import { describe, expect, it } from "vitest";

import { redactLiterals, redactValue } from "../src/redact.js";

describe("redactLiterals", () => {
  it("replaces every occurrence of a secret", () => {
    const output = redactLiterals("key=abc123456 and again abc123456", [
      "abc123456",
    ]);
    expect(output).toBe("key=[redacted] and again [redacted]");
  });

  it("treats secrets as literals, not patterns", () => {
    expect(redactLiterals("a.b.c.d", ["a.b.c.d"])).toBe("[redacted]");
    expect(redactLiterals("axbxcxd", ["a.b.c.d"])).toBe("axbxcxd");
  });

  it("ignores short values that would over-match", () => {
    expect(redactLiterals("the cat sat", ["cat"])).toBe("the cat sat");
  });

  it("ignores undefined secrets", () => {
    expect(redactLiterals("unchanged", [undefined])).toBe("unchanged");
  });
});

describe("redactValue", () => {
  it("redacts values held under sensitive keys", () => {
    const output = redactValue({
      apiKey: "public-looking",
      api_secret: "s3cret",
      Authorization: "Basic zzz",
      ticker: "AAPL_US_EQ",
    });

    expect(output).toEqual({
      apiKey: "[redacted]",
      api_secret: "[redacted]",
      Authorization: "[redacted]",
      ticker: "AAPL_US_EQ",
    });
  });

  it("redacts literal secrets nested anywhere in the structure", () => {
    const output = redactValue(
      { responses: [{ body: "token supersecret1 rejected" }] },
      ["supersecret1"],
    );

    expect(output).toEqual({
      responses: [{ body: "token [redacted] rejected" }],
    });
  });

  it("serialises errors including a scrubbed stack", () => {
    const error = new Error("failed for supersecret1");
    const output = redactValue(error, ["supersecret1"]) as {
      name: string;
      message: string;
      stack: string;
    };

    expect(output.name).toBe("Error");
    expect(output.message).toBe("failed for [redacted]");
    expect(output.stack).not.toContain("supersecret1");
  });

  it("breaks cycles instead of throwing", () => {
    const node: Record<string, unknown> = { name: "root" };
    node["self"] = node;

    expect(redactValue(node)).toEqual({ name: "root", self: "[circular]" });
  });

  it("truncates beyond the depth limit", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "too far" } } } } } } };
    expect(redactValue(deep)).toEqual({
      a: { b: { c: { d: { e: { f: "[truncated]" } } } } },
    });
  });

  it("reduces non-serialisable values", () => {
    expect(redactValue(10n)).toBe("10");
    expect(redactValue(() => undefined)).toBe("[function]");
    expect(redactValue(new Date("2026-01-02T03:04:05.000Z"))).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    expect(redactValue(new Set(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("passes primitives through untouched", () => {
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeUndefined();
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
  });
});
