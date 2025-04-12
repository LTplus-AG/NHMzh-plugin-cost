import { Paper, Typography, Box } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useCallback, useRef, useState } from "react";
import { getDropzoneStyle } from "./styles";
// Removed parseExcelFile import, will be handled in parent
// import { parseExcelFile } from "./utils";
// Removed MetaFile import as it's not needed here
// import { MetaFile } from "./types";

interface FileDropzoneProps {
  // Renamed prop to indicate it just passes the selected file
  onFileSelected: (file: File) => void;
  // Removed setIsLoading prop
}

const FileDropzone = ({ onFileSelected }: FileDropzoneProps) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Renamed function, now just validates and calls onFileSelected
  const handleFileSelectedInternal = useCallback(
    (file: File | null) => {
      if (!file) return;

      console.log(`File selected/dropped: ${file.name}, Size: ${file.size}`);

      // Basic validation for Excel type
      if (
        file.type ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        file.type === "application/vnd.ms-excel"
      ) {
        onFileSelected(file); // Pass the raw file up
      } else {
        console.warn("Invalid file type selected:", file.type);
        // TODO: Add user feedback for invalid file type
      }
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        // Get only the first file
        handleFileSelectedInternal(e.dataTransfer.files[0]);
      }
    },
    [handleFileSelectedInternal]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Set drag active only if items are being dragged over
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileSelectedInternal(e.target.files[0]);
        // Reset input value to allow selecting the same file again
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    },
    [handleFileSelectedInternal]
  );

  const handleClick = () => {
    if (inputRef.current) {
      inputRef.current.click();
    }
  };

  return (
    <Paper
      sx={getDropzoneStyle(isDragActive)}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      <Box sx={{ textAlign: "center", padding: 2 }}>
        {isDragActive ? (
          <div>
            <UploadFileIcon color="primary" sx={{ fontSize: 32, mb: 1 }} />
            <Typography variant="body1" color="primary">
              Lassen Sie die Excel-Datei hier fallen...
            </Typography>
          </div>
        ) : (
          <div>
            <UploadFileIcon color="primary" sx={{ fontSize: 32, mb: 1 }} />
            <Typography variant="body1" color="textPrimary">
              Drag and Drop
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Format: Excel (.xlsx, .xls)
            </Typography>
          </div>
        )}
      </Box>
    </Paper>
  );
};

export default FileDropzone;
