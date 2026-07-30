import { z } from "zod";

import { ENDPOINTS, resolvePath } from "../t212/endpoints.js";
import { positionSchema, positionsSchema } from "../t212/schemas.js";
import type { Position } from "../t212/schemas.js";
import { limitItems, money, pluralise, quantity, signed } from "./format.js";
import { defineTool, type ToolDefinition } from "./types.js";

/** Market value of a holding, or undefined when the price is unavailable. */
export function positionValue(position: Position): number | undefined {
  const price = position.currentPrice;
  if (price === null || price === undefined) return undefined;
  return position.quantity * price;
}

const listPositions = defineTool({
  name: "t212_list_positions",
  title: "Open positions",
  description:
    "Returns every open position in the account: ticker, quantity, average " +
    "buy price, current price, and unrealised profit or loss (including the " +
    "portion caused by currency movement). This is the tool for 'what do I " +
    "hold', 'how is my portfolio doing', or any question about a specific " +
    "holding when you do not already know its exact Trading 212 ticker. " +
    "Returns the whole portfolio in one call, so prefer it over repeated " +
    "single-position lookups.",
  inputSchema: z.object({
    sortBy: z
      .enum(["value", "profit", "ticker"])
      .default("value")
      .describe(
        "Order of the returned positions. 'value' is market value, " +
          "'profit' is unrealised profit or loss, both descending.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe(
        "Maximum positions to return. The total count is always reported.",
      ),
  }),
  handler: async (input, { client }) => {
    const positions = await client.get({
      path: resolvePath("positions"),
      group: ENDPOINTS.positions.group,
      operation: "positions",
      schema: positionsSchema,
    });

    const sorted = [...positions].sort((a, b) => {
      if (input.sortBy === "ticker") return a.ticker.localeCompare(b.ticker);
      if (input.sortBy === "profit") return (b.ppl ?? 0) - (a.ppl ?? 0);
      return (positionValue(b) ?? 0) - (positionValue(a) ?? 0);
    });

    const { items, truncated, total } = limitItems(sorted, input.limit);
    const totalPpl = positions.reduce((sum, p) => sum + (p.ppl ?? 0), 0);

    return {
      summary:
        total === 0
          ? "No open positions."
          : `${pluralise(total, "open position")}, combined unrealised P/L ` +
            `${signed(totalPpl)}.` +
            (truncated ? ` Showing the first ${items.length}.` : ""),
      data: {
        positions: items.map((position) => ({
          ...position,
          value: positionValue(position),
        })),
        totalPositions: total,
        totalUnrealisedPpl: totalPpl,
        truncated,
      },
    };
  },
});

const getPosition = defineTool({
  name: "t212_get_position",
  title: "Single position by ticker",
  description:
    "Returns one open position by its exact Trading 212 ticker (for example " +
    "AAPL_US_EQ, not AAPL). Only use this when you already know the exact " +
    "ticker — otherwise call t212_list_positions, which returns everything " +
    "in a single request, or t212_search_instruments to resolve a name to a " +
    "ticker. Fails if the account holds no such position.",
  inputSchema: z.object({
    ticker: z
      .string()
      .min(1)
      .describe("Exact Trading 212 ticker, e.g. AAPL_US_EQ. Case-sensitive."),
  }),
  handler: async (input, { client }) => {
    const position = await client.get({
      path: resolvePath("position", { ticker: input.ticker }),
      group: ENDPOINTS.position.group,
      operation: "position",
      schema: positionSchema,
    });

    return {
      summary:
        `${position.ticker}: ${quantity(position.quantity)} at an average ` +
        `of ${money(position.averagePrice)}, now ` +
        `${money(position.currentPrice)}, unrealised P/L ` +
        `${signed(position.ppl)}.`,
      data: { ...position, value: positionValue(position) },
    };
  },
});

export const portfolioTools: ToolDefinition[] = [listPositions, getPosition];
