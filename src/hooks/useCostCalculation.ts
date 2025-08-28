import { useMemo } from "react";
import { CostItem } from "../components/CostUploader/types"; // Adjust path as needed

// Helper function to get all items from a hierarchical structure (recursive)
const getAllItems = (items: CostItem[]): CostItem[] => {
  let result: CostItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children && item.children.length > 0) {
      result = result.concat(getAllItems(item.children));
    }
  }
  return result;
};

interface CostCalculationResult {
  totalCost: number;
  flatItems: CostItem[];
}

/**
 * Custom hook to calculate total cost from hierarchical CostItem data.
 * It flattens the hierarchy and sums the 'chf' or 'totalChf' field.
 * @param hierarchicalData The hierarchical array of CostItems.
 * @returns An object containing the totalCost and the flatItems array.
 */
export const useCostCalculation = (
  hierarchicalData: CostItem[] | null | undefined
): CostCalculationResult => {
  const calculationResult = useMemo((): CostCalculationResult => {
    if (!hierarchicalData) {
      return { totalCost: 0, flatItems: [] };
    }

    // Calculate totalCost by summing ONLY the top-level items.
    // Prefer the explicit total (totalChf). If absent, fall back to
    // quantity × unit cost, and finally to chf. Use nullish checks so 0 is valid.
    const totalCost = hierarchicalData.reduce((sum, item) => {
      const fromTotal = item.totalChf ?? null;
      const fromQtyUnit =
        item.menge != null && item.kennwert != null
          ? item.menge * item.kennwert
          : null;
      const fromChf = item.chf ?? null;

      const itemTotal =
        (fromTotal != null ? fromTotal : null) ??
        (fromQtyUnit != null ? fromQtyUnit : null) ??
        (fromChf != null ? fromChf : 0);

      return sum + (typeof itemTotal === "number" ? itemTotal : 0);
    }, 0);

    // We still might want the flat list for other purposes, so calculate it separately.
    const flatItems = getAllItems(hierarchicalData);

    // Optional: Log calculation details here if needed during debugging
    // console.log('[useCostCalculation]', { totalCost, topLevelItemCount: hierarchicalData.length, totalFlatItemCount: flatItems.length });

    return { totalCost, flatItems };
  }, [hierarchicalData]); // Dependency array includes the hierarchical data

  return calculationResult;
};

// Optional: Export getAllItems if needed elsewhere, otherwise keep it local.
// export { getAllItems };
