import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SERVER_NAME, SERVER_VERSION } from "../src/version.js";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

describe("server identity", () => {
  it("matches the package name", () => {
    expect(SERVER_NAME).toBe(manifest.name);
  });

  it("matches the package version", () => {
    expect(SERVER_VERSION).toBe(manifest.version);
  });
});
