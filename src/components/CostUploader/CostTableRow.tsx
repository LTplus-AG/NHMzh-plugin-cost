import React, { useState, useEffect, useMemo } from "react";
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
import SyncIcon from "@mui/icons-material/Sync";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { CostItem } from "./types";
import { getColumnStyle, columnWidths } from "./styles";
import { tableStyle } from "./styles";
import CostTableChildRow from "./CostTableChildRow";
import { useApi } from "../../contexts/ApiContext";
import { computeItemTotal, aggregateChildTotals, generateItemSignature } from "../../utils/costTotals";

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

interface CostTableRowProps {
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

const CostTableRow = ({
  item,
  expanded,
  onToggle,
  expandedRows,
  isMobile,
  cellStyles,
  renderNumber,
  totalElements,
}: CostTableRowProps) => {
  // Add state to track if QTO data is available
  const [hasQtoState, setHasQtoState] = useState<boolean>(false);
  const [hasQtoInTreeState, setHasQtoInTreeState] = useState<boolean>(false);

  // Get the Kafka context
  const { replaceEbkpPlaceholders, formatTimestamp } = useApi();

  // Update the hasQtoData function to check for IFC data
  const hasQtoData = (item: CostItem): boolean => {
    // Check if any children have QTO data
    if (item.children && item.children.length > 0) {
      return item.children.some((child) => {
        // Check if child has direct QTO data
        if (child.area !== undefined) return true;
        // Check if child's children have QTO data
        if (child.children && child.children.length > 0) {
          return child.children.some(
            (grandchild) => grandchild.area !== undefined
          );
        }
        return false;
      });
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
        if (hasQtoDataInTree(child)) return true;
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
  }, [item, hasQtoState, hasQtoInTreeState, qtoInTree]);

  // Use state values for rendering
  const hasQtoInTree = hasQtoInTreeState;

  // Get unit from MongoDB data (if available)
  const getQuantityUnit = () => {
    // If the item has explicit quantity type/unit metadata from MongoDB
    if (item.quantityUnit) {
      return item.quantityUnit;
    }

    // Check if any children have quantity unit info
    if (item.children && item.children.length > 0) {
      // Try to find a child with quantity unit info
      for (const child of item.children) {
        if (child.quantityUnit) {
          return child.quantityUnit;
        }

        // Check grandchildren if needed
        if (child.children && child.children.length > 0) {
          for (const grandchild of child.children) {
            if (grandchild.quantityUnit) {
              return grandchild.quantityUnit;
            }
          }
        }
      }
    }

    // Default to square meters
    return "m²";
  };

  // Use shared utility to calculate totals from children
  const calculateTotalsFromChildren = (item: CostItem): { area: number; elementCount: number } => {
    return aggregateChildTotals(item);
  };

  // Update the getMengeValue function to always show sums
  const getMengeValue = (
    originalMenge: number | null | undefined
  ): number | null | undefined => {
    // Calculate total area from children
    const { area } = calculateTotalsFromChildren(item);

    // If we have a total area from children, use it
    if (area > 0) {
      return area;
    }

    // Otherwise use original value from Excel
    return originalMenge;
  };

  // Generate stable signature for deep change detection
  const itemSignature = useMemo(() => generateItemSignature(item), [item]);

  // Memoized CHF calculation to avoid repeated deep traversals
  const chfValue = useMemo(() => {
    return computeItemTotal(item);
  }, [item, itemSignature]); // Use stable signature to detect deep changes

  // Update the getChfValue function to use memoized value
  const getChfValue = (): number => {
    return chfValue;
  };

  // Process text fields to replace any eBKP placeholders
  const processField = (text: string | null | undefined): string => {
    if (text === null || text === undefined) return "";
    return replaceEbkpPlaceholders(String(text));
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

  // Update the DataSourceInfo component to show IFC data info
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
          backgroundColor: hasQtoData(item)
            ? "rgba(25, 118, 210, 0.04)"
            : hasQtoInTree
              ? "rgba(25, 118, 210, 0.02)"
              : "rgba(0, 0, 0, 0.04)",
          "& > *": { borderBottom: "unset" },
          borderLeft: hasQtoData(item)
            ? "2px solid rgba(25, 118, 210, 0.6)"
            : hasQtoInTree
              ? "2px solid rgba(25, 118, 210, 0.3)"
              : "none",
        }}
      >
        <TableCell sx={{ padding: isMobile ? "8px 4px" : undefined }}>
          {item.children && item.children.length > 0 && (
            <Tooltip
              title={
                hasQtoInTree && !hasQtoData(item) && !expanded
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
                      opacity: !expanded ? 0.9 : 0.7,
                      border: !expanded
                        ? "1px solid rgba(25, 118, 210, 0.3)"
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
            fontWeight: "bold",
            padding: isMobile ? "8px 4px" : undefined,
          }}
        >
          {processField(item.ebkp)}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("bezeichnung"),
            fontWeight: "bold",
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
            {hasQtoData(item) && (
              <Chip
                icon={<SyncIcon />}
                size="small"
                label={renderNumber(getMengeValue(item.menge), 2)}
                variant="outlined"
                color="info"
                sx={{
                  height: 20,
                  "& .MuiChip-label": {
                    px: 0.5,
                    fontSize: "0.75rem",
                  },
                  "& .MuiChip-icon": {
                    fontSize: "0.875rem",
                    ml: 0.5,
                  },
                }}
              />
            )}
            {!hasQtoData(item) && hasQtoInTree && (
              <>
                {renderNumber(getMengeValue(item.menge), 2)}
                <Tooltip
                  title="Enthält BIM Daten in untergeordneten Positionen"
                  arrow
                >
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      bgcolor: "info.main",
                      display: "inline-block",
                      ml: 0.8,
                      verticalAlign: "middle",
                      opacity: 0.5,
                    }}
                  />
                </Tooltip>
              </>
            )}
            {!hasQtoData(item) && !hasQtoInTree && (
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
                  label={renderNumber(getChfValue())}
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
                aria-label="child items"
                sx={{
                  ...tableStyle,
                  "& td": {
                    padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px",
                  },
                  "& th": {
                    padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px",
                  },
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
                  {item.children?.map((childItem: CostItem) => (
                    <CostTableChildRow
                      key={
                        childItem.ebkp ??
                        `child-${Math.random().toString(36).substring(2)}`
                      }
                      item={childItem}
                      expanded={
                        childItem.ebkp
                          ? expandedRows[childItem.ebkp] || false
                          : false
                      }
                      onToggle={onToggle}
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
    </React.Fragment>
  );
};

export default CostTableRow;
