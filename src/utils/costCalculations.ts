import { CostItem } from "../components/CostUploader/types";

export function computeRowTotal(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

export function computeGroupTotal(rows: Array<{ unitPrice: number; quantity: number }>): number {
  return rows.reduce((acc, r) => acc + computeRowTotal(r.unitPrice, r.quantity), 0);
}

export function computeCostItemTotal(item: CostItem): number {
  if (item.children && item.children.length > 0) {
    const totals = item.children.map((child) => computeCostItemTotal(child));
    return computeGroupTotal(totals.map((total) => ({ unitPrice: 1, quantity: total })));
  }
  const unitPrice = item.kennwert ?? item.cost_unit ?? 0;
  const quantity = item.area ?? item.menge ?? 0;
  return computeRowTotal(unitPrice, quantity);
}
