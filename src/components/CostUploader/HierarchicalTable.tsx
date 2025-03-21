import {
  Alert,
  TableContainer,
  Paper,
  Table,
  TableBody,
  Box,
  Typography,
  Chip,
} from "@mui/material";
import { CostItem, MetaFile } from "./types";
import { columnWidths } from "./styles";
import { formatNumber } from "./utils";
import TableHeader from "./TableHeader";
import CostTableRow from "./CostTableRow";
import { useKafka } from "../../contexts/KafkaContext";
import SyncIcon from "@mui/icons-material/Sync";
import {
  createTableContainerStyle,
  tableStyle,
  createCellStyles,
} from "./styles";

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
}

const HierarchicalTable = ({
  metaFile,
  expandedRows,
  toggleRow,
  isMobile,
}: HierarchicalTableProps) => {
  // Get isKafkaData helper from context
  const { isKafkaData } = useKafka();

  // Cell styles for alignment and formatting
  const cellStyles: CellStyles = createCellStyles(isMobile);

  // Count items with BIM/IFC data
  const countItemsWithBimData = (items: CostItem[]): number => {
    if (!items || !items.length) return 0;

    let count = 0;

    for (const item of items) {
      // Check if this item has BIM data
      if (isKafkaData(item.ebkp)) {
        count++;
      }

      // Recursively check children
      if (item.children && item.children.length) {
        count += countItemsWithBimData(item.children);
      }
    }

    return count;
  };

  // Get count of items with BIM data
  const bimItemsCount = metaFile?.data
    ? countItemsWithBimData(metaFile.data)
    : 0;

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
          // Force horizontal scrolling when content exceeds the container width
          overflowX: "auto",
        }}
      >
        <Table
          stickyHeader
          size="small"
          sx={{
            flexGrow: 1,
            ...tableStyle,
            "& td": {
              // Direct table cell styling
              padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px",
            },
            "& th": {
              // Direct header cell styling
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
            <col style={{ width: columnWidths.chf }} />
            <col style={{ width: columnWidths.totalChf }} />
            <col style={{ width: columnWidths.kommentar }} />
          </colgroup>

          <TableHeader isMobile={isMobile} cellStyles={cellStyles} />

          <TableBody>
            {metaFile.data.map((parentItem: CostItem) => (
              <CostTableRow
                key={parentItem.ebkp}
                item={parentItem}
                expanded={expandedRows[parentItem.ebkp] || false}
                onToggle={toggleRow}
                expandedRows={expandedRows}
                isMobile={isMobile}
                cellStyles={cellStyles}
                renderNumber={renderNumber}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
};

export default HierarchicalTable;
