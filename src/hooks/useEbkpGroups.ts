import { useMemo } from 'react';
import { CostEbkpGroup, HierarchicalCostEbkpGroup } from '../types/cost.types';
import { EbkpStat } from '../components/EbkpCostForm';

// Main EBKP group names mapping
const EBKP_MAIN_GROUP_NAMES: Record<string, string> = {
  A: "Grundstück",
  B: "Vorbereitung", 
  C: "Konstruktion",
  D: "Technik",
  E: "Äussere Wandbekleidung",
  F: "Bedachung",
  G: "Ausbau",
  H: "Nutzungsspezifische Anlage",
  I: "Umgebung",
  J: "Ausstattung",
};

// Helper to normalize EBKP codes to ensure leading zeros
const normalizeEbkpCode = (code: string): string => {
  // Match pattern like C2.3 or C02.03
  const match = code.match(/^([A-J])(\d{1,2})\.(\d{1,2})$/);
  if (match) {
    const [, letter, group, element] = match;
    // Pad with leading zeros to ensure 2 digits
    const paddedGroup = group.padStart(2, '0');
    const paddedElement = element.padStart(2, '0');
    return `${letter}${paddedGroup}.${paddedElement}`;
  }
  return code; // Return original if it doesn't match the pattern
};

// Helper to extract main group letter from EBKP code
const getMainGroupFromEbkpCode = (code: string): string | null => {
  // First normalize the code, then extract the main group
  const normalizedCode = normalizeEbkpCode(code);
  // Check if it's an EBKP code pattern (e.g., C01.03, E02.01)
  const match = normalizedCode.match(/^([A-J])\d{2}\.\d{2}$/);
  return match ? match[1] : null;
};

export const useEbkpGroups = (
  stats: EbkpStat[],
  kennwerte: Record<string, number>
) => {
  const { ebkpGroups, hierarchicalGroups } = useMemo(() => {
    // Convert stats to CostEbkpGroup format
    const ebkpGroups: CostEbkpGroup[] = stats.map(stat => ({
      code: normalizeEbkpCode(stat.code),
      name: stat.code, // You might want to add name mapping here
      elements: stat.elements || [],
      totalQuantity: stat.quantity,
      availableQuantities: stat.availableQuantities || [],
      selectedQuantityType: stat.selectedQuantityType,
      kennwert: kennwerte[stat.code] || 0,
    }));

    // Create hierarchical groups
    const hierarchicalMap = new Map<string, HierarchicalCostEbkpGroup>();
    
    ebkpGroups.forEach((group) => {
      // Check if this is an EBKP code
      const mainGroup = getMainGroupFromEbkpCode(group.code);
      
      if (mainGroup) {
        // It's an EBKP code - add to hierarchical structure
        if (!hierarchicalMap.has(mainGroup)) {
          hierarchicalMap.set(mainGroup, {
            mainGroup,
            mainGroupName: EBKP_MAIN_GROUP_NAMES[mainGroup] || mainGroup,
            subGroups: [],
            totalElements: 0,
            totalQuantity: 0,
            totalCost: 0,
          });
        }
        
        const hierarchicalGroup = hierarchicalMap.get(mainGroup)!;
        hierarchicalGroup.subGroups.push(group);
        hierarchicalGroup.totalElements += group.elements.length;
        hierarchicalGroup.totalQuantity += group.totalQuantity;
        hierarchicalGroup.totalCost += group.totalQuantity * (group.kennwert || 0);
      } else {
        // Not an EBKP code - add to "Other" group
        if (!hierarchicalMap.has("_OTHER_")) {
          hierarchicalMap.set("_OTHER_", {
            mainGroup: "_OTHER_",
            mainGroupName: "Sonstige Klassifikationen",
            subGroups: [],
            totalElements: 0,
            totalQuantity: 0,
            totalCost: 0,
          });
        }
        
        const otherGroup = hierarchicalMap.get("_OTHER_")!;
        otherGroup.subGroups.push(group);
        otherGroup.totalElements += group.elements.length;
        otherGroup.totalQuantity += group.totalQuantity;
        otherGroup.totalCost += group.totalQuantity * (group.kennwert || 0);
      }
    });

    // Sort hierarchical groups: EBKP groups A-J first, then Others
    const sortedHierarchicalGroups = Array.from(hierarchicalMap.values()).sort((a, b) => {
      if (a.mainGroup === "_OTHER_") return 1;
      if (b.mainGroup === "_OTHER_") return -1;
      return a.mainGroup.localeCompare(b.mainGroup);
    });

    // Sort subGroups within each hierarchical group by normalized code
    sortedHierarchicalGroups.forEach((hierarchicalGroup) => {
      hierarchicalGroup.subGroups.sort((a, b) => {
        const normalizedA = normalizeEbkpCode(a.code);
        const normalizedB = normalizeEbkpCode(b.code);
        return normalizedA.localeCompare(normalizedB);
      });
    });

    return { ebkpGroups, hierarchicalGroups: sortedHierarchicalGroups };
  }, [stats, kennwerte]);

  return { ebkpGroups, hierarchicalGroups };
}; 