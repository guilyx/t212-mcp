import { describe, expect, it } from "vitest";

import { testConfig } from "../helpers/config.js";
import {
  buildExportTools,
  exportToolsForTesting,
} from "../../src/tools/exports.js";
import { callTool, findTool, toolHarness } from "../helpers/tools.js";

const list = findTool(exportToolsForTesting, "t212_list_exports");

describe("export tool gating", () => {
  it("registers nothing when exports are not enabled", () => {
    expect(buildExportTools(testConfig({ allowExports: false }))).toEqual([]);
  });

  it("registers the export tools when explicitly enabled", () => {
    const tools = buildExportTools(testConfig({ allowExports: true }));

    expect(tools.map((tool) => tool.name)).toEqual(["t212_list_exports"]);
  });

  it("is off by default", () => {
    // A user who never opted in should not see download links to a full
    // account statement, which need no further authentication to use.
    expect(buildExportTools(testConfig())).toEqual([]);
  });
});

describe("t212_list_exports", () => {
  it("reports how many jobs have a link ready", async () => {
    const { context } = toolHarness({
      "/history/exports": [
        { reportId: 1, status: "Finished", downloadLink: "https://example/1" },
        { reportId: 2, status: "Processing" },
      ],
    });

    const result = await callTool(list, {}, context);

    expect(result.summary).toContain("2 export jobs");
    expect(result.summary).toContain("1 with a download link");
    expect(result.data).toMatchObject({ totalExports: 2 });
  });

  it("says plainly when none have been requested", async () => {
    const { context } = toolHarness({ "/history/exports": [] });

    const result = await callTool(list, {}, context);

    expect(result.summary).toContain("No export jobs");
  });

  it("states that download links are not fetched by this server", () => {
    expect(list.description).toContain("does not fetch");
  });
});
