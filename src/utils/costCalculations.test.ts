import { describe, it, expect } from "vitest";
import {
  computeRowTotal,
  computeGroupTotal,
  computeCostItemTotal,
} from "./costCalculations";
import { CostItem } from "../components/CostUploader/types";

describe("row calculation", () => {
  it("multiplies unit price and quantity", () => {
    expect(computeRowTotal(250, 3)).toBe(750);
  });
});

describe("group aggregation", () => {
  it("sums child row totals", () => {
    const rows = [
      { unitPrice: 100, quantity: 2 },
      { unitPrice: 50, quantity: 1.5 },
    ];
    expect(computeGroupTotal(rows)).toBe(275);
  });
});

describe("view parity", () => {
  it("collapsed and expanded totals are identical", () => {
    const item: CostItem = {
      children: [
        { kennwert: 100, menge: 2 },
        { kennwert: 50, menge: 1.5 },
      ],
    };
    const expandedTotal = item.children!
      .map((c) => computeCostItemTotal(c))
      .reduce((a, b) => a + b, 0);
    const collapsedTotal = computeCostItemTotal(item);
    expect(collapsedTotal).toBe(expandedTotal);
  });
});

describe("regression", () => {
  it("position price matches grand total", () => {
    const item: CostItem = {
      children: [
        { kennwert: 120, menge: 1, chf: 999 },
        { kennwert: 80, menge: 1 },
      ],
      totalChf: 555,
    };
    const childTotals = item.children!.map((c) => computeCostItemTotal(c));
    const groupTotal = computeCostItemTotal(item);
    expect(childTotals[0]).toBe(120);
    expect(childTotals[1]).toBe(80);
    expect(groupTotal).toBe(200);
    expect(groupTotal).toBe(childTotals.reduce((a, b) => a + b, 0));
  });
});
