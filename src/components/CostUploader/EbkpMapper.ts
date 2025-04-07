import { CostItem } from "./types";

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
   * Map quantities into cost items from the Excel file
   */
  mapQuantitiesToCostItems(
    costItems: CostItem[],
    options?: {
      alwaysUseDbQuantities?: boolean;
    }
  ): CostItem[] {
    const updatedItems = JSON.parse(JSON.stringify(costItems)) as CostItem[];
    const opts = {
      alwaysUseDbQuantities: true,
      ...options,
    };

    this.processItemsRecursively(updatedItems, opts);
    return updatedItems;
  }

  /**
   * Process items recursively to add quantities
   */
  private processItemsRecursively(
    items: CostItem[],
    options: {
      alwaysUseDbQuantities: boolean;
    }
  ): void {
    items.forEach((item) => {
      if (item.ebkp) {
        const totalArea = this.getTotalAreaForEbkp(item.ebkp);
        const elements = this.getElementsForEbkp(item.ebkp);

        if (item.menge && options.alwaysUseDbQuantities) {
          if (!item.originalValues) {
            item.originalValues = {};
          }
          item.originalValues.menge = item.menge;
        }

        if (options.alwaysUseDbQuantities || !item.menge || item.menge === 0) {
          if (elements.length > 0 && totalArea > 0) {
            item.menge = totalArea;
            item.area = totalArea;
            item.areaSource = "IFC";
            item.kafkaTimestamp = new Date().toISOString();

            if (elements[0]?.quantity?.type) {
              item.quantityType = elements[0].quantity.type;
              item.quantityUnit = elements[0].quantity.unit;
            }

            if (item.kennwert) {
              item.chf = item.kennwert * totalArea;
            }

            item.dbElements = elements.length;
            item.dbArea = totalArea;
          }
        }
      }

      if (item.children && item.children.length > 0) {
        this.processItemsRecursively(item.children, options);
      }
    });
  }

  /**
   * Calculate total cost for all items
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
