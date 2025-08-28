export function computeRowTotal(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

export function computeGroupTotal(rows: Array<{ unitPrice: number; quantity: number }>): number {
  return rows.reduce((acc, r) => acc + computeRowTotal(r.unitPrice, r.quantity), 0);
}

// Helper to compute total for hierarchical cost items
import type { CostItem } from '../components/CostUploader/types';

// Memoization cache to avoid recomputing totals for the same item objects repeatedly
// WeakMap ensures no memory leaks when items are garbage-collected
type CacheEntry = { total: number; signature: string; version: number };
const itemTotalCache: WeakMap<CostItem, CacheEntry> = new WeakMap();

export function computeItemTotal(item: CostItem): number {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0;

  if (hasChildren) {
    // Compute children first (will be cached individually)
    const childTotals: number[] = [];
    const childVersions: number[] = [];
    const childSigs: string[] = [];
    for (const child of item.children as CostItem[]) {
      childTotals.push(computeItemTotal(child));
      const childEntry = itemTotalCache.get(child);
      childVersions.push(childEntry?.version ?? 0);
      if (childEntry?.signature) {
        childSigs.push(childEntry.signature);
      } else {
        // Rare fallback: child entry should exist after computeItemTotal(child)
        childSigs.push(generateItemSignature(child));
      }
    }

    const total = childTotals.reduce((sum, t) => sum + t, 0);
    const signature = `g|cs:[${childSigs.sort().join(',')}]|len:${childVersions.length}`;

    const cached = itemTotalCache.get(item);
    if (cached && cached.signature === signature) {
      return cached.total;
    }

    const nextVersion = (cached?.signature === signature) ? (cached.version) : ((cached?.version ?? 0) + 1);
    itemTotalCache.set(item, { total, signature, version: nextVersion });
    return total;
  }

  // Leaf row: prefer area over menge to align with UI quantity logic
  const quantity = (item.area ?? item.menge ?? 0);
  const unitPrice = item.kennwert ?? 0;
  const total = computeRowTotal(unitPrice, quantity);
  const signature = `l|u:${unitPrice}|q:${quantity}`;

  const cached = itemTotalCache.get(item);
  if (cached && cached.signature === signature) {
    return cached.total;
  }

  const nextVersion = (cached?.signature === signature) ? (cached.version) : ((cached?.version ?? 0) + 1);
  itemTotalCache.set(item, { total, signature, version: nextVersion });
  return total;
}

/**
 * Recursively aggregates area and element count from children
 * Uses nullish coalescing to properly handle element_count of 0
 * @param item The cost item to aggregate totals from
 * @returns Object with area and elementCount totals
 */
export function aggregateChildTotals(item: CostItem): { area: number; elementCount: number } {
  if (!item.children || item.children.length === 0) {
    return { area: 0, elementCount: 0 };
  }

  return item.children.reduce<{ area: number; elementCount: number }>(
    (acc, child) => {
      if (child.children && child.children.length > 0) {
        // Recursively aggregate from nested children
        const childTotals = aggregateChildTotals(child);
        acc.area += childTotals.area;
        acc.elementCount += childTotals.elementCount;
      } else {
        // Leaf node: use area-first logic for quantity, nullish coalescing for element_count
        const qty = child.area ?? child.menge ?? 0;
        acc.area += qty;
        acc.elementCount += child.element_count ?? 1;
      }
      return acc;
    },
    { area: 0, elementCount: 0 }
  );
}

/**
 * Generates a stable signature for deep change detection
 * Creates a deterministic string representation of the item's relevant properties
 * for use in React dependency arrays to detect deep tree changes
 * @param item The cost item to generate signature for
 * @returns A stable string signature of the item's structure and values
 */
export function generateItemSignature(item: CostItem): string {
  // Create a stable signature focusing on properties that affect CHF calculations
  const signatureParts: string[] = [
    `ebkp:${item.ebkp || ''}`,
    `kennwert:${item.kennwert || 0}`,
    `area:${item.area || 0}`,
    `menge:${item.menge || 0}`,
  ];

  // Recursively add child signatures in a deterministic order
  if (item.children && item.children.length > 0) {
    const childSignatures = item.children
      .map(child => generateItemSignature(child))
      .sort(); // Sort to ensure consistent ordering regardless of array order changes

    signatureParts.push(`children:[${childSignatures.join(',')}]`);
  } else {
    signatureParts.push('children:[]');
  }

  return signatureParts.join('|');
}
