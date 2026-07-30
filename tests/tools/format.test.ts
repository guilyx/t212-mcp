import { describe, expect, it } from "vitest";

import {
  limitItems,
  money,
  percent,
  pluralise,
  quantity,
  signed,
} from "../../src/tools/format.js";

describe("money", () => {
  it("formats to two decimal places with thousands separators", () => {
    expect(money(1234.5)).toBe("1,234.50");
  });

  it("appends a currency code when one is known", () => {
    expect(money(10, "GBP")).toBe("10.00 GBP");
  });

  it("reports an absent figure as unknown, never zero", () => {
    // Rendering a missing balance as 0.00 would read as "you have nothing".
    expect(money(null)).toBe("unknown");
    expect(money(undefined)).toBe("unknown");
    expect(money(Number.NaN)).toBe("unknown");
    expect(money(Number.POSITIVE_INFINITY)).toBe("unknown");
  });

  it("still renders a genuine zero", () => {
    expect(money(0)).toBe("0.00");
  });
});

describe("signed", () => {
  it("keeps the sign explicit in both directions", () => {
    expect(signed(12.5)).toBe("+12.50");
    expect(signed(-12.5)).toBe("-12.50");
    expect(signed(0)).toBe("+0.00");
  });

  it("reports an absent figure as unknown", () => {
    expect(signed(null)).toBe("unknown");
  });
});

describe("quantity", () => {
  it("trims trailing zeros from fractional shares", () => {
    expect(quantity(1.5)).toBe("1.5");
    expect(quantity(3)).toBe("3");
    expect(quantity(0.10000000001)).toBe("0.1");
  });

  it("reports an absent quantity as unknown", () => {
    expect(quantity(undefined)).toBe("unknown");
  });
});

describe("percent", () => {
  it("renders a ratio as a percentage", () => {
    expect(percent(0.1234)).toBe("12.34%");
  });

  it("reports an absent ratio as unknown", () => {
    expect(percent(null)).toBe("unknown");
  });
});

describe("pluralise", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralise(1, "position")).toBe("1 position");
  });

  it("adds an s otherwise, including for zero", () => {
    expect(pluralise(0, "position")).toBe("0 positions");
    expect(pluralise(2, "position")).toBe("2 positions");
  });

  it("accepts an explicit plural for words that +s would mangle", () => {
    expect(pluralise(3, "match", "matches")).toBe("3 matches");
    expect(pluralise(1, "match", "matches")).toBe("1 match");
  });
});

describe("limitItems", () => {
  it("truncates and reports the true total", () => {
    expect(limitItems([1, 2, 3], 2)).toEqual({
      items: [1, 2],
      truncated: true,
      total: 3,
    });
  });

  it("does not mark a complete list as truncated", () => {
    expect(limitItems([1, 2], 5)).toEqual({
      items: [1, 2],
      truncated: false,
      total: 2,
    });
  });

  it("handles an empty list", () => {
    expect(limitItems([], 5)).toEqual({
      items: [],
      truncated: false,
      total: 0,
    });
  });
});
