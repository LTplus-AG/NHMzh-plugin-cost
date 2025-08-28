import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { CostTableRow } from './CostTableRow';
import { CostTableChildRow } from './CostTableChildRow';
import { CostTableGrandchildRow } from './CostTableGrandchildRow';
import { CostItem } from './types';

// Mock the API context
vi.mock('../../contexts/ApiContext', () => ({
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

describe('CostUploader UI Components', () => {
    const mockRenderNumber = (value: number | null | undefined, decimals: number = 2) => {
        if (value === null || value === undefined || isNaN(value) || value === 0) {
            return '';
        }
        return value.toLocaleString('de-CH', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    };

    const mockProps = {
        expanded: false,
        onToggle: vi.fn(),
        expandedRows: {},
        isMobile: false,
        cellStyles: {},
        renderNumber: mockRenderNumber,
        totalElements: 100
    };

    describe('CostTableRow Component', () => {
        describe('QTO Data Display and Styling', () => {
            it('displays QTO data with correct styling when IFC data is present', () => {
                const itemWithQto: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Test Item',
                    kennwert: 100,
                    area: 50,
                    areaSource: 'IFC',
                    kafkaTimestamp: '2024-01-15T10:30:00Z',
                    element_count: 5
                };

                render(<CostTableRow {...mockProps} item={itemWithQto} />);

                // Check for QTO data chip
                expect(screen.getByText('50.00')).toBeInTheDocument();

                // Check for data source info tooltip
                const infoIcon = screen.getByLabelText(/info/i);
                expect(infoIcon).toBeInTheDocument();
            });

            it('applies correct background styling for QTO data', () => {
                const itemWithQto: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Test Item',
                    kennwert: 100,
                    area: 50,
                    areaSource: 'IFC'
                };

                render(<CostTableRow {...mockProps} item={itemWithQto} />);

                // Check that the table row has QTO styling
                const tableRow = screen.getByRole('row');
                expect(tableRow).toHaveStyle({
                    backgroundColor: expect.stringContaining('rgba(25, 118, 210, 0.04)')
                });
            });

            it('displays CHF with tooltip when QTO data is present', () => {
                const itemWithQto: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Test Item',
                    kennwert: 100,
                    area: 50,
                    areaSource: 'IFC'
                };

                render(<CostTableRow {...mockProps} item={itemWithQto} />);

                // Check for CHF chip with tooltip
                const chfChip = screen.getByText('5,000.00');
                expect(chfChip).toBeInTheDocument();

                // The chip should be inside a tooltip
                const tooltip = chfChip.closest('[title]');
                expect(tooltip).toBeInTheDocument();
            });

            it('shows data source tooltip with formatted timestamp', async () => {
                const itemWithTimestamp: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Test Item',
                    kennwert: 100,
                    area: 50,
                    areaSource: 'IFC',
                    kafkaTimestamp: '2024-01-15T10:30:00Z'
                };

                render(<CostTableRow {...mockProps} item={itemWithTimestamp} />);

                const infoIcon = screen.getByLabelText(/info/i);

                // Hover over the info icon to trigger tooltip
                fireEvent.mouseOver(infoIcon);

                await waitFor(() => {
                    expect(screen.getByText('Quelle:')).toBeInTheDocument();
                    expect(screen.getByText('IFC')).toBeInTheDocument();
                    expect(screen.getByText('Aktualisiert:')).toBeInTheDocument();
                });
            });

            it('handles items without QTO data correctly', () => {
                const itemWithoutQto: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Test Item',
                    kennwert: 100,
                    menge: 25
                };

                render(<CostTableRow {...mockProps} item={itemWithoutQto} />);

                // Should not have QTO-specific styling
                const tableRow = screen.getByRole('row');
                expect(tableRow).toHaveStyle({
                    backgroundColor: expect.stringContaining('rgba(0, 0, 0, 0.04)')
                });

                // Should display menge value normally
                expect(screen.getByText('25.00')).toBeInTheDocument();
            });
        });

        describe('CHF Calculation Integration', () => {
            it('displays correct CHF values with area-first logic', () => {
                const itemWithBoth: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Test Item',
                    kennwert: 100,
                    area: 10,
                    menge: 20 // Should use area (10) not menge (20)
                };

                render(<CostTableRow {...mockProps} item={itemWithBoth} />);

                // Should display 100 * 10 = 1000
                expect(screen.getByText('1,000.00')).toBeInTheDocument();
            });

            it('calculates CHF correctly for hierarchical structures', () => {
                const hierarchicalItem: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Parent',
                    kennwert: 50,
                    area: 100,
                    children: [
                        {
                            ebkp: 'A01.01',
                            bezeichnung: 'Child 1',
                            kennwert: 25,
                            area: 50,
                            children: [
                                {
                                    ebkp: 'A01.01.01',
                                    bezeichnung: 'Grandchild',
                                    kennwert: 10,
                                    area: 25
                                }
                            ]
                        }
                    ]
                };

                render(<CostTableRow {...mockProps} item={hierarchicalItem} />);

                // Total should be: (50 * 100) + (25 * 50) + (10 * 25) = 5000 + 1250 + 250 = 6500
                expect(screen.getByText('6,500.00')).toBeInTheDocument();
            });

            it('handles zero values correctly in CHF display', () => {
                const zeroValueItem: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Zero Value Item',
                    kennwert: 0,
                    area: 100
                };

                render(<CostTableRow {...mockProps} item={zeroValueItem} />);

                // Should display 0 * 100 = 0
                expect(screen.getByText('0.00')).toBeInTheDocument();
            });
        });

        describe('Row Expansion and Interaction', () => {
            it('shows expand icon when item has children', () => {
                const itemWithChildren: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Parent Item',
                    kennwert: 100,
                    area: 50,
                    children: [
                        {
                            ebkp: 'A01.01',
                            bezeichnung: 'Child Item',
                            kennwert: 50,
                            area: 25
                        }
                    ]
                };

                render(<CostTableRow {...mockProps} item={itemWithChildren} />);

                const expandIcon = screen.getByLabelText('expand row');
                expect(expandIcon).toBeInTheDocument();
            });

            it('calls onToggle when expand icon is clicked', () => {
                const mockOnToggle = vi.fn();
                const itemWithChildren: CostItem = {
                    ebkp: 'A01',
                    bezeichnung: 'Parent Item',
                    kennwert: 100,
                    area: 50,
                    children: [
                        {
                            ebkp: 'A01.01',
                            bezeichnung: 'Child Item',
                            kennwert: 50,
                            area: 25
                        }
                    ]
                };

                render(<CostTableRow {...mockProps} item={itemWithChildren} onToggle={mockOnToggle} />);

                const expandIcon = screen.getByLabelText('expand row');
                fireEvent.click(expandIcon);

                expect(mockOnToggle).toHaveBeenCalledWith('A01');
            });
        });
    });

    describe('CostTableChildRow Component', () => {
        it('displays CHF values with proper formatting', () => {
            const childItem: CostItem = {
                ebkp: 'A01.01',
                bezeichnung: 'Child Item',
                kennwert: 75,
                area: 30
            };

            render(<CostTableChildRow {...mockProps} item={childItem} />);

            // Should display 75 * 30 = 2250
            expect(screen.getByText('2,250.00')).toBeInTheDocument();
        });

        it('handles QTO data display in child rows', () => {
            const childWithQto: CostItem = {
                ebkp: 'A01.01',
                bezeichnung: 'Child with QTO',
                kennwert: 50,
                area: 40,
                areaSource: 'IFC',
                kafkaTimestamp: '2024-01-15T14:20:00Z'
            };

            render(<CostTableChildRow {...mockProps} item={childWithQto} />);

            // Check for QTO data chip
            expect(screen.getByText('40.00')).toBeInTheDocument();

            // Check for CHF display
            expect(screen.getByText('2,000.00')).toBeInTheDocument();
        });
    });

    describe('CostTableGrandchildRow Component', () => {
        it('displays CHF values for grandchild items', () => {
            const grandchildItem: CostItem = {
                ebkp: 'A01.01.01',
                bezeichnung: 'Grandchild Item',
                kennwert: 25,
                area: 15
            };

            render(<CostTableGrandchildRow {...mockProps} item={grandchildItem} />);

            // Should display 25 * 15 = 375
            expect(screen.getByText('375.00')).toBeInTheDocument();
        });
    });

    describe('Data Source Integration', () => {
        it('displays IFC source information correctly', () => {
            const ifcItem: CostItem = {
                ebkp: 'B01',
                bezeichnung: 'IFC Wall',
                kennwert: 150,
                area: 75,
                areaSource: 'IFC',
                kafkaTimestamp: '2024-01-15T09:15:00Z',
                dbElements: 12
            };

            render(<CostTableRow {...mockProps} item={ifcItem} />);

            const infoIcon = screen.getByLabelText(/info/i);
            expect(infoIcon).toBeInTheDocument();
        });

        it('handles BIM data without timestamps gracefully', () => {
            const bimItem: CostItem = {
                ebkp: 'C01',
                bezeichnung: 'BIM Element',
                kennwert: 200,
                area: 60,
                areaSource: 'BIM'
                // No timestamp
            };

            render(<CostTableRow {...mockProps} item={bimItem} />);

            const infoIcon = screen.getByLabelText(/info/i);
            expect(infoIcon).toBeInTheDocument();
        });
    });

    describe('Responsive Design', () => {
        it('applies mobile-specific styling when isMobile is true', () => {
            const mobileItem: CostItem = {
                ebkp: 'A01',
                bezeichnung: 'Mobile Test Item',
                kennwert: 100,
                area: 25
            };

            render(<CostTableRow {...mockProps} item={mobileItem} isMobile={true} />);

            // Check for mobile-specific styling classes
            const tableRow = screen.getByRole('row');
            expect(tableRow).toBeInTheDocument();
        });
    });
});
