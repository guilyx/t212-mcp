import type { RateLimitGroup } from "./rate-limit.js";

/**
 * Every Trading 212 endpoint this server talks to, in one place.
 *
 * Paths live here rather than at their call sites so that the read-only
 * guarantee is auditable: this table is the complete list of what the server
 * can reach, and every entry is a GET. Adding a state-changing endpoint would
 * mean adding it here, in a diff a reviewer sees.
 *
 * The API is documented at https://docs.trading212.com/api and is in beta;
 * paths have moved before. Keeping them in a table means a change upstream is
 * a one-line edit rather than a hunt through the tool implementations.
 */
export interface EndpointDefinition {
  /** Path below `/api/v0`. `{name}` segments are filled by `resolvePath`. */
  path: string;
  /** Shares a rate-limit budget and a cache lifetime with its group. */
  group: RateLimitGroup;
  summary: string;
}

export const ENDPOINTS = {
  accountCash: {
    path: "/equity/account/cash",
    group: "account",
    summary: "Cash balance, invested value and unrealised profit or loss",
  },
  accountInfo: {
    path: "/equity/account/info",
    group: "account",
    summary: "Account identifier and reporting currency",
  },
  positions: {
    path: "/equity/portfolio",
    group: "portfolio",
    summary: "All open positions",
  },
  position: {
    path: "/equity/portfolio/{ticker}",
    group: "portfolio",
    summary: "A single open position by ticker",
  },
  instruments: {
    path: "/equity/metadata/instruments",
    group: "instruments",
    summary: "Every tradeable instrument and its metadata",
  },
  exchanges: {
    path: "/equity/metadata/exchanges",
    group: "exchanges",
    summary: "Exchanges and their trading schedules",
  },
  orders: {
    path: "/equity/orders",
    group: "orders",
    summary: "Currently pending orders",
  },
  order: {
    path: "/equity/orders/{id}",
    group: "orders",
    summary: "A single pending order by identifier",
  },
  orderHistory: {
    path: "/equity/history/orders",
    group: "history",
    summary: "Historical, already-executed orders",
  },
  dividends: {
    path: "/history/dividends",
    group: "history",
    summary: "Dividends paid into the account",
  },
  transactions: {
    path: "/history/transactions",
    group: "history",
    summary: "Deposits, withdrawals and other cash movements",
  },
  pies: {
    path: "/equity/pies",
    group: "pies",
    summary: "All pies in the account",
  },
  pie: {
    path: "/equity/pies/{id}",
    group: "pies",
    summary: "A single pie, including its holdings",
  },
  exports: {
    path: "/history/exports",
    group: "exports",
    summary: "CSV export jobs and their download links",
  },
} as const satisfies Record<string, EndpointDefinition>;

export type EndpointName = keyof typeof ENDPOINTS;

/**
 * Fills `{name}` placeholders, percent-encoding each value.
 *
 * Encoding matters: tickers contain underscores and are user-supplied by way
 * of the model, so a value carrying a `/` or `?` must not be able to redirect
 * the request to a different endpoint.
 */
export function resolvePath(
  endpoint: EndpointName,
  params: Record<string, string> = {},
): string {
  const { path } = ENDPOINTS[endpoint];

  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new Error(`Missing path parameter "${name}" for ${endpoint}.`);
    }
    return encodeURIComponent(value);
  });
}
