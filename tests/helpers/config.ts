import { loadConfig, type Config } from "../../src/config.js";

/**
 * A config for tests. Values are invented — no real credential, account
 * number or ticker holding may appear anywhere in this suite.
 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      T212_API_KEY: "test-api-key-000",
      T212_ENVIRONMENT: "demo",
      T212_MAX_RETRIES: "2",
      T212_TIMEOUT_MS: "1000",
    }),
    ...overrides,
  };
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}
