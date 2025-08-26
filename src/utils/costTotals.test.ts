import { describe, it, expect } from 'vitest';
import { computeRowTotal, computeGroupTotal, computeItemTotal } from './costTotals';
import type { CostItem } from '../components/CostUploader/types';

describe('cost total calculations', () => {
  it('row calculation', () => {
    expect(computeRowTotal(250, 3)).toBe(750);
  });

  it('group aggregation', () => {
    const rows = [
      { unitPrice: 100, quantity: 2 },
      { unitPrice: 50, quantity: 1.5 },
    ];
    expect(computeGroupTotal(rows)).toBe(275);
  });

  it('view parity', () => {
    const children: CostItem[] = [
      { kennwert: 100, menge: 2 },
      { kennwert: 50, menge: 1.5 },
    ];
    const group: CostItem = { children };
    const expanded = children.reduce((sum, c) => sum + computeItemTotal(c), 0);
    const collapsed = computeItemTotal(group);
    expect(collapsed).toBe(expanded);
  });

  it('regression mismatch', () => {
    const child: CostItem = { kennwert: 80, menge: 1, totalChf: 999 };
    const group: CostItem = { children: [child], totalChf: 1234 };
    expect(computeItemTotal(child)).toBe(80);
    expect(computeItemTotal(group)).toBe(80);
  });
});
