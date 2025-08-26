import React from "react";
import { TableRow, TableCell, Box, Tooltip, Chip } from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { CostItem } from "./types";
import { getColumnStyle } from "./styles";
import { useApi } from "../../contexts/ApiContext";
import { computeRowTotal } from "../../utils/costCalculations";

// Define a proper type for cellStyles instead of using any
interface CellStyles {
  grandchildRow?: React.CSSProperties;
  menge?: React.CSSProperties;
  standardBorder?: React.CSSProperties;
  kennwert?: React.CSSProperties;
  chf?: React.CSSProperties;
  totalChf?: React.CSSProperties;
  [key: string]: React.CSSProperties | undefined;
}

interface CostTableGrandchildRowProps {
  item: CostItem;
  isMobile: boolean;
  cellStyles: CellStyles;
  renderNumber: (
    value: number | null | undefined,
    decimals?: number
  ) => React.ReactElement | string;
  totalElements: number;
}

const CostTableGrandchildRow = ({
  item,
  isMobile,
  cellStyles,
  renderNumber,
  totalElements,
}: CostTableGrandchildRowProps) => {
  // Get the Kafka context
  const { replaceEbkpPlaceholders, formatTimestamp } = useApi();

  // Check if this item has QTO data from MongoDB
  const hasQtoData = (item: CostItem): boolean => {
    return item.area !== undefined;
  };

  // Process text fields to replace any eBKP placeholders
  const processField = (text: string | null | undefined): string => {
    if (text === null || text === undefined) return "";
    return replaceEbkpPlaceholders(String(text));
  };

  // Get appropriate Menge value - use area data if available for this eBKP code
  const getMengeValue = (originalMenge: number | null | undefined) => {
    // If item has area from MongoDB
    if (item.area !== undefined) {
      return item.area;
    }

    // Otherwise use original value from Excel
    return originalMenge;
  };

  // Get CHF value - calculate based on area when available
  const getChfValue = () => {
    const quantity = item.area !== undefined ? item.area : item.menge;
    return computeRowTotal({
      quantity,
      unitPrice: item.kennwert,
      factor: item.factor,
    });
  };

  // Get element count for this item
  const getElementCount = () => {
    // Always return the total elements count to show 100%
    return totalElements;
  };

  // Get unit from MongoDB data (if available)
  const getQuantityUnit = () => {
    // If the item has explicit quantity type/unit metadata from MongoDB
    if (item.quantityUnit) {
      return item.quantityUnit;
    }

    // Default to square meters
    return "m²";
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
    <TableRow
      hover
      sx={{
        ...cellStyles.grandchildRow,
        backgroundColor: hasQtoData(item)
          ? "rgba(25, 118, 210, 0.02)"
          : undefined,
        borderLeft: hasQtoData(item)
          ? "2px solid rgba(25, 118, 210, 0.3)"
          : "none",
      }}
    >
      <TableCell sx={{ padding: isMobile ? "8px 4px" : undefined }}>
        {hasQtoData(item) && (
          <Box
            sx={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              bgcolor: "info.main",
              display: "inline-block",
              ml: 0.5,
              verticalAlign: "middle",
              opacity: 0.7,
            }}
          />
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
          {hasQtoData(item) ? (
            <Tooltip
              title={`${getElementCount()}/${totalElements} BIM Elemente (100%)`}
              arrow
            >
              <Chip
                icon={<SyncIcon />}
                size="small"
                label={renderNumber(getMengeValue(item.menge), 2)}
                variant="outlined"
                color="info"
                sx={{
                  height: 20,
                  backgroundColor: "rgba(25, 118, 210, 0.05)",
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
          {hasQtoData(item) ? (
            <Tooltip title="Betrag aus BIM Daten" arrow>
              <Chip
                size="small"
                label={renderNumber(getChfValue())}
                variant="outlined"
                color="primary"
                sx={{
                  height: 20,
                  backgroundColor: "rgba(25, 118, 210, 0.05)",
                  "& .MuiChip-label": {
                    px: 0.5,
                    fontSize: "0.75rem",
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
  );
};

export default CostTableGrandchildRow;
