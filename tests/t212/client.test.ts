import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLogger } from "../../src/logger.js";
import {
  authorizationHeader,
  parseRetryAfter,
  T212Client,
  type FetchLike,
} from "../../src/t212/client.js";
import {
  T212AuthError,
  T212NetworkError,
  T212RateLimitError,
  T212ResponseError,
  T212ServerError,
  T212TimeoutError,
} from "../../src/t212/errors.js";
import { RateLimiter } from "../../src/t212/rate-limit.js";
import { jsonResponse, testConfig } from "../helpers/config.js";

const schema = z.object({ free: z.number(), total: z.number() });

interface Harness {
  client: T212Client;
  calls: { url: string; init: RequestInit }[];
  sleeps: number[];
}

function harness(
  responses: (Response | Error)[],
  configOverrides: Parameters<typeof testConfig>[0] = {},
): Harness {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const queue = [...responses];

  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected extra request");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };

  return {
    calls,
    sleeps,
    client: new T212Client({
      config: testConfig(configOverrides),
      fetch: fetchImpl,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      // Midpoint of the jitter window keeps backoff assertions exact.
      random: () => 0.5,
      // Rate limiting has its own tests. Leaving it on here would make every
      // second request in a group wait out a real multi-second window.
      rateLimiter: new RateLimiter({ enabled: false }),
    }),
  };
}

const request = { path: "/equity/account/cash", schema } as const;

describe("authorizationHeader", () => {
  it("sends the bare key when no secret is configured", () => {
    expect(authorizationHeader(testConfig())).toBe("test-api-key-000");
  });

  it("sends HTTP Basic when a key/secret pair is configured", () => {
    const header = authorizationHeader(
      testConfig({ apiSecret: "test-secret-000" }),
    );
    const encoded = Buffer.from("test-api-key-000:test-secret-000").toString(
      "base64",
    );

    expect(header).toBe(`Basic ${encoded}`);
  });
});

