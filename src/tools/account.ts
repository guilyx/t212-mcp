import { z } from "zod";

import { ENDPOINTS, resolvePath } from "../t212/endpoints.js";
import { accountCashSchema, accountInfoSchema } from "../t212/schemas.js";
import { money, signed } from "./format.js";
import { defineTool, type ToolDefinition } from "./types.js";

const getAccountCash = defineTool({
  name: "t212_get_account_cash",
  title: "Account cash and balance",
  description:
    "Returns the account's cash breakdown: free cash available to invest, " +
    "total account value, amount currently invested, unrealised profit or " +
    "loss, cash held inside pies, and cash blocked by pending orders. Use " +
    "this for any question about how much money is in the account or how it " +
    "is performing overall. Figures are in the account's own currency — call " +
    "t212_get_account_info if you need to know which currency that is.",
  inputSchema: z.object({}),
  handler: async (_input, { client }) => {
    const cash = await client.get({
      path: resolvePath("accountCash"),
      group: ENDPOINTS.accountCash.group,
      operation: "accountCash",
      schema: accountCashSchema,
    });

    return {
      summary:
        `Free cash ${money(cash.free)}, total account value ` +
        `${money(cash.total)}, invested ${money(cash.invested)}, ` +
        `unrealised P/L ${signed(cash.ppl)}.`,
      data: cash,
    };
  },
});

const getAccountInfo = defineTool({
  name: "t212_get_account_info",
  title: "Account identity and currency",
  description:
    "Returns the account identifier and the currency every monetary figure " +
    "from this server is reported in. Call this once when you need to label " +
    "amounts correctly; the other tools return bare numbers in this currency.",
  inputSchema: z.object({}),
  handler: async (_input, { client, config }) => {
    const info = await client.get({
      path: resolvePath("accountInfo"),
      group: ENDPOINTS.accountInfo.group,
      operation: "accountInfo",
      schema: accountInfoSchema,
    });

    return {
      summary:
        `Trading 212 ${config.environment} account reports in ` +
        `${info.currencyCode ?? "an unspecified currency"}.`,
      // The environment is worth returning: a model that knows it is looking
      // at the practice account will not describe the figures as real money.
      data: { ...info, environment: config.environment },
    };
  },
});

export const accountTools: ToolDefinition[] = [getAccountCash, getAccountInfo];
