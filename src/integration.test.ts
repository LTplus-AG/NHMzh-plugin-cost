import { vi } from 'vitest';
import { CostItem } from './components/CostUploader/types';
import { computeItemTotal, aggregateChildTotals } from './utils/costTotals';

// Mock the API context for integration tests
vi.mock('./contexts/ApiContext', () => ({
    useApi: () => ({
        replaceEbkpPlaceholders: (text: string) => text,
        formatTimestamp: (timestamp: string) => {
            try {
                return new Date(timestamp).toLocaleString('de-CH');
            } catch {
                return 'Invalid Date';
            }
        }
    })
}));

describe('Complete Cost Calculation Integration', () => {
    describe('End-to-End Cost Calculation Workflow', () => {
        it('processes a complete cost structure from Excel to final CHF totals', () => {
            // Simulate a complete cost structure as it would come from Excel + BIM integration
            const completeCostStructure: CostItem = {
                ebkp: 'A',
                bezeichnung: 'Building Structure',
                kennwert: 500,
                area: 1000,
                children: [
                    {
                        ebkp: 'A01',
                        bezeichnung: 'Foundation',
                        kennwert: 300,
                        area: 600,
                        children: [
                            {
                                ebkp: 'A01.01',
                                bezeichnung: 'Concrete Foundation',
                                kennwert: 200,
                                area: 400,
                                areaSource: 'IFC',
                                kafkaTimestamp: '2024-01-15T10:30:00Z',
                                element_count: 8,
                                dbElements: 8
                            },
                            {
                                ebkp: 'A01.02',
                                bezeichnung: 'Rebar Foundation',
                                kennwert: 400,
                                area: 200,
                                areaSource: 'BIM',
                                kafkaTimestamp: '2024-01-15T11:15:00Z',
                                element_count: 12,
                                dbElements: 12
                            }
                        ]
                    },
                    {
                        ebkp: 'A02',
                        bezeichnung: 'Structural Frame',
                        kennwert: 700,
                        area: 400,
                        children: [
                            {
                                ebkp: 'A02.01',
                                bezeichnung: 'Steel Columns',
                                kennwert: 800,
                                area: 200,
                                areaSource: 'IFC',
                                kafkaTimestamp: '2024-01-15T14:20:00Z',
                                element_count: 15,
                                dbElements: 15
                            },
                            {
                                ebkp: 'A02.02',
                                bezeichnung: 'Steel Beams',
                                kennwert: 600,
                                area: 200,
                                areaSource: 'Manual',
                                kafkaTimestamp: '2024-01-15T16:45:00Z',
                                element_count: 25,
                                dbElements: 25
                            }
                        ]
                    }
                ]
            };

            // Test individual leaf calculations
            const concreteFoundationTotal = computeItemTotal(completeCostStructure.children![0].children![0]);
            const rebarFoundationTotal = computeItemTotal(completeCostStructure.children![0].children![1]);
            const steelColumnsTotal = computeItemTotal(completeCostStructure.children![1].children![0]);
            const steelBeamsTotal = computeItemTotal(completeCostStructure.children![1].children![1]);

            // Verify leaf calculations use area-first logic
            expect(concreteFoundationTotal).toBe(80000); // 200 * 400
            expect(rebarFoundationTotal).toBe(80000);   // 400 * 200
            expect(steelColumnsTotal).toBe(160000);     // 800 * 200
            expect(steelBeamsTotal).toBe(120000);       // 600 * 200

            // Test aggregation at different levels
            const foundationAggregation = aggregateChildTotals(completeCostStructure.children![0]);
            const structuralFrameAggregation = aggregateChildTotals(completeCostStructure.children![1]);
            const buildingStructureAggregation = aggregateChildTotals(completeCostStructure);

            // Foundation should aggregate both children
            expect(foundationAggregation.area).toBe(600); // 400 + 200
            expect(foundationAggregation.elementCount).toBe(20); // 8 + 12

            // Structural Frame should aggregate both children
            expect(structuralFrameAggregation.area).toBe(400); // 200 + 200
            expect(structuralFrameAggregation.elementCount).toBe(40); // 15 + 25

            // Building Structure should aggregate all descendants
            expect(buildingStructureAggregation.area).toBe(1000); // 600 + 400
            expect(buildingStructureAggregation.elementCount).toBe(60); // 20 + 40

            // Test final CHF totals
            const foundationTotal = computeItemTotal(completeCostStructure.children![0]);
            const structuralFrameTotal = computeItemTotal(completeCostStructure.children![1]);
            const buildingStructureTotal = computeItemTotal(completeCostStructure);

            // Foundation total: 300 * 600 = 180000
            expect(foundationTotal).toBe(180000);

            // Structural Frame total: 700 * 400 = 280000
            expect(structuralFrameTotal).toBe(280000);

            // Building Structure total: 500 * 1000 + 180000 + 280000 = 960000
            expect(buildingStructureTotal).toBe(960000);
        });

        it('handles mixed data sources with proper priority', () => {
            const mixedDataItem: CostItem = {
                ebkp: 'M01',
                bezeichnung: 'Mixed Data Sources',
                kennwert: 250,
                area: 300,
                children: [
                    {
                        ebkp: 'M01.01',
                        bezeichnung: 'IFC Element',
                        kennwert: 200,
                        area: 150,
                        menge: 100, // Should be ignored due to area-first logic
                        areaSource: 'IFC',
                        kafkaTimestamp: '2024-01-15T10:30:00Z',
                        originalValues: {
                            menge: 100,
                            chf: 20000
                        }
                    },
                    {
                        ebkp: 'M01.02',
                        bezeichnung: 'Manual Element',
                        kennwert: 300,
                        area: 100,
                        menge: 80, // Should be ignored
                        areaSource: 'Manual',
                        kafkaTimestamp: '2024-01-15T11:15:00Z',
                        originalValues: {
                            menge: 80,
                            chf: 24000
                        }
                    },
                    {
                        ebkp: 'M01.03',
                        bezeichnung: 'Excel Only Element',
                        kennwert: 150,
                        menge: 50 // No BIM data, should use menge
                    }
                ]
            };

            // Test individual calculations
            const ifcTotal = computeItemTotal(mixedDataItem.children![0]); // 200 * 150 = 30000
            const manualTotal = computeItemTotal(mixedDataItem.children![1]); // 300 * 100 = 30000
            const excelTotal = computeItemTotal(mixedDataItem.children![2]); // 150 * 50 = 7500

            expect(ifcTotal).toBe(30000);
            expect(manualTotal).toBe(30000);
            expect(excelTotal).toBe(7500);

            // Test parent calculation
            const parentTotal = computeItemTotal(mixedDataItem); // 250 * 300 + 30000 + 30000 + 7500 = 131500

            expect(parentTotal).toBe(131500);

            // Verify original values are preserved
            expect(mixedDataItem.children![0].originalValues?.menge).toBe(100);
            expect(mixedDataItem.children![1].originalValues?.menge).toBe(80);
        });

        it('maintains data integrity through complex transformations', () => {
            const originalItem: CostItem = {
                ebkp: 'T01',
                bezeichnung: 'Test Item',
                kennwert: 100,
                area: 200,
                areaSource: 'IFC',
                kafkaTimestamp: '2024-01-15T12:00:00Z',
                dbElements: 10,
                element_count: 10,
                originalValues: {
                    menge: 150,
                    chf: 15000
                }
            };

            // Calculate total - should use area, not original menge
            const calculatedTotal = computeItemTotal(originalItem);
            expect(calculatedTotal).toBe(20000); // 100 * 200

            // Verify all BIM properties are preserved
            expect(originalItem.areaSource).toBe('IFC');
            expect(originalItem.kafkaTimestamp).toBe('2024-01-15T12:00:00Z');
            expect(originalItem.dbElements).toBe(10);
            expect(originalItem.element_count).toBe(10);

            // Verify original values are preserved
            expect(originalItem.originalValues?.menge).toBe(150);
            expect(originalItem.originalValues?.chf).toBe(15000);

            // Verify calculation doesn't modify original data
            expect(originalItem.area).toBe(200);
            expect(originalItem.kennwert).toBe(100);
        });
    });

    describe('Performance and Caching Integration', () => {
        it('memoization prevents redundant calculations in hierarchical structures', () => {
            const hierarchicalItem: CostItem = {
                ebkp: 'P01',
                bezeichnung: 'Performance Test Parent',
                kennwert: 100,
                area: 100,
                children: [
                    {
                        ebkp: 'P01.01',
                        bezeichnung: 'Performance Test Child 1',
                        kennwert: 50,
                        area: 50,
                        children: [
                            { ebkp: 'P01.01.01', bezeichnung: 'Leaf 1', kennwert: 25, area: 25 },
                            { ebkp: 'P01.01.02', bezeichnung: 'Leaf 2', kennwert: 30, area: 30 }
                        ]
                    },
                    {
                        ebkp: 'P01.02',
                        bezeichnung: 'Performance Test Child 2',
                        kennwert: 60,
                        area: 60,
                        children: [
                            { ebkp: 'P01.02.01', bezeichnung: 'Leaf 3', kennwert: 35, area: 35 },
                            { ebkp: 'P01.02.02', bezeichnung: 'Leaf 4', kennwert: 40, area: 40 }
                        ]
                    }
                ]
            };

            // Multiple calculations should return consistent results
            const results = Array.from({ length: 10 }, () => computeItemTotal(hierarchicalItem));
            const expectedTotal = 100 * 100 + (50 * 50 + 25 * 25 + 30 * 30) + (60 * 60 + 35 * 35 + 40 * 40);

            results.forEach(result => {
                expect(result).toBe(expectedTotal);
            });

            expect(expectedTotal).toBe(24250); // Calculated: 10000 + 6250 + 8550 = 24250
        });

        it('aggregateChildTotals provides consistent results for UI display', () => {
            const uiTestItem: CostItem = {
                ebkp: 'U01',
                bezeichnung: 'UI Test Item',
                kennwert: 200,
                area: 150,
                children: [
                    { ebkp: 'U01.01', bezeichnung: 'UI Child 1', kennwert: 100, area: 75, element_count: 5 },
                    { ebkp: 'U01.02', bezeichnung: 'UI Child 2', kennwert: 120, area: 50, element_count: 3 },
                    { ebkp: 'U01.03', bezeichnung: 'UI Child 3', kennwert: 80, area: 25, element_count: 7 }
                ]
            };

            const aggregated = aggregateChildTotals(uiTestItem);

            // Area should sum all children: 75 + 50 + 25 = 150
            expect(aggregated.area).toBe(150);

            // Element count should sum all children: 5 + 3 + 7 = 15
            expect(aggregated.elementCount).toBe(15);

            // Parent CHF calculation should use its own area: 200 * 150 = 30000
            const parentTotal = computeItemTotal(uiTestItem);
            expect(parentTotal).toBe(30000);

            // Child totals should use their individual areas
            const child1Total = computeItemTotal(uiTestItem.children![0]); // 100 * 75 = 7500
            const child2Total = computeItemTotal(uiTestItem.children![1]); // 120 * 50 = 6000
            const child3Total = computeItemTotal(uiTestItem.children![2]); // 80 * 25 = 2000

            expect(child1Total).toBe(7500);
            expect(child2Total).toBe(6000);
            expect(child3Total).toBe(2000);
        });
    });

    describe('Real-World Data Scenarios', () => {
        it('handles construction project cost breakdown correctly', () => {
            // Simulate a real construction project cost breakdown
            const constructionProject: CostItem = {
                ebkp: 'PROJECT',
                bezeichnung: 'Construction Project',
                kennwert: 1000,
                area: 5000,
                children: [
                    {
                        ebkp: 'A',
                        bezeichnung: 'Building Structure',
                        kennwert: 800,
                        area: 3000,
                        children: [
                            { ebkp: 'A01', bezeichnung: 'Foundation', kennwert: 600, area: 1500, areaSource: 'IFC' },
                            { ebkp: 'A02', bezeichnung: 'Frame', kennwert: 1000, area: 1500, areaSource: 'BIM' }
                        ]
                    },
                    {
                        ebkp: 'B',
                        bezeichnung: 'Building Envelope',
                        kennwert: 1200,
                        area: 2000,
                        children: [
                            { ebkp: 'B01', bezeichnung: 'Walls', kennwert: 900, area: 1200, areaSource: 'IFC' },
                            { ebkp: 'B02', bezeichnung: 'Roof', kennwert: 1500, area: 800, areaSource: 'Manual' }
                        ]
                    }
                ]
            };

            // Test hierarchical cost accumulation
            const structureTotal = computeItemTotal(constructionProject.children![0]); // 800 * 3000 = 2,400,000
            const envelopeTotal = computeItemTotal(constructionProject.children![1]); // 1200 * 2000 = 2,400,000
            const projectTotal = computeItemTotal(constructionProject); // 1000 * 5000 + 2,400,000 + 2,400,000 = 9,800,000

            expect(structureTotal).toBe(2400000);
            expect(envelopeTotal).toBe(2400000);
            expect(projectTotal).toBe(9800000);
        });

        it('maintains data consistency across updates', () => {
            const dynamicItem: CostItem = {
                ebkp: 'D01',
                bezeichnung: 'Dynamic Item',
                kennwert: 100,
                area: 50
            };

            // Initial calculation
            const initialTotal = computeItemTotal(dynamicItem);
            expect(initialTotal).toBe(5000); // 100 * 50

            // Simulate BIM data update
            dynamicItem.area = 75;
            dynamicItem.areaSource = 'IFC';
            dynamicItem.kafkaTimestamp = '2024-01-15T10:30:00Z';

            // Updated calculation should reflect new area
            const updatedTotal = computeItemTotal(dynamicItem);
            expect(updatedTotal).toBe(7500); // 100 * 75

            // Verify BIM metadata is preserved
            expect(dynamicItem.areaSource).toBe('IFC');
            expect(dynamicItem.kafkaTimestamp).toBe('2024-01-15T10:30:00Z');
        });
    });
});