describe("parseRetryAfter", () => {
  it("reads a delay in seconds", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
  });

  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-01-02T03:04:05.000Z");
    expect(parseRetryAfter("Fri, 02 Jan 2026 03:04:15 GMT", now)).toBe(10_000);
  });

  it("clamps a date already in the past to zero", () => {
    const now = Date.parse("2026-01-02T03:04:05.000Z");
    expect(parseRetryAfter("Fri, 02 Jan 2026 03:00:00 GMT", now)).toBe(0);
  });

  it("returns undefined when absent or unparseable", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("T212Client.get", () => {
  it("returns parsed data on success", async () => {
    const { client } = harness([jsonResponse({ free: 10.5, total: 42 })]);

    await expect(client.get(request)).resolves.toEqual({
      free: 10.5,
      total: 42,
    });
  });

  it("builds the URL under the versioned API prefix", async () => {
    const { client, calls } = harness([jsonResponse({ free: 1, total: 1 })]);

    await client.get(request);

    expect(calls[0]?.url).toBe(
      "https://demo.trading212.com/api/v0/equity/account/cash",
    );
  });

  it("appends query parameters and skips undefined ones", async () => {
    const { client, calls } = harness([jsonResponse({ free: 1, total: 1 })]);

    await client.get({
      ...request,
      query: { limit: 20, cursor: undefined, includeAll: false },
    });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("includeAll")).toBe("false");
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("sends credentials and identifies itself", async () => {
    const { client, calls } = harness([jsonResponse({ free: 1, total: 1 })]);

    await client.get(request);
    const headers = calls[0]!.init.headers as Record<string, string>;

    expect(headers["Authorization"]).toBe("test-api-key-000");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe("t212-mcp");
  });

  it("never issues anything but a GET", async () => {
    const { client, calls } = harness([jsonResponse({ free: 1, total: 1 })]);

    await client.get(request);

    expect(calls[0]?.init.method).toBe("GET");
  });
});

describe("T212Client error handling", () => {
  it("does not retry an authentication failure", async () => {
    const { client, calls } = harness([
      jsonResponse("Forbidden", { status: 403 }),
    ]);

    await expect(client.get(request)).rejects.toBeInstanceOf(T212AuthError);
    expect(calls).toHaveLength(1);
  });

  it("retries a server error and succeeds", async () => {
    const { client, calls } = harness([
      jsonResponse("nope", { status: 503 }),
      jsonResponse({ free: 1, total: 2 }),
    ]);

    await expect(client.get(request)).resolves.toEqual({ free: 1, total: 2 });
    expect(calls).toHaveLength(2);
  });

  it("gives up after the configured number of retries", async () => {
    const { client, calls } = harness([
      jsonResponse("a", { status: 500 }),
      jsonResponse("b", { status: 500 }),
      jsonResponse("c", { status: 500 }),
    ]);

    await expect(client.get(request)).rejects.toBeInstanceOf(T212ServerError);
    expect(calls).toHaveLength(3); // 1 attempt + 2 retries
  });

  it("backs off exponentially between attempts", async () => {
    const { client, sleeps } = harness([
      jsonResponse("a", { status: 500 }),
      jsonResponse("b", { status: 500 }),
      jsonResponse({ free: 1, total: 1 }),
    ]);

    await client.get(request);

    // 500ms then 1000ms ceilings, at the midpoint of the jitter window.
    expect(sleeps).toEqual([375, 750]);
  });

  it("honours Retry-After over its own backoff", async () => {
    const { client, sleeps } = harness([
      jsonResponse("slow down", {
        status: 429,
        headers: { "retry-after": "7" },
      }),
      jsonResponse({ free: 1, total: 1 }),
    ]);

    await client.get(request);

    expect(sleeps).toEqual([7_000]);
  });

  it("caps an absurd Retry-After rather than hanging", async () => {
    const { client, sleeps } = harness([
      jsonResponse("slow down", {
        status: 429,
        headers: { "retry-after": "3600" },
      }),
      jsonResponse({ free: 1, total: 1 }),
    ]);

    await client.get(request);

    expect(sleeps).toEqual([20_000]);
  });

  it("surfaces a rate limit that never clears", async () => {
    const { client } = harness([jsonResponse("slow down", { status: 429 })], {
      maxRetries: 0,
    });

    await expect(client.get(request)).rejects.toBeInstanceOf(
      T212RateLimitError,
    );
  });

  it("retries a network failure", async () => {
    const { client, calls } = harness([
      new TypeError("fetch failed"),
      jsonResponse({ free: 3, total: 4 }),
    ]);

    await expect(client.get(request)).resolves.toEqual({ free: 3, total: 4 });
    expect(calls).toHaveLength(2);
  });

  it("reports an unreachable host as a network error", async () => {
    const { client } = harness([new TypeError("fetch failed")], {
      maxRetries: 0,
    });

    await expect(client.get(request)).rejects.toBeInstanceOf(T212NetworkError);
  });

  it("extracts an error code from a JSON body", async () => {
    const { client } = harness(
      [jsonResponse({ code: "InvalidTicker" }, { status: 400 })],
      { maxRetries: 0 },
    );

    await expect(client.get(request)).rejects.toMatchObject({
      code: "InvalidTicker",
    });
  });

  it("scrubs credentials echoed back in an error body", async () => {
    const { client } = harness(
      [
        jsonResponse("rejected key test-api-key-000", {
          status: 400,
        }),
      ],
      { maxRetries: 0 },
    );

    const error = await client.get(request).catch((caught: unknown) => caught);

    expect((error as Error).message).toContain("[redacted]");
    expect((error as Error).message).not.toContain("test-api-key-000");
  });
});

describe("T212Client response validation", () => {
  it("rejects a payload that does not match the schema", async () => {
    const { client } = harness([jsonResponse({ free: "lots" })], {
      maxRetries: 0,
    });

    await expect(client.get(request)).rejects.toBeInstanceOf(T212ResponseError);
  });

  it("does not retry a schema mismatch", async () => {
    const { client, calls } = harness([jsonResponse({ wrong: true })]);

    await expect(client.get(request)).rejects.toBeInstanceOf(T212ResponseError);
    expect(calls).toHaveLength(1);
  });

  it("names the offending fields in the message", async () => {
    const { client } = harness([jsonResponse({ free: "lots", total: 1 })], {
      maxRetries: 0,
    });

    await expect(client.get(request)).rejects.toThrow(/free/);
  });

  it("rejects a body that is not JSON", async () => {
    const { client } = harness([jsonResponse("<html>oops</html>")], {
      maxRetries: 0,
    });

    await expect(client.get(request)).rejects.toThrow(/not valid JSON/);
  });

  it("treats an empty body as null so schemas decide", async () => {
    const { client } = harness([jsonResponse("")], { maxRetries: 0 });

    await expect(
      client.get({ path: "/x", schema: z.null() }),
    ).resolves.toBeNull();
  });
});

describe("T212Client cancellation", () => {
  it("propagates a caller abort without wrapping it", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Aborted", "AbortError");
    const { client } = harness([abortError], { maxRetries: 0 });
    controller.abort();

    await expect(
      client.get({ ...request, signal: controller.signal }),
    ).rejects.toBe(abortError);
  });

  it("reports the configured timeout as a timeout error", async () => {
    const config = testConfig({ timeoutMs: 1_000, maxRetries: 0 });
    const client = new T212Client({
      config,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted", "TimeoutError"),
            );
          });
        }),
      sleep: () => Promise.resolve(),
    });

    vi.useFakeTimers();
    try {
      const pending = client.get(request);
      await vi.advanceTimersByTimeAsync(1_100);
      await expect(pending).rejects.toBeInstanceOf(T212TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("T212Client logging", () => {
  it("logs a retry without leaking the credential", async () => {
    const lines: string[] = [];
    const client = new T212Client({
      config: testConfig(),
      logger: createLogger({
        level: "debug",
        secrets: ["test-api-key-000"],
        stream: Object.assign(Object.create(null), {
          write: (chunk: string) => {
            lines.push(chunk);
            return true;
          },
        }) as never,
      }),
      fetch: () =>
        Promise.resolve(
          jsonResponse("denied for test-api-key-000", { status: 500 }),
        ),
      sleep: () => Promise.resolve(),
      random: () => 0.5,
    });

    await expect(client.get(request)).rejects.toBeInstanceOf(T212ServerError);

    const output = lines.join("");
    expect(output).toContain("request failed");
    expect(output).toContain('"willRetry":true');
    expect(output).not.toContain("test-api-key-000");
  });
});

describe("T212Client caching", () => {
  it("serves a repeat call for a cacheable group from cache", async () => {
    const { client, calls } = harness([jsonResponse({ free: 1, total: 1 })]);

    await client.get({ ...request, group: "instruments" });
    await client.get({ ...request, group: "instruments" });

    expect(calls).toHaveLength(1);
  });

  it("does not cache groups whose data can move", async () => {
    const { client, calls } = harness([
      jsonResponse({ free: 1, total: 1 }),
      jsonResponse({ free: 2, total: 2 }),
    ]);

    await client.get({ ...request, group: "orders" });
    await client.get({ ...request, group: "orders" });

    expect(calls).toHaveLength(2);
  });

  it("does not cache a request with no group", async () => {
    const { client, calls } = harness([
      jsonResponse({ free: 1, total: 1 }),
      jsonResponse({ free: 1, total: 1 }),
    ]);

    await client.get(request);
    await client.get(request);

    expect(calls).toHaveLength(2);
  });

  it("keys the cache on the full URL, query included", async () => {
    const { client, calls } = harness([
      jsonResponse({ free: 1, total: 1 }),
      jsonResponse({ free: 2, total: 2 }),
    ]);

    await client.get({ ...request, group: "instruments", query: { q: "a" } });
    await client.get({ ...request, group: "instruments", query: { q: "b" } });

    expect(calls).toHaveLength(2);
  });

  it("collapses concurrent identical calls into one request", async () => {
    const { client, calls } = harness([jsonResponse({ free: 1, total: 1 })]);

    await Promise.all([
      client.get({ ...request, group: "instruments" }),
      client.get({ ...request, group: "instruments" }),
      client.get({ ...request, group: "instruments" }),
    ]);

    expect(calls).toHaveLength(1);
  });

  it("honours an explicit TTL override", async () => {
    const { client, calls } = harness([jsonResponse({ free: 1, total: 1 })]);

    await client.get({ ...request, cacheTtlMs: 60_000 });
    await client.get({ ...request, cacheTtlMs: 60_000 });

    expect(calls).toHaveLength(1);
  });

  it("does not cache a failed request", async () => {
    const { client, calls } = harness([
      jsonResponse("boom", { status: 500 }),
      jsonResponse("boom", { status: 500 }),
      jsonResponse("boom", { status: 500 }),
      jsonResponse({ free: 9, total: 9 }),
    ]);

    await expect(
      client.get({ ...request, group: "instruments" }),
    ).rejects.toBeInstanceOf(T212ServerError);

    await expect(
      client.get({ ...request, group: "instruments" }),
    ).resolves.toEqual({ free: 9, total: 9 });

    expect(calls).toHaveLength(4);
  });
});

describe("T212Client rate limiting", () => {
  it("waits for budget before a second call in the same group", async () => {
    const waits: number[] = [];
    let clock = 1_000_000;
    const client = new T212Client({
      config: testConfig(),
      fetch: () => Promise.resolve(jsonResponse({ free: 1, total: 1 })),
      sleep: () => Promise.resolve(),
      rateLimiter: new RateLimiter({
        now: () => clock,
        sleep: (ms) => {
          waits.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      }),
    });

    await client.get({ ...request, group: "orders" });
    await client.get({ ...request, group: "orders" });

    expect(waits).toEqual([5_000]);
  });

  it("does not spend budget on a cache hit", async () => {
    const waits: number[] = [];
    let clock = 1_000_000;
    const client = new T212Client({
      config: testConfig(),
      fetch: () => Promise.resolve(jsonResponse({ free: 1, total: 1 })),
      sleep: () => Promise.resolve(),
      rateLimiter: new RateLimiter({
        now: () => clock,
        sleep: (ms) => {
          waits.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      }),
    });

    await client.get({ ...request, group: "instruments" });
    await client.get({ ...request, group: "instruments" });

    expect(waits).toEqual([]);
  });
});
