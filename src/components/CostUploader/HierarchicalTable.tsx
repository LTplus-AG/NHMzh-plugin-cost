import { Alert, TableContainer, Paper, Table, TableBody } from "@mui/material";
import { CostItem, MetaFile } from "./types";
import { columnWidths } from "./styles";
import { formatNumber } from "./utils";
import TableHeader from "./TableHeader";
import CostTableRow from "./CostTableRow";
import {
  createTableContainerStyle,
  tableStyle,
  createCellStyles,
} from "./styles";
import { useEffect, useRef } from "react";

// Define CellStyles interface to match the one used in CostTableRow
interface CellStyles {
  childRow?: React.CSSProperties;
  grandchildRow?: React.CSSProperties;
  menge?: React.CSSProperties;
  standardBorder?: React.CSSProperties;
  kennwert?: React.CSSProperties;
  chf?: React.CSSProperties;
  totalChf?: React.CSSProperties;
  header?: React.CSSProperties;
  cell?: React.CSSProperties;
  [key: string]: React.CSSProperties | undefined;
}

interface HierarchicalTableProps {
  metaFile: MetaFile;
  expandedRows: Record<string, boolean>;
  toggleRow: (code: string) => void;
  isMobile: boolean;
  totalElements: number;
  isLoading: boolean;
  mappingMessage: string;
}

const HierarchicalTable = ({
  metaFile,
  expandedRows,
  toggleRow,
  isMobile,
  totalElements,
}: HierarchicalTableProps) => {
  // Cell styles for alignment and formatting
  const cellStyles: CellStyles = createCellStyles(isMobile);

  // Keep track of rows we've already auto-expanded
  const autoExpandedRef = useRef<Set<string>>(new Set());
  // Track if initial auto-expansion has been performed
  const initialExpansionDoneRef = useRef<boolean>(false);
  // Store file ID to detect file changes
  const fileIdRef = useRef<string | null>(null);

  // Helper function to get the data array safely
  const getDataArray = (): CostItem[] => {
    if (!metaFile.data) return [];

    // Handle both formats: array and object with data property
    if (Array.isArray(metaFile.data)) {
      return metaFile.data;
    } else if (metaFile.data.data && Array.isArray(metaFile.data.data)) {
      return metaFile.data.data;
    }

    return [];
  };

  // Get count of items with BIM data
  // This function is still useful for coloring rows and expanding rows with BIM data
  const countItemsWithBimData = (items: CostItem[]): number => {
    if (!items || !items.length) return 0;

    let count = 0;

    for (const item of items) {
      // Check if this item has BIM data
      if (item.area !== undefined) {
        count++;
      }

      // Recursively check children
      if (item.children && item.children.length) {
        count += countItemsWithBimData(item.children);
      }
    }

    return count;
  };

  // Check if an item or its children have BIM data
  const hasItemBimData = (item: CostItem): boolean => {
    // Check if this item has direct BIM data
    if (item.area !== undefined) {
      return true;
    }

    // Check if any children have BIM data
    if (item.children && item.children.length > 0) {
      return item.children.some((child) => hasItemBimData(child));
    }

    return false;
  };

  // Reset when the file changes
  useEffect(() => {
    const currentFileId = metaFile?.file?.name || null;

    // If the file has changed, reset our tracking
    if (fileIdRef.current !== currentFileId) {
      fileIdRef.current = currentFileId;
      initialExpansionDoneRef.current = false;
      autoExpandedRef.current.clear();
    }
  }, [metaFile?.file?.name]);

  // One-time auto-expansion of BIM data rows
  useEffect(() => {
    // Skip if we've already done the initial expansion for this file
    // or if there's no data to work with
    if (initialExpansionDoneRef.current || !metaFile?.data) {
      return;
    }

    const dataArray = getDataArray();
    if (dataArray.length === 0) return;

    // Find all parent rows that have BIM data
    const rowsToExpand: string[] = [];

    dataArray.forEach((item) => {
      if (item.ebkp && hasItemBimData(item)) {
        rowsToExpand.push(item.ebkp);
        autoExpandedRef.current.add(item.ebkp);
      }
    });

    // Expand all at once
    if (rowsToExpand.length > 0) {
      console.log(`Auto-expanding ${rowsToExpand.length} rows with BIM data`);
      // Use a fake expanded state to calculate what needs to be expanded
      const fakeExpandedState = { ...expandedRows };

      // Expand only rows that aren't already expanded
      rowsToExpand.forEach((code) => {
        if (!fakeExpandedState[code]) {
          fakeExpandedState[code] = true;
          toggleRow(code);
        }
      });
    }

    // Mark that we've done the initial expansion
    initialExpansionDoneRef.current = true;

    // Calculate BIM data count for logging
    const bimDataCount = countItemsWithBimData(dataArray);
    console.log(`Found ${bimDataCount} items with BIM data in this Excel file`);
  }, [metaFile?.data, toggleRow, expandedRows]);

  // Render a number with hover effect showing the full value
  const renderNumber = (
    value: number | null | undefined,
    decimals: number = 2
  ) => {
    if (value === null || value === undefined || isNaN(value) || value === 0) {
      return "";
    }

    return <span title={String(value)}>{formatNumber(value, decimals)}</span>;
  };

  if (!metaFile?.data) return null;

  // Get the data array for rendering
  const dataArray = getDataArray();

  return (
    <>
      {metaFile.missingHeaders && metaFile.missingHeaders.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Fehlende Spalten in der Excel-Datei:{" "}
          {metaFile.missingHeaders.join(", ")}
        </Alert>
      )}

      <TableContainer
        component={Paper}
        elevation={1}
        sx={{
          ...createTableContainerStyle(isMobile),
          maxHeight: "none",
          overflowY: "visible",
        }}
      >
        <Table
          stickyHeader
          size="small"
          sx={{
            flexGrow: 1,
            ...tableStyle,
            "& td": {
              padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px",
            },
            "& th": {
              padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px",
            },
          }}
        >
          {/* Use HTML colgroup element directly, not as a Material-UI component */}
          <colgroup>
            <col style={{ width: columnWidths.expandIcon }} />
            <col style={{ width: columnWidths.ebkp }} />
            <col style={{ width: columnWidths.bezeichnung }} />
            <col style={{ width: columnWidths.menge }} />
            <col style={{ width: columnWidths.einheit }} />
            <col style={{ width: columnWidths.kennwert }} />
            <col style={{ width: columnWidths.totalChf }} />
            <col style={{ width: columnWidths.kommentar }} />
          </colgroup>

          <TableHeader isMobile={isMobile} cellStyles={cellStyles} />

          <TableBody>
            {dataArray.map((parentItem: CostItem) => (
              <CostTableRow
                key={
                  parentItem.ebkp ||
                  `row-${Math.random().toString(36).substring(2)}`
                }
                item={parentItem}
                expanded={
                  parentItem.ebkp
                    ? expandedRows[parentItem.ebkp] || false
                    : false
                }
                onToggle={toggleRow}
                expandedRows={expandedRows}
                isMobile={isMobile}
                cellStyles={cellStyles}
                renderNumber={renderNumber}
                totalElements={totalElements}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
};

export default HierarchicalTable;
