/**
 * Error taxonomy for Trading 212 API calls.
 *
 * Two audiences read these: the retry logic, which needs to know whether
 * trying again could plausibly help, and the language model receiving the
 * tool error, which needs to know what to do differently. Every error
 * therefore carries a `retryable` flag and a message written for a reader who
 * cannot see the stack trace.
 */

export interface T212ErrorContext {
  /** Endpoint path, without the host or credentials. */
  endpoint?: string;
  status?: number;
  /** Machine-readable code from the API body, when it supplies one. */
  code?: string;
  cause?: unknown;
}

export class T212Error extends Error {
  override readonly name: string = "T212Error";
  readonly endpoint: string | undefined;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly retryable: boolean = false;

  constructor(message: string, context: T212ErrorContext = {}) {
    super(message, context.cause === undefined ? {} : { cause: context.cause });
    this.endpoint = context.endpoint;
    this.status = context.status;
    this.code = context.code;
  }
}

/** 401/403 — the key is wrong, revoked, or lacks the required scope. */
export class T212AuthError extends T212Error {
  override readonly name = "T212AuthError";
}

/** 404 — the resource genuinely does not exist for this account. */
export class T212NotFoundError extends T212Error {
  override readonly name = "T212NotFoundError";
}

/** 400/422 — the request itself is wrong; retrying it unchanged will not help. */
export class T212BadRequestError extends T212Error {
  override readonly name = "T212BadRequestError";
}

/**
 * 429. Trading 212's limits are strict and per-endpoint — some endpoints
 * allow one call every few seconds — so this is an expected condition rather
 * than an exceptional one.
 */
export class T212RateLimitError extends T212Error {
  override readonly name = "T212RateLimitError";
  override readonly retryable = true;
  /** From `Retry-After`, when the response supplies it. */
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    context: T212ErrorContext & { retryAfterMs?: number } = {},
  ) {
    super(message, context);
    this.retryAfterMs = context.retryAfterMs;
  }
}

/** 5xx — upstream fault, worth retrying. */
export class T212ServerError extends T212Error {
  override readonly name = "T212ServerError";
  override readonly retryable = true;
}

/** DNS failure, connection reset, TLS error. */
export class T212NetworkError extends T212Error {
  override readonly name = "T212NetworkError";
  override readonly retryable = true;
}

/** The request exceeded the configured timeout. */
export class T212TimeoutError extends T212Error {
  override readonly name = "T212TimeoutError";
  override readonly retryable = true;
}

/**
 * The response did not match its schema.
 *
 * Deliberately not retryable: a shape mismatch means our model of the API is
 * wrong, and hammering the endpoint will not fix that. Surfacing it as an
 * error rather than passing the payload through keeps a malformed number from
 * being reported to the user as a balance.
 */
export class T212ResponseError extends T212Error {
  override readonly name = "T212ResponseError";
}

/**
 * Maps an HTTP status to the matching error class.
 */
export function errorFromStatus(
  status: number,
  message: string,
  context: T212ErrorContext & { retryAfterMs?: number } = {},
): T212Error {
  const withStatus = { ...context, status };

  if (status === 401 || status === 403) {
    return new T212AuthError(message, withStatus);
  }
  if (status === 404) return new T212NotFoundError(message, withStatus);
  if (status === 429) return new T212RateLimitError(message, withStatus);
  if (status >= 500) return new T212ServerError(message, withStatus);
  if (status >= 400) return new T212BadRequestError(message, withStatus);

  return new T212Error(message, withStatus);
}

/**
 * Advice appended to the error surfaced to the model, so it can recover
 * without a round trip through the user.
 */
const GUIDANCE: Record<string, string> = {
  T212AuthError:
    "Check that T212_API_KEY (and T212_API_SECRET, if your key has one) is " +
    "valid for the configured environment. Practice and real-money accounts " +
    "issue separate credentials and do not accept each other's keys.",
  T212NotFoundError:
    "The account has no such resource. For a ticker, confirm the exact " +
    "Trading 212 symbol with the instrument search tool first.",
  T212RateLimitError:
    "Trading 212 rate limits are per endpoint and strict. Wait before " +
    "retrying, and prefer one broad call over several narrow ones.",
  T212ResponseError:
    "The API returned data this server could not parse. This usually means " +
    "the upstream schema changed; it is not something the caller can fix.",
};

/** Human-readable, model-actionable rendering of an error. */
export function describeError(error: unknown): string {
  if (error instanceof T212Error) {
    const guidance = GUIDANCE[error.name];
    return guidance ? `${error.message} ${guidance}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
