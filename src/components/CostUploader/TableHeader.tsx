import { TableHead, TableRow, TableCell, TableSortLabel, Box } from "@mui/material";
import ArrowRightAltIcon from "@mui/icons-material/ArrowRightAlt";
import { getColumnStyle } from "./styles";

// Sorting types
export type SortDirection = "asc" | "desc";
export type SortableColumn = "ebkp" | "bezeichnung" | "menge" | "kennwert" | "totalChf" | "kommentar";

export interface SortConfig {
  column: SortableColumn | null;
  direction: SortDirection;
}

// Define a proper type for cellStyles
interface CellStyles {
  header?: React.CSSProperties;
  menge?: React.CSSProperties;
  kennwert?: React.CSSProperties;
  chf?: React.CSSProperties;
  totalChf?: React.CSSProperties;
  [key: string]: React.CSSProperties | undefined;
}

interface TableHeaderProps {
  isMobile: boolean;
  cellStyles: CellStyles;
  sortConfig: SortConfig;
  onSort: (column: SortableColumn) => void;
}

const TableHeader = ({ isMobile, cellStyles, sortConfig, onSort }: TableHeaderProps) => {
  const createSortableHeader = (
    column: SortableColumn,
    label: string,
    columnStyle: string,
    additionalContent?: React.ReactNode,
    subtitle?: string
  ) => (
    <TableCell
      sx={{
        ...getColumnStyle(columnStyle as keyof typeof getColumnStyle),
        ...cellStyles.header,
        ...(column === "kennwert" ? cellStyles.kennwert : {}),
        ...(column === "totalChf" ? cellStyles.totalChf : {}),
        cursor: "pointer",
        userSelect: "none",
        "&:hover": {
          backgroundColor: "rgba(0, 0, 0, 0.04)",
        },
      }}
    >
      <TableSortLabel
        active={sortConfig.column === column}
        direction={sortConfig.column === column ? sortConfig.direction : "asc"}
        onClick={() => onSort(column)}
        sx={{
          "& .MuiTableSortLabel-icon": {
            fontSize: "1rem",
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
          <span>{label}</span>
          {additionalContent}
          {subtitle && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "#666",
                marginLeft: "4px",
              }}
            >
              {subtitle}
            </span>
          )}
        </Box>
      </TableSortLabel>
    </TableCell>
  );

  return (
    <TableHead>
      <TableRow>
        <TableCell
          sx={{
            ...getColumnStyle("expandIcon"),
            ...cellStyles.header,
          }}
        ></TableCell>
        {createSortableHeader("ebkp", "eBKP", "ebkp")}
        {createSortableHeader("bezeichnung", "Bezeichnung", "bezeichnung")}
        {createSortableHeader(
          "menge",
          "Menge",
          "menge"
        )}
        <TableCell
          sx={{
            ...getColumnStyle("einheit"),
            ...cellStyles.header,
          }}
        >
          Einheit
        </TableCell>
        {createSortableHeader(
          "kennwert",
          "Kennwert",
          "kennwert",
          !isMobile ? (
            <ArrowRightAltIcon
              fontSize="small"
              sx={{ verticalAlign: "middle", ml: 1 }}
            />
          ) : null,
          "(Eingabe)"
        )}
        {createSortableHeader(
          "totalChf",
          "Total CHF",
          "totalChf",
          !isMobile ? (
            <ArrowRightAltIcon
              fontSize="small"
              sx={{ verticalAlign: "middle", ml: 1 }}
            />
          ) : null,
          "(Berechnet)"
        )}
        {createSortableHeader("kommentar", "Kommentar", "kommentar")}
      </TableRow>
    </TableHead>
  );
};

export default TableHeader;
