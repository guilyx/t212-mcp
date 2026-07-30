import type { Config } from "../../src/config.js";
import { silentLogger } from "../../src/logger.js";
import { T212Client, type FetchLike } from "../../src/t212/client.js";
import { RateLimiter } from "../../src/t212/rate-limit.js";
import type { ToolContext, ToolDefinition } from "../../src/tools/types.js";
import { jsonResponse, testConfig } from "./config.js";

export interface ToolHarness {
  context: ToolContext;
  /** URLs requested, in order. */
  urls: string[];
}

/**
 * Builds a tool context whose HTTP layer replies from `routes`.
 *
 * Keys are matched as substrings of the request URL, so a test names the
 * endpoint it cares about rather than a full URL. An unmatched request
 * returns 404, which is what the API does for a resource the account does
 * not have.
 */
export function toolHarness(
  routes: Record<string, unknown>,
  configOverrides: Partial<Config> = {},
): ToolHarness {
  const urls: string[] = [];

  const fetchImpl: FetchLike = (url) => {
    urls.push(url);
    const match = Object.entries(routes).find(([path]) => url.includes(path));

    if (!match) {
      return Promise.resolve(jsonResponse("not found", { status: 404 }));
    }

    const [, body] = match;
    return Promise.resolve(
      body instanceof Response ? body : jsonResponse(body),
    );
  };

  const config = testConfig(configOverrides);

  return {
    urls,
    context: {
      config,
      logger: silentLogger,
      client: new T212Client({
        config,
        fetch: fetchImpl,
        sleep: () => Promise.resolve(),
        // Real limits would make these tests wait out multi-second windows.
        rateLimiter: new RateLimiter({ enabled: false }),
      }),
    },
  };
}

/**
 * Invokes a tool the way the server will: raw arguments in, schema applied by
 * the tool itself. Tests therefore exercise the real defaults and coercion.
 */
export function callTool(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  context: ToolContext,
) {
  return tool.handler(input, context);
}

export function findTool(
  tools: ToolDefinition[],
  name: string,
): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool;
}
