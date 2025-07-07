import { SxProps, Theme } from '@mui/material/styles';

// Check if a quantity value is zero or effectively zero
export const isZeroQuantity = (value: number | null | undefined): boolean => {
  if (value === null || value === undefined) return true;
  return Math.abs(value) < 0.001; // Consider values less than 0.001 as zero
};

// Get the styling for zero quantity highlighting
export const getZeroQuantityStyles = (
  hasZeroQuantity: boolean,
  baseStyles?: SxProps<Theme>
): SxProps<Theme> => {
  if (!hasZeroQuantity) return baseStyles || {};

  return {
    ...baseStyles,
    backgroundColor: 'rgba(255, 152, 0, 0.08)', // Subtle orange background
    borderLeft: '3px solid rgba(255, 152, 0, 0.4)', // Orange left border
    position: 'relative',
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'linear-gradient(45deg, transparent 48%, rgba(255, 152, 0, 0.1) 49%, rgba(255, 152, 0, 0.1) 51%, transparent 52%)',
      backgroundSize: '20px 20px',
      pointerEvents: 'none',
      opacity: 0.3,
    },
    '&:hover': {
      backgroundColor: 'rgba(255, 152, 0, 0.12)',
      '&::before': {
        opacity: 0.4,
      },
    },
    transition: 'all 0.2s ease-in-out',
  };
};

// Get the styling for zero quantity cells (for specific cells within a row)
export const getZeroQuantityCellStyles = (
  hasZeroQuantity: boolean,
  baseStyles?: SxProps<Theme>
): SxProps<Theme> => {
  if (!hasZeroQuantity) return baseStyles || {};

  return {
    ...baseStyles,
    backgroundColor: 'rgba(255, 152, 0, 0.12)',
    borderRadius: '4px',
    border: '1px solid rgba(255, 152, 0, 0.3)',
    position: 'relative',
    '&::after': {
      content: '"⚠"',
      position: 'absolute',
      top: '2px',
      right: '4px',
      fontSize: '10px',
      color: 'rgba(255, 152, 0, 0.8)',
      fontWeight: 'bold',
    },
  };
};

// Get tooltip text for zero quantity warning
export const getZeroQuantityTooltip = (elementType?: string): string => {
  const baseText = 'Keine Mengen vorhanden (0 m²)';
  if (elementType) {
    return `${baseText} - ${elementType}`;
  }
  return baseText;
};

// Check if a cost item has zero quantity
export const hasCostItemZeroQuantity = (item: {
  menge?: number | null;
  area?: number | null;
}): boolean => {
  const quantities = [item.menge, item.area];
  
  // If all quantities are null/undefined, consider it zero
  const hasAnyQuantity = quantities.some(q => q !== null && q !== undefined);
  if (!hasAnyQuantity) return true;
  
  // Check if all defined quantities are zero
  return quantities.every(q => q === null || q === undefined || isZeroQuantity(q));
}; 