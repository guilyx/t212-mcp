import { z } from "zod";

import { ENDPOINTS, resolvePath } from "../t212/endpoints.js";
import {
  ordersSchema,
  paginatedDividendsSchema,
  paginatedOrdersSchema,
  paginatedTransactionsSchema,
} from "../t212/schemas.js";
import { money, pluralise, signed } from "./format.js";
import { defineTool, type ToolDefinition } from "./types.js";

/**
 * Extracts the cursor from the `nextPagePath` the API returns.
 *
 * The path is server-supplied and absolute, and handing it back to the model
 * verbatim would invite it to be passed somewhere that treats it as a URL.
 * Reducing it to a cursor keeps the pagination contract to one opaque string.
 */
export function cursorFromPath(
  path: string | null | undefined,
): string | undefined {
  if (!path) return undefined;

  try {
    const url = new URL(path, "https://placeholder.invalid");
    return url.searchParams.get("cursor") ?? undefined;
  } catch {
    return undefined;
  }
}

const paginationInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum records to return in this page."),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Opaque cursor from a previous call's nextCursor. Omit for the first " +
        "page.",
    ),
};

const listPendingOrders = defineTool({
  name: "t212_list_pending_orders",
  title: "Pending orders",
  description:
    "Returns orders that are placed but not yet executed, with their type, " +
    "limit or stop price, and how much has filled so far. Use this for " +
    "'what orders do I have open'. This server is read-only: it can show " +
    "pending orders but cannot place, amend or cancel them.",
  inputSchema: z.object({}),
  handler: async (_input, { client }) => {
    const orders = await client.get({
      path: resolvePath("orders"),
      group: ENDPOINTS.orders.group,
      operation: "orders",
      schema: ordersSchema,
    });

    return {
      summary:
        orders.length === 0
          ? "No pending orders."
          : `${pluralise(orders.length, "pending order")}.`,
      data: { orders, totalOrders: orders.length },
    };
  },
});

const listOrderHistory = defineTool({
  name: "t212_list_order_history",
  title: "Executed order history",
  description:
    "Returns past, already-executed orders newest first: what was bought " +
    "or sold, at what price, and any taxes charged. Use this for questions " +
    "about trading activity or realised results. Results are paginated — " +
    "pass the returned nextCursor to continue. Optionally filter to a " +
    "single ticker.",
  inputSchema: z.object({
    ...paginationInput,
    ticker: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Exact Trading 212 ticker to filter by, e.g. AAPL_US_EQ. Omit for " +
          "all instruments.",
      ),
  }),
  handler: async (input, { client }) => {
    const page = await client.get({
      path: resolvePath("orderHistory"),
      group: ENDPOINTS.orderHistory.group,
      operation: "orderHistory",
      schema: paginatedOrdersSchema,
      query: {
        limit: input.limit,
        cursor: input.cursor,
        ticker: input.ticker,
      },
    });

    const nextCursor = cursorFromPath(page.nextPagePath);

    return {
      summary:
        page.items.length === 0
          ? "No matching orders in the account's history."
          : pluralise(page.items.length, "historical order") +
            (nextCursor ? ", more available." : "."),
      data: {
        orders: page.items,
        nextCursor,
        hasMore: nextCursor !== undefined,
      },
    };
  },
});

const listDividends = defineTool({
  name: "t212_list_dividends",
  title: "Dividend payments",
  description:
    "Returns dividends paid into the account, newest first, with the " +
    "instrument, amount, and amount per share. Use this for dividend income " +
    "questions. Results are paginated — pass the returned nextCursor to " +
    "continue. Note this reports what was actually paid, not forecast yield.",
  inputSchema: z.object({
    ...paginationInput,
    ticker: z
      .string()
      .min(1)
      .optional()
      .describe("Exact Trading 212 ticker to filter by. Omit for all."),
  }),
  handler: async (input, { client }) => {
    const page = await client.get({
      path: resolvePath("dividends"),
      group: ENDPOINTS.dividends.group,
      operation: "dividends",
      schema: paginatedDividendsSchema,
      query: {
        limit: input.limit,
        cursor: input.cursor,
        ticker: input.ticker,
      },
    });

    const nextCursor = cursorFromPath(page.nextPagePath);
    const total = page.items.reduce((sum, item) => sum + (item.amount ?? 0), 0);

    return {
      summary:
        page.items.length === 0
          ? "No dividends recorded."
          : `${pluralise(page.items.length, "dividend payment")} totalling ` +
            `${money(total)} on this page` +
            (nextCursor ? ", more available." : "."),
      data: {
        dividends: page.items,
        pageTotal: total,
        nextCursor,
        hasMore: nextCursor !== undefined,
      },
    };
  },
});

const listTransactions = defineTool({
  name: "t212_list_transactions",
  title: "Cash transactions",
  description:
    "Returns cash movements — deposits, withdrawals, fees and interest — " +
    "newest first. Use this for 'how much have I deposited' or to explain a " +
    "change in cash that positions do not account for. Results are " +
    "paginated; pass the returned nextCursor to continue.",
  inputSchema: z.object(paginationInput),
  handler: async (input, { client }) => {
    const page = await client.get({
      path: resolvePath("transactions"),
      group: ENDPOINTS.transactions.group,
      operation: "transactions",
      schema: paginatedTransactionsSchema,
      query: { limit: input.limit, cursor: input.cursor },
    });

    const nextCursor = cursorFromPath(page.nextPagePath);
    const net = page.items.reduce((sum, item) => sum + (item.amount ?? 0), 0);

    return {
      summary:
        page.items.length === 0
          ? "No cash transactions recorded."
          : `${pluralise(page.items.length, "transaction")}, net ` +
            `${signed(net)} on this page` +
            (nextCursor ? ", more available." : "."),
      data: {
        transactions: page.items,
        pageNet: net,
        nextCursor,
        hasMore: nextCursor !== undefined,
      },
    };
  },
});

export const historyTools: ToolDefinition[] = [
  listPendingOrders,
  listOrderHistory,
  listDividends,
  listTransactions,
];
