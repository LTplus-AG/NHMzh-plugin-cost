import { useMemo } from "react";
import { CostItem } from "../components/CostUploader/types"; // Adjust path as needed
import { computeRowTotal, computeGroupTotal } from "../utils/costCalculations";

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

    const calculateItemCost = (item: CostItem): number => {
      if (item.children && item.children.length > 0) {
        const rows = item.children.map(child => ({
          quantity: child.area !== undefined ? child.area : child.menge,
          unitPrice: child.kennwert,
          factor: child.factor,
        }));
        return computeGroupTotal(rows);
      }
      const quantity = item.area !== undefined ? item.area : item.menge;
      return computeRowTotal({
        quantity,
        unitPrice: item.kennwert,
        factor: item.factor,
      });
    };

    const totalCost = hierarchicalData.reduce(
      (sum, item) => sum + calculateItemCost(item),
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
