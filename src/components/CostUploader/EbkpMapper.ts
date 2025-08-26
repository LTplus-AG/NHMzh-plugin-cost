import { CostItem } from "./types";
import { computeRowTotal } from "../../utils/costCalculations";

// Define ProjectElement type locally to avoid the import issue
interface ProjectElement {
  id: string;
  ebkpCode: string;
  // New nested quantity structure
  quantity?: {
    value: number;
    type: string;
    unit: string;
  };
  // Legacy fields for backward compatibility
  area?: number;
  description?: string;
  category?: string;
  level?: string;
  // Add IFC-specific fields from new schema
  ifc_class?: string;
  type_name?: string;
  name?: string;
  is_structural?: boolean;
  is_external?: boolean;
}

/**
 * Utility class for mapping eBKP codes between IFC elements and Excel files
 */
export class EbkpMapper {
  private projectElements: ProjectElement[] = [];
  private ebkpMap: Record<string, ProjectElement[]> = {};

  /**
   * Initialize the mapper with project elements
   */
  constructor(projectElements?: ProjectElement[]) {
    if (projectElements) {
      this.setProjectElements(projectElements);
    }
  }

  /**
   * Set project elements and build the eBKP map
   */
  setProjectElements(elements: ProjectElement[]) {
    if (elements.length === 0) {
      return;
    }

    this.projectElements = elements;
    this.ebkpMap = {};

    const uniqueCodes = new Set<string>();

    elements.forEach((element) => {
      if (!element.ebkpCode) {
        return;
      }

      const normalizedCode = this.normalizeEbkpCode(element.ebkpCode);
      uniqueCodes.add(normalizedCode);

      if (!this.ebkpMap[normalizedCode]) {
        this.ebkpMap[normalizedCode] = [];
      }
      this.ebkpMap[normalizedCode].push(element);

      this.addElementToAlternativeKeys(element, normalizedCode);
    });
  }

  /**
   * Add an element to alternative keying strategies for more robust matching
   */
  private addElementToAlternativeKeys(
    element: ProjectElement,
    normalizedCode: string
  ) {
    if (!normalizedCode || !/^[A-Z][0-9]/.test(normalizedCode)) {
      return;
    }

    const withoutDots = normalizedCode.replace(/\./g, "");
    if (withoutDots !== normalizedCode) {
      if (!this.ebkpMap[withoutDots]) {
        this.ebkpMap[withoutDots] = [];
      }
      if (!this.ebkpMap[withoutDots].some((e) => e.id === element.id)) {
        this.ebkpMap[withoutDots].push(element);
      }
    }

    const mainCategory = normalizedCode.match(/^([A-Z][0-9]+)/);
    if (mainCategory && mainCategory[1] && mainCategory[1] !== normalizedCode) {
      const mainCategoryCode = mainCategory[1];
      if (!this.ebkpMap[mainCategoryCode]) {
        this.ebkpMap[mainCategoryCode] = [];
      }
      if (!this.ebkpMap[mainCategoryCode].some((e) => e.id === element.id)) {
        this.ebkpMap[mainCategoryCode].push(element);
      }
    }
  }

  /**
   * Normalize eBKP code to ensure consistent matching
   */
  normalizeEbkpCode(code: string): string {
    if (!code) return "";

    const upperCode = code.toUpperCase().trim();
    const normalized = upperCode.replace(/\s+/g, "");

    const match =
      normalized.match(/([A-Z]+)([0-9].*)/) ||
      normalized.match(/([A-Z]+)([0-9]+)/);
    if (!match) {
      return normalized;
    }

    const letter = match[1];
    const numbers = match[2];

    let normalizedNumbers = "";
    if (numbers.includes(".")) {
      const parts = numbers.split(".");
      normalizedNumbers = parts
        .map((part) => part.replace(/^0+/, ""))
        .map((part) => part || "0")
        .join(".");
    } else {
      normalizedNumbers = numbers.replace(/^0+/, "") || "0";
    }

    return letter + normalizedNumbers;
  }

