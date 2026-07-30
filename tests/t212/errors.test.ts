import { describe, expect, it } from "vitest";

import {
  describeError,
  errorFromStatus,
  T212AuthError,
  T212BadRequestError,
  T212Error,
  T212NotFoundError,
  T212RateLimitError,
  T212ServerError,
} from "../../src/t212/errors.js";

describe("errorFromStatus", () => {
  it.each([
    [401, T212AuthError],
    [403, T212AuthError],
    [404, T212NotFoundError],
    [422, T212BadRequestError],
    [429, T212RateLimitError],
    [500, T212ServerError],
    [503, T212ServerError],
  ])("maps %i to the matching class", (status, expected) => {
    expect(errorFromStatus(status, "boom")).toBeInstanceOf(expected);
  });

  it("records the status on the error", () => {
    expect(errorFromStatus(404, "missing").status).toBe(404);
  });

  it("marks only transient failures as retryable", () => {
    expect(errorFromStatus(429, "slow down").retryable).toBe(true);
    expect(errorFromStatus(503, "upstream").retryable).toBe(true);
    expect(errorFromStatus(401, "denied").retryable).toBe(false);
    expect(errorFromStatus(404, "missing").retryable).toBe(false);
    expect(errorFromStatus(400, "bad").retryable).toBe(false);
  });

  it("falls back to the base error for a non-error status", () => {
    const error = errorFromStatus(302, "redirect");
    expect(error).toBeInstanceOf(T212Error);
    expect(error.name).toBe("T212Error");
  });

  it("keeps the code supplied by the API body", () => {
    expect(errorFromStatus(400, "bad", { code: "InvalidTicker" }).code).toBe(
      "InvalidTicker",
    );
  });
});

describe("T212RateLimitError", () => {
  it("carries the retry delay when one was supplied", () => {
    expect(
      new T212RateLimitError("slow down", { retryAfterMs: 5_000 }).retryAfterMs,
    ).toBe(5_000);
  });
});

describe("describeError", () => {
  it("appends recovery guidance for auth failures", () => {
    const described = describeError(new T212AuthError("Returned 401."));

    expect(described).toContain("Returned 401.");
    expect(described).toContain("T212_API_KEY");
    expect(described).toContain("separate credentials");
  });

  it("tells the caller to look up the ticker on a 404", () => {
    expect(describeError(new T212NotFoundError("Returned 404."))).toContain(
      "instrument search tool",
    );
  });

  it("returns the bare message when there is no guidance", () => {
    expect(describeError(new T212BadRequestError("Bad request."))).toBe(
      "Bad request.",
    );
  });

  it("handles plain errors and non-errors", () => {
    expect(describeError(new Error("plain"))).toBe("plain");
    expect(describeError("just a string")).toBe("just a string");
  });
});
