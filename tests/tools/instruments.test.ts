import { describe, expect, it } from "vitest";

import { instrumentTools, matchScore } from "../../src/tools/instruments.js";
import { callTool, findTool, toolHarness } from "../helpers/tools.js";

const search = findTool(instrumentTools, "t212_search_instruments");
const exchanges = findTool(instrumentTools, "t212_list_exchanges");

const catalogue = [
  {
    ticker: "AAPL_US_EQ",
    shortName: "AAPL",
    name: "Apple Inc",
    isin: "US0000000001",
    type: "STOCK",
  },
  {
    ticker: "APLE_US_EQ",
    shortName: "APLE",
    name: "Apple Hospitality REIT",
    isin: "US0000000002",
    type: "STOCK",
  },
  {
    ticker: "PINEAPPLE_US_EQ",
    shortName: "PINE",
    name: "Pineapple Holdings",
    isin: "US0000000003",
    type: "STOCK",
  },
  {
    ticker: "VUSA_EQ",
    shortName: "VUSA",
    name: "Vanguard S&P 500",
    isin: "IE0000000004",
    type: "ETF",
  },
];

describe("matchScore", () => {
  const apple = catalogue[0]!;

  it("ranks an exact ticker highest", () => {
    expect(matchScore(apple, "AAPL_US_EQ")).toBe(100);
  });

  it("ranks an exact ISIN as highly as an exact ticker", () => {
    expect(matchScore(apple, "US0000000001")).toBe(100);
  });

  it("ranks a bare symbol above a substring hit", () => {
    // "AAPL" is the symbol; Trading 212 appends a market suffix.
    expect(matchScore(apple, "AAPL")).toBeGreaterThan(
      matchScore(catalogue[2]!, "apple"),
    );
  });

  it("ranks a name prefix above a name substring", () => {
    expect(matchScore(apple, "Apple")).toBeGreaterThan(
      matchScore(catalogue[2]!, "apple"),
    );
  });

  it("is case-insensitive", () => {
    expect(matchScore(apple, "aapl_us_eq")).toBe(100);
  });

  it("scores zero for no match and for an empty query", () => {
    expect(matchScore(apple, "banana")).toBe(0);
    expect(matchScore(apple, "   ")).toBe(0);
  });
});

describe("t212_search_instruments", () => {
  it("returns the best match first", async () => {
    const { context } = toolHarness({ "/metadata/instruments": catalogue });

    const result = await callTool(search, { query: "apple" }, context);
    const data = result.data as { matches: { ticker: string }[] };

    expect(data.matches[0]?.ticker).toBe("AAPL_US_EQ");
    expect(result.summary).toContain("AAPL_US_EQ");
  });

  it("finds an instrument by ISIN", async () => {
    const { context } = toolHarness({ "/metadata/instruments": catalogue });

    const result = await callTool(search, { query: "IE0000000004" }, context);
    const data = result.data as { matches: { ticker: string }[] };

    expect(data.matches).toHaveLength(1);
    expect(data.matches[0]?.ticker).toBe("VUSA_EQ");
  });

  it("filters by instrument type", async () => {
    const { context } = toolHarness({ "/metadata/instruments": catalogue });

    const result = await callTool(search, { query: "a", type: "ETF" }, context);
    const data = result.data as { matches: { ticker: string }[] };

    expect(data.matches.map((m) => m.ticker)).toEqual(["VUSA_EQ"]);
  });

  it("matches the type filter case-insensitively", async () => {
    const { context } = toolHarness({ "/metadata/instruments": catalogue });

    const result = await callTool(search, { query: "a", type: "etf" }, context);
    const data = result.data as { matches: unknown[] };

    expect(data.matches).toHaveLength(1);
  });

  it("caps results but reports how many matched", async () => {
    const { context } = toolHarness({ "/metadata/instruments": catalogue });

    const result = await callTool(
      search,
      { query: "apple", limit: 1 },
      context,
    );

    expect(result.data).toMatchObject({ totalMatches: 3, truncated: true });
    expect(result.summary).toContain("3 matches");
  });

  it("suggests a way forward when nothing matches", async () => {
    const { context } = toolHarness({ "/metadata/instruments": catalogue });

    const result = await callTool(search, { query: "zzzzz" }, context);

    expect(result.summary).toContain("No instrument matches");
    expect(result.summary).toContain("symbol");
    expect(result.data).toMatchObject({ totalMatches: 0 });
  });

  it("rejects an empty query rather than returning the catalogue", async () => {
    const { context, urls } = toolHarness({});

    // Returning 15,000 instruments would flood the model's context.
    await expect(callTool(search, { query: "  " }, context)).rejects.toThrow();
    expect(urls).toHaveLength(0);
  });

  it("fetches the catalogue once across repeated searches", async () => {
    const { context, urls } = toolHarness({
      "/metadata/instruments": catalogue,
    });

    await callTool(search, { query: "apple" }, context);
    await callTool(search, { query: "vanguard" }, context);

    // The catalogue is rate-limited to roughly one call per minute.
    expect(urls).toHaveLength(1);
  });
});

describe("t212_list_exchanges", () => {
  const exchangeData = [
    {
      id: 1,
      name: "Test Exchange",
      workingSchedules: [
        {
          id: 10,
          timeEvents: [{ date: "2026-01-02T14:30:00Z", type: "OPEN" }],
        },
      ],
    },
  ];

  it("omits verbose schedules by default", async () => {
    const { context } = toolHarness({ "/metadata/exchanges": exchangeData });

    const result = await callTool(exchanges, {}, context);
    const data = result.data as { exchanges: Record<string, unknown>[] };

    expect(data.exchanges[0]).toMatchObject({ id: 1, name: "Test Exchange" });
    expect(data.exchanges[0]).not.toHaveProperty("workingSchedules");
  });

  it("includes schedules when asked", async () => {
    const { context } = toolHarness({ "/metadata/exchanges": exchangeData });

    const result = await callTool(
      exchanges,
      { includeSchedules: true },
      context,
    );
    const data = result.data as {
      exchanges: { workingSchedules?: unknown[] }[];
    };

    expect(data.exchanges[0]?.workingSchedules).toHaveLength(1);
  });

  it("counts the exchanges in the summary", async () => {
    const { context } = toolHarness({ "/metadata/exchanges": exchangeData });

    const result = await callTool(exchanges, {}, context);

    expect(result.summary).toBe("1 exchange available.");
  });
});
