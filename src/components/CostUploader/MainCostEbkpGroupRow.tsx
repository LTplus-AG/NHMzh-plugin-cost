import React from "react";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  IconButton,
  Typography,
  Collapse,
  Box,
} from "@mui/material";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { HierarchicalCostEbkpGroup } from "../../types/cost.types";
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

  return (
    <>
      {/* Main Group Header Row */}
      <TableRow 
        sx={{ 
          backgroundColor: "rgba(0, 0, 0, 0.04)",
          "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.08)" }
        }}
      >
        <TableCell sx={{ py: 2, pl: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <IconButton
              size="small"
              onClick={() => toggleExpand(group.mainGroup)}
              sx={{
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
            <Typography variant="body2" sx={{ 
              color: "text.secondary",
              fontSize: "0.8rem",
              fontWeight: 500,
              ml: 1
            }}>
              {group.subGroups.length} Gruppen • {group.totalElements} Elemente
            </Typography>
          </Box>
        </TableCell>
        <TableCell sx={{ py: 2, textAlign: "right" }}>
          <Typography variant="body2" color="text.secondary">
            {formatQuantity(group.totalQuantity)}
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