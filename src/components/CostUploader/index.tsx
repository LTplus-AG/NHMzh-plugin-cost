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

// Define the WebSocket response interfaces
interface BatchResponseData {
  type: string;
  messageId: string;
  status: "success" | "error";
  message?: string;
  insertedCount?: number;
  result?: {
    excelItemsInserted: number;
    matchedItemsProcessed: number;
    qtoElementsUpdated: number;
  };
}

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
  calculatedTotalCost: number;
  elementsComponent?: ReactNode;
  projectName: string;
  triggerPreview?: boolean;
  onPreviewClosed?: () => void;
}

const CostUploader = ({
  onFileUploaded,
  totalElements,
  calculatedTotalCost,
  elementsComponent,
  projectName,
  triggerPreview,
  onPreviewClosed,
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
      let ws = (window as { ws?: WebSocket }).ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected, trying to reconnect");
        try {
          const wsUrl: string =
            (window as { VITE_WEBSOCKET_URL?: string }).VITE_WEBSOCKET_URL ||
            import.meta.env.VITE_WEBSOCKET_URL ||
            "ws://localhost:8001";
          ws = new WebSocket(wsUrl);
          (window as { ws?: WebSocket }).ws = ws;
          await new Promise((resolve, reject) => {
            if (ws) {
              ws.onopen = resolve;
              ws.onerror = reject;
              setTimeout(() => reject(new Error("WS connect timeout")), 5000);
            } else {
              reject(new Error("WebSocket is undefined"));
            }
          });
        } catch (error) {
          console.error("Failed to connect to WebSocket:", error);
          throw new Error("WebSocket connection failed");
        }
      }
      const messageId = `batch_${Date.now()}${Math.random()
        .toString(36)
        .substring(2, 7)}`;
      const message = {
        type: "save_cost_batch_full",
        messageId,
        payload: {
          projectName,
          matchedItems: enhancedData,
          allExcelItems: flattenedExcelItems,
        },
      };
      ws.send(JSON.stringify(message));
      console.log(`Full cost batch sent to server for project ${projectName}`);
      const response: BatchResponseData = await new Promise(
        (resolve, reject) => {
          const responseHandler = (event: MessageEvent) => {
            try {
              const responseData: BatchResponseData = JSON.parse(event.data);
              if (
                responseData.type === "save_cost_batch_full_response" &&
                responseData.messageId === messageId
              ) {
                ws?.removeEventListener("message", responseHandler);
                clearTimeout(timeoutId);
                resolve(responseData);
              }
            } catch {
              /* Ignore */
            }
          };
          ws?.addEventListener("message", responseHandler);
          const timeoutId = setTimeout(() => {
            ws?.removeEventListener("message", responseHandler);
            reject(
              new Error("Timeout waiting for save_cost_batch_full_response")
            );
          }, 30000);
          ws?.addEventListener("close", () => clearTimeout(timeoutId), {
            once: true,
          });
        }
      );
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

      const currentMetaFile: MetaFile = {
        file: file,
        data: result.data,
        headers: result.headers,
        missingHeaders: result.missingHeaders,
        valid: result.valid,
      };

      if (!currentMetaFile.valid) {
        console.error("Excel file is invalid or missing headers.");
        setMetaFile(currentMetaFile);
        setIsLoading(false);
        return;
      }

      setMappingMessage("Excel-Daten werden gespeichert...");
      const costData = Array.isArray(currentMetaFile.data)
        ? currentMetaFile.data
        : currentMetaFile.data.data;

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

      let ws = (window as { ws?: WebSocket }).ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(
          "WebSocket not connected for Excel save, trying to reconnect"
        );
        try {
          const wsUrl: string =
            (window as { VITE_WEBSOCKET_URL?: string }).VITE_WEBSOCKET_URL ||
            import.meta.env.VITE_WEBSOCKET_URL ||
            "ws://localhost:8001";
          ws = new WebSocket(wsUrl);
          (window as { ws?: WebSocket }).ws = ws;
          await new Promise((resolve, reject) => {
            if (ws) {
              ws.onopen = resolve;
              ws.onerror = reject;
              setTimeout(() => reject(new Error("WS connect timeout")), 5000);
            } else {
              reject(new Error("WebSocket is undefined"));
            }
          });
        } catch (error) {
          console.error("Failed to connect WebSocket for Excel save:", error);
          throw new Error("WebSocket connection failed for Excel save");
        }
      }

      const messageId = `upload_${Date.now()}${Math.random()
        .toString(36)
        .substring(2, 7)}`;
      const message = {
        type: "save_excel_data",
        messageId,
        payload: {
          projectName,
          excelItems: flattenedExcelItems,
          replaceExisting: true,
        },
      };

      console.log(
        `Sending save_excel_data message (ID: ${messageId}) for replace`
      );
      ws.send(JSON.stringify(message));

      const response = await new Promise<{ status: string; message: string }>(
        (resolve, reject) => {
          const responseHandler = (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data);
              if (
                data.type === "save_excel_data_response" &&
                data.messageId === messageId
              ) {
                console.log(
                  `Received save_excel_data_response (ID: ${messageId}):`,
                  data
                );
                ws?.removeEventListener("message", responseHandler);
                clearTimeout(timeoutId);
                resolve(data);
              }
            } catch {
              /* Ignore */
            }
          };
          ws?.addEventListener("message", responseHandler);
          const timeoutId = setTimeout(() => {
            ws?.removeEventListener("message", responseHandler);
            reject(new Error("Timeout waiting for save_excel_data_response"));
          }, 15000);
          ws?.addEventListener("close", () => clearTimeout(timeoutId), {
            once: true,
          });
        }
      );

      if (response.status !== "success") {
        console.error("Error saving Excel data:", response.message);
        setIsLoading(false);
        return;
      }

      console.log("Excel data saved successfully. Proceeding to UI update.");
      handleFileProcessed(currentMetaFile);
    } catch (error) {
      console.error("Error processing file upload:", error);
      setIsLoading(false);
    }
  };

  const handleFileProcessed = (processedMetaFile: MetaFile) => {
    setMetaFile(processedMetaFile);
    setMappedItemsCount(0);
    setExpandedRows({});
    if (onFileUploaded && processedMetaFile.data) {
      const fileName = processedMetaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Vorschau";
      const costData = processedMetaFile.data;
      onFileUploaded(fileName, currentDate, status, costData, false);
      console.log("Called parent onFileUploaded callback with preview status.");
    } else {
      console.log("Parent onFileUploaded callback skipped.");
    }
  };

  const handleQuantitiesMapped = useCallback((count: number) => {
    console.log(
      `BIM quantities mapped callback received: ${count} items updated`
    );
    setMappedItemsCount(count);
  }, []);

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
              calculatedTotalCost={calculatedTotalCost}
            />
          </div>
        </div>
      )}
    </Box>
  );
};

export default CostUploader;
