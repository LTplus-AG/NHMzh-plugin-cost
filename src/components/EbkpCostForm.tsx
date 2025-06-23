import React from "react";
import {
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TextField,
  Box,
  Typography,
} from "@mui/material";

export interface EbkpStat {
  code: string;
  quantity: number;
  unit?: string;
}

interface Props {
  stats: EbkpStat[];
  kennwerte: Record<string, number>;
  onKennwertChange: (code: string, value: number) => void;
}

const EbkpCostForm: React.FC<Props> = ({ stats, kennwerte, onKennwertChange }) => {
  const handleChange = (code: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    onKennwertChange(code, isNaN(value) ? 0 : value);
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }} color="primary">
        Kennwerte pro eBKP
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>eBKP</TableCell>
            <TableCell align="right">Menge</TableCell>
            <TableCell>Einheit</TableCell>
            <TableCell align="right">Kennwert (CHF)</TableCell>
            <TableCell align="right">Kosten (CHF)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {stats.map((s) => (
            <TableRow key={s.code}>
              <TableCell>{s.code}</TableCell>
              <TableCell align="right">
                {s.quantity.toLocaleString("de-CH")}
              </TableCell>
              <TableCell>{s.unit || "-"}</TableCell>
              <TableCell align="right">
                <TextField
                  type="number"
                  variant="outlined"
                  size="small"
                  value={kennwerte[s.code] ?? ""}
                  onChange={handleChange(s.code)}
                  inputProps={{ step: "0.01", min: 0 }}
                />
              </TableCell>
              <TableCell align="right">
                {kennwerte[s.code]
                  ? (kennwerte[s.code] * s.quantity).toLocaleString("de-CH", {
                      maximumFractionDigits: 2,
                    })
                  : "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

export default EbkpCostForm;
