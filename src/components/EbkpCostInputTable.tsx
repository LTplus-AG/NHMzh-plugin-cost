import React, { useMemo, useState, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Paper,
  Typography,
  Box,
} from "@mui/material";
import { MongoElement } from "../types/common.types";

interface EbkpCostInputTableProps {
  elements: MongoElement[];
  onTotalChange?: (total: number) => void;
}

interface EbkpData {
  quantity: number;
  unit?: string;
}

const EbkpCostInputTable: React.FC<EbkpCostInputTableProps> = ({
  elements,
  onTotalChange,
}) => {
  const [kennwerte, setKennwerte] = useState<Record<string, number>>({});

  const ebkpMap = useMemo(() => {
    const map: Record<string, EbkpData> = {};
    elements.forEach((el) => {
      const code =
        el.classification?.id || el.properties?.ebkph || "Unbekannt";
      if (!code) return;
      const qty =
        el.quantity?.value ?? el.quantity_value ?? el.properties?.area ?? 0;
      const unit = el.quantity?.unit ?? el.quantity?.type;
      if (!map[code]) {
        map[code] = { quantity: 0, unit };
      }
      map[code].quantity += qty || 0;
    });
    return map;
  }, [elements]);

  const totalCost = useMemo(() => {
    return Object.entries(ebkpMap).reduce((sum, [code, info]) => {
      const kw = kennwerte[code] || 0;
      return sum + kw * info.quantity;
    }, 0);
  }, [kennwerte, ebkpMap]);

  useEffect(() => {
    if (onTotalChange) {
      onTotalChange(totalCost);
    }
  }, [totalCost, onTotalChange]);

  const handleChange = (code: string, value: number) => {
    setKennwerte((prev) => ({ ...prev, [code]: value }));
  };

  return (
    <Box sx={{ mt: 2 }}>
      <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>eBKP</TableCell>
              <TableCell align="right">Menge</TableCell>
              <TableCell>Einheit</TableCell>
              <TableCell align="right">Kennwert</TableCell>
              <TableCell align="right">Kosten</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.entries(ebkpMap).map(([code, info]) => {
              const cost = (kennwerte[code] || 0) * info.quantity;
              return (
                <TableRow key={code} hover>
                  <TableCell component="th" scope="row">
                    {code}
                  </TableCell>
                  <TableCell align="right">
                    {info.quantity.toLocaleString("de-CH", {
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell>{info.unit ?? ""}</TableCell>
                  <TableCell align="right" sx={{ minWidth: 100 }}>
                    <TextField
                      size="small"
                      type="number"
                      value={kennwerte[code] ?? ""}
                      onChange={(e) =>
                        handleChange(code, parseFloat(e.target.value) || 0)
                      }
                      inputProps={{ style: { textAlign: "right" } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {cost.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={4}>
                <Typography fontWeight="bold">Total</Typography>
              </TableCell>
              <TableCell align="right">
                <Typography fontWeight="bold">
                  {totalCost.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
                </Typography>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default EbkpCostInputTable;
