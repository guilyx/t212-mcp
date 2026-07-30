/**
 * Formatting helpers for tool summaries.
 *
 * The summaries are read by a model and then, usually, quoted to a person, so
 * they aim for unambiguous rather than pretty: an explicit currency code
 * beats a bare symbol, and a missing value says so instead of showing zero.
 */

/** Renders a number as money, or `unknown` when the API omitted it. */
export function money(
  value: number | null | undefined,
  currency?: string | null,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }

  const amount = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return currency ? `${amount} ${currency}` : amount;
}

/** Renders a signed number, keeping the sign explicit for profit and loss. */
export function signed(
  value: number | null | undefined,
  currency?: string | null,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  return `${value >= 0 ? "+" : ""}${money(value, currency)}`;
}

/** Renders a share quantity, trimming the noise of trailing zeros. */
export function quantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  return String(Number(value.toFixed(8)));
}

/** Renders a ratio as a percentage. */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  return `${(value * 100).toFixed(2)}%`;
}

export function pluralise(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Truncates a list, reporting what was left out.
 *
 * Silently dropping items would let a model report "you hold 20 positions"
 * from a truncated list of 20 when there are 400.
 */
export function limitItems<T>(
  items: readonly T[],
  limit: number,
): { items: T[]; truncated: boolean; total: number } {
  return {
    items: items.slice(0, limit),
    truncated: items.length > limit,
    total: items.length,
  };
}
