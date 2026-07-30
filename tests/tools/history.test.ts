import { describe, expect, it } from "vitest";

import { cursorFromPath, historyTools } from "../../src/tools/history.js";
import { callTool, findTool, toolHarness } from "../helpers/tools.js";

const pending = findTool(historyTools, "t212_list_pending_orders");
const orders = findTool(historyTools, "t212_list_order_history");
const dividends = findTool(historyTools, "t212_list_dividends");
const transactions = findTool(historyTools, "t212_list_transactions");

describe("cursorFromPath", () => {
  it("extracts the cursor from a server-supplied path", () => {
    expect(
      cursorFromPath("/api/v0/equity/history/orders?limit=20&cursor=abc123"),
    ).toBe("abc123");
  });

  it("returns undefined when there is no next page", () => {
    expect(cursorFromPath(null)).toBeUndefined();
    expect(cursorFromPath(undefined)).toBeUndefined();
    expect(cursorFromPath("")).toBeUndefined();
  });

  it("returns undefined when the path carries no cursor", () => {
    expect(cursorFromPath("/api/v0/equity/history/orders")).toBeUndefined();
  });

  it("copes with an absolute URL", () => {
    expect(cursorFromPath("https://demo.trading212.com/x?cursor=z")).toBe("z");
  });
});

describe("t212_list_pending_orders", () => {
  it("returns pending orders", async () => {
    const { context } = toolHarness({
      "/equity/orders": [
        { id: 1, ticker: "AAA_US_EQ", type: "LIMIT", limitPrice: 10 },
      ],
    });

    const result = await callTool(pending, {}, context);

    expect(result.summary).toBe("1 pending order.");
    expect(result.data).toMatchObject({ totalOrders: 1 });
  });

  it("says plainly when there are none", async () => {
    const { context } = toolHarness({ "/equity/orders": [] });

    const result = await callTool(pending, {}, context);

    expect(result.summary).toBe("No pending orders.");
  });
});

describe("t212_list_order_history", () => {
  const page = {
    items: [
      { id: 1, ticker: "AAA_US_EQ", fillPrice: 10, filledQuantity: 2 },
      { id: 2, ticker: "BBB_US_EQ", fillPrice: 5, filledQuantity: 1 },
    ],
    nextPagePath: "/api/v0/equity/history/orders?cursor=next-1",
  };

  it("returns a page of orders with a cursor for the next", async () => {
    const { context } = toolHarness({ "/equity/history/orders": page });

    const result = await callTool(orders, {}, context);

    expect(result.data).toMatchObject({
      nextCursor: "next-1",
      hasMore: true,
    });
    expect(result.summary).toContain("more available");
  });

  it("reduces the next page path to an opaque cursor", async () => {
    const { context } = toolHarness({ "/equity/history/orders": page });

    const result = await callTool(orders, {}, context);

    // Handing back a path invites it to be treated as a URL.
    expect(JSON.stringify(result.data)).not.toContain("/api/v0");
  });

  it("reports the end of the list", async () => {
    const { context } = toolHarness({
      "/equity/history/orders": { items: page.items },
    });

    const result = await callTool(orders, {}, context);

    expect(result.data).toMatchObject({ hasMore: false });
    expect(result.summary).not.toContain("more available");
  });

  it("passes pagination and filters through to the API", async () => {
    const { context, urls } = toolHarness({
      "/equity/history/orders": { items: [] },
    });

    await callTool(
      orders,
      { limit: 5, cursor: "abc", ticker: "AAA_US_EQ" },
      context,
    );

    const url = new URL(urls[0]!);
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("cursor")).toBe("abc");
    expect(url.searchParams.get("ticker")).toBe("AAA_US_EQ");
  });

  it("omits absent optional filters from the query", async () => {
    const { context, urls } = toolHarness({
      "/equity/history/orders": { items: [] },
    });

    await callTool(orders, {}, context);

    const url = new URL(urls[0]!);
    expect(url.searchParams.has("ticker")).toBe(false);
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("says plainly when the history is empty", async () => {
    const { context } = toolHarness({
      "/equity/history/orders": { items: [] },
    });

    const result = await callTool(orders, {}, context);

    expect(result.summary).toContain("No matching orders");
  });

  it("rejects a page size beyond the supported maximum", async () => {
    const { context } = toolHarness({});

    await expect(callTool(orders, { limit: 500 }, context)).rejects.toThrow();
  });
});

describe("t212_list_dividends", () => {
  it("totals the dividends on the page", async () => {
    const { context } = toolHarness({
      "/history/dividends": {
        items: [
          { ticker: "AAA_US_EQ", amount: 1.25 },
          { ticker: "BBB_US_EQ", amount: 2.5 },
        ],
      },
    });

    const result = await callTool(dividends, {}, context);

    expect(result.data).toMatchObject({ pageTotal: 3.75 });
    expect(result.summary).toContain("3.75");
  });

  it("describes the total as page-scoped, not lifetime", async () => {
    const { context } = toolHarness({
      "/history/dividends": {
        items: [{ ticker: "AAA_US_EQ", amount: 1 }],
        nextPagePath: "/x?cursor=2",
      },
    });

    const result = await callTool(dividends, {}, context);

    // A model must not report a partial total as the lifetime figure.
    expect(result.summary).toContain("on this page");
    expect(result.summary).toContain("more available");
  });

  it("says plainly when there are none", async () => {
    const { context } = toolHarness({ "/history/dividends": { items: [] } });

    const result = await callTool(dividends, {}, context);

    expect(result.summary).toBe("No dividends recorded.");
  });
});

describe("t212_list_transactions", () => {
  it("nets the transactions on the page, keeping the sign", async () => {
    const { context } = toolHarness({
      "/history/transactions": {
        items: [
          { type: "DEPOSIT", amount: 500 },
          { type: "WITHDRAW", amount: -200 },
        ],
      },
    });

    const result = await callTool(transactions, {}, context);

    expect(result.data).toMatchObject({ pageNet: 300 });
    expect(result.summary).toContain("+300.00");
  });

  it("shows a net outflow as negative", async () => {
    const { context } = toolHarness({
      "/history/transactions": { items: [{ type: "WITHDRAW", amount: -50 }] },
    });

    const result = await callTool(transactions, {}, context);

    expect(result.summary).toContain("-50.00");
  });

  it("says plainly when there are none", async () => {
    const { context } = toolHarness({
      "/history/transactions": { items: [] },
    });

    const result = await callTool(transactions, {}, context);

    expect(result.summary).toBe("No cash transactions recorded.");
  });
});