  /**
   * Get all elements for a specific eBKP code
   */
  getElementsForEbkp(ebkpCode: string): ProjectElement[] {
    const normalizedCode = this.normalizeEbkpCode(ebkpCode);
    const elements = this.ebkpMap[normalizedCode] || [];

    if (elements.length === 0 && Object.keys(this.ebkpMap).length > 0) {
      const simplifiedCode = normalizedCode.replace(/\./g, "");
      const matches: ProjectElement[] = [];

      for (const [key, value] of Object.entries(this.ebkpMap)) {
        const simplifiedKey = key.replace(/\./g, "");

        if (simplifiedCode.charAt(0) === simplifiedKey.charAt(0)) {
          if (simplifiedCode.length >= 2 && simplifiedKey.length >= 2) {
            const restCode = simplifiedCode.substring(1);
            const restKey = simplifiedKey.substring(1);

            if (parseInt(restCode, 10) === parseInt(restKey, 10)) {
              matches.push(...value);
            }
          }
        }
      }

      if (matches.length === 0) {
        for (const [key, value] of Object.entries(this.ebkpMap)) {
          if (
            key.startsWith(normalizedCode) ||
            normalizedCode.startsWith(key)
          ) {
            matches.push(...value);
          }
        }
      }

      if (matches.length === 0) {
        const mainCategory = normalizedCode.match(/^([A-Z][0-9]+)/);
        if (mainCategory && mainCategory[1]) {
          const categoryPrefix = mainCategory[1];
          for (const [key, value] of Object.entries(this.ebkpMap)) {
            if (
              key.startsWith(categoryPrefix + ".") ||
              key === categoryPrefix
            ) {
              matches.push(...value);
            }
          }
        }
      }

      if (matches.length > 0) {
        return matches;
      }
    }

    return elements;
  }

  /**
   * Get element quantity value by handling both legacy and new structure
   */
  private getQuantityValue(element: ProjectElement): number {
    if (element.quantity && typeof element.quantity === "object") {
      return element.quantity.value || 0;
    }

    if (element.area !== undefined) {
      return element.area;
    }

    return 0;
  }

  /**
   * Get total area/quantity for a specific eBKP code
   */
  getTotalAreaForEbkp(ebkpCode: string): number {
    const elements = this.getElementsForEbkp(ebkpCode);
    return elements.reduce(
      (sum, element) => sum + this.getQuantityValue(element),
      0
    );
  }

  /**
   * Process items recursively. Focuses on mapping leaf nodes with exact eBKP matches.
   */
  private processItemsRecursively(
    items: CostItem[],
    options: { alwaysUseDbQuantities: boolean } // Options might be less relevant now
  ): void {
    items.forEach((item) => {
      // --- Recursive Step FIRST ---
      // Process children before deciding on the parent.
      // Parent totals will be handled later by recalculateParentTotals.
      if (item.children && item.children.length > 0) {
        this.processItemsRecursively(item.children, options);
      }
      // --- Process LEAF nodes with eBKP ---
      else if (item.ebkp) {
        const normalizedExcelCode = this.normalizeEbkpCode(item.ebkp);
        // Get BIM elements that EXACTLY match the normalized code
        // Assumes ebkpMap keys are already normalized during construction
        const exactMatchingElements = this.ebkpMap[normalizedExcelCode] || [];

        if (exactMatchingElements.length > 0) {
          // Sum quantity ONLY from exactly matching elements
          const totalExactArea = exactMatchingElements.reduce(
            (sum, element) => sum + this.getQuantityValue(element),
            0
          );

          // Update item only if matching elements have quantity
          if (totalExactArea > 0) {
            if (!item.originalValues) item.originalValues = {};
            if (item.menge !== undefined)
              item.originalValues.menge = item.menge;
            if (item.chf !== undefined) item.originalValues.chf = item.chf;

            item.menge = totalExactArea;
            item.area = totalExactArea;
            item.areaSource = "IFC-Exact"; // Mark source clearly
            item.kafkaTimestamp = new Date().toISOString();
            item.dbElements = exactMatchingElements.length;
            item.dbArea = totalExactArea;
            // Potentially copy quantity type/unit from first match
            if (exactMatchingElements[0]?.quantity?.type) {
              item.quantityType = exactMatchingElements[0].quantity.type;
              item.quantityUnit = exactMatchingElements[0].quantity.unit;
            }

            // Recalculate CHF based on exact match area and original kennwert
            if (typeof item.kennwert === "number" && item.kennwert > 0) {
              const rowTotal = computeRowTotal({
                quantity: totalExactArea,
                unitPrice: item.kennwert,
                factor: item.factor,
              });
              item.chf = rowTotal;
              item.totalChf = rowTotal; // Keep consistent
            } else {
              item.chf = 0;
              item.totalChf = 0;
            }
          } else {
            // Exact match(es) found, but total area is 0. Retain Excel values.
            item.areaSource = "IFC-Exact (Zero Qty)";
          }
        } else {
          // No exact BIM match found for this leaf item's eBKP code.
          item.areaSource = "Excel"; // Explicitly mark as not mapped
        }
      }
      // --- Else: Item is a leaf node WITHOUT an eBKP code ---
      // Retain its original values from Excel. It will be summed up by parents.
      else if (!item.children || item.children.length === 0) {
        item.areaSource = "Excel (No EBKP)";
      }
    });
  }

