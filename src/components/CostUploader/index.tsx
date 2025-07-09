import { useState, useEffect, ReactNode, useCallback } from "react";
import {
  Box,
  CircularProgress,
  useMediaQuery,
  useTheme,
  Typography,
} from "@mui/material";
import { MetaFile, CostItem } from "./types";
import { parseExcelFile } from "./utils";
import FileDropzone from "./FileDropzone";
import FileInfo from "./FileInfo";
import HierarchicalTable from "./HierarchicalTable";
import PreviewModal, { EnhancedCostItem } from "./PreviewModal";
import BimMapper from "./BimMapper";
import { MongoElement } from "../../types/common.types";
import { useCostCalculation } from "../../hooks/useCostCalculation";
import { getProjects, confirmCosts } from "../../services/costApi"; // Assuming costApi.ts exists

// Define the custom event type
interface BimMappingStatusEvent extends CustomEvent {
  detail: {
    isMapping: boolean;
    message?: string;
  };
}

interface CostUploaderProps {
  onFileUploaded?: (
    fileName: string | null,
    date?: string,
    status?: string,
    costData?: CostItem[] | { data: CostItem[] },
    isUpdate?: boolean
  ) => void;
  totalElements: number;
  costData: CostItem[] | null;
  elementsComponent?: ReactNode;
  projectName: string;
  triggerPreview?: boolean;
  onPreviewClosed?: () => void;
  bimElements?: MongoElement[];
}

