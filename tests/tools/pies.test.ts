import { describe, expect, it } from "vitest";

import { pieTools } from "../../src/tools/pies.js";
import { callTool, findTool, toolHarness } from "../helpers/tools.js";

const list = findTool(pieTools, "t212_list_pies");
const detail = findTool(pieTools, "t212_get_pie");

const pies = [
  {
    id: 1,
    cash: 5,
    progress: 0.4,
    status: "AHEAD",
    result: { priceAvgInvestedValue: 100, priceAvgValue: 120 },
  },
  {
    id: 2,
    cash: 0,
    result: { priceAvgInvestedValue: 200, priceAvgValue: 180 },
  },
];

describe("t212_list_pies", () => {
  it("aggregates invested value and current value", async () => {
    const { context } = toolHarness({ "/equity/pies": pies });

    const result = await callTool(list, {}, context);

    expect(result.summary).toContain("300.00");
    expect(result.summary).toContain("worth 300.00");
    expect(result.data).toMatchObject({ totalPies: 2 });
  });

  it("shows a combined loss with its sign", async () => {
    const { context } = toolHarness({
      "/equity/pies": [
        { id: 1, result: { priceAvgInvestedValue: 100, priceAvgValue: 80 } },
      ],
    });

    const result = await callTool(list, {}, context);

    expect(result.summary).toContain("-20.00");
  });

  it("says plainly when there are no pies", async () => {
    const { context } = toolHarness({ "/equity/pies": [] });

    const result = await callTool(list, {}, context);

    expect(result.summary).toBe("No pies in this account.");
  });
});

describe("t212_get_pie", () => {
  const pie = {
    instruments: [
      { ticker: "AAA_US_EQ", currentShare: 0.6, expectedShare: 0.5 },
      { ticker: "BBB_US_EQ", currentShare: 0.25, expectedShare: 0.3 },
      { ticker: "CCC_US_EQ", currentShare: 0.15, expectedShare: 0.2 },
    ],
  };

  it("requests the pie by id", async () => {
    const { context, urls } = toolHarness({ "/equity/pies/7": pie });

    await callTool(detail, { id: 7 }, context);

    expect(urls[0]).toContain("/equity/pies/7");
  });

  it("ranks holdings by absolute drift from target", async () => {
    const { context } = toolHarness({ "/equity/pies/7": pie });

    const result = await callTool(detail, { id: 7 }, context);
    const data = result.data as {
      allocationDrift: { ticker: string; drift: number }[];
    };

    expect(data.allocationDrift[0]?.ticker).toBe("AAA_US_EQ");
    expect(data.allocationDrift[0]?.drift).toBeCloseTo(0.1);
  });

  it("treats an underweight holding as drift too", async () => {
    const { context } = toolHarness({
      "/equity/pies/7": {
        instruments: [
          { ticker: "AAA_US_EQ", currentShare: 0.52, expectedShare: 0.5 },
          { ticker: "BBB_US_EQ", currentShare: 0.1, expectedShare: 0.5 },
        ],
      },
    });

    const result = await callTool(detail, { id: 7 }, context);
    const data = result.data as { allocationDrift: { ticker: string }[] };

    // Being 40 points under target matters more than being 2 over.
    expect(data.allocationDrift[0]?.ticker).toBe("BBB_US_EQ");
  });

  it("names the largest drift in the summary", async () => {
    const { context } = toolHarness({ "/equity/pies/7": pie });

    const result = await callTool(detail, { id: 7 }, context);

    expect(result.summary).toContain("AAA_US_EQ");
    expect(result.summary).toContain("60.00%");
    expect(result.summary).toContain("50.00%");
  });

  it("skips holdings with no target rather than inventing a drift", async () => {
    const { context } = toolHarness({
      "/equity/pies/7": {
        instruments: [
          { ticker: "AAA_US_EQ", currentShare: 0.6 },
          { ticker: "BBB_US_EQ", currentShare: 0.2, expectedShare: 0.4 },
        ],
      },
    });

    const result = await callTool(detail, { id: 7 }, context);
    const data = result.data as { allocationDrift: { ticker: string }[] };

    expect(data.allocationDrift).toHaveLength(1);
    expect(data.allocationDrift[0]?.ticker).toBe("BBB_US_EQ");
  });

  it("handles an empty pie", async () => {
    const { context } = toolHarness({ "/equity/pies/7": { instruments: [] } });

    const result = await callTool(detail, { id: 7 }, context);

    expect(result.summary).toBe("Pie 7 holds no instruments.");
  });

  it("rejects a non-numeric id before making a request", async () => {
    const { context, urls } = toolHarness({});

    await expect(callTool(detail, { id: "seven" }, context)).rejects.toThrow();
    expect(urls).toHaveLength(0);
  });
});
