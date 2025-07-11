import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import {
  Box,
  Collapse,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import React from "react";
import { HierarchicalCostEbkpGroup } from "../../types/cost.types";
import { getZeroQuantityStyles, isZeroQuantity } from "../../utils/zeroQuantityHighlight";
import { getElementQuantityValue } from "../../utils/quantityUtils";
import CostEbkpGroupRow from "./CostEbkpGroupRow";

interface MainCostEbkpGroupRowProps {
  group: HierarchicalCostEbkpGroup;
  isExpanded: boolean;
  toggleExpand: (mainGroup: string) => void;
  expandedEbkp: string[];
  toggleExpandEbkp: (code: string) => void;
  kennwerte: Record<string, number>;
  onKennwertChange: (code: string, value: number) => void;
  onQuantityTypeChange?: (code: string, quantityType: string) => void;
}

const MainCostEbkpGroupRow: React.FC<MainCostEbkpGroupRowProps> = ({
  group,
  isExpanded,
  toggleExpand,
  expandedEbkp,
  toggleExpandEbkp,
  kennwerte,
  onKennwertChange,
  onQuantityTypeChange,
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

  // Check if ANY subgroup has elements with zero quantities for their selected quantity type
  const hasZeroQuantity = group.subGroups.some(subGroup => {
    const selectedQuantityType = subGroup.selectedQuantityType || subGroup.availableQuantities[0]?.type;
    return subGroup.elements.some(element => {
      const quantityValue = getElementQuantityValue(element, selectedQuantityType);
      return isZeroQuantity(quantityValue);
    });
  });

  // Count total elements with missing quantities across all subgroups
  const totalElementsWithMissingQuantities = group.subGroups.reduce((total, subGroup) => {
    const selectedQuantityType = subGroup.selectedQuantityType || subGroup.availableQuantities[0]?.type;
    // Count elements in this subgroup that have zero quantities for the selected type
    const elementsWithZeroQuantity = subGroup.elements.filter(element => {
      const quantityValue = getElementQuantityValue(element, selectedQuantityType);
      return isZeroQuantity(quantityValue);
    });
    return total + elementsWithZeroQuantity.length;
  }, 0);

  return (
    <>
      {/* Main Group Header Row */}
      <Tooltip 
        title={hasZeroQuantity ? `Enthält Elemente ohne Mengen - Hauptgruppe ${group.mainGroup}` : ''}
        arrow
        placement="left"
      >
        <TableRow 
          sx={getZeroQuantityStyles(hasZeroQuantity, { 
            backgroundColor: isExpanded ? 'rgba(25, 118, 210, 0.08)' : 'rgba(0, 0, 0, 0.04)',
            "&:hover": { 
              backgroundColor: isExpanded ? 'rgba(25, 118, 210, 0.12)' : 'rgba(0, 0, 0, 0.08)'
            },
            cursor: 'pointer',
          })}
          onClick={() => toggleExpand(group.mainGroup)}
        >
          <TableCell sx={{ py: 2, pl: hasZeroQuantity ? 1.5 : 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(group.mainGroup);
                }}
                sx={{
                  mr: 1,
                  p: 0.5,
                  transition: "transform 0.2s ease",
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                <KeyboardArrowRightIcon fontSize="small" />
              </IconButton>
              <Typography variant="subtitle1" fontWeight="bold" color="primary">
                {group.mainGroup === "_OTHER_" ? "" : group.mainGroup}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {group.mainGroup === "_OTHER_" ? "Sonstige Klassifikationen" : group.mainGroupName}
              </Typography>
              <Box sx={{ ml: 1, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="body2" sx={{ 
                  color: "text.secondary",
                  fontSize: "0.8rem",
                  fontWeight: 500
                }}>
                  {group.subGroups.length} Gruppen • {group.totalElements} Elemente
                </Typography>
                {totalElementsWithMissingQuantities > 0 && (
                  <Typography variant="caption" sx={{ 
                    color: 'warning.main', 
                    fontWeight: 'bold',
                    fontSize: '0.65rem'
                  }}>
                    {totalElementsWithMissingQuantities} ohne Mengen
                  </Typography>
                )}
              </Box>
            </Box>
          </TableCell>
          <TableCell sx={{ py: 2, textAlign: "right" }}>
            <Typography variant="body2" sx={{ 
              fontWeight: hasZeroQuantity ? 'bold' : 'medium',
              color: hasZeroQuantity ? 'warning.main' : 'inherit'
            }}>
              {formatQuantity(group.totalQuantity)} m²
            </Typography>
          </TableCell>
          <TableCell sx={{ py: 2, textAlign: "right" }}>
            <Typography variant="body2" color="text.secondary">
              -
            </Typography>
          </TableCell>
          <TableCell sx={{ py: 2, textAlign: "right" }}>
            <Typography variant="subtitle2" fontWeight="bold">
              {formatCurrency(group.totalCost)}
            </Typography>
          </TableCell>
        </TableRow>
      </Tooltip>

      {/* Collapsible Sub-Groups */}
      <TableRow>
        <TableCell 
          colSpan={4} 
          sx={{ 
            py: 0, 
            border: "none",
            backgroundColor: "transparent" 
          }}
        >
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            <Box sx={{ py: 1 }}>
              <Table size="small">
                <TableBody>
                  {group.subGroups.map((subGroup) => (
                    <CostEbkpGroupRow
                      key={subGroup.code}
                      group={subGroup}
                      isExpanded={expandedEbkp.includes(subGroup.code)}
                      toggleExpand={toggleExpandEbkp}
                      kennwerte={kennwerte}
                      onKennwertChange={onKennwertChange}
                      onQuantityTypeChange={onQuantityTypeChange}
                      isSubGroup={true}
                    />
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

export default MainCostEbkpGroupRow; 