const CostUploader = ({
  onFileUploaded,
  totalElements,
  costData,
  elementsComponent,
  projectName,
  triggerPreview,
  onPreviewClosed,
  bimElements,
}: CostUploaderProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [metaFile, setMetaFile] = useState<MetaFile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mappingMessage, setMappingMessage] = useState(
    "BIM Daten werden verarbeitet..."
  );
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mappedItemsCount, setMappedItemsCount] = useState(0);

  useEffect(() => {
    if (costData && metaFile?.file) {
      setMetaFile((prev) => ({
        ...prev!,
        data: costData,
      }));
    } else if (!costData) {
      setMetaFile(null);
    }
  }, [costData, metaFile?.file]);

  const toggleRow = (code: string) => {
    setExpandedRows((prev: Record<string, boolean>) => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  const handleRemoveFile = () => {
    if (metaFile && onFileUploaded) {
      onFileUploaded(null, undefined, "Gelöscht", [], false);
    }
    setMetaFile(null);
    setExpandedRows({});
    setPreviewOpen(false);
    setMappedItemsCount(0);
    const resetEvent = new CustomEvent("cost-file-removed", {
      detail: { timestamp: Date.now() },
    });
    window.dispatchEvent(resetEvent);
  };

  const handleClosePreviewInternal = () => {
    setPreviewOpen(false);
    if (onPreviewClosed) {
      onPreviewClosed();
    }
  };

  const handleShowPreview = () => {
    if (metaFile) {
      setPreviewOpen(true);
    }
  };

  const handleConfirmPreview = async (enhancedData: EnhancedCostItem[]) => {
    if (!metaFile) {
      console.error("Cannot confirm preview without metaFile.");
      handleClosePreviewInternal();
      return;
    }
    setIsLoading(true);
    setMappingMessage("Kostendaten werden gespeichert...");
    try {
      console.log(
        `Sending ${enhancedData.length} matched QTO elements to update costElements (Excel data already saved in costData)`
      );
      const allExcelItems = metaFile
        ? Array.isArray(metaFile.data)
          ? metaFile.data
          : metaFile.data.data
        : [];
      const getAllItems = (items: CostItem[]): CostItem[] => {
        let result: CostItem[] = [];
        items.forEach((item) => {
          result.push(item);
          if (item.children && item.children.length > 0) {
            result = result.concat(getAllItems(item.children));
          }
        });
        return result;
      };
      const flattenedExcelItems = getAllItems(allExcelItems);
      console.log(
        `Including ${flattenedExcelItems.length} Excel items for reference (already saved in costData)`
      );
      const response = await confirmCosts({
        projectName: projectName,
        matchedItems: enhancedData,
        allExcelItems: flattenedExcelItems,
      });
      if (response.status === "success") {
        if (onFileUploaded) {
          const fileName = metaFile.file.name;
          const currentDate = new Date().toLocaleString("de-CH");
          const status = "Gespeichert";
          const costData = metaFile.data;
          onFileUploaded(fileName, currentDate, status, costData, true);
        }
      } else {
        console.error(
          "Error saving cost data backend:",
          response.message || "Unknown error"
        );
      }
    } catch (error) {
      console.error("Failed to send cost data batch:", error);
    } finally {
      setIsLoading(false);
      handleClosePreviewInternal();
    }
  };

  const handleFileSelected = async (file: File) => {
    setIsLoading(true);
    setMappingMessage("Excel wird analysiert...");
    setMetaFile(null);
    setMappedItemsCount(0);
    setExpandedRows({});

    try {
      const result = await parseExcelFile(file);
      console.log(
        "Excel parsing complete.",
        result.valid ? "Valid." : "Invalid.",
        `Missing: ${result.missingHeaders?.join(", ")}`
      );

      const initialMetaFile: MetaFile = {
        file: file,
        data: result.data,
        headers: result.headers,
        missingHeaders: result.missingHeaders,
        valid: result.valid,
      };
      setMetaFile(initialMetaFile);
      setMappedItemsCount(0);
      setExpandedRows({});
      if (onFileUploaded && initialMetaFile.data) {
        onFileUploaded(
          initialMetaFile.file.name,
          new Date().toLocaleString("de-CH"),
          "Vorschau",
          initialMetaFile.data,
          false
        );
      }

      setMappingMessage("Excel-Daten werden gespeichert...");
      const costData = Array.isArray(initialMetaFile.data)
        ? initialMetaFile.data
        : initialMetaFile.data.data;

      const getAllItems = (items: CostItem[]): CostItem[] => {
        let result: CostItem[] = [];
        items.forEach((item) => {
          result.push(item);
          if (item.children && item.children.length > 0) {
            result = result.concat(getAllItems(item.children));
          }
        });
        return result;
      };
      const flattenedExcelItems = getAllItems(costData);

      const response = await confirmCosts({
        projectName: projectName,
        excelItems: flattenedExcelItems,
        replaceExisting: true,
      });

      if (response.status !== "success") {
        console.error("Error saving Excel data:", response.message);
        setMappingMessage(
          response.message || "Fehler beim Speichern der Excel-Daten."
        );
        setIsLoading(false);
        return;
      }

      console.log("Excel data saved successfully. Proceeding to UI update.");
      handleQuantitiesMapped(mappedItemsCount);
      setMappingMessage("Excel-Daten verarbeitet. Starte BIM-Abgleich...");
      setIsLoading(false);
    } catch (error) {
      console.error("Error processing file upload:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unbekannter Fehler beim Datei-Upload";
      setMappingMessage(`Fehler: ${errorMessage}`);
      setIsLoading(false);
    }
  };

  const handleQuantitiesMapped = useCallback(
    (mappedCount: number) => {
      console.log(
        `BIM quantities mapped callback received: ${mappedCount} items updated.`
      );
      setMappedItemsCount(mappedCount);
      if (onFileUploaded && metaFile?.data) {
        onFileUploaded(
          metaFile.file.name,
          new Date().toLocaleString("de-CH"),
          "Vorschau",
          metaFile.data,
          false
        );
      }
    },
    [metaFile, onFileUploaded]
  );

  const { totalCost: calculatedTotalCostForPreview } = useCostCalculation(
    metaFile?.data
      ? Array.isArray(metaFile.data)
        ? metaFile.data
        : metaFile.data.data
      : null
  );

  useEffect(() => {
    const handleMappingStatus = (event: BimMappingStatusEvent) => {
      if (event.detail.isMapping) {
        setIsLoading(true);
        setMappingMessage(
          event.detail.message || "BIM Daten werden verarbeitet..."
        );
      } else {
        setIsLoading(false);
      }
    };

    window.addEventListener(
      "bim-mapping-status",
      handleMappingStatus as EventListener
    );

    return () => {
      window.removeEventListener(
        "bim-mapping-status",
        handleMappingStatus as EventListener
      );
    };
  }, []);

  useEffect(() => {
    async function fetchProjects() {
      try {
        await getProjects();
        // ... (handle project data)
      } catch (error) {
        // ... (handle error)
      }
    }
    fetchProjects();
  }, []);

  useEffect(() => {
    if (triggerPreview && !previewOpen && metaFile) {
      console.log("Preview triggered by prop change.");
      handleShowPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerPreview, metaFile]);

  return (
    <Box
      className="flex flex-col h-full"
      position="relative"
      sx={{ overflow: "hidden" }}
    >
      {isLoading && (
        <Box
          position="fixed"
          top={0}
          left={0}
          right={0}
          bottom={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          bgcolor="rgba(255, 255, 255, 0.8)"
          zIndex={1300}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              backgroundColor: "white",
              padding: 3,
              borderRadius: 2,
              boxShadow: 3,
            }}
          >
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="body1" color="primary.main" fontWeight="500">
              {mappingMessage}
            </Typography>
          </Box>
        </Box>
      )}

      <BimMapper
        metaFile={metaFile}
        projectName={projectName}
        onQuantitiesMapped={handleQuantitiesMapped}
        setIsLoading={setIsLoading}
        setMappingMessage={setMappingMessage}
        ifcElements={bimElements}
      />

      {!metaFile ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflow: "hidden",
          }}
        >
          <FileDropzone onFileSelected={handleFileSelected} />
          {elementsComponent}
        </Box>
      ) : (
        <div style={{ height: "100%", overflow: "hidden" }}>
          <div className="flex flex-col h-full">
            <FileInfo
              metaFile={metaFile}
              onRemoveFile={handleRemoveFile}
              onSendData={handleShowPreview}
              mappedItems={mappedItemsCount}
            />
            <HierarchicalTable
              metaFile={metaFile}
              expandedRows={expandedRows}
              toggleRow={toggleRow}
              isMobile={isMobile}
              isLoading={isLoading}
              mappingMessage={mappingMessage}
              totalElements={totalElements}
            />
            <PreviewModal
              open={previewOpen}
              onClose={handleClosePreviewInternal}
              onConfirm={handleConfirmPreview}
              metaFile={metaFile}
              calculatedTotalCost={calculatedTotalCostForPreview}
            />
          </div>
        </div>
      )}
    </Box>
  );
};

export default CostUploader;
