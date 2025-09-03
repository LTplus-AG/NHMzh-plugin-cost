import { useMemo } from "react";
import { CostItem } from "../components/CostUploader/types";
import { computeItemTotal } from "../utils/costTotals";

// Helper function to get all items from a hierarchical structure (recursive)
const getAllItems = (items: CostItem[]): CostItem[] => {
  const result: CostItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children && item.children.length > 0) {
      result.push(...getAllItems(item.children));
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
 * Sums top-level items using centralized logic: groups = sum(children); leaves = (area || menge) × kennwert.
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

    // Calculate totalCost by summing ONLY the top-level items using centralized logic
    const totalCost = hierarchicalData.reduce(
      (sum, item) => sum + computeItemTotal(item),
      0
    );

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
