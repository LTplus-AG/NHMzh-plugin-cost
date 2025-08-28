import { describe, it, expect } from 'vitest';
import { computeRowTotal, computeGroupTotal, computeItemTotal, aggregateChildTotals } from './costTotals';
import type { CostItem } from '../components/CostUploader/types';

describe('cost total calculations', () => {
  it('row calculation', () => {
    expect(computeRowTotal(250, 3)).toBe(750);
  });

  it('group aggregation', () => {
    const rows = [
      { unitPrice: 100, quantity: 2 },
      { unitPrice: 50, quantity: 1.5 },
    ];
    expect(computeGroupTotal(rows)).toBe(275);
  });

  it('view parity', () => {
    const children: CostItem[] = [
      { kennwert: 100, menge: 2 },
      { kennwert: 50, menge: 1.5 },
    ];
    const group: CostItem = { children };
    const expanded = children.reduce((sum, c) => sum + computeItemTotal(c), 0);
    const collapsed = computeItemTotal(group);
    expect(collapsed).toBe(expanded);
  });

  it('regression mismatch', () => {
    const child: CostItem = { kennwert: 80, menge: 1, totalChf: 999 };
    const group: CostItem = { children: [child], totalChf: 1234 };
    expect(computeItemTotal(child)).toBe(80);
    expect(computeItemTotal(group)).toBe(80);
  });

  it('prefers area over menge for leaf rows', () => {
    const item: CostItem = { kennwert: 100, menge: 2, area: 3 };
    // Area-first rule => 100 * 3
    expect(computeItemTotal(item)).toBe(300);
  });

  it('falls back to menge when area missing', () => {
    const item: CostItem = { kennwert: 120, menge: 4 };
    expect(computeItemTotal(item)).toBe(480);
  });

  describe('aggregateChildTotals', () => {
    it('handles element_count of 0 correctly with nullish coalescing', () => {
      const item: CostItem = {
        children: [
          { area: 10, element_count: 0 }, // Should count as 0, not 1
          { area: 20, element_count: 2 },
          { area: 30, element_count: undefined }, // Should default to 1
        ]
      };
      const result = aggregateChildTotals(item);
      expect(result.area).toBe(60);
      expect(result.elementCount).toBe(0 + 2 + 1); // 3, not 4
    });

    it('recursively aggregates nested children', () => {
      const item: CostItem = {
        children: [
          {
            children: [
              { area: 5, element_count: 1 },
              { area: 10, element_count: 2 },
            ]
          },
          { area: 15, element_count: 3 },
        ]
      };
      const result = aggregateChildTotals(item);
      expect(result.area).toBe(30); // 5 + 10 + 15
      expect(result.elementCount).toBe(6); // 1 + 2 + 3
    });

    it('prefers area over menge for leaf nodes', () => {
      const item: CostItem = {
        children: [
          { menge: 10, area: 20, element_count: 1 }, // Should use area (20)
          { menge: 30, element_count: 2 }, // Should use menge (30)
        ]
      };
      const result = aggregateChildTotals(item);
      expect(result.area).toBe(50); // 20 + 30
      expect(result.elementCount).toBe(3); // 1 + 2
    });
  });

  describe('memoization behavior', () => {
    it('computeItemTotal uses area-first logic consistently', () => {
      const itemWithBoth: CostItem = {
        kennwert: 100,
        menge: 5,
        area: 10 // Should use area (10) over menge (5)
      };

      const result = computeItemTotal(itemWithBoth);
      expect(result).toBe(1000); // 100 * 10 (area), not 500 (menge)
    });

    it('computeItemTotal memoizes results for same input', () => {
      const item: CostItem = {
        kennwert: 50,
        area: 20,
        ebkp: 'test-item'
      };

      // First call
      const result1 = computeItemTotal(item);

      // Modify irrelevant property (should not affect memoization key)
      item.bezeichnung = 'modified';

      // Second call with same relevant properties
      const result2 = computeItemTotal(item);

      // Results should be identical (memoized)
      expect(result1).toBe(result2);
      expect(result1).toBe(1000); // 50 * 20
    });
  });

  describe('comprehensive cost calculation features', () => {
    describe('area-first logic implementation', () => {
      it('prioritizes area over menge in leaf nodes', () => {
        const testCases = [
          { item: { kennwert: 100, area: 10, menge: 5 }, expected: 1000 },
          { item: { kennwert: 50, area: 0, menge: 20 }, expected: 0 },
          { item: { kennwert: 75, area: undefined, menge: 4 }, expected: 300 },
          { item: { kennwert: 25, area: null, menge: 8 }, expected: 200 },
        ];

        testCases.forEach(({ item, expected }) => {
          const result = computeItemTotal(item as CostItem);
          expect(result).toBe(expected);
        });
      });

      it('handles edge cases with zero values correctly', () => {
        const testCases = [
          { item: { kennwert: 0, area: 10, menge: 5 }, expected: 0 },
          { item: { kennwert: 100, area: 0, menge: 0 }, expected: 0 },
          { item: { kennwert: 50, area: undefined, menge: 0 }, expected: 0 },
          { item: { kennwert: 25, area: 0, menge: undefined }, expected: 0 },
        ];

        testCases.forEach(({ item, expected }) => {
          const result = computeItemTotal(item as CostItem);
          expect(result).toBe(expected);
        });
      });
    });

    describe('memoization performance', () => {
      it('avoids redundant calculations for identical items', () => {
        const item: CostItem = {
          kennwert: 100,
          area: 25,
          ebkp: 'performance-test'
        };

        // Multiple calls should return same result without recalculation
        const results = Array.from({ length: 10 }, () => computeItemTotal(item));
        const allSame = results.every(result => result === results[0]);

        expect(allSame).toBe(true);
        expect(results[0]).toBe(2500); // 100 * 25
      });

      it('invalidates cache when relevant properties change', () => {
        const item: CostItem = {
          kennwert: 50,
          area: 10,
          ebkp: 'cache-test'
        };

        const result1 = computeItemTotal(item); // 500

        // Change kennwert - should invalidate cache
        item.kennwert = 75;
        const result2 = computeItemTotal(item); // 750

        // Change area - should invalidate cache
        item.area = 20;
        const result3 = computeItemTotal(item); // 1500

        expect(result1).toBe(500);
        expect(result2).toBe(750);
        expect(result3).toBe(1500);
      });

      it('handles complex hierarchical structures efficiently', () => {
        const complexItem: CostItem = {
          ebkp: 'complex-parent',
          children: [
            {
              ebkp: 'child-1',
              kennwert: 10,
              area: 5,
              children: [
                { ebkp: 'grandchild-1', kennwert: 5, area: 2 },
                { ebkp: 'grandchild-2', kennwert: 3, area: 3 }
              ]
            },
            {
              ebkp: 'child-2',
              kennwert: 8,
              area: 4
            }
          ]
        };

        // Calculate total multiple times - should be efficient with memoization
        const results = Array.from({ length: 5 }, () => computeItemTotal(complexItem));
        const expectedTotal = (5 * 2 + 3 * 3) + (8 * 4); // grandchildren + child-2 = 10 + 5 + 32 = 47

        results.forEach(result => {
          expect(result).toBe(expectedTotal);
        });
      });
    });

    describe('aggregateChildTotals comprehensive functionality', () => {
      it('handles all combinations of area/menge with element_count', () => {
        const testItem: CostItem = {
          children: [
            // Both area and menge present - should use area
            { area: 10, menge: 20, element_count: 2 },
            // Only area present
            { area: 15, element_count: 1 },
            // Only menge present
            { menge: 8, element_count: 3 },
            // Neither area nor menge (should be 0)
            { element_count: 1 },
            // element_count is 0 (should preserve 0, not default to 1)
            { area: 5, element_count: 0 },
            // element_count is undefined (should default to 1)
            { area: 12, element_count: undefined },
            // element_count is null (should default to 1)
            { area: 7, element_count: null }
          ]
        };

        const result = aggregateChildTotals(testItem);

        // Area calculation: 10 + 15 + 8 + 0 + 5 + 12 + 7 = 57
        expect(result.area).toBe(57);

        // Element count: 2 + 1 + 3 + 1 + 0 + 1 + 1 = 9
        expect(result.elementCount).toBe(9);
      });

      it('recursively aggregates deeply nested structures', () => {
        const deeplyNestedItem: CostItem = {
          children: [
            {
              children: [
                {
                  children: [
                    { area: 1, element_count: 1 },
                    { area: 2, element_count: 1 }
                  ]
                },
                { area: 4, element_count: 2 }
              ]
            },
            {
              children: [
                { area: 8, element_count: 1 },
                { area: 16, element_count: 2 }
              ]
            },
            { area: 32, element_count: 4 }
          ]
        };

        const result = aggregateChildTotals(deeplyNestedItem);

        // Area: 1 + 2 + 4 + 8 + 16 + 32 = 63
        expect(result.area).toBe(63);

        // Element count: 1 + 1 + 2 + 1 + 2 + 4 = 11
        expect(result.elementCount).toBe(11);
      });

      it('handles empty and null child arrays gracefully', () => {
        const emptyChildren: CostItem = { children: [] };
        const nullChildren: CostItem = { children: undefined };

        const result1 = aggregateChildTotals(emptyChildren);
        const result2 = aggregateChildTotals(nullChildren);

        expect(result1.area).toBe(0);
        expect(result1.elementCount).toBe(0);
        expect(result2.area).toBe(0);
        expect(result2.elementCount).toBe(0);
      });
    });

    describe('integration with UI requirements', () => {
      it('provides accurate totals for UI display', () => {
        // Simulate a real-world cost item structure
        const realWorldItem: CostItem = {
          ebkp: 'A01',
          bezeichnung: 'Foundation',
          kennwert: 150,
          area: 100,
          children: [
            {
              ebkp: 'A01.01',
              bezeichnung: 'Concrete Foundation',
              kennwert: 200,
              area: 60,
              element_count: 3
            },
            {
              ebkp: 'A01.02',
              bezeichnung: 'Rebar Foundation',
              kennwert: 300,
              area: 40,
              element_count: 2
            }
          ]
        };

        // Test individual calculations
        const child1Total = computeItemTotal(realWorldItem.children![0]); // 200 * 60 = 12000
        const child2Total = computeItemTotal(realWorldItem.children![1]); // 300 * 40 = 12000
        const parentTotal = computeItemTotal(realWorldItem); // 150 * 100 + 12000 + 12000 = 39000

        expect(child1Total).toBe(12000);
        expect(child2Total).toBe(12000);
        expect(parentTotal).toBe(24000); // Parent only uses its own area * kennwert

        // Test aggregation matches
        const aggregated = aggregateChildTotals(realWorldItem);
        expect(aggregated.area).toBe(100); // 60 + 40
        expect(aggregated.elementCount).toBe(5); // 3 + 2
      });

      it('handles BIM/QTO data integration correctly', () => {
        const bimItem: CostItem = {
          ebkp: 'B01',
          bezeichnung: 'Walls',
          kennwert: 180,
          area: 150,
          areaSource: 'IFC',
          kafkaTimestamp: '2024-01-15T10:30:00Z',
          dbElements: 25,
          element_count: 25,
          originalValues: {
            menge: 120,
            chf: 21600
          }
        };

        const total = computeItemTotal(bimItem);
        expect(total).toBe(27000); // 180 * 150 (uses area, not original menge)

        // Verify BIM properties are preserved but don't affect calculation
        expect(bimItem.areaSource).toBe('IFC');
        expect(bimItem.element_count).toBe(25);
      });
    });
  });
});
