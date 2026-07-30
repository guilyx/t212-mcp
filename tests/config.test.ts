import { describe, expect, it } from "vitest";

import {
  ConfigError,
  configSecrets,
  describeConfig,
  loadConfig,
} from "../src/config.js";

const minimal = { T212_API_KEY: "key-1234567890" };

describe("loadConfig", () => {
  it("defaults to the demo environment", () => {
    const config = loadConfig(minimal);

    expect(config.environment).toBe("demo");
    expect(config.baseUrl).toBe("https://demo.trading212.com");
  });

  it("selects the live host when asked explicitly", () => {
    const config = loadConfig({ ...minimal, T212_ENVIRONMENT: "live" });

    expect(config.baseUrl).toBe("https://live.trading212.com");
  });

  it("applies documented defaults", () => {
    const config = loadConfig(minimal);

    expect(config).toMatchObject({
      timeoutMs: 15_000,
      maxRetries: 3,
      cacheTtlMs: 300_000,
      logLevel: "info",
      allowExports: false,
      apiSecret: undefined,
    });
  });

  it("requires an API key", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it("treats an empty variable as unset", () => {
    expect(() => loadConfig({ T212_API_KEY: "   " })).toThrow(ConfigError);
    expect(loadConfig({ ...minimal, T212_ENVIRONMENT: "" }).environment).toBe(
      "demo",
    );
  });

  it("reports every problem at once", () => {
    let error: ConfigError | undefined;
    try {
      loadConfig({
        T212_API_KEY: "key-1234567890",
        T212_ENVIRONMENT: "production",
        T212_MAX_RETRIES: "99",
        T212_LOG_LEVEL: "verbose",
      });
    } catch (caught) {
      error = caught as ConfigError;
    }

    expect(error?.issues).toHaveLength(3);
    expect(error?.issues.join("\n")).toContain("T212_ENVIRONMENT");
    expect(error?.issues.join("\n")).toContain("T212_MAX_RETRIES");
    expect(error?.issues.join("\n")).toContain("T212_LOG_LEVEL");
  });

  it("never echoes a credential in the error message", () => {
    let message = "";
    try {
      loadConfig({ T212_API_KEY: "leaky-key-value", T212_TIMEOUT_MS: "nope" });
    } catch (caught) {
      message = (caught as ConfigError).message;
    }

    expect(message).toContain("T212_TIMEOUT_MS");
    expect(message).not.toContain("leaky-key-value");
  });

  it("rejects a non-numeric duration", () => {
    expect(() => loadConfig({ ...minimal, T212_TIMEOUT_MS: "10s" })).toThrow(
      /whole number/,
    );
  });

  it("rejects a timeout outside the supported range", () => {
    expect(() => loadConfig({ ...minimal, T212_TIMEOUT_MS: "10" })).toThrow(
      ConfigError,
    );
  });

  it("accepts the usual spellings of a boolean flag", () => {
    for (const value of ["1", "true", "TRUE", "yes"]) {
      expect(
        loadConfig({ ...minimal, T212_ALLOW_EXPORTS: value }),
      ).toMatchObject({ allowExports: true });
    }
    for (const value of ["0", "false", "no"]) {
      expect(
        loadConfig({ ...minimal, T212_ALLOW_EXPORTS: value }),
      ).toMatchObject({ allowExports: false });
    }
  });

  it("rejects an unrecognised boolean rather than guessing", () => {
    expect(() =>
      loadConfig({ ...minimal, T212_ALLOW_EXPORTS: "maybe" }),
    ).toThrow(ConfigError);
  });

  it("honours a base URL override and strips trailing slashes", () => {
    const config = loadConfig({
      ...minimal,
      T212_BASE_URL: "http://localhost:8080///",
    });

    expect(config.baseUrl).toBe("http://localhost:8080");
  });

  it("rejects a base URL that is not a URL", () => {
    expect(() =>
      loadConfig({ ...minimal, T212_BASE_URL: "not a url" }),
    ).toThrow(ConfigError);
  });
});

describe("configSecrets", () => {
  it("lists the key alone under token auth", () => {
    expect(configSecrets(loadConfig(minimal))).toEqual(["key-1234567890"]);
  });

  it("includes the encoded basic credential when a secret is set", () => {
    const config = loadConfig({ ...minimal, T212_API_SECRET: "secret-value" });
    const encoded = Buffer.from("key-1234567890:secret-value").toString(
      "base64",
    );

    expect(configSecrets(config)).toEqual([
      "key-1234567890",
      "secret-value",
      encoded,
    ]);
  });
});

describe("describeConfig", () => {
  it("omits credentials and names the auth scheme", () => {
    const description = describeConfig(
      loadConfig({ ...minimal, T212_API_SECRET: "secret-value" }),
    );

    expect(description).toMatchObject({
      environment: "demo",
      authScheme: "basic",
    });
    expect(JSON.stringify(description)).not.toContain("key-1234567890");
    expect(JSON.stringify(description)).not.toContain("secret-value");
  });

  it("reports token auth when no secret is configured", () => {
    expect(describeConfig(loadConfig(minimal))).toMatchObject({
      authScheme: "token",
    });
  });
});

describe("first-run experience", () => {
  it("tells a new user where to get an API key", () => {
    // This is the first message anyone sees when the server will not start.
    let message = "";
    try {
      loadConfig({});
    } catch (caught) {
      message = (caught as ConfigError).message;
    }

    expect(message).toContain("T212_API_KEY");
    expect(message).toContain("Settings > API");
  });
});
