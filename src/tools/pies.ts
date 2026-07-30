import { z } from "zod";

import { ENDPOINTS, resolvePath } from "../t212/endpoints.js";
import { pieDetailSchema, piesSchema } from "../t212/schemas.js";
import { money, percent, pluralise, signed } from "./format.js";
import { defineTool, type ToolDefinition } from "./types.js";

const listPies = defineTool({
  name: "t212_list_pies",
  title: "Investment pies",
  description:
    "Returns the account's pies — Trading 212's named baskets of " +
    "instruments with target allocations — including each pie's invested " +
    "value, current value, result, and progress towards its goal. Use " +
    "t212_get_pie for the instruments inside a specific pie. This server " +
    "is read-only and cannot create or change a pie.",
  inputSchema: z.object({}),
  handler: async (_input, { client }) => {
    const pies = await client.get({
      path: resolvePath("pies"),
      group: ENDPOINTS.pies.group,
      operation: "pies",
      schema: piesSchema,
    });

    const invested = pies.reduce(
      (sum, pie) => sum + (pie.result?.priceAvgInvestedValue ?? 0),
      0,
    );
    const value = pies.reduce(
      (sum, pie) => sum + (pie.result?.priceAvgValue ?? 0),
      0,
    );

    return {
      summary:
        pies.length === 0
          ? "No pies in this account."
          : `${pluralise(pies.length, "pie")}, ${money(invested)} invested ` +
            `now worth ${money(value)} (${signed(value - invested)}).`,
      data: { pies, totalPies: pies.length },
    };
  },
});

const getPie = defineTool({
  name: "t212_get_pie",
  title: "Pie holdings",
  description:
    "Returns one pie's contents: every instrument in it with its current " +
    "share of the pie, its target share, the quantity owned, and its " +
    "result. Use this to explain how a pie is allocated or which of its " +
    "holdings are drifting from target. Get the pie's id from " +
    "t212_list_pies first.",
  inputSchema: z.object({
    id: z
      .number()
      .int()
      .describe("Pie identifier, as returned by t212_list_pies."),
  }),
  handler: async (input, { client }) => {
    const pie = await client.get({
      path: resolvePath("pie", { id: String(input.id) }),
      group: ENDPOINTS.pie.group,
      operation: "pie",
      schema: pieDetailSchema,
    });

    const instruments = pie.instruments ?? [];
    // Drift is what a person actually asks about: "is my pie still balanced?"
    const drifted = instruments
      .map((instrument) => ({
        ticker: instrument.ticker,
        currentShare: instrument.currentShare,
        expectedShare: instrument.expectedShare,
        drift:
          instrument.currentShare !== null &&
          instrument.currentShare !== undefined &&
          instrument.expectedShare !== null &&
          instrument.expectedShare !== undefined
            ? instrument.currentShare - instrument.expectedShare
            : undefined,
      }))
      .filter((entry) => entry.drift !== undefined)
      .sort((a, b) => Math.abs(b.drift ?? 0) - Math.abs(a.drift ?? 0));

    const largest = drifted[0];

    return {
      summary:
        instruments.length === 0
          ? `Pie ${input.id} holds no instruments.`
          : `Pie ${input.id} holds ${pluralise(instruments.length, "instrument")}` +
            (largest
              ? `. Largest drift from target: ${largest.ticker} at ` +
                `${percent(largest.currentShare)} against ` +
                `${percent(largest.expectedShare)}.`
              : "."),
      data: { ...pie, allocationDrift: drifted },
    };
  },
});

export const pieTools: ToolDefinition[] = [listPies, getPie];