  /**
   * Map quantities into cost items from the Excel file
   */
  mapQuantitiesToCostItems(
    costItems: CostItem[],
    options?: { alwaysUseDbQuantities?: boolean }
  ): CostItem[] {
    const updatedItems = JSON.parse(JSON.stringify(costItems)) as CostItem[];
    const opts = {
      alwaysUseDbQuantities: true, // This option seems less relevant now?
      ...options,
    };
    this.processItemsRecursively(updatedItems, opts);
    this.recalculateParentTotals(updatedItems);
    return updatedItems;
  }

  /**
   * Calculate total cost for all items
   * @deprecated Use recalculateParentTotals and access top-level chf instead.
   */
  calculateTotalCost(items: CostItem[]): number {
    let total = 0;

    items.forEach((item) => {
      // Add current item's cost if available
      if (item.chf) {
        total += item.chf;
      }

      // Add children's costs recursively
      if (item.children && item.children.length > 0) {
        total += this.calculateTotalCost(item.children);
      }
    });

    return total;
  }

  /**
   * Recursively recalculates the chf/totalChf for parent items
   * based on the final values of their children.
   */
  private recalculateParentTotals(items: CostItem[]): void {
    items.forEach((item) => {
      if (item.children && item.children.length > 0) {
        // First, ensure totals for all children are calculated
        this.recalculateParentTotals(item.children);

        // Now, sum the final chf values of the direct children
        const childrenTotalChf = item.children.reduce(
          (sum, child) =>
            sum +
            computeRowTotal({
              quantity: child.area !== undefined ? child.area : child.menge,
              unitPrice: child.kennwert,
              factor: child.factor,
            }),
          0
        );

        // Update the parent's chf value
        item.chf = childrenTotalChf;
        item.totalChf = childrenTotalChf; // Keep both fields consistent if needed

        // Clear menge/kennwert for parent nodes if they only represent totals
        item.menge = undefined;
        item.kennwert = undefined;
        item.einheit = undefined; // Clear unit as well
      }
      // Leaf nodes keep their chf calculated during processItemsRecursively
    });
  }

  /**
   * Get statistics about the mapping
   */
  getStatistics(): {
    totalElements: number;
    uniqueCodes: number;
    mappedCodes: string[];
  } {
    return {
      totalElements: this.projectElements.length,
      uniqueCodes: Object.keys(this.ebkpMap).length,
      mappedCodes: Object.keys(this.ebkpMap),
    };
  }
}

export default EbkpMapper;
