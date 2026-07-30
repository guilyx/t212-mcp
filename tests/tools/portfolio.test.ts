import { describe, expect, it } from "vitest";

import { portfolioTools, positionValue } from "../../src/tools/portfolio.js";
import { callTool, findTool, toolHarness } from "../helpers/tools.js";

const list = findTool(portfolioTools, "t212_list_positions");
const single = findTool(portfolioTools, "t212_get_position");

const positions = [
  {
    ticker: "AAA_US_EQ",
    quantity: 10,
    currentPrice: 5,
    ppl: 12,
    averagePrice: 4,
  },
  {
    ticker: "BBB_US_EQ",
    quantity: 2,
    currentPrice: 100,
    ppl: -30,
    averagePrice: 115,
  },
  {
    ticker: "CCC_US_EQ",
    quantity: 1,
    currentPrice: 50,
    ppl: 3,
    averagePrice: 47,
  },
];

describe("positionValue", () => {
  it("multiplies quantity by the current price", () => {
    expect(positionValue({ ticker: "A", quantity: 3, currentPrice: 7 })).toBe(
      21,
    );
  });

  it("is undefined when the price is unavailable", () => {
    expect(positionValue({ ticker: "A", quantity: 3 })).toBeUndefined();
    expect(
      positionValue({ ticker: "A", quantity: 3, currentPrice: null }),
    ).toBeUndefined();
  });
});

describe("t212_list_positions", () => {
  it("returns every position with its market value", async () => {
    const { context } = toolHarness({ "/equity/portfolio": positions });

    const result = await callTool(list, {}, context);
    const data = result.data as { positions: { value?: number }[] };

    expect(data.positions).toHaveLength(3);
    expect(data.positions[0]?.value).toBe(200);
  });

  it("sorts by market value by default", async () => {
    const { context } = toolHarness({ "/equity/portfolio": positions });

    const result = await callTool(list, {}, context);
    const data = result.data as { positions: { ticker: string }[] };

    expect(data.positions.map((p) => p.ticker)).toEqual([
      "BBB_US_EQ",
      "AAA_US_EQ",
      "CCC_US_EQ",
    ]);
  });

  it("sorts by profit when asked", async () => {
    const { context } = toolHarness({ "/equity/portfolio": positions });

    const result = await callTool(list, { sortBy: "profit" }, context);
    const data = result.data as { positions: { ticker: string }[] };

    expect(data.positions.map((p) => p.ticker)).toEqual([
      "AAA_US_EQ",
      "CCC_US_EQ",
      "BBB_US_EQ",
    ]);
  });

  it("sorts by ticker when asked", async () => {
    const { context } = toolHarness({ "/equity/portfolio": positions });

    const result = await callTool(list, { sortBy: "ticker" }, context);
    const data = result.data as { positions: { ticker: string }[] };

    expect(data.positions.map((p) => p.ticker)).toEqual([
      "AAA_US_EQ",
      "BBB_US_EQ",
      "CCC_US_EQ",
    ]);
  });

  it("totals unrealised profit and loss across the portfolio", async () => {
    const { context } = toolHarness({ "/equity/portfolio": positions });

    const result = await callTool(list, {}, context);

    expect(result.data).toMatchObject({ totalUnrealisedPpl: -15 });
    expect(result.summary).toContain("-15.00");
  });

  it("reports the true total when the list is truncated", async () => {
    const { context } = toolHarness({ "/equity/portfolio": positions });

    const result = await callTool(list, { limit: 1 }, context);

    // A model must not be able to read "1 position" off a truncated list.
    expect(result.summary).toContain("3 open positions");
    expect(result.data).toMatchObject({ totalPositions: 3, truncated: true });
  });

  it("says plainly when there is nothing held", async () => {
    const { context } = toolHarness({ "/equity/portfolio": [] });

    const result = await callTool(list, {}, context);

    expect(result.summary).toBe("No open positions.");
    expect(result.data).toMatchObject({ totalPositions: 0 });
  });

  it("does not mark a complete list as truncated", async () => {
    const { context } = toolHarness({ "/equity/portfolio": positions });

    const result = await callTool(list, { limit: 3 }, context);

    expect(result.data).toMatchObject({ truncated: false });
  });

  it("sorts positions with no price last rather than dropping them", async () => {
    const { context } = toolHarness({
      "/equity/portfolio": [
        { ticker: "NOPRICE_US_EQ", quantity: 1 },
        ...positions,
      ],
    });

    const result = await callTool(list, {}, context);
    const data = result.data as { positions: { ticker: string }[] };

    expect(data.positions).toHaveLength(4);
    expect(data.positions.at(-1)?.ticker).toBe("NOPRICE_US_EQ");
  });
});

describe("t212_get_position", () => {
  it("returns one position by ticker", async () => {
    const { context, urls } = toolHarness({
      "/equity/portfolio/AAA_US_EQ": positions[0],
    });

    const result = await callTool(single, { ticker: "AAA_US_EQ" }, context);

    expect(urls[0]).toContain("/equity/portfolio/AAA_US_EQ");
    expect(result.summary).toContain("AAA_US_EQ");
    expect(result.data).toMatchObject({ value: 50 });
  });

  it("encodes a ticker so it cannot escape its path segment", async () => {
    const { context, urls } = toolHarness({
      "/equity/portfolio": { ticker: "X", quantity: 1 },
    });

    await callTool(single, { ticker: "../orders/market" }, context);

    expect(urls[0]).toContain("..%2Forders%2Fmarket");
    expect(urls[0]).not.toContain("/orders/market");
  });

  it("rejects an empty ticker before making a request", async () => {
    const { context, urls } = toolHarness({});

    // The schema rejects it during argument validation, so no HTTP call is
    // ever made and no rate-limit budget is spent on a doomed request.
    await expect(callTool(single, { ticker: "" }, context)).rejects.toThrow();
    expect(urls).toHaveLength(0);
  });

  it("surfaces a missing holding as an error with recovery guidance", async () => {
    const { context } = toolHarness({});

    await expect(
      callTool(single, { ticker: "ZZZ_US_EQ" }, context),
    ).rejects.toThrow(/404/);
  });
});
