import { z } from "zod";

import type { Config } from "../config.js";
import { ENDPOINTS, resolvePath } from "../t212/endpoints.js";
import { exportsSchema } from "../t212/schemas.js";
import { pluralise } from "./format.js";
import { defineTool, type ToolDefinition } from "./types.js";

const listExports = defineTool({
  name: "t212_list_exports",
  title: "CSV export jobs",
  description:
    "Lists CSV export jobs previously requested from Trading 212, with " +
    "each job's status, the period it covers, and its download link once " +
    "ready. Use this when a full statement is needed rather than the " +
    "paginated history tools. Download links point at Trading 212 and " +
    "expire; this server does not fetch or store their contents.",
  inputSchema: z.object({}),
  handler: async (_input, { client }) => {
    const jobs = await client.get({
      path: resolvePath("exports"),
      group: ENDPOINTS.exports.group,
      operation: "exports",
      schema: exportsSchema,
    });

    const ready = jobs.filter((job) => job.downloadLink);

    return {
      summary:
        jobs.length === 0
          ? "No export jobs have been requested for this account."
          : `${pluralise(jobs.length, "export job")}, ${ready.length} with a ` +
            `download link ready.`,
      data: { exports: jobs, totalExports: jobs.length },
    };
  },
});

/**
 * Export tools are gated.
 *
 * Listing existing jobs is a plain read, but it is grouped with the export
 * feature so that a user who has not opted in sees nothing about exports at
 * all — including the download links of previously generated statements,
 * which are the one thing this API hands out that grants access to a full
 * account history without further authentication.
 */
export function buildExportTools(config: Config): ToolDefinition[] {
  return config.allowExports ? [listExports] : [];
}

export const exportToolsForTesting = [listExports];
