import { z } from "zod";

import { ENDPOINTS, resolvePath } from "../t212/endpoints.js";
import {
  exchangesSchema,
  instrumentsSchema,
  type Instrument,
} from "../t212/schemas.js";
import { limitItems, pluralise } from "./format.js";
import { defineTool, type ToolDefinition } from "./types.js";

/**
 * How well an instrument matches a query, higher is better; 0 means no match.
 *
 * Ranking matters because the catalogue holds many instruments whose names
 * contain a common word. A user asking for "Apple" wants AAPL first, not the
 * first alphabetical company with "apple" somewhere in its name.
 */
export function matchScore(instrument: Instrument, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle === "") return 0;

  const ticker = instrument.ticker.toLowerCase();
  const name = (instrument.name ?? "").toLowerCase();
  const shortName = (instrument.shortName ?? "").toLowerCase();
  const isin = (instrument.isin ?? "").toLowerCase();

  if (ticker === needle || isin === needle) return 100;
  if (shortName === needle) return 90;
  if (name === needle) return 85;
  // A Trading 212 ticker is the symbol plus a market suffix, so a bare
  // symbol should still rank as a near-exact hit.
  if (ticker.startsWith(`${needle}_`)) return 80;
  if (shortName.startsWith(needle)) return 70;
  if (name.startsWith(needle)) return 60;
  if (ticker.includes(needle)) return 40;
  if (name.includes(needle)) return 30;
  if (isin.includes(needle)) return 20;

  return 0;
}

const searchInstruments = defineTool({
  name: "t212_search_instruments",
  title: "Search tradeable instruments",
  description:
    "Finds instruments in the Trading 212 catalogue by company name, symbol " +
    "or ISIN, returning the exact tickers other tools need (for example " +
    "AAPL_US_EQ). Use this first whenever you have a company name but not a " +
    "ticker. Results are ranked, with exact symbol and ISIN matches first. " +
    "Note this searches everything Trading 212 offers, not the account's " +
    "holdings — use t212_list_positions for what is actually owned.",
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Company name, symbol or ISIN. Matching is case-insensitive and " +
          "partial, e.g. 'apple', 'AAPL' or 'US0378331005'.",
      ),
    type: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Optional instrument type filter, e.g. STOCK or ETF. Omit to " +
          "search every type.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum matches to return, best first."),
  }),
  handler: async (input, { client }) => {
    // The catalogue is large and rate-limited to roughly one call per
    // minute, so it is fetched whole and cached, then searched in process.
    const instruments = await client.get({
      path: resolvePath("instruments"),
      group: ENDPOINTS.instruments.group,
      operation: "instruments",
      schema: instrumentsSchema,
    });

    const scored = instruments
      .filter(
        (instrument) =>
          input.type === undefined ||
          (instrument.type ?? "").toLowerCase() === input.type.toLowerCase(),
      )
      .map((instrument) => ({
        instrument,
        score: matchScore(instrument, input.query),
      }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.instrument.ticker.localeCompare(b.instrument.ticker),
      );

    const { items, truncated, total } = limitItems(scored, input.limit);

    return {
      summary:
        total === 0
          ? `No instrument matches "${input.query}". Try a shorter query, ` +
            `or the company's symbol.`
          : `${pluralise(total, "match", "matches")} for "${input.query}"` +
            (truncated ? `, showing the best ${items.length}` : "") +
            `. Best match: ${items[0]?.instrument.ticker ?? "unknown"}.`,
      data: {
        matches: items.map((entry) => entry.instrument),
        totalMatches: total,
        truncated,
      },
    };
  },
});

const listExchanges = defineTool({
  name: "t212_list_exchanges",
  title: "Exchanges and trading hours",
  description:
    "Returns the exchanges Trading 212 supports and their working " +
    "schedules, including the time events that mark when each session opens " +
    "and closes. Use this to answer whether a market is open, or to explain " +
    "why an instrument cannot be traded right now. Schedules are verbose, so " +
    "they are omitted unless explicitly requested.",
  inputSchema: z.object({
    includeSchedules: z
      .boolean()
      .default(false)
      .describe(
        "Include full working schedules. These are long; leave false " +
          "unless you need specific session times.",
      ),
  }),
  handler: async (input, { client }) => {
    const exchanges = await client.get({
      path: resolvePath("exchanges"),
      group: ENDPOINTS.exchanges.group,
      operation: "exchanges",
      schema: exchangesSchema,
    });

    return {
      summary: `${pluralise(exchanges.length, "exchange")} available.`,
      data: {
        exchanges: input.includeSchedules
          ? exchanges
          : exchanges.map(({ workingSchedules: _schedules, ...rest }) => rest),
      },
    };
  },
});

export const instrumentTools: ToolDefinition[] = [
  searchInstruments,
  listExchanges,
];
