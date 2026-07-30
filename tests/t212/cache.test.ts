import { describe, expect, it, vi } from "vitest";

import {
  CACHE_TTL_FACTORS,
  TtlCache,
  ttlForGroup,
} from "../../src/t212/cache.js";

function fakeClock() {
  let current = 1_000_000;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("TtlCache", () => {
  it("returns a stored value before it expires", () => {
    const clock = fakeClock();
    const cache = new TtlCache({ now: clock.now });

    cache.set("k", { free: 1 }, 1_000);
    clock.advance(999);

    expect(cache.get("k")).toEqual({ free: 1 });
  });

  it("drops a value once it expires", () => {
    const clock = fakeClock();
    const cache = new TtlCache({ now: clock.now });

    cache.set("k", "v", 1_000);
    clock.advance(1_000);

    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("refuses to store anything with a non-positive TTL", () => {
    const cache = new TtlCache();

    cache.set("k", "v", 0);
    cache.set("j", "v", -1);

    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new TtlCache({ maxEntries: 2 });

    cache.set("a", 1, 10_000);
    cache.set("b", 2, 10_000);
    cache.get("a"); // "a" is now the most recently used.
    cache.set("c", 3, 10_000);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("supports explicit invalidation", () => {
    const cache = new TtlCache();

    cache.set("a", 1, 10_000);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();

    cache.set("b", 1, 10_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe("TtlCache.fetch", () => {
  it("calls the loader once and reuses the result", async () => {
    const cache = new TtlCache();
    const load = vi.fn().mockResolvedValue("loaded");

    await expect(cache.fetch("k", 1_000, load)).resolves.toBe("loaded");
    await expect(cache.fetch("k", 1_000, load)).resolves.toBe("loaded");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after expiry", async () => {
    const clock = fakeClock();
    const cache = new TtlCache({ now: clock.now });
    const load = vi.fn().mockResolvedValue("loaded");

    await cache.fetch("k", 1_000, load);
    clock.advance(1_001);
    await cache.fetch("k", 1_000, load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const cache = new TtlCache();
    let release: (value: string) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    const first = cache.fetch("k", 1_000, load);
    const second = cache.fetch("k", 1_000, load);
    release("loaded");

    await expect(Promise.all([first, second])).resolves.toEqual([
      "loaded",
      "loaded",
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure", async () => {
    const cache = new TtlCache();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream down"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.fetch("k", 1_000, load)).rejects.toThrow(
      "upstream down",
    );
    await expect(cache.fetch("k", 1_000, load)).resolves.toBe("recovered");
  });

  it("propagates a shared failure to every waiter", async () => {
    const cache = new TtlCache();
    const load = vi.fn().mockRejectedValue(new Error("upstream down"));

    const first = cache.fetch("k", 1_000, load);
    const second = cache.fetch("k", 1_000, load);

    await expect(first).rejects.toThrow("upstream down");
    await expect(second).rejects.toThrow("upstream down");
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("ttlForGroup", () => {
  it("caches reference data far longer than money", () => {
    expect(ttlForGroup("instruments", 60_000)).toBeGreaterThan(
      ttlForGroup("portfolio", 60_000),
    );
    expect(ttlForGroup("exchanges", 60_000)).toBeGreaterThan(
      ttlForGroup("account", 60_000),
    );
  });

  it("never caches pending orders", () => {
    expect(ttlForGroup("orders", 300_000)).toBe(0);
  });

  it("does not cache an unrecognised group", () => {
    expect(ttlForGroup("something-new", 300_000)).toBe(0);
  });

  it("scales with the configured base TTL", () => {
    expect(ttlForGroup("history", 10_000)).toBe(10_000);
    expect(ttlForGroup("history", 20_000)).toBe(20_000);
  });

  it("keeps every balance-bearing group under a minute at the default TTL", () => {
    for (const group of ["account", "portfolio", "pies"]) {
      expect(ttlForGroup(group, 300_000), group).toBeLessThanOrEqual(60_000);
    }
  });

  it("declares a factor for every group it knows about", () => {
    expect(Object.keys(CACHE_TTL_FACTORS).length).toBeGreaterThan(0);
    for (const factor of Object.values(CACHE_TTL_FACTORS)) {
      expect(factor).toBeGreaterThanOrEqual(0);
    }
  });
});
