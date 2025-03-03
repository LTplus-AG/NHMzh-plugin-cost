import { useState } from "react";
import { Box, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { CostUploaderProps, MetaFile } from "./types";
import FileDropzone from "./FileDropzone";
import FileInfo from "./FileInfo";
import HierarchicalTable from "./HierarchicalTable";

const CostUploader = ({ onFileUploaded }: CostUploaderProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [metaFile, setMetaFile] = useState<MetaFile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleRow = (code: string) => {
    setExpandedRows((prev: Record<string, boolean>) => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  const handleRemoveFile = () => {
    setMetaFile(null);
  };

  const handleSendData = async () => {
    if (!metaFile) return;

    // Here you would implement the API call to send the data
    // For now, we'll just simulate a successful upload
    setIsLoading(true);

    // Simulate API call
    setTimeout(() => {
      const fileName = metaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Erfolgreich";

      // Call the onFileUploaded prop if provided
      if (onFileUploaded) {
        onFileUploaded(fileName, currentDate, status);
      }

      setMetaFile(null);
      setIsLoading(false);
    }, 1500);
  };

  const handleFileUploaded = (newMetaFile: MetaFile) => {
    setMetaFile(newMetaFile);
  };

  return (
    <div className="flex flex-col h-full">
      {!metaFile ? (
        <FileDropzone
          onFileUploaded={handleFileUploaded}
          setIsLoading={setIsLoading}
        />
      ) : (
        <div>
          {isLoading ? (
            <Box display="flex" justifyContent="center" my={4}>
              <CircularProgress />
            </Box>
          ) : (
            <div className="flex flex-col h-full">
              <FileInfo
                metaFile={metaFile}
                onRemoveFile={handleRemoveFile}
                onSendData={handleSendData}
              />

              <HierarchicalTable
                metaFile={metaFile}
                expandedRows={expandedRows}
                toggleRow={toggleRow}
                isMobile={isMobile}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CostUploader;
