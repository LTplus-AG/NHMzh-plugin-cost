import React from "react";
import {
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TextField,
} from "@mui/material";

interface EbkpStats {
  count: number;
  quantity: number;
}

interface Props {
  stats: Record<string, EbkpStats>;
  kennwerte: Record<string, number>;
  onKennwertChange: (code: string, value: number) => void;
}

const EbkpCostInputTable: React.FC<Props> = ({
  stats,
  kennwerte,
  onKennwertChange,
}) => {
  const codes = Object.keys(stats).sort();
  return (
    <Table size="small" stickyHeader>
      <TableHead>
        <TableRow>
          <TableCell>eBKP</TableCell>
          <TableCell>Anzahl</TableCell>
          <TableCell>Menge</TableCell>
          <TableCell>Kennwert (CHF)</TableCell>
          <TableCell>Teilsumme</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {codes.map((code) => {
          const info = stats[code];
          const value = kennwerte[code] ?? "";
          const subtotal = (kennwerte[code] || 0) * info.quantity;
          return (
            <TableRow key={code}>
              <TableCell>{code}</TableCell>
              <TableCell>{info.count}</TableCell>
              <TableCell>{info.quantity.toLocaleString("de-CH")}</TableCell>
              <TableCell>
                <TextField
                  type="number"
                  size="small"
                  value={value}
                  onChange={(e) =>
                    onKennwertChange(code, parseFloat(e.target.value) || 0)
                  }
                  inputProps={{ min: 0, step: 0.01 }}
                />
              </TableCell>
              <TableCell>
                {subtotal.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

export default EbkpCostInputTable;
