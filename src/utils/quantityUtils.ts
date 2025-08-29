import { MongoElement } from '../types/common.types';

/**
 * Extracts the quantity value from an element based on the selected quantity type
 * @param element - The MongoElement to extract quantity from
 * @param selectedQuantityType - The type of quantity to extract ('area', 'volume', 'length', 'count')
 * @returns The quantity value for the specified type
 */
export const getElementQuantityValue = (element: MongoElement, selectedQuantityType: string): number => {
  switch (selectedQuantityType) {
    case 'area':
      return element.area || 0;
    case 'volume':
      return element.volume || 0;
    case 'length':
      return element.length || 0;
    case 'count':
      // For count type, we should return 1 if element exists, but for missing quantity detection,
      // we need to check if the element has valid count-related data
      // Since elements in the database represent actual counted objects, return 1
      return 1;
    default:
      return element.area || 0; // Default to area
  }
};

/**
 * Checks if an element has missing quantities for the specified quantity type
 * This is different from getElementQuantityValue as it considers 'count' type differently
 * @param element - The MongoElement to check
 * @param selectedQuantityType - The type of quantity to check for ('area', 'volume', 'length', 'count')
 * @returns True if the element has missing quantities for the specified type
 */
export const hasElementMissingQuantity = (element: MongoElement, selectedQuantityType: string): boolean => {
  switch (selectedQuantityType) {
    case 'area':
      return !element.area || element.area <= 0;
    case 'volume':
      return !element.volume || element.volume <= 0;
    case 'length':
      return !element.length || element.length <= 0;
    case 'count':
      // For count type, if the element exists in the database, it should be counted
      // Only return true for missing if element itself is somehow invalid
      return !element._id;
    default:
      return !element.area || element.area <= 0; // Default to area
  }
};

/**
 * Maps quantity type to German label
 * @param type - The quantity type ('area', 'volume', 'length', 'count')
 * @returns The German label for the quantity type
 */
export const quantityTypeLabel = (type: string): string => {
  switch (type) {
    case 'area':
      return 'Fläche';
    case 'length':
      return 'Länge';
    case 'volume':
      return 'Volumen';
    case 'count':
      return 'Stück';
    default:
      return type;
  }
};

/**
 * Maps quantity type to German calculation label
 * @param type - The quantity type ('area', 'volume', 'length', 'count')
 * @returns The German calculation label for the quantity type
 */
export const quantityTypeCalculationLabel = (type: string): string => {
  switch (type) {
    case 'area':
      return 'Flächenberechnung';
    case 'length':
      return 'Längenberechnung';
    case 'volume':
      return 'Volumenberechnung';
    case 'count':
      return 'Stückzahl';
    default:
      return 'Andere';
  }
};

/**
 * Gets available quantities for a MongoElement
 * @param el - The MongoElement to get available quantities for
 * @returns Array of available quantities with value, type, unit, and label
 */
export const getAvailableQuantities = (el: MongoElement) => {
  const quantities = [];

  if (el.available_quantities && el.available_quantities.length > 0) {
    return el.available_quantities;
  }

  const elAny = el as MongoElement & { area?: number; length?: number; volume?: number };

  if (elAny.area && elAny.area > 0) {
    quantities.push({
      value: elAny.area,
      type: "area",
      unit: "m²",
      label: "Area"
    });
  }

  if (elAny.length && elAny.length > 0) {
    quantities.push({
      value: elAny.length,
      type: "length",
      unit: "m",
      label: "Length"
    });
  }

  if (elAny.volume && elAny.volume > 0) {
    quantities.push({
      value: elAny.volume,
      type: "volume",
      unit: "m³",
      label: "Volume"
    });
  }

  if (quantities.length === 0 || !quantities.some(q => q.type === 'count')) {
    quantities.push({
      value: 1,
      type: "count",
      unit: "Stk",
      label: "Count"
    });
  }

  return quantities;
};

/**
 * Gets the selected quantity for a MongoElement based on selected type
 * @param el - The MongoElement to get quantity for
 * @param selectedType - The type of quantity to select (optional, defaults to first available)
 * @returns Object with value, unit, and type of the selected quantity
 */
export const getSelectedQuantity = (
  el: MongoElement,
  selectedType?: string
): { value: number; unit: string; type: string } => {
  const availableQuantities = getAvailableQuantities(el);

  if (availableQuantities.length === 0) {
    return { value: 1, unit: "Stk", type: "count" };
  }

  if (selectedType) {
    const selected = availableQuantities.find(q => q.type === selectedType);
    if (selected) {
      return {
        value: selected.value,
        unit: selected.unit,
        type: selected.type
      };
    }
  }

  const defaultQty = availableQuantities[0];
  return {
    value: defaultQty.value,
    unit: defaultQty.unit,
    type: defaultQty.type
  };
}; 