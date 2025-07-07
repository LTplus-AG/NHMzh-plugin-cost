import React from "react";
import {
  TableRow,
  TableCell,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  Box,
  Chip,
  IconButton,
  Collapse,
  Table,
  TableBody,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { CostEbkpGroup } from "../../types/cost.types";
import { MongoElement } from "../../types/common.types";

interface CostEbkpGroupRowProps {
  group: CostEbkpGroup;
  isExpanded: boolean;
  toggleExpand: (code: string) => void;
  kennwerte: Record<string, number>;
  onKennwertChange: (code: string, value: number) => void;
  onQuantityTypeChange?: (code: string, quantityType: string) => void;
  isSubGroup?: boolean;
}

const CostEbkpGroupRow: React.FC<CostEbkpGroupRowProps> = ({
  group,
  isExpanded,
  toggleExpand,
  kennwerte,
  onKennwertChange,
  onQuantityTypeChange,
  isSubGroup = false,
}) => {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('de-CH', {
      style: 'currency',
      currency: 'CHF',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatQuantity = (value: number) => {
    return new Intl.NumberFormat('de-CH', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleKennwertChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    onKennwertChange(group.code, isNaN(value) ? 0 : value);
  };

  const handleQuantityTypeChange = (e: any) => {
    if (onQuantityTypeChange) {
      onQuantityTypeChange(group.code, e.target.value);
    }
  };

  const getSelectedQuantity = () => {
    if (group.selectedQuantityType) {
      const selected = group.availableQuantities.find(q => q.type === group.selectedQuantityType);
      if (selected) {
        return { value: selected.value, unit: selected.unit };
      }
    }
    
    const defaultQty = group.availableQuantities[0];
    return defaultQty ? { value: defaultQty.value, unit: defaultQty.unit } : { value: 0, unit: '' };
  };

  const selectedQuantity = getSelectedQuantity();
  const kennwert = kennwerte[group.code] || 0;
  const totalCost = selectedQuantity.value * kennwert;

  return (
    <>
      {/* Main Group Row */}
      <TableRow 
        sx={{ 
          backgroundColor: isSubGroup ? "rgba(0, 0, 0, 0.02)" : "inherit",
          "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.04)" },
        }}
      >
        <TableCell sx={{ py: 1.5, pl: isSubGroup ? 3 : 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {group.elements.length > 0 && (
              <IconButton
                size="small"
                onClick={() => toggleExpand(group.code)}
                sx={{ p: 0.5 }}
              >
                {isExpanded ? (
                  <KeyboardArrowDownIcon fontSize="small" />
                ) : (
                  <KeyboardArrowRightIcon fontSize="small" />
                )}
              </IconButton>
            )}
            <Chip 
              label={group.code}
              color="primary"
              variant="outlined"
              size="small"
              sx={{ fontWeight: 'bold' }}
            />
            {group.elements.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {group.elements.length} Element{group.elements.length !== 1 ? 'e' : ''}
              </Typography>
            )}
          </Box>
        </TableCell>
        
        <TableCell sx={{ py: 1.5, textAlign: "right" }}>
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
            <Typography variant="body2" fontWeight="medium">
              {formatQuantity(selectedQuantity.value)} {selectedQuantity.unit}
            </Typography>
            
            {group.availableQuantities.length > 1 && (
              <FormControl size="small" sx={{ minWidth: 80 }}>
                <Select
                  value={group.selectedQuantityType || group.availableQuantities[0]?.type || ''}
                  onChange={handleQuantityTypeChange}
                  variant="outlined"
                  sx={{ fontSize: '0.75rem' }}
                >
                  {group.availableQuantities.map((qty) => (
                    <MenuItem key={qty.type} value={qty.type}>
                      {qty.type === 'area' ? 'Fläche' : 
                       qty.type === 'length' ? 'Länge' : 
                       qty.type === 'volume' ? 'Volumen' : 
                       qty.type === 'count' ? 'Stück' : qty.type}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </TableCell>
        
        <TableCell sx={{ py: 1.5, textAlign: "right" }}>
          <TextField
            type="number"
            value={kennwert}
            onChange={handleKennwertChange}
            variant="outlined"
            size="small"
            sx={{ width: 120 }}
            InputProps={{
              endAdornment: <Typography variant="caption" color="text.secondary">CHF</Typography>,
            }}
          />
        </TableCell>
        
        <TableCell sx={{ py: 1.5, textAlign: "right" }}>
          <Typography variant="subtitle2" fontWeight="bold">
            {formatCurrency(totalCost)}
          </Typography>
        </TableCell>
      </TableRow>

      {/* Collapsible Elements */}
      {group.elements.length > 0 && (
        <TableRow>
          <TableCell 
            colSpan={4} 
            sx={{ 
              py: 0, 
              border: "none",
              backgroundColor: "rgba(0, 0, 0, 0.01)" 
            }}
          >
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ py: 1, pl: 4 }}>
                <Table size="small">
                  <TableBody>
                    {group.elements.slice(0, 5).map((element: MongoElement) => (
                      <TableRow key={element._id}>
                        <TableCell sx={{ py: 0.5, border: "none" }}>
                          <Typography variant="caption" color="text.secondary">
                            {element.type_name || element.ifc_class || 'Unknown'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 0.5, border: "none", textAlign: "right" }}>
                          <Typography variant="caption" color="text.secondary">
                            {element.level || 'Unknown Level'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                      </TableRow>
                    ))}
                    {group.elements.length > 5 && (
                      <TableRow>
                        <TableCell sx={{ py: 0.5, border: "none" }}>
                          <Typography variant="caption" color="text.secondary">
                            ... und {group.elements.length - 5} weitere
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

export default CostEbkpGroupRow; 