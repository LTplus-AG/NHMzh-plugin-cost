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
    backgroundColor: 'rgba(255, 152, 0, 0.06)', // More subtle orange background
    borderLeft: '4px solid rgba(255, 152, 0, 0.6)', // Clean left border
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 4, // Start after the left border
      right: 0,
      bottom: 0,
      background: 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255, 152, 0, 0.03) 8px, rgba(255, 152, 0, 0.03) 16px)',
      pointerEvents: 'none',
      zIndex: 0,
    },
    '&:hover': {
      backgroundColor: 'rgba(255, 152, 0, 0.10)',
      borderLeftColor: 'rgba(255, 152, 0, 0.8)',
    },
    '& > *': {
      position: 'relative',
      zIndex: 1, // Ensure content is above the pattern
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

// Check if an element/item has zero quantity across different quantity types
export const hasZeroQuantityInAnyType = (item: {
  quantity?: number | null;
  area?: number | null;
  length?: number | null;
  volume?: number | null;
  count?: number | null;
}): boolean => {
  const quantities = [
    item.quantity,
    item.area,
    item.length,
    item.volume,
    item.count,
  ];
  
  // If all quantities are null/undefined, consider it zero
  const hasAnyQuantity = quantities.some(q => q !== null && q !== undefined);
  if (!hasAnyQuantity) return true;
  
  // Check if all defined quantities are zero
  return quantities.every(q => q === null || q === undefined || isZeroQuantity(q));
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