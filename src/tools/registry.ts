import type { Config } from "../config.js";
import { accountTools } from "./account.js";
import { portfolioTools } from "./portfolio.js";
import type { ToolDefinition } from "./types.js";

/**
 * Builds the tool list for a given configuration.
 *
 * Taking config here rather than exporting a fixed array is what lets an
 * opt-in tool be absent from `tools/list` entirely, instead of being
 * advertised and then refusing to run. A tool a model cannot see is a tool it
 * cannot be talked into calling.
 */
export function buildTools(_config: Config): ToolDefinition[] {
  return [...accountTools, ...portfolioTools];
}
