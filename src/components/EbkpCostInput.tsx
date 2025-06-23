
import {
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TextField,
  Typography,
  Box,
} from "@mui/material";

interface EbkpCostInputProps {
  quantities: Record<string, number>;
  kennwerte: Record<string, number>;
  onKennwerteChange: (values: Record<string, number>) => void;
}

const EbkpCostInput = ({ quantities, kennwerte, onKennwerteChange }: EbkpCostInputProps) => {
  const handleChange = (code: string, value: string) => {
    const num = parseFloat(value);
    onKennwerteChange({ ...kennwerte, [code]: isNaN(num) ? 0 : num });
  };

  const rows = Object.entries(quantities);
  const total = rows.reduce((sum, [code, qty]) => sum + qty * (kennwerte[code] || 0), 0);

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Kosten nach eBKP
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>eBKP</TableCell>
            <TableCell align="right">Menge</TableCell>
            <TableCell align="right">Kennwert [CHF]</TableCell>
            <TableCell align="right">Kosten [CHF]</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(([code, qty]) => {
            const kw = kennwerte[code] || 0;
            const cost = kw * qty;
            return (
              <TableRow key={code}>
                <TableCell>{code}</TableCell>
                <TableCell align="right">{qty.toLocaleString("de-CH")}</TableCell>
                <TableCell align="right">
                  <TextField
                    size="small"
                    type="number"
                    value={kennwerte[code] ?? ""}
                    onChange={(e) => handleChange(code, e.target.value)}
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
            <TableCell colSpan={3} sx={{ fontWeight: "bold" }}>
              Total
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: "bold" }}>
              {total.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Box>
  );
};

export default EbkpCostInput;
