/**
 * Client-side rate limiting.
 *
 * Trading 212 publishes per-endpoint limits that are unusually strict — parts
 * of the metadata API allow roughly one call per minute. A model exploring an
 * account will happily call four tools in a row, so without shaping here the
 * server would spend most of its time backing off from 429s. Waiting a known
 * interval is faster than being rejected and retrying blind, and it keeps the
 * account in good standing.
 *
 * The configured limits are deliberately at or below the documented ones.
 * Being slightly conservative costs a few hundred milliseconds; being
 * optimistic costs a rejected request and a retry.
 */

export interface RateLimit {
  /** Requests allowed per window. */
  capacity: number;
  windowMs: number;
}

/**
 * Endpoint groups that share a budget upstream. Keyed by the group name used
 * in the endpoint table.
 */
export const RATE_LIMITS = {
  account: { capacity: 1, windowMs: 5_000 },
  portfolio: { capacity: 1, windowMs: 5_000 },
  orders: { capacity: 1, windowMs: 5_000 },
  history: { capacity: 6, windowMs: 60_000 },
  pies: { capacity: 1, windowMs: 30_000 },
  instruments: { capacity: 1, windowMs: 50_000 },
  exchanges: { capacity: 1, windowMs: 30_000 },
  exports: { capacity: 1, windowMs: 30_000 },
} as const satisfies Record<string, RateLimit>;

export type RateLimitGroup = keyof typeof RATE_LIMITS;

export interface RateLimiterOptions {
  limits?: Partial<Record<string, RateLimit>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Disables waiting entirely. Only for tests that assert other behaviour. */
  enabled?: boolean;
}

interface BucketState {
  tokens: number;
  lastRefillAt: number;
  /** Serialises acquisition so two callers cannot reserve the same token. */
  tail: Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Token bucket per endpoint group.
 *
 * Tokens refill continuously rather than in discrete windows, so a caller
 * that has been idle is not punished for the boundary it happens to land on.
 */
export class RateLimiter {
  private readonly limits: Record<string, RateLimit>;
  private readonly buckets = new Map<string, BucketState>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly enabled: boolean;

  constructor(options: RateLimiterOptions = {}) {
    this.limits = { ...RATE_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.enabled = options.enabled ?? true;
  }

  /**
   * Resolves once the group has budget, having waited if necessary.
   *
   * An unknown group is unlimited: a new endpoint should not silently inherit
   * another endpoint's budget just because someone forgot to add it here.
   */
  async acquire(group: string): Promise<void> {
    if (!this.enabled) return;

    const limit = this.limits[group];
    if (!limit) return;

    const bucket = this.bucketFor(group, limit);

    // Chain onto the group's queue so concurrent callers wait their turn
    // rather than all reading the same token count.
    const turn = bucket.tail.then(async () => {
      this.refill(bucket, limit);

      if (bucket.tokens < 1) {
        const perToken = limit.windowMs / limit.capacity;
        const waitMs = Math.ceil((1 - bucket.tokens) * perToken);
        await this.sleep(waitMs);
        this.refill(bucket, limit);
      }

      bucket.tokens = Math.max(0, bucket.tokens - 1);
    });

    bucket.tail = turn.catch(() => undefined);
    return turn;
  }

  /** Milliseconds until the group has budget, without consuming any. */
  timeUntilAvailable(group: string): number {
    const limit = this.limits[group];
    if (!limit || !this.enabled) return 0;

    const bucket = this.bucketFor(group, limit);
    this.refill(bucket, limit);
    if (bucket.tokens >= 1) return 0;

    const perToken = limit.windowMs / limit.capacity;
    return Math.ceil((1 - bucket.tokens) * perToken);
  }

  private bucketFor(group: string, limit: RateLimit): BucketState {
    let bucket = this.buckets.get(group);
    if (!bucket) {
      bucket = {
        tokens: limit.capacity,
        lastRefillAt: this.now(),
        tail: Promise.resolve(),
      };
      this.buckets.set(group, bucket);
    }
    return bucket;
  }

  private refill(bucket: BucketState, limit: RateLimit): void {
    const now = this.now();
    const elapsed = now - bucket.lastRefillAt;
    if (elapsed <= 0) return;

    const refillRate = limit.capacity / limit.windowMs;
    bucket.tokens = Math.min(
      limit.capacity,
      bucket.tokens + elapsed * refillRate,
    );
    bucket.lastRefillAt = now;
  }
}
