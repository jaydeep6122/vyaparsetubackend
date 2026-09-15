import { describe, expect, it } from "@jest/globals";
import {
  amountInWords,
  formatDate,
  formatINR,
  formatPercent,
  formatQuantity,
  formatRate,
  stateName,
} from "../src/utils/format.js";

describe("invoice formatting", () => {
  it("groups digits the Indian way", () => {
    expect(formatINR("1234567.5")).toBe("12,34,567.50");
    expect(formatINR("999")).toBe("999.00");
    expect(formatINR("100000")).toBe("1,00,000.00");
    expect(formatINR("-1234.5")).toBe("-1,234.50");
    expect(formatINR("0")).toBe("0.00");
  });

  it("writes amounts in words with lakh and crore", () => {
    expect(amountInWords("4720.00")).toBe("Rupees Four Thousand Seven Hundred Twenty Only");
    expect(amountInWords("12345678.05")).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Five Paise Only",
    );
    expect(amountInWords("100000")).toBe("Rupees One Lakh Only");
    expect(amountInWords("0")).toBe("Rupees Zero Only");
  });

  it("shows quantities, rates, percentages, dates and states compactly", () => {
    expect(formatQuantity("10.000")).toBe("10");
    expect(formatQuantity("250.500")).toBe("250.5");
    expect(formatRate("400.0000")).toBe("400.00");
    expect(formatRate("0.5500")).toBe("0.55");
    expect(formatRate("12.1250")).toBe("12.125");
    expect(formatPercent("18.00")).toBe("18%");
    expect(formatDate("2026-09-15")).toBe("15-09-2026");
    expect(stateName("24")).toBe("Gujarat");
  });
});
