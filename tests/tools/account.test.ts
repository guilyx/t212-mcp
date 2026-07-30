import { describe, expect, it } from "vitest";

import { accountTools } from "../../src/tools/account.js";
import { callTool, findTool, toolHarness } from "../helpers/tools.js";

const cash = findTool(accountTools, "t212_get_account_cash");
const info = findTool(accountTools, "t212_get_account_info");

describe("t212_get_account_cash", () => {
  it("returns the cash breakdown", async () => {
    const { context } = toolHarness({
      "/equity/account/cash": {
        free: 250.5,
        total: 1_250.75,
        invested: 1_000.25,
        ppl: -12.4,
        result: 40,
        pieCash: 0,
        blocked: null,
      },
    });

    const result = await callTool(cash, {}, context);

    expect(result.data).toMatchObject({ free: 250.5, total: 1_250.75 });
  });

  it("summarises the figures a person would ask for", async () => {
    const { context } = toolHarness({
      "/equity/account/cash": {
        free: 250.5,
        total: 1_250.75,
        invested: 1_000.25,
        ppl: -12.4,
      },
    });

    const { summary } = await callTool(cash, {}, context);

    expect(summary).toContain("250.50");
    expect(summary).toContain("1,250.75");
    // Losses must read as losses.
    expect(summary).toContain("-12.40");
  });

  it("says a figure is unknown rather than showing zero", async () => {
    const { context } = toolHarness({ "/equity/account/cash": { free: 10 } });

    const { summary } = await callTool(cash, {}, context);

    // Reporting an absent figure as 0.00 would read as "you have nothing".
    expect(summary).toContain("Free cash 10.00");
    expect(summary).toContain("total account value unknown");
    expect(summary).toContain("invested unknown");
  });

  it("calls the documented endpoint", async () => {
    const { context, urls } = toolHarness({ "/equity/account/cash": {} });

    await callTool(cash, {}, context);

    expect(urls[0]).toContain("/api/v0/equity/account/cash");
  });

  it("propagates an API failure rather than inventing a balance", async () => {
    const { context } = toolHarness({});

    await expect(callTool(cash, {}, context)).rejects.toThrow();
  });
});

describe("t212_get_account_info", () => {
  it("returns the reporting currency", async () => {
    const { context } = toolHarness({
      "/equity/account/info": { id: 12_345, currencyCode: "GBP" },
    });

    const result = await callTool(info, {}, context);

    expect(result.summary).toContain("GBP");
    expect(result.data).toMatchObject({ currencyCode: "GBP" });
  });

  it("reports which environment the figures came from", async () => {
    const { context } = toolHarness({
      "/equity/account/info": { id: 1, currencyCode: "EUR" },
    });

    const result = await callTool(info, {}, context);

    // A model that knows this is the practice account will not describe the
    // numbers as real money.
    expect(result.summary).toContain("demo");
    expect(result.data).toMatchObject({ environment: "demo" });
  });

  it("copes with a missing currency code", async () => {
    const { context } = toolHarness({ "/equity/account/info": { id: 1 } });

    const result = await callTool(info, {}, context);

    expect(result.summary).toContain("unspecified currency");
  });
});

describe("account tool definitions", () => {
  it("tells the model what each tool is for", () => {
    for (const tool of accountTools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(80);
      expect(tool.title.length, tool.name).toBeGreaterThan(3);
    }
  });

  it("namespaces tool names so they survive a flattened client", () => {
    for (const tool of accountTools) {
      expect(tool.name).toMatch(/^t212_/);
    }
  });
});
