export function computeRowTotal(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

export function computeGroupTotal(rows: Array<{ unitPrice: number; quantity: number }>): number {
  return rows.reduce((acc, r) => acc + computeRowTotal(r.unitPrice, r.quantity), 0);
}

// Helper to compute total for hierarchical cost items
import type { CostItem } from '../components/CostUploader/types';

export function computeItemTotal(item: CostItem): number {
  const quantity = item.menge ?? item.area ?? 0;
  const unitPrice = item.kennwert ?? 0;

  if (item.children && item.children.length > 0) {
    const childTotals = item.children.map((child) => computeItemTotal(child));
    return computeGroupTotal(childTotals.map((t) => ({ unitPrice: 1, quantity: t })));
  }

  return computeRowTotal(unitPrice, quantity);
}
