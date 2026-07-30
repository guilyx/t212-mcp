import { describe, expect, it } from "vitest";

import {
  accountCashSchema,
  exchangesSchema,
  instrumentsSchema,
  paginatedOrdersSchema,
  pieSchema,
  positionSchema,
  positionsSchema,
  transactionSchema,
} from "../../src/t212/schemas.js";

// Every value below is invented. No real account data belongs in this suite.

describe("accountCashSchema", () => {
  it("accepts a full cash response", () => {
    const parsed = accountCashSchema.parse({
      free: 100.25,
      total: 1000.5,
      ppl: -12.75,
      result: 40,
      invested: 900.25,
      pieCash: 0,
      blocked: null,
    });

    expect(parsed.free).toBe(100.25);
    expect(parsed.blocked).toBeNull();
  });

  it("keeps fields it does not know about", () => {
    const parsed = accountCashSchema.parse({
      free: 1,
      newFieldFromUpstream: 7,
    });

    expect(parsed["newFieldFromUpstream"]).toBe(7);
  });

  it("rejects money that arrives as a string", () => {
    // A string here would flow straight into an answer as a balance.
    expect(() => accountCashSchema.parse({ free: "100.25" })).toThrow();
  });
});

describe("positionSchema", () => {
  it("accepts a position with every field populated", () => {
    const parsed = positionSchema.parse({
      ticker: "TEST_US_EQ",
      quantity: 3,
      averagePrice: 10,
      currentPrice: 12,
      ppl: 6,
      fxPpl: -0.5,
      initialFillDate: "2026-01-02T03:04:05.000+00:00",
      maxBuy: 100,
      maxSell: 3,
      pieQuantity: 0,
      frontend: "API",
    });

    expect(parsed.ticker).toBe("TEST_US_EQ");
    expect(parsed.ppl).toBe(6);
  });

  it("requires the fields that identify and size the position", () => {
    expect(() => positionSchema.parse({ quantity: 1 })).toThrow();
    expect(() => positionSchema.parse({ ticker: "TEST_US_EQ" })).toThrow();
  });

  it("tolerates omitted optional detail", () => {
    const parsed = positionSchema.parse({ ticker: "TEST_US_EQ", quantity: 1 });

    expect(parsed.currentPrice).toBeUndefined();
  });

  it("accepts an empty portfolio", () => {
    expect(positionsSchema.parse([])).toEqual([]);
  });
});

describe("instrumentsSchema", () => {
  it("parses a catalogue entry", () => {
    const [parsed] = instrumentsSchema.parse([
      {
        ticker: "TEST_US_EQ",
        type: "STOCK",
        isin: "US0000000000",
        currencyCode: "USD",
        name: "Test Corporation",
        shortName: "TEST",
        workingScheduleId: 1,
        minTradeQuantity: 0.1,
        maxOpenQuantity: 1000,
        addedOn: "2020-01-01T00:00:00.000+00:00",
      },
    ]);

    expect(parsed?.name).toBe("Test Corporation");
  });

  it("requires a ticker, since it is the lookup key", () => {
    expect(() => instrumentsSchema.parse([{ name: "No ticker" }])).toThrow();
  });
});

describe("exchangesSchema", () => {
  it("parses nested working schedules", () => {
    const [parsed] = exchangesSchema.parse([
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
    ]);

    expect(parsed?.workingSchedules?.[0]?.timeEvents?.[0]?.type).toBe("OPEN");
  });

  it("accepts an exchange with no published schedule", () => {
    expect(() =>
      exchangesSchema.parse([{ id: 1, name: "Quiet" }]),
    ).not.toThrow();
  });
});

describe("pieSchema", () => {
  it("parses nested results and dividend details", () => {
    const parsed = pieSchema.parse({
      id: 7,
      cash: 12.5,
      progress: 0.42,
      status: "AHEAD",
      dividendDetails: { gained: 3, reinvested: 2, inCash: 1 },
      result: {
        priceAvgInvestedValue: 100,
        priceAvgValue: 120,
        priceAvgResult: 20,
        priceAvgResultCoef: 0.2,
      },
    });

    expect(parsed.result?.priceAvgResultCoef).toBe(0.2);
  });
});

describe("transactionSchema", () => {
  it("parses a cash movement", () => {
    const parsed = transactionSchema.parse({
      type: "DEPOSIT",
      reference: "TEST-REF-1",
      amount: 250,
      dateTime: "2026-01-02T03:04:05.000+00:00",
    });

    expect(parsed.amount).toBe(250);
  });
});

describe("paginated envelopes", () => {
  it("carries the next page path when there is more data", () => {
    const parsed = paginatedOrdersSchema.parse({
      items: [{ id: 1, ticker: "TEST_US_EQ" }],
      nextPagePath: "/api/v0/equity/history/orders?cursor=2",
    });

    expect(parsed.nextPagePath).toBe("/api/v0/equity/history/orders?cursor=2");
  });

  it("treats a missing next page as the end of the list", () => {
    const parsed = paginatedOrdersSchema.parse({ items: [] });

    expect(parsed.nextPagePath).toBeUndefined();
  });

  it("requires the items array to be present", () => {
    expect(() => paginatedOrdersSchema.parse({ nextPagePath: null })).toThrow();
  });
});
