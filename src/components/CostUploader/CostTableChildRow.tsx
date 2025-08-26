import React, { useState, useEffect } from "react";
import {
  TableRow,
  TableCell,
  IconButton,
  Collapse,
  Box,
  Table,
  TableBody,
  Tooltip,
  Chip,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { CostItem } from "./types";
import { getColumnStyle, columnWidths } from "./styles";
import { tableStyle } from "./styles";
import CostTableGrandchildRow from "./CostTableGrandchildRow.tsx";
import { useApi } from "../../contexts/ApiContext";
import { computeRowTotal } from "../../utils/costCalculations";

// Define a proper type for cellStyles instead of using any
interface CellStyles {
  childRow?: React.CSSProperties;
  grandchildRow?: React.CSSProperties;
  menge?: React.CSSProperties;
  standardBorder?: React.CSSProperties;
  kennwert?: React.CSSProperties;
  chf?: React.CSSProperties;
  totalChf?: React.CSSProperties;
  [key: string]: React.CSSProperties | undefined;
}

// Added interface for reducer accumulator
interface ChildTotals {
  area: number;
  cost: number;
  chf: number;
  elementCount: number;
}

interface CostTableChildRowProps {
  item: CostItem;
  expanded: boolean;
  onToggle: (code: string) => void;
  expandedRows: Record<string, boolean>;
  isMobile: boolean;
  cellStyles: CellStyles;
  renderNumber: (
    value: number | null | undefined,
    decimals?: number
  ) => React.ReactElement | string;
  totalElements: number;
}

const CostTableChildRow = ({
  item,
  expanded,
  onToggle,
  isMobile,
  cellStyles,
  renderNumber,
  totalElements,
}: Omit<CostTableChildRowProps, "expandedRows">) => {
  // Add state to track if QTO data is available
  const [hasQtoState, setHasQtoState] = useState<boolean>(false);
  const [hasQtoInTreeState, setHasQtoInTreeState] = useState<boolean>(false);

  // Get the Kafka context
  const { replaceEbkpPlaceholders, formatTimestamp } = useApi();

  // Update the hasQtoData function to check for IFC data
  const hasQtoData = (item: CostItem): boolean => {
    // Direct check for this item
    if (item.area !== undefined) return true;

    // Check if any children have QTO data
    if (item.children && item.children.length > 0) {
      return item.children.some((child) => child.area !== undefined);
    }

    return false;
  };

  // Update the hasQtoDataInTree function to check for IFC data
  const hasQtoDataInTree = (item: CostItem): boolean => {
    // Check if this item has QTO data
    if (hasQtoData(item)) return true;

    // Check children recursively
    if (item.children && item.children.length > 0) {
      for (const child of item.children) {
        if (child.area !== undefined) return true;
      }
    }

    return false;
  };

  // Use effect to update QTO state whenever item or its children change
  useEffect(() => {
    // Check QTO data status
    const qtoData = hasQtoData(item);
    const qtoInTree = hasQtoDataInTree(item);

    // Update state if changed
    if (qtoData !== hasQtoState) {
      setHasQtoState(qtoData);
    }

    if (qtoInTree !== hasQtoInTreeState) {
      setHasQtoInTreeState(qtoInTree);
    }
  }, [item, hasQtoState, hasQtoInTreeState]);

  // Use state values for rendering
  const hasQtoInTree = hasQtoInTreeState;

  // Process text fields to replace any eBKP placeholders
  const processField = (text: string | null | undefined): string => {
    if (text === null || text === undefined) return "";
    return replaceEbkpPlaceholders(String(text));
  };

  // Get unit from MongoDB data (if available)
  const getQuantityUnit = () => {
    // If the item has explicit quantity type/unit metadata from MongoDB
    if (item.quantityUnit) {
      return item.quantityUnit;
    }

    // Check if any children have quantity unit info
    if (item.children && item.children.length > 0) {
      const unitChild = item.children.find((child) => child.quantityUnit);
      if (unitChild && unitChild.quantityUnit) {
        return unitChild.quantityUnit;
      }
    }

    // Default to square meters
    return "m²";
  };

  // Update the calculateTotalsFromChildren function to handle grandchild sums
  const calculateTotalsFromChildren = (item: CostItem): ChildTotals => {
    if (!item.children || item.children.length === 0) {
      return { area: 0, cost: 0, chf: 0, elementCount: 0 };
    }

    return item.children.reduce<ChildTotals>(
      (acc, child) => {
        if (child.area !== undefined) {
          acc.area += child.area;
          const rowTotal = computeRowTotal({
            quantity: child.area,
            unitPrice: child.kennwert,
            factor: child.factor,
          });
          acc.cost += rowTotal;
          acc.chf += rowTotal;
          if (!child.children || child.children.length === 0) {
            acc.elementCount += child.element_count || 1;
          }
        }
        if (child.children && child.children.length > 0) {
          const childTotals = calculateTotalsFromChildren(child);
          acc.area += childTotals.area;
          acc.cost += childTotals.cost;
          acc.chf += childTotals.chf;
          acc.elementCount += childTotals.elementCount;
        }
        if (child.area === undefined && child.menge !== undefined) {
          acc.area += child.menge || 0;
          const rowTotal = computeRowTotal({
            quantity: child.menge || 0,
            unitPrice: child.kennwert,
            factor: child.factor,
          });
          acc.cost += rowTotal;
          acc.chf += rowTotal;
          if (!child.children || child.children.length === 0) {
            acc.elementCount += 1;
          }
        }
        return acc;
      },
      { area: 0, cost: 0, chf: 0, elementCount: 0 }
    );
  };

  // Update the getMengeValue function to use grandchild sums
  const getMengeValue = (originalMenge: number | null | undefined) => {
    // Calculate total area from grandchildren
    const { area } = calculateTotalsFromChildren(item);

    // If we have a total area from grandchildren, use it
    if (area > 0) {
      return area;
    }

    // Otherwise use original value from Excel
    return originalMenge;
  };

  // Update the getChfValue function to use grandchild sums
  const getChfValue = () => {
    // Calculate total cost from grandchildren
    const { chf } = calculateTotalsFromChildren(item);

    if (chf > 0) {
      return chf;
    }

    const quantity = item.area !== undefined ? item.area : item.menge;
    return computeRowTotal({
      quantity,
      unitPrice: item.kennwert,
      factor: item.factor,
    });
  };

  // Get info about QTO data for this item
  const getQtoInfo = () => {
    // If the item has area from MongoDB
    if (item.area !== undefined) {
      return {
        value: item.area,
        unit: item.quantityUnit || "m²",
        type: item.quantityType || "area",
        timestamp: item.kafkaTimestamp || new Date().toISOString(),
        source: item.areaSource || "BIM",
      };
    }

    return null;
  };

  // Create a component for QTO source info icon with tooltip
  const DataSourceInfo = () => {
    const qtoInfo = getQtoInfo();

    if (!qtoInfo) return null;

    const formattedTime = qtoInfo.timestamp
      ? formatTimestamp(qtoInfo.timestamp)
      : "Kein Zeitstempel";

    return (
      <Tooltip
        title={
          <React.Fragment>
            <div>
              <strong>Quelle:</strong> {qtoInfo.source}
            </div>
            <div>
              <strong>Typ:</strong> {qtoInfo.type}
            </div>
            <div>
              <strong>Aktualisiert:</strong> {formattedTime}
            </div>
          </React.Fragment>
        }
        arrow
      >
        <Box
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            ml: 0.5,
            cursor: "help",
            color: qtoInfo.source === "IFC" ? "info.main" : "primary.main",
          }}
        >
          <InfoOutlinedIcon fontSize="small" sx={{ fontSize: "0.875rem" }} />
        </Box>
      </Tooltip>
    );
  };

  return (
    <React.Fragment>
      <TableRow
        hover
        sx={{
          ...cellStyles.childRow,
          backgroundColor: hasQtoData(item)
            ? "rgba(25, 118, 210, 0.03)"
            : hasQtoInTree
            ? "rgba(25, 118, 210, 0.015)"
            : undefined,
          borderLeft: hasQtoData(item)
            ? "2px solid rgba(25, 118, 210, 0.4)"
            : hasQtoInTree
            ? "2px solid rgba(25, 118, 210, 0.2)"
            : "none",
        }}
      >
        <TableCell sx={{ padding: isMobile ? "8px 4px" : undefined }}>
          {item.children && item.children.length > 0 && (
            <Tooltip
              title={
                hasQtoInTree && !expanded
                  ? "BIM Daten in untergeordneten Positionen"
                  : ""
              }
              arrow
              placement="right"
            >
              <IconButton
                aria-label="expand row"
                size="small"
                onClick={() => onToggle(item.ebkp || "")}
                sx={
                  hasQtoInTree && !hasQtoData(item)
                    ? {
                        color: !expanded ? "info.main" : undefined,
                        opacity: !expanded ? 0.8 : 0.6,
                        border: !expanded
                          ? "1px solid rgba(25, 118, 210, 0.2)"
                          : "none",
                      }
                    : {}
                }
              >
                {expanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
        <TableCell
          component="th"
          scope="row"
          sx={{
            ...getColumnStyle("ebkp"),
            padding: isMobile ? "8px 4px" : undefined,
          }}
        >
          {processField(item.ebkp)}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("bezeichnung"),
            padding: isMobile ? "8px 4px" : undefined,
          }}
        >
          {processField(item.bezeichnung)}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("menge"),
            ...cellStyles.menge,
            position: "relative",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              "& > *:first-of-type": {
                mr: 0.5,
              },
            }}
          >
            {hasQtoData(item) || hasQtoInTree ? (
              <Tooltip title="Summe der untergeordneten Positionen" arrow>
                <Chip
                  size="small"
                  label={
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                      <span>Σ </span>
                      {renderNumber(getMengeValue(item.menge), 2)}
                    </Box>
                  }
                  variant="outlined"
                  color="primary"
                  sx={{
                    height: 20,
                    backgroundColor: "rgba(25, 118, 210, 0.08)",
                    borderColor: "rgba(25, 118, 210, 0.3)",
                    "& .MuiChip-label": {
                      px: 0.5,
                      fontSize: "0.75rem",
                      color: "primary.main",
                    },
                  }}
                />
              </Tooltip>
            ) : (
              <>{renderNumber(getMengeValue(item.menge), 2)}</>
            )}

            {hasQtoData(item) && <DataSourceInfo />}
          </Box>
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("einheit"),
            ...cellStyles.standardBorder,
          }}
        >
          {hasQtoData(item) ? getQuantityUnit() : processField(item.einheit)}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("kennwert"),
            ...cellStyles.kennwert,
            ...cellStyles.standardBorder,
          }}
        >
          {item.kennwert !== null && item.kennwert !== undefined ? (
            <>{renderNumber(item.kennwert)}</>
          ) : (
            ""
          )}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("totalChf"),
            ...cellStyles.totalChf,
            ...cellStyles.standardBorder,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {hasQtoData(item) || hasQtoInTree ? (
              <Tooltip
                title="Gesamtsumme inkl. untergeordnete Positionen"
                arrow
              >
                <Chip
                  size="small"
                  label={
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                      <span>Σ </span>
                      {renderNumber(getChfValue())}
                    </Box>
                  }
                  variant="outlined"
                  color="primary"
                  sx={{
                    height: 20,
                    backgroundColor: "rgba(25, 118, 210, 0.08)",
                    borderColor: "rgba(25, 118, 210, 0.3)",
                    "& .MuiChip-label": {
                      px: 0.5,
                      fontSize: "0.75rem",
                      color: "primary.main",
                      fontWeight: 500,
                    },
                  }}
                />
              </Tooltip>
            ) : (
              <>{renderNumber(getChfValue())}</>
            )}
          </Box>
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("kommentar"),
            padding: isMobile ? "8px 4px" : undefined,
          }}
        >
          {processField(item.kommentar)}
        </TableCell>
      </TableRow>

      {/* Third level items (grandchildren) */}
      {item.children && item.children.length > 0 && (
        <TableRow key={`${item.ebkp}-children`}>
          <TableCell
            style={{
              padding: 0,
              margin: 0,
              border: 0,
            }}
            colSpan={10}
          >
            <Collapse
              in={expanded}
              timeout="auto"
              unmountOnExit
              sx={{ padding: 0, margin: 0 }}
            >
              <Box sx={{ margin: 0, padding: 0 }}>
                <Table
                  size="small"
                  aria-label="grandchild items"
                  sx={{
                    ...tableStyle,
                  }}
                >
                  <colgroup>
                    <col style={{ width: columnWidths["expandIcon"] }} />
                    <col style={{ width: columnWidths["ebkp"] }} />
                    <col style={{ width: columnWidths["bezeichnung"] }} />
                    <col style={{ width: columnWidths["menge"] }} />
                    <col style={{ width: columnWidths["einheit"] }} />
                    <col style={{ width: columnWidths["kennwert"] }} />
                    <col style={{ width: columnWidths["totalChf"] }} />
                    <col style={{ width: columnWidths["kommentar"] }} />
                  </colgroup>
                  <TableBody>
                    {item.children?.map((grandchildItem: CostItem, index) => (
                      <CostTableGrandchildRow
                        key={`${grandchildItem.ebkp}-${index}`}
                        item={grandchildItem}
                        isMobile={isMobile}
                        cellStyles={cellStyles}
                        renderNumber={renderNumber}
                        totalElements={totalElements}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
};

export default CostTableChildRow;
