import { describe, expect, it } from "vitest";

import { RateLimiter, RATE_LIMITS } from "../../src/t212/rate-limit.js";

/**
 * A controllable clock. Sleeping advances it, so tests assert on the total
 * simulated wait rather than on wall-clock time.
 */
function fakeClock() {
  let current = 1_000_000;
  const waits: number[] = [];

  return {
    waits,
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    sleep: (ms: number) => {
      waits.push(ms);
      current += ms;
      return Promise.resolve();
    },
  };
}

describe("RATE_LIMITS", () => {
  it("keeps every configured limit at or below one call per second", () => {
    for (const [group, limit] of Object.entries(RATE_LIMITS)) {
      const perSecond = limit.capacity / (limit.windowMs / 1_000);
      expect(perSecond, group).toBeLessThanOrEqual(1);
    }
  });
});

describe("RateLimiter", () => {
  it("lets the first call through immediately", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await limiter.acquire("account");

    expect(clock.waits).toEqual([]);
  });

  it("waits for the window before a second call in the same group", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await limiter.acquire("account");
    await limiter.acquire("account");

    // account allows 1 per 5s.
    expect(clock.waits).toEqual([5_000]);
  });

  it("keeps groups independent", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await limiter.acquire("account");
    await limiter.acquire("history");

    expect(clock.waits).toEqual([]);
  });

  it("spends a multi-call budget before making anyone wait", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    // history allows 6 per minute.
    for (let i = 0; i < 6; i += 1) await limiter.acquire("history");
    expect(clock.waits).toEqual([]);

    await limiter.acquire("history");
    expect(clock.waits).toEqual([10_000]);
  });

  it("refills continuously rather than in discrete windows", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await limiter.acquire("account");
    clock.advance(5_000);
    await limiter.acquire("account");

    expect(clock.waits).toEqual([]);
  });

  it("credits time already elapsed against the wait", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await limiter.acquire("account");
    clock.advance(3_000);
    await limiter.acquire("account");

    expect(clock.waits).toEqual([2_000]);
  });

  it("never accumulates more budget than the window allows", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await limiter.acquire("account");
    clock.advance(600_000);

    await limiter.acquire("account");
    await limiter.acquire("account");

    expect(clock.waits).toEqual([5_000]);
  });

  it("serialises concurrent callers instead of handing out one token twice", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await Promise.all([
      limiter.acquire("account"),
      limiter.acquire("account"),
      limiter.acquire("account"),
    ]);

    expect(clock.waits).toEqual([5_000, 5_000]);
  });

  it("treats an unknown group as unlimited rather than guessing", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await limiter.acquire("brand-new-endpoint");
    await limiter.acquire("brand-new-endpoint");

    expect(clock.waits).toEqual([]);
  });

  it("accepts overridden limits", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      ...clock,
      limits: { account: { capacity: 1, windowMs: 1_000 } },
    });

    await limiter.acquire("account");
    await limiter.acquire("account");

    expect(clock.waits).toEqual([1_000]);
  });

  it("can be disabled outright", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ ...clock, enabled: false });

    await limiter.acquire("account");
    await limiter.acquire("account");

    expect(clock.waits).toEqual([]);
    expect(limiter.timeUntilAvailable("account")).toBe(0);
  });
});

describe("RateLimiter.timeUntilAvailable", () => {
  it("reports zero while budget remains", () => {
    const limiter = new RateLimiter(fakeClock());

    expect(limiter.timeUntilAvailable("account")).toBe(0);
  });

  it("reports the remaining wait without consuming budget", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock);

    await limiter.acquire("account");

    expect(limiter.timeUntilAvailable("account")).toBe(5_000);
    expect(limiter.timeUntilAvailable("account")).toBe(5_000);
  });

  it("reports zero for an unknown group", () => {
    expect(new RateLimiter(fakeClock()).timeUntilAvailable("nope")).toBe(0);
  });
});
