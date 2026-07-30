import type { Writable } from "node:stream";

import { redactValue } from "./redact.js";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that merges `bindings` into every record it writes. */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /**
   * Literal values to scrub from every record — the API key and secret.
   */
  secrets?: readonly (string | undefined)[];
  /**
   * Defaults to stderr. Passing stdout throws: on a stdio transport that
   * stream carries JSON-RPC frames and any extra bytes desync the client.
   */
  stream?: Writable;
  bindings?: LogFields;
  now?: () => Date;
}

function write(
  stream: Writable,
  level: Exclude<LogLevel, "silent">,
  message: string,
  timestamp: string,
  bindings: LogFields,
  fields: LogFields | undefined,
  secrets: readonly (string | undefined)[],
): void {
  const record = {
    time: timestamp,
    level,
    msg: message,
    ...(redactValue({ ...bindings, ...fields }, secrets) as LogFields),
  };

  try {
    stream.write(`${JSON.stringify(record)}\n`);
  } catch {
    // A logger that throws would take the server down with it. Losing a log
    // line is strictly better than losing the process.
  }
}

/**
 * Structured NDJSON logger that writes to stderr.
 *
 * Every field passes through {@link redactValue}, so callers can log a
 * request context or a caught error without auditing it for credentials
 * first.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    level = "info",
    secrets = [],
    stream = process.stderr,
    bindings = {},
    now = () => new Date(),
  } = options;

  if (stream === process.stdout) {
    throw new Error(
      "Refusing to log to stdout: it carries the MCP protocol stream.",
    );
  }

  const threshold = LEVEL_WEIGHT[level];

  const log =
    (recordLevel: Exclude<LogLevel, "silent">) =>
    (message: string, fields?: LogFields): void => {
      if (LEVEL_WEIGHT[recordLevel] < threshold) return;
      write(
        stream,
        recordLevel,
        message,
        now().toISOString(),
        bindings,
        fields,
        secrets,
      );
    };

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (childBindings: LogFields) =>
      createLogger({
        level,
        secrets,
        stream,
        now,
        bindings: { ...bindings, ...childBindings },
      }),
  };
}

/** Discards every record. Convenient default for tests and library use. */
export const silentLogger: Logger = createLogger({ level: "silent" });
