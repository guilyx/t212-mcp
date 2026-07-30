import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { describeConfig, type Config } from "./config.js";
import { silentLogger, type Logger } from "./logger.js";
import { T212Client } from "./t212/client.js";
import { describeError } from "./t212/errors.js";
import { buildExportTools } from "./tools/exports.js";
import { buildTools } from "./tools/registry.js";
import type { ToolContext, ToolDefinition } from "./tools/types.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

export interface CreateServerOptions {
  config: Config;
  logger?: Logger;
  /** Injected in tests; otherwise built from the config. */
  client?: T212Client;
}

/**
 * Every tool this server exposes is a read.
 *
 * The hints are not decorative: clients use them to decide what may run
 * without a confirmation prompt, and `openWorldHint` tells a client the data
 * comes from outside the process and can change between calls.
 */
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * Renders a tool result for the protocol.
 *
 * The text block leads with the summary so a model reading only the first
 * line still gets a usable answer, and follows with the structured payload
 * for clients that do not surface `structuredContent`.
 */
function toCallToolResult(summary: string, data: unknown): CallToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(data, null, 2) },
    ],
    structuredContent: { summary, data },
  };
}

/**
 * Turns a thrown error into a tool error the model can act on.
 *
 * Returning `isError` rather than throwing keeps the failure inside the
 * conversation: the model sees why the call failed and can correct itself,
 * instead of the client surfacing a protocol-level fault.
 */
function toErrorResult(error: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: describeError(error) }],
    isError: true,
  };
}

function registerTool(
  server: McpServer,
  tool: ToolDefinition,
  context: ToolContext,
  logger: Logger,
): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema.shape,
      annotations: { title: tool.title, ...READ_ONLY_ANNOTATIONS },
    },
    async (args: unknown) => {
      const started = Date.now();
      try {
        const { summary, data } = await tool.handler(args, context);
        logger.info("tool succeeded", {
          tool: tool.name,
          durationMs: Date.now() - started,
        });
        return toCallToolResult(summary, data);
      } catch (error) {
        // Arguments are deliberately not logged: they can carry tickers and
        // other account detail, and the tool name is enough to debug with.
        logger.warn("tool failed", {
          tool: tool.name,
          durationMs: Date.now() - started,
          error,
        });
        return toErrorResult(error);
      }
    },
  );
}

/**
 * Builds the MCP server: tools, one resource describing the connection, and
 * a prompt for the most common analysis request.
 */
export function createServer(options: CreateServerOptions): McpServer {
  const { config } = options;
  const logger = options.logger ?? silentLogger;
  const client = options.client ?? new T212Client({ config, logger });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Read-only access to a Trading 212 investing account. Every tool " +
        "reads; none can place, amend or cancel an order, or change a pie. " +
        "Monetary values are in the account's own currency — call " +
        "t212_get_account_info once to learn which. Endpoints are rate " +
        "limited, some to roughly one call per minute, so prefer one broad " +
        "call over several narrow ones. When a user names a company rather " +
        "than a ticker, resolve it with t212_search_instruments first. This " +
        "server cannot place, amend or cancel orders — do not offer to.",
    },
  );

  const context: ToolContext = { client, config, logger };
  const tools = [...buildTools(config), ...buildExportTools(config)];

  for (const tool of tools) {
    registerTool(server, tool, context, logger);
  }

  server.registerResource(
    "connection",
    "t212://connection",
    {
      title: "Trading 212 connection",
      description:
        "Which account environment this server is connected to and how it " +
        "is configured. Contains no credentials.",
      mimeType: "application/json",
    },
    // Reading this must never require a network call: a client that lists
    // resources on connect would otherwise spend rate-limit budget.
    () =>
      Promise.resolve({
        contents: [
          {
            uri: "t212://connection",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                server: { name: SERVER_NAME, version: SERVER_VERSION },
                readOnly: true,
                tools: tools.map((tool) => tool.name),
                ...describeConfig(config),
              },
              null,
              2,
            ),
          },
        ],
      }),
  );

  server.registerPrompt(
    "portfolio_review",
    {
      title: "Review the portfolio",
      description:
        "Walks through the account's holdings and performance in a sensible " +
        "order, minimising rate-limited calls.",
      argsSchema: {
        focus: z
          .string()
          .optional()
          .describe(
            "Optional area to concentrate on, e.g. 'dividends', " +
              "'losses', or a specific ticker.",
          ),
      },
    },
    ({ focus }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "Review my Trading 212 account. Call t212_get_account_info " +
              "once for the reporting currency, then t212_get_account_cash " +
              "and t212_list_positions. Report total value, cash, and the " +
              "largest contributors to profit and loss. State figures with " +
              "their currency, and say explicitly if any figure was " +
              "unavailable rather than treating it as zero." +
              (focus ? ` Concentrate on: ${focus}.` : "") +
              " Do not suggest trades; this connection is read-only.",
          },
        },
      ],
    }),
  );

  logger.info("server ready", {
    tools: tools.length,
    ...describeConfig(config),
  });

  return server;
}
