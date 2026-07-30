import { z } from "zod";

import { LOG_LEVELS, type LogLevel } from "./logger.js";

export const ENVIRONMENTS = ["demo", "live"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Trading 212 serves the practice and real-money accounts from separate hosts
 * with separate credentials. A key issued for one is rejected by the other,
 * which is the safety property this server leans on: the default is `demo`,
 * so a misconfigured install reads a play-money account rather than a real
 * one.
 */
export const ENVIRONMENT_HOSTS: Record<Environment, string> = {
  demo: "https://demo.trading212.com",
  live: "https://live.trading212.com",
};

/** Every documented endpoint lives under this prefix. */
export const API_PATH_PREFIX = "/api/v0";

const booleanFromEnv = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(["1", "0", "true", "false", "yes", "no"]))
  .transform((value) => value === "1" || value === "true" || value === "yes");

const integerFromEnv = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, "must be a whole number")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

const rawConfigSchema = z.object({
  T212_API_KEY: z.string().trim().min(1, "must not be empty"),
  T212_API_SECRET: z.string().trim().min(1).optional(),
  T212_ENVIRONMENT: z.enum(ENVIRONMENTS).default("demo"),
  T212_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  T212_TIMEOUT_MS: integerFromEnv(1_000, 120_000).default(15_000),
  T212_MAX_RETRIES: integerFromEnv(0, 5).default(3),
  T212_CACHE_TTL_MS: integerFromEnv(0, 86_400_000).default(300_000),
  T212_LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  T212_ALLOW_EXPORTS: booleanFromEnv.default(false),
});

export interface Config {
  apiKey: string;
  /**
   * Absent when the account uses the older single-token scheme, where the key
   * alone is sent as the `Authorization` header.
   */
  apiSecret: string | undefined;
  environment: Environment;
  /** Origin only; the `/api/v0` prefix is applied per request. */
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
  logLevel: LogLevel;
  /**
   * CSV export generation is the one exposed endpoint with a side effect
   * upstream, so it is opt-in. Everything else this server does is a read.
   */
  allowExports: boolean;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";

  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
  }
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const variable = issue.path.join(".") || "configuration";
    return `${variable}: ${issue.message}`;
  });
}

/**
 * Reads and validates configuration from environment variables.
 *
 * Throws {@link ConfigError} listing every problem at once rather than
 * failing on the first — a user fixing their client config should not have to
 * restart four times. Error messages name the offending variable but never
 * echo its value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Empty strings are what an unset variable in a JSON client config looks
  // like in practice; treat them as absent so defaults apply.
  const present: Record<string, string> = {};
  for (const key of Object.keys(rawConfigSchema.shape)) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") present[key] = value;
  }

  const parsed = rawConfigSchema.safeParse(present);
  if (!parsed.success) {
    const issues = describeIssues(parsed.error);
    throw new ConfigError(
      `Invalid Trading 212 MCP configuration:\n  - ${issues.join("\n  - ")}`,
      issues,
    );
  }

  const raw = parsed.data;
  const baseUrl = (
    raw.T212_BASE_URL ?? ENVIRONMENT_HOSTS[raw.T212_ENVIRONMENT]
  ).replace(/\/+$/, "");

  return {
    apiKey: raw.T212_API_KEY,
    apiSecret: raw.T212_API_SECRET,
    environment: raw.T212_ENVIRONMENT,
    baseUrl,
    timeoutMs: raw.T212_TIMEOUT_MS,
    maxRetries: raw.T212_MAX_RETRIES,
    cacheTtlMs: raw.T212_CACHE_TTL_MS,
    logLevel: raw.T212_LOG_LEVEL,
    allowExports: raw.T212_ALLOW_EXPORTS,
  };
}

/** Literal secrets that must be scrubbed from logs and error messages. */
export function configSecrets(config: Config): readonly string[] {
  const secrets = [config.apiKey];
  if (config.apiSecret) {
    secrets.push(
      config.apiSecret,
      Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64"),
    );
  }
  return secrets;
}

/** Config with credentials removed, safe to log at startup. */
export function describeConfig(config: Config): Record<string, unknown> {
  return {
    environment: config.environment,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    cacheTtlMs: config.cacheTtlMs,
    logLevel: config.logLevel,
    allowExports: config.allowExports,
    authScheme: config.apiSecret ? "basic" : "token",
  };
}
