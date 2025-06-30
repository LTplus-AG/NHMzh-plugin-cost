import { ColumnWidthsType, ColumnHighlightsType } from "./types";

// Define fixed pixel-based column widths for consistent alignment
export const columnWidths: ColumnWidthsType = {
  expandIcon: "50px",
  ebkp: "120px",
  bezeichnung: "350px",
  menge: "110px",
  einheit: "90px",
  kennwert: "140px",
  chf: "0px",
  totalChf: "180px",
  kommentar: "200px",
};

// Define column highlight colors
export const columnHighlights: ColumnHighlightsType = {
  kennwert: "#fff9e6 !important", // Solid light yellow
  chf: "#e6f5e6 !important", // Solid light green
  totalChf: "#e6f5e6 !important", // Solid light green
};

// Create table column styles with consistent widths
export const getColumnStyle = (
  column: keyof typeof columnWidths,
  additionalStyles: object = {}
): Record<string, unknown> => ({
  width: columnWidths[column],
  minWidth: columnWidths[column],
  maxWidth: columnWidths[column],
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  boxSizing: "border-box",
  ...additionalStyles,
});

// Cell styles for alignment and formatting
export const createCellStyles = (
  isMobile: boolean
): Record<string, React.CSSProperties> => ({
  kennwert: {
    backgroundColor: columnHighlights.kennwert,
    textAlign: "right",
    borderRight: "1px dashed #ccc",
    paddingRight: "12px !important", // Normal right padding
  },
  chf: {
    display: "none",
    backgroundColor: columnHighlights.chf,
    textAlign: "right",
    borderRight: "1px dashed #ccc",
    paddingRight: "12px !important", // Normal right padding
  },
  totalChf: {
    backgroundColor: columnHighlights.totalChf,
    textAlign: "right",
    fontWeight: "bold",
    borderLeft: "1px dashed #ccc",
    paddingRight: "12px !important", // Normal right padding
  },
  menge: {
    textAlign: "right",
    paddingRight: "12px !important", // Normal right padding
  },
  header: {
    backgroundColor: "#f5f5f5",
    fontWeight: "bold",
  },
  childRow: {
    backgroundColor: "#f9f9f9",
    borderLeft: "4px solid #e0e0e0",
  },
  grandchildRow: {
    backgroundColor: "#f0f0f0",
    borderLeft: "8px solid #d5d5d5",
    fontStyle: "italic",
  },
  numeric: {
    textAlign: "right" as const,
    paddingRight: "8px", // Small fixed right padding for right-aligned text
  },
  standardBorder: {
    borderBottom: "1px solid rgba(224, 224, 224, 0.5)",
  },
  cell: {
    padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px", // Left padding only
  },
});

// Table container style with consistent layout
export const createTableContainerStyle = (isMobile: boolean) => ({
  height: "auto",
  mb: 1,
  overflowX: "auto",
  width: "100%",
  "& .MuiTableCell-root": {
    boxSizing: "border-box" as const,
    padding: isMobile ? "8px" : "12px 8px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  "& .MuiTable-root": {
    tableLayout: "fixed",
    width: "100%",
    minWidth: "1240px",
    borderCollapse: "collapse",
  },
  "& .MuiCollapse-root, & .MuiCollapse-wrapper, & .MuiCollapse-wrapperInner": {
    padding: 0,
    margin: 0,
  },
});

// Table style with fixed layout for consistent column alignment
export const tableStyle = {
  tableLayout: "fixed" as const,
  width: "100%",
  minWidth: "1240px", // Minimum width based on sum of all column widths
  borderCollapse: "collapse" as const,
  "& .MuiTableCell-alignRight": {
    textAlign: "right",
  },
  "& td": {
    padding: "12px 8px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  "& th": {
    padding: "12px 8px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

// Dropzone styles
export const getDropzoneStyle = (isDragActive: boolean) => ({
  p: 3,
  mt: 0,
  mb: 0,
  textAlign: "center",
  cursor: "pointer",
  backgroundColor: isDragActive ? "#f0f7ff" : "#f5f5f5",
  border: "2px dashed #ccc",
  "&:hover": {
    backgroundColor: "#f0f7ff",
    borderColor: "#2196f3",
  },
});
