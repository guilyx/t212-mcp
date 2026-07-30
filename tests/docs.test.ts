import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { buildExportTools } from "../src/tools/exports.js";
import { buildTools } from "../src/tools/registry.js";

function read(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
}

const readme = read("README.md");
const envExample = read(".env.example");

const config = loadConfig({ T212_API_KEY: "docs-test-key-000" });
const allTools = [
  ...buildTools(config),
  ...buildExportTools({ ...config, allowExports: true }),
];

/**
 * Documentation drift is the failure nobody notices until a user follows the
 * README and it does not work. These are cheap to keep passing and catch the
 * two things that actually rot: the tool table and the variable list.
 */
describe("README", () => {
  it("documents every registered tool", () => {
    for (const tool of allTools) {
      expect(readme, tool.name).toContain(tool.name);
    }
  });

  it("does not advertise a tool that no longer exists", () => {
    const documented = [...readme.matchAll(/`(t212_[a-z_]+)`/g)].map(
      (match) => match[1],
    );
    const registered = new Set(allTools.map((tool) => tool.name));

    for (const name of new Set(documented)) {
      expect(
        registered.has(name!),
        `${name!} is documented but not registered`,
      ).toBe(true);
    }
  });

  it("documents every configuration variable", () => {
    for (const variable of envExample.match(/T212_[A-Z_]+/g) ?? []) {
      expect(readme, variable).toContain(variable);
    }
  });

  it("states the read-only guarantee prominently", () => {
    expect(readme.slice(0, 1_500)).toMatch(/cannot trade/i);
  });

  it("warns that tool results reach the model provider", () => {
    expect(readme).toContain("model provider");
  });
});

describe(".env.example", () => {
  it("ships no credential values", () => {
    const assignments = envExample
      .split("\n")
      .filter((line) => /^T212_(API_KEY|API_SECRET)=/.test(line));

    expect(assignments).toEqual(["T212_API_KEY=", "T212_API_SECRET="]);
  });
});
