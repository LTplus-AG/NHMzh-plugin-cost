import {
  Alert,
  TableContainer,
  Paper,
  Table,
  TableBody,
  Box,
  Chip,
} from "@mui/material";
import { CostItem, MetaFile } from "./types";
import { columnWidths } from "./styles";
import { formatNumber } from "./utils";
import TableHeader from "./TableHeader";
import CostTableRow from "./CostTableRow";
import SyncIcon from "@mui/icons-material/Sync";
import {
  createTableContainerStyle,
  tableStyle,
  createCellStyles,
} from "./styles";
import { useEffect } from "react";

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

  // Count items with BIM/IFC data
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

  // Auto-expand rows that have BIM data when component mounts or data changes
  useEffect(() => {
    const dataArray = getDataArray();
    const itemsToExpand: string[] = [];

    // Find all parent rows that have BIM data in their children
    dataArray.forEach((item) => {
      if (item.ebkp && hasItemBimData(item) && !expandedRows[item.ebkp]) {
        itemsToExpand.push(item.ebkp);
      }
    });

    // Toggle each row that needs to be expanded
    if (itemsToExpand.length > 0) {
      itemsToExpand.forEach((code) => toggleRow(code));
    }
  }, [metaFile.data, toggleRow, expandedRows]);

  // Get count of items with BIM data
  const bimItemsCount = countItemsWithBimData(getDataArray());

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

      {/* BIM Data Indicator */}
      {bimItemsCount > 0 && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            mb: 1,
            mt: 1,
          }}
        >
          <Chip
            icon={<SyncIcon />}
            size="small"
            label={`${bimItemsCount} Positionen mit BIM Daten`}
            color="info"
            variant="outlined"
            sx={{
              height: 24,
              "& .MuiChip-label": { fontWeight: 500 },
            }}
          />
        </Box>
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
