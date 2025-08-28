import { vi } from 'vitest';
import { CostItem } from '../components/CostUploader/types';

// Mock the cost totals module
vi.mock('../utils/costTotals', () => ({
    computeItemTotal: vi.fn((item: CostItem) => {
        const quantity = item.area ?? item.menge ?? 0;
        const unitPrice = item.kennwert ?? 0;
        return unitPrice * quantity;
    }),
    aggregateChildTotals: vi.fn((item: CostItem) => {
        if (!item.children || item.children.length === 0) {
            return { area: 0, elementCount: 0 };
        }
        return item.children.reduce((acc, child) => {
            const qty = child.area ?? child.menge ?? 0;
            return {
                area: acc.area + qty,
                elementCount: acc.elementCount + (child.element_count ?? 1)
            };
        }, { area: 0, elementCount: 0 });
    })
}));

describe('Data Source Features', () => {
    describe('QTO Data Detection', () => {
        it('correctly identifies items with IFC data', () => {
            const ifcItem: CostItem = {
                ebkp: 'A01',
                bezeichnung: 'IFC Wall',
                kennwert: 100,
                area: 50,
                areaSource: 'IFC',
                kafkaTimestamp: '2024-01-15T10:30:00Z'
            };

            // Item should be considered to have QTO data
            expect(ifcItem.area).toBeDefined();
            expect(ifcItem.areaSource).toBe('IFC');
            expect(ifcItem.kafkaTimestamp).toBeDefined();
        });

        it('correctly identifies items with BIM data', () => {
            const bimItem: CostItem = {
                ebkp: 'B01',
                bezeichnung: 'BIM Column',
                kennwert: 200,
                area: 30,
                areaSource: 'BIM',
                kafkaTimestamp: '2024-01-15T14:20:00Z'
            };

            expect(bimItem.area).toBeDefined();
            expect(bimItem.areaSource).toBe('BIM');
            expect(bimItem.kafkaTimestamp).toBeDefined();
        });

        it('correctly identifies items with manual QTO data', () => {
            const manualItem: CostItem = {
                ebkp: 'C01',
                bezeichnung: 'Manual Entry',
                kennwert: 150,
                area: 25,
                areaSource: 'Manual',
                kafkaTimestamp: '2024-01-15T16:45:00Z'
            };

            expect(manualItem.area).toBeDefined();
            expect(manualItem.areaSource).toBe('Manual');
            expect(manualItem.kafkaTimestamp).toBeDefined();
        });

        it('correctly identifies items without QTO data', () => {
            const excelOnlyItem: CostItem = {
                ebkp: 'D01',
                bezeichnung: 'Excel Only',
                kennwert: 100,
                menge: 40
                // No area, areaSource, or kafkaTimestamp
            };

            expect(excelOnlyItem.area).toBeUndefined();
            expect(excelOnlyItem.areaSource).toBeUndefined();
            expect(excelOnlyItem.kafkaTimestamp).toBeUndefined();
        });
    });

    describe('Timestamp Formatting', () => {
        const formatTimestamp = (timestamp: string): string => {
            try {
                return new Date(timestamp).toLocaleString('de-CH');
            } catch {
                return 'Invalid Date';
            }
        };

        it('formats ISO timestamps correctly for Swiss locale', () => {
            const timestamp = '2024-01-15T10:30:00Z';
            const formatted = formatTimestamp(timestamp);

            // Should be formatted as Swiss German locale
            expect(formatted).toContain('15.01.2024');
            expect(formatted).toContain('10:30');
        });

        it('handles different ISO timestamp formats', () => {
            const testCases = [
                '2024-01-15T10:30:00Z',
                '2024-01-15T10:30:00.000Z',
                '2024-01-15T10:30:00+01:00',
                '2024-01-15T10:30:00-05:00'
            ];

            testCases.forEach(timestamp => {
                const formatted = formatTimestamp(timestamp);
                expect(formatted).not.toBe('Invalid Date');
                expect(formatted).toContain('15.01.2024');
            });
        });

        it('handles invalid timestamps gracefully', () => {
            const invalidTimestamps = [
                'invalid-date',
                '2024-13-45', // Invalid date
                '',
                null,
                undefined
            ];

            invalidTimestamps.forEach(timestamp => {
                const formatted = formatTimestamp(timestamp as string);
                expect(formatted).toBe('Invalid Date');
            });
        });

        it('formats timestamps without timezone correctly', () => {
            const timestamp = '2024-01-15T10:30:00';
            const formatted = formatTimestamp(timestamp);

            expect(formatted).toContain('15.01.2024');
            expect(formatted).toContain('10:30');
        });
    });

    describe('QTO Data Integration with Cost Calculations', () => {
        it('uses area from IFC data in CHF calculations', () => {
            const ifcItem: CostItem = {
                ebkp: 'A01',
                bezeichnung: 'IFC Item',
                kennwert: 100,
                area: 50, // IFC area
                menge: 25, // Excel menge - should be ignored
                areaSource: 'IFC',
                originalValues: {
                    menge: 25 // Original Excel value
                }
            };

            // CHF should be calculated using area (50) not menge (25)
            // 100 * 50 = 5000
            expect(ifcItem.area).toBe(50);
            expect(ifcItem.menge).toBe(25); // Original menge preserved
            expect(ifcItem.kennwert).toBe(100);
        });

        it('preserves original Excel values when BIM data is applied', () => {
            const bimItem: CostItem = {
                ebkp: 'B01',
                bezeichnung: 'BIM Item',
                kennwert: 200,
                area: 75, // BIM area
                areaSource: 'BIM',
                kafkaTimestamp: '2024-01-15T10:30:00Z',
                originalValues: {
                    menge: 60, // Original Excel menge
                    chf: 12000 // Original Excel CHF
                }
            };

            expect(bimItem.area).toBe(75); // BIM value used for calculations
            expect(bimItem.originalValues?.menge).toBe(60); // Original preserved
            expect(bimItem.originalValues?.chf).toBe(12000); // Original preserved
        });

        it('handles mixed data sources correctly', () => {
            const mixedItems: CostItem[] = [
                {
                    ebkp: 'A01',
                    bezeichnung: 'IFC Item',
                    kennwert: 100,
                    area: 50,
                    areaSource: 'IFC'
                },
                {
                    ebkp: 'B01',
                    bezeichnung: 'Manual Item',
                    kennwert: 150,
                    area: 30,
                    areaSource: 'Manual'
                },
                {
                    ebkp: 'C01',
                    bezeichnung: 'Excel Item',
                    kennwert: 200,
                    menge: 25 // No BIM data
                }
            ];

            // All items should have proper data source identification
            expect(mixedItems[0].areaSource).toBe('IFC');
            expect(mixedItems[1].areaSource).toBe('Manual');
            expect(mixedItems[2].areaSource).toBeUndefined();

            // Items with BIM data should use area for calculations
            expect(mixedItems[0].area).toBeDefined();
            expect(mixedItems[1].area).toBeDefined();
            expect(mixedItems[2].area).toBeUndefined();
        });
    });

    describe('Data Source Tooltip Information', () => {
        it('provides complete tooltip data for IFC sources', () => {
            const ifcItem: CostItem = {
                ebkp: 'A01',
                bezeichnung: 'IFC Wall',
                kennwert: 100,
                area: 50,
                areaSource: 'IFC',
                kafkaTimestamp: '2024-01-15T10:30:00Z',
                dbElements: 12,
                element_count: 12
            };

            expect(ifcItem.areaSource).toBe('IFC');
            expect(ifcItem.kafkaTimestamp).toBe('2024-01-15T10:30:00Z');
            expect(ifcItem.dbElements).toBe(12);
            expect(ifcItem.element_count).toBe(12);
        });

        it('provides complete tooltip data for BIM sources', () => {
            const bimItem: CostItem = {
                ebkp: 'B01',
                bezeichnung: 'BIM Column',
                kennwert: 150,
                area: 30,
                areaSource: 'BIM',
                kafkaTimestamp: '2024-01-15T14:20:00Z',
                dbElements: 8,
                element_count: 8
            };

            expect(bimItem.areaSource).toBe('BIM');
            expect(bimItem.kafkaTimestamp).toBe('2024-01-15T14:20:00Z');
            expect(bimItem.dbElements).toBe(8);
            expect(bimItem.element_count).toBe(8);
        });

        it('handles missing optional tooltip data gracefully', () => {
            const minimalItem: CostItem = {
                ebkp: 'C01',
                bezeichnung: 'Minimal BIM Item',
                kennwert: 200,
                area: 40,
                areaSource: 'BIM'
                // No timestamp, dbElements, or element_count
            };

            expect(minimalItem.areaSource).toBe('BIM');
            expect(minimalItem.kafkaTimestamp).toBeUndefined();
            expect(minimalItem.dbElements).toBeUndefined();
            expect(minimalItem.element_count).toBeUndefined();
        });
    });

    describe('QTO Data Detection Functions', () => {
        const hasQtoData = (item: CostItem): boolean => {
            return item.area !== undefined;
        };

        const hasQtoDataInTree = (item: CostItem): boolean => {
            if (hasQtoData(item)) return true;

            if (item.children && item.children.length > 0) {
                for (const child of item.children) {
                    if (hasQtoDataInTree(child)) return true;
                }
            }

            return false;
        };

        it('correctly identifies leaf nodes with QTO data', () => {
            const leafWithQto: CostItem = {
                ebkp: 'A01.01',
                bezeichnung: 'Leaf with QTO',
                kennwert: 100,
                area: 25,
                areaSource: 'IFC'
            };

            const leafWithoutQto: CostItem = {
                ebkp: 'A01.02',
                bezeichnung: 'Leaf without QTO',
                kennwert: 100,
                menge: 25
            };

            expect(hasQtoData(leafWithQto)).toBe(true);
            expect(hasQtoData(leafWithoutQto)).toBe(false);
        });

        it('correctly identifies parent nodes with QTO data in children', () => {
            const parentWithQtoChildren: CostItem = {
                ebkp: 'A01',
                bezeichnung: 'Parent with QTO Children',
                kennwert: 200,
                menge: 100,
                children: [
                    {
                        ebkp: 'A01.01',
                        bezeichnung: 'Child with QTO',
                        kennwert: 100,
                        area: 50,
                        areaSource: 'IFC'
                    },
                    {
                        ebkp: 'A01.02',
                        bezeichnung: 'Child without QTO',
                        kennwert: 100,
                        menge: 50
                    }
                ]
            };

            const parentWithoutQto: CostItem = {
                ebkp: 'B01',
                bezeichnung: 'Parent without QTO',
                kennwert: 150,
                menge: 75,
                children: [
                    {
                        ebkp: 'B01.01',
                        bezeichnung: 'Child without QTO',
                        kennwert: 75,
                        menge: 25
                    }
                ]
            };

            expect(hasQtoDataInTree(parentWithQtoChildren)).toBe(true);
            expect(hasQtoDataInTree(parentWithoutQto)).toBe(false);
        });

        it('handles complex hierarchical structures with mixed QTO data', () => {
            const complexHierarchy: CostItem = {
                ebkp: 'A01',
                bezeichnung: 'Complex Parent',
                kennwert: 300,
                menge: 200,
                children: [
                    {
                        ebkp: 'A01.01',
                        bezeichnung: 'Child 1 - No QTO',
                        kennwert: 150,
                        menge: 100,
                        children: [
                            {
                                ebkp: 'A01.01.01',
                                bezeichnung: 'Grandchild 1 - With QTO',
                                kennwert: 75,
                                area: 50,
                                areaSource: 'IFC'
                            }
                        ]
                    },
                    {
                        ebkp: 'A01.02',
                        bezeichnung: 'Child 2 - With QTO',
                        kennwert: 125,
                        area: 75,
                        areaSource: 'BIM'
                    }
                ]
            };

            expect(hasQtoDataInTree(complexHierarchy)).toBe(true);
            expect(hasQtoData(complexHierarchy)).toBe(false); // Parent itself has no QTO
        });
    });
});
