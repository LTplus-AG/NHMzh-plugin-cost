import { Paper, Typography, Box } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useCallback, useRef, useState } from "react";
import { getDropzoneStyle } from "./styles";
import { parseExcelFile } from "./utils";
import { MetaFile } from "./types";

interface FileDropzoneProps {
  onFileUploaded: (metaFile: MetaFile) => void;
  setIsLoading: (loading: boolean) => void;
}

const FileDropzone = ({ onFileUploaded, setIsLoading }: FileDropzoneProps) => {
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file) return;

      console.log(`Processing new file: ${file.name}, Size: ${file.size}`);
      setIsLoading(true);

      try {
        const result = await parseExcelFile(file);

        const metaFile: MetaFile = {
          file: file,
          data: result.data,
          headers: result.headers,
          missingHeaders: result.missingHeaders,
          valid: result.valid,
        };

        onFileUploaded(metaFile);
      } catch (error) {
        console.error("Error processing file:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [onFileUploaded, setIsLoading]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        // Get only the first file
        const file = e.dataTransfer.files[0];
        // Only accept Excel files
        if (
          file.type ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          file.type === "application/vnd.ms-excel"
        ) {
          handleFile(file);
        }
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFile(e.target.files[0]);
        // Reset input value to allow selecting the same file again
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    },
    [handleFile]
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
