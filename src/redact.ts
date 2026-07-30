/**
 * Secret scrubbing for anything that might reach stderr or a tool result.
 *
 * The server holds live brokerage credentials. Log lines and error messages
 * are the realistic leak paths — an upstream error body can echo a request
 * header, and a stack trace can capture a config object. Everything on those
 * paths goes through here first.
 */

const REDACTED = "[redacted]";

/**
 * Keys whose values are replaced wholesale, regardless of content.
 */
const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|api[-_]?secret|secret|token|authorization|password|credential|cookie)/i;

/**
 * Shortest string still worth searching for. Redacting a one- or two-character
 * "secret" would replace unrelated substrings across the whole message.
 */
const MIN_LITERAL_LENGTH = 6;

const MAX_DEPTH = 6;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces every occurrence of the given literal secrets in `text`.
 *
 * Used for values we know verbatim — the configured API key and secret, and
 * the base64 credential derived from them.
 */
export function redactLiterals(
  text: string,
  secrets: readonly (string | undefined)[],
): string {
  let output = text;
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_LITERAL_LENGTH) continue;
    output = output.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  return output;
}

/**
 * Deep-copies `value`, replacing anything held under a sensitive-looking key
 * and any literal secret found in a string.
 *
 * Returns a plain JSON-shaped structure: this exists to be serialised, so
 * class instances, functions and symbols are reduced rather than preserved.
 * Cycles are broken with a marker instead of throwing, because a logger must
 * never be the thing that crashes the server.
 */
export function redactValue(
  value: unknown,
  secrets: readonly (string | undefined)[] = [],
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactLiterals(value, secrets);

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (typeof value === "bigint") return value.toString();

  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }

  if (depth >= MAX_DEPTH) return "[truncated]";

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLiterals(value.message, secrets),
      ...(value.stack ? { stack: redactLiterals(value.stack, secrets) } : {}),
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, secrets, depth + 1, seen));
    }

    if (value instanceof Map || value instanceof Set) {
      return redactValue([...value], secrets, depth + 1, seen);
    }

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(item, secrets, depth + 1, seen);
    }
    return output;
  }

  // Every `typeof` result is handled above, so this is unreachable. It exists
  // so an exotic future value can never escape unredacted.
  return "[unserialisable]";
}
