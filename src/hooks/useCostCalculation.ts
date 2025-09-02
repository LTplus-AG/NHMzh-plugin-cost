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
    // EbkpMapper.recalculateParentTotals should have already aggregated children totals into these parents.
    const totalCost = hierarchicalData.reduce(
      (sum, item) => sum + (item.chf || item.totalChf || 0),
      0
    );

    const flatItems = getAllItems(hierarchicalData);



    return { totalCost, flatItems };
  }, [hierarchicalData]); // Dependency array includes the hierarchical data

  return calculationResult;
};


