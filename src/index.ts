import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConfigError, configSecrets, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

export { createServer } from "./server.js";
export { loadConfig, ConfigError, type Config } from "./config.js";
export { SERVER_NAME, SERVER_VERSION } from "./version.js";

const USAGE = `${SERVER_NAME} ${SERVER_VERSION}

Read-only MCP server for Trading 212 account and market data. Speaks the
Model Context Protocol over stdio; run it from an MCP client rather than
directly.

Required environment:
  T212_API_KEY        API key from the Trading 212 app (Settings -> API)

Optional:
  T212_API_SECRET     Secret, if your key was issued as a key/secret pair
  T212_ENVIRONMENT    demo (default) or live
  T212_LOG_LEVEL      debug, info (default), warn, error, silent
  T212_ALLOW_EXPORTS  true to expose the CSV export tools

See https://github.com/guilyx/t212-mcp for the full list.
`;

/**
 * Writes to stderr. stdout carries the protocol stream and must stay clean
 * even when the process is failing.
 */
function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * An MCP client that exits closes the pipe underneath us, and the in-flight
 * write fails with EPIPE. That is an ordinary end of session, not a fault:
 * without this, Node reports it as an unhandled 'error' event and the user
 * sees a stack trace every time they close their client.
 */
export function handleBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }
    fail(`Fatal stream error: ${error.message}`);
  });
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stderr.write(USAGE);
    return;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    process.stderr.write(`${SERVER_VERSION}\n`);
    return;
  }

  handleBrokenPipe(process.stdout);
  handleBrokenPipe(process.stderr);

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      fail(`${error.message}\n\n${USAGE}`);
    }
    throw error;
  }

  const logger = createLogger({
    level: config.logLevel,
    secrets: configSecrets(config),
  });

  const server = createServer({ config, logger });
  const transport = new StdioServerTransport();

  const shutdown = (signal: string): void => {
    logger.info("shutting down", { signal });
    void server.close().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  await server.connect(transport);
  logger.info("listening on stdio");
}

/**
 * Only runs when executed as a program. Importing this module — which the
 * build's smoke test does — must not start a server or read credentials.
 */
if (process.argv[1] !== undefined && import.meta.url.startsWith("file:")) {
  const invokedPath = process.argv[1];
  const modulePath = new URL(import.meta.url).pathname;

  if (modulePath === invokedPath || modulePath.endsWith("/dist/index.js")) {
    main(process.argv.slice(2)).catch((error: unknown) => {
      fail(error instanceof Error ? error.message : String(error));
    });
  }
}
