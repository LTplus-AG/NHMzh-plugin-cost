export interface RowCalculationParams {
  quantity?: number | null;
  unitPrice?: number | null;
  factor?: number | null;
}

export function computeRowTotal({ quantity, unitPrice, factor }: RowCalculationParams): number {
  const q = typeof quantity === 'number' ? quantity : 0;
  const p = typeof unitPrice === 'number' ? unitPrice : 0;
  const f = typeof factor === 'number' ? factor : 1;
  return q * p * f;
}

export function computeGroupTotal(rows: RowCalculationParams[]): number {
  return rows.reduce((sum, row) => sum + computeRowTotal(row), 0);
}
