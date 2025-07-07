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