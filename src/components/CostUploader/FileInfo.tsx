import { Button, IconButton, Box, Chip } from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import { MetaFile } from "./types";
import SendIcon from "@mui/icons-material/Send";
import NumbersIcon from "@mui/icons-material/Numbers";

interface FileInfoProps {
  metaFile: MetaFile;
  onRemoveFile?: () => void;
  onSendData: () => void;
  hideDeleteButton?: boolean;
  mappedItems?: number;
}

/**
 * Simplified FileInfo component showing the button and BIM data indicator
 */
const FileInfo = ({
  onRemoveFile,
  onSendData,
  hideDeleteButton = false,
  mappedItems = 0,
}: FileInfoProps) => {
  return (
    <Box
      sx={{
        p: 2,
        borderBottom: "1px solid #e0e0e0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* Left side - BIM data indicator with delete button */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {mappedItems > 0 && (
          <Chip
            icon={<NumbersIcon />}
            label={`${mappedItems} Positionen mit BIM Daten`}
            color="primary"
            variant="outlined"
            sx={{
              borderRadius: "16px",
              "& .MuiChip-label": {
                fontWeight: 500,
              },
              "& .MuiChip-icon": {
                color: "primary.main",
              },
            }}
          />
        )}
        {!hideDeleteButton && onRemoveFile && (
          <IconButton
            color="error"
            onClick={onRemoveFile}
            size="small"
            title="Datei entfernen"
          >
            <DeleteIcon />
          </IconButton>
        )}
      </Box>

      {/* Right side - Actions */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Button
          variant="contained"
          color="primary"
          size="small"
          startIcon={<SendIcon />}
          onClick={onSendData}
        >
          Vorschau anzeigen
        </Button>
      </Box>
    </Box>
  );
};

export default FileInfo;
