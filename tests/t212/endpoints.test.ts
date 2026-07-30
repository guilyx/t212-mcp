import { describe, expect, it } from "vitest";

import {
  ENDPOINTS,
  resolvePath,
  type EndpointName,
} from "../../src/t212/endpoints.js";
import { RATE_LIMITS } from "../../src/t212/rate-limit.js";

describe("ENDPOINTS", () => {
  it("gives every endpoint a group that has a configured limit", () => {
    for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
      expect(Object.keys(RATE_LIMITS), name).toContain(endpoint.group);
    }
  });

  it("declares only paths below the versioned API prefix", () => {
    for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
      expect(endpoint.path.startsWith("/"), name).toBe(true);
      expect(endpoint.path, name).not.toContain("://");
      expect(endpoint.path, name).not.toContain("/api/v0");
    }
  });

  it("summarises every endpoint for the tool descriptions", () => {
    for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
      expect(endpoint.summary.length, name).toBeGreaterThan(10);
    }
  });

  it("exposes no endpoint that could place or cancel an order", () => {
    // The table is the audit surface for the read-only guarantee: if an
    // order-mutating path is ever added, this fails.
    for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
      expect(endpoint.path, name).not.toMatch(
        /orders\/(market|limit|stop|stop_limit|stop-limit)/,
      );
    }
  });
});

describe("resolvePath", () => {
  it("returns a static path unchanged", () => {
    expect(resolvePath("accountCash")).toBe("/equity/account/cash");
  });

  it("substitutes a path parameter", () => {
    expect(resolvePath("position", { ticker: "AAPL_US_EQ" })).toBe(
      "/equity/portfolio/AAPL_US_EQ",
    );
  });

  it("percent-encodes a value so it cannot escape its segment", () => {
    expect(resolvePath("position", { ticker: "../orders/market" })).toBe(
      "/equity/portfolio/..%2Forders%2Fmarket",
    );
  });

  it("encodes query-string characters rather than letting them through", () => {
    expect(resolvePath("order", { id: "1?x=2" })).toBe(
      "/equity/orders/1%3Fx%3D2",
    );
  });

  it("rejects a missing parameter instead of building a broken path", () => {
    expect(() => resolvePath("position", {})).toThrow(/ticker/);
  });

  it("rejects an empty parameter", () => {
    expect(() => resolvePath("position", { ticker: "" })).toThrow(/ticker/);
  });

  it("resolves every parameterless endpoint without arguments", () => {
    const parameterless = (Object.keys(ENDPOINTS) as EndpointName[]).filter(
      (name) => !ENDPOINTS[name].path.includes("{"),
    );

    for (const name of parameterless) {
      expect(() => resolvePath(name)).not.toThrow();
    }
  });
});
