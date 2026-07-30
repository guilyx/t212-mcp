import type { z } from "zod";

import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { T212Client } from "../t212/client.js";

/** Everything a tool handler is allowed to reach. */
export interface ToolContext {
  client: T212Client;
  config: Config;
  logger: Logger;
}

/**
 * What a handler returns.
 *
 * `summary` is a short line of prose the model can use directly; `data` is
 * the structured payload. Returning both lets a model answer a simple
 * question without re-deriving it from JSON, while keeping the full numbers
 * available when it needs them.
 */
export interface ToolResult {
  summary: string;
  data: unknown;
}

/**
 * A tool, described independently of the MCP SDK.
 *
 * Keeping this layer SDK-free means handlers are testable by calling them,
 * with no transport or protocol wiring in the way.
 *
 * The registered `handler` takes `unknown`: argument validation happens
 * inside it, so a tool cannot be invoked with unvalidated input by any
 * caller, including a future transport that forgets to parse.
 */
export interface ToolDefinition {
  name: string;
  /** Human-friendly label shown by clients that support one. */
  title: string;
  /**
   * Written for the model deciding whether to call this tool. States what it
   * returns, when to prefer it, and what it costs — several endpoints are
   * limited to roughly one call per minute, so an unnecessary call is
   * expensive in a way the model cannot otherwise know.
   */
  description: string;
  inputSchema: z.ZodObject;
  handler: (rawInput: unknown, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolSpec<Schema extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  handler: (
    input: z.output<Schema>,
    context: ToolContext,
  ) => Promise<ToolResult>;
}

/**
 * Wraps a typed handler in one that validates its own arguments.
 *
 * The handler body sees a parsed, defaulted input; everything outside sees a
 * uniform `(unknown, context)` signature.
 */
export function defineTool<Schema extends z.ZodObject>(
  spec: ToolSpec<Schema>,
): ToolDefinition {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    // Async so a validation failure is a rejection like every other error.
    // A handler that throws synchronously would need separate handling at
    // each call site, and one of them would eventually forget.
    handler: async (rawInput, context) =>
      spec.handler(spec.inputSchema.parse(rawInput ?? {}), context),
  };
}
