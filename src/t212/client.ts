import type { z } from "zod";

import { API_PATH_PREFIX, type Config, configSecrets } from "../config.js";
import { type Logger, silentLogger } from "../logger.js";
import { redactLiterals } from "../redact.js";
import { TtlCache, ttlForGroup } from "./cache.js";
import { RateLimiter } from "./rate-limit.js";
import {
  errorFromStatus,
  T212NetworkError,
  T212ResponseError,
  T212TimeoutError,
  type T212Error,
} from "./errors.js";

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions<T> {
  /** Path below `/api/v0`, e.g. `/equity/account/cash`. */
  path: string;
  query?: Record<string, QueryValue>;
  /** Response schema. Parsing failures become {@link T212ResponseError}. */
  schema: z.ZodType<T>;
  /** Caller-side cancellation, combined with the configured timeout. */
  signal?: AbortSignal;
  /** Label used in logs; defaults to the path. */
  operation?: string;
  /**
   * Endpoint group sharing an upstream rate-limit budget, and deciding how
   * long the response may be cached. Omitted means unlimited and uncached.
   */
  group?: string;
  /** Overrides the group's default cache lifetime. */
  cacheTtlMs?: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface T212ClientOptions {
  config: Config;
  logger?: Logger;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests to make backoff jitter deterministic. */
  random?: () => number;
  rateLimiter?: RateLimiter;
  cache?: TtlCache;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20_000;
/** Bodies above this are truncated before being logged or wrapped in an error. */
const MAX_ERROR_BODY_CHARS = 500;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds the `Authorization` header.
 *
 * Trading 212 issues newer credentials as a key/secret pair authenticated
 * with HTTP Basic, while older keys are a single token sent as the raw header
 * value. Which one applies is inferred from whether a secret is configured.
 */
export function authorizationHeader(config: Config): string {
  if (!config.apiSecret) return config.apiKey;
  const encoded = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString(
    "base64",
  );
  return `Basic ${encoded}`;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, QueryValue> | undefined,
): string {
  const url = new URL(`${API_PATH_PREFIX}${path}`, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * `Retry-After` is either a delay in seconds or an HTTP date. Returns
 * undefined when the header is absent or unparseable, leaving the caller on
 * its normal backoff schedule.
 */
export function parseRetryAfter(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;

  return Math.max(0, date - now);
}

/** Extracts an error code from whatever shape the API returned. */
function extractErrorCode(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["code", "errorCode", "error"]) {
        const value = record[key];
        if (typeof value === "string") return value;
      }
    }
  } catch {
    // Not JSON. The status alone carries enough meaning.
  }
  return undefined;
}

/**
 * HTTP client for the Trading 212 public API.
 *
 * Owns four concerns that would otherwise be repeated per tool: attaching
 * credentials, enforcing a timeout, classifying failures, and retrying the
 * subset of them that could plausibly succeed on a second attempt. Responses
 * are parsed against a schema rather than cast, because a wrong number
 * presented as a balance is worse than an error.
 */
export class T212Client {
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly secrets: readonly string[];
  private readonly rateLimiter: RateLimiter;
  private readonly cache: TtlCache;

  constructor(options: T212ClientOptions) {
    this.config = options.config;
    this.logger = options.logger ?? silentLogger;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.secrets = configSecrets(this.config);
    this.rateLimiter = options.rateLimiter ?? new RateLimiter();
    this.cache = options.cache ?? new TtlCache();
  }

  /**
   * Performs a GET, serving from cache when possible, waiting for rate-limit
   * budget, and retrying transient failures up to the configured limit.
   */
  async get<T>(options: RequestOptions<T>): Promise<T> {
    const url = buildUrl(this.config.baseUrl, options.path, options.query);
    const ttlMs =
      options.cacheTtlMs ??
      ttlForGroup(options.group ?? "", this.config.cacheTtlMs);

    if (ttlMs <= 0) return this.send(url, options);

    // The cache de-duplicates concurrent callers as well as sequential ones,
    // which matters most for the endpoints with the tightest limits.
    return this.cache.fetch(url, ttlMs, () => this.send(url, options));
  }

  /** Runs the retry loop for one request. */
  private async send<T>(url: string, options: RequestOptions<T>): Promise<T> {
    const operation = options.operation ?? options.path;
    const maxAttempts = this.config.maxRetries + 1;

    let lastError: T212Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const log = this.logger.child({ operation, attempt });

      try {
        if (options.group) {
          const waitMs = this.rateLimiter.timeUntilAvailable(options.group);
          if (waitMs > 0) {
            log.debug("waiting for rate-limit budget", {
              group: options.group,
              waitMs,
            });
          }
          await this.rateLimiter.acquire(options.group);
        }

        const body = await this.attempt(url, options.signal);
        return this.parse(body, options.schema, options.path, operation);
      } catch (error) {
        const t212Error = error as T212Error;
        lastError = t212Error;

        const canRetry = t212Error.retryable && attempt < maxAttempts;
        log.warn("request failed", {
          error: t212Error.name,
          status: t212Error.status,
          willRetry: canRetry,
        });

        if (!canRetry) throw t212Error;

        await this.sleep(this.backoffMs(attempt, t212Error));
      }
    }

    // Unreachable: the loop either returns or throws.
    throw lastError ?? new T212NetworkError(`${operation} failed`);
  }

  /** Issues one HTTP request and returns the raw body, or throws. */
  private async attempt(
    url: string,
    callerSignal: AbortSignal | undefined,
  ): Promise<string> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeout])
      : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: authorizationHeader(this.config),
          Accept: "application/json",
          "User-Agent": "t212-mcp",
        },
        signal,
      });
    } catch (error) {
      // The caller's own cancellation is not our failure to report.
      if (callerSignal?.aborted) throw error;

      if (timeout.aborted) {
        throw new T212TimeoutError(
          `Request timed out after ${this.config.timeoutMs}ms.`,
          { cause: error },
        );
      }
      throw new T212NetworkError(
        `Could not reach Trading 212: ${this.safe(errorMessage(error))}`,
        { cause: error },
      );
    }

    const body = await response.text();

    if (!response.ok) {
      const detail = this.safe(body).slice(0, MAX_ERROR_BODY_CHARS);
      const code = extractErrorCode(body);
      const retryAfterMs =
        response.status === 429
          ? parseRetryAfter(response.headers.get("retry-after"))
          : undefined;

      throw errorFromStatus(
        response.status,
        `Trading 212 returned ${response.status}${detail ? `: ${detail}` : "."}`,
        {
          ...(code === undefined ? {} : { code }),
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        },
      );
    }

    return body;
  }

  private parse<T>(
    body: string,
    schema: z.ZodType<T>,
    endpoint: string,
    operation: string,
  ): T {
    let json: unknown;
    try {
      json = body.trim() === "" ? null : JSON.parse(body);
    } catch (error) {
      throw new T212ResponseError(
        `${operation} returned a body that is not valid JSON.`,
        { endpoint, cause: error },
      );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const summary = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new T212ResponseError(
        `${operation} returned an unexpected shape (${summary}).`,
        { endpoint, cause: parsed.error },
      );
    }

    return parsed.data;
  }

  /**
   * Exponential backoff with full jitter, so concurrent tool calls that hit a
   * limit together do not retry in lockstep. An explicit `Retry-After` wins.
   */
  private backoffMs(attempt: number, error: T212Error): number {
    const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
    if (typeof retryAfter === "number") {
      return Math.min(retryAfter, MAX_BACKOFF_MS);
    }

    const ceiling = Math.min(
      BASE_BACKOFF_MS * 2 ** (attempt - 1),
      MAX_BACKOFF_MS,
    );
    return Math.round(ceiling * (0.5 + this.random() * 0.5));
  }

  /** Strips credentials from text that came from outside the process. */
  private safe(text: string): string {
    return redactLiterals(text, this.secrets).trim();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
