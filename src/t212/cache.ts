/**
 * In-memory response cache with single-flight de-duplication.
 *
 * This exists because of the rate limits, not because the API is slow. The
 * instrument catalogue is a multi-megabyte response behind a roughly
 * one-per-minute limit, and a model resolving three tickers would otherwise
 * spend two minutes waiting for data that has not changed. Balances and
 * positions are given short or zero TTLs — stale money is worse than a slow
 * answer.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface TtlCacheOptions {
  /** Entries are evicted oldest-first beyond this. */
  maxEntries?: number;
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 64;

export class TtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns `unknown` rather than a caller-chosen `T`: nothing here validates
   * the stored shape, and a generic would dress an unchecked cast up as a
   * type guarantee. Callers that know the shape narrow it themselves.
   */
  get(key: string): unknown {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh insertion order so eviction approximates least-recently-used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (ttlMs <= 0) return;

    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Returns the cached value, or calls `load` and caches the result.
   *
   * Concurrent calls for the same key share one `load` call. Under a
   * one-request-per-minute limit, two tools racing for the catalogue would
   * otherwise serialise into two minutes of waiting for identical data.
   *
   * A rejected load is never cached, and is propagated to every waiter.
   */
  async fetch<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached as T;

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = load()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}

/**
 * How long each endpoint group's responses stay usable, as a multiple of the
 * configured base TTL.
 *
 * Reference data barely changes; money does. Anything that could be quoted
 * back to a user as a current figure gets a short life.
 */
export const CACHE_TTL_FACTORS = {
  instruments: 12,
  exchanges: 12,
  history: 1,
  pies: 0.2,
  account: 0.1,
  portfolio: 0.1,
  orders: 0,
  exports: 0,
} as const satisfies Record<string, number>;

export function ttlForGroup(group: string, baseTtlMs: number): number {
  const factor = (CACHE_TTL_FACTORS as Record<string, number | undefined>)[
    group
  ];
  // Unknown groups are not cached: opting in should be a deliberate act.
  return factor === undefined ? 0 : Math.round(baseTtlMs * factor);
}
