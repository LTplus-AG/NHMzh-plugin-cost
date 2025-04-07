import { useState, useEffect, ReactNode } from "react";
import {
  Box,
  CircularProgress,
  useMediaQuery,
  useTheme,
  Typography,
} from "@mui/material";
import { MetaFile, CostItem } from "./types";
import FileDropzone from "./FileDropzone";
import FileInfo from "./FileInfo";
import HierarchicalTable from "./HierarchicalTable";
import PreviewModal, { EnhancedCostItem } from "./PreviewModal";

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
    fileName: string,
    date?: string,
    status?: string,
    costData?: CostItem[],
    isUpdate?: boolean
  ) => void;
  totalElements: number;
  totalCost: number;
  elementsComponent?: ReactNode;
  projectName: string;
}

const CostUploader = ({
  onFileUploaded,
  totalElements,
  totalCost,
  elementsComponent,
  projectName,
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

  const toggleRow = (code: string) => {
    setExpandedRows((prev: Record<string, boolean>) => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  const handleRemoveFile = () => {
    // If there was a file and it was passed to the parent, notify that it's being removed
    if (metaFile && onFileUploaded) {
      // Keep the same filename but pass null data to indicate removal
      const fileName = metaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Gelöscht";
      console.log(`Removing file: ${fileName}`);
      onFileUploaded(fileName, currentDate, status, [], false);
    }

    // Reset all state related to the file
    setMetaFile(null);
    setExpandedRows({});
    setPreviewOpen(false);

    // Dispatch a custom event to notify other components about file removal
    // This will help ensure proper resetting of state in the FileInfo component
    const resetEvent = new CustomEvent("cost-file-removed", {
      detail: { timestamp: Date.now() },
    });
    window.dispatchEvent(resetEvent);

    // Add a small delay before allowing new file upload to ensure clean state
    setIsLoading(true);
    setTimeout(() => {
      console.log("File removal complete, state reset");
      setIsLoading(false);
    }, 300);
  };

  const handleShowPreview = () => {
    setPreviewOpen(true);
  };

  const handleConfirmPreview = async (enhancedData: EnhancedCostItem[]) => {
    // Ensure we have data to send
    if (!metaFile || !enhancedData || enhancedData.length === 0) {
      console.warn("No enhanced data to send to backend.");
      setPreviewOpen(false); // Close preview even if nothing sent
      return;
    }

    setIsLoading(true);
    setMappingMessage("Kostendaten werden gespeichert...");

    try {
      console.log(
        `Sending ${enhancedData.length} matched QTO elements to update costElements (Excel data already saved in costData)`
      );

      // Extract all Excel items from metaFile
      const allExcelItems = metaFile
        ? Array.isArray(metaFile.data)
          ? metaFile.data
          : metaFile.data.data
        : [];

      // Flatten the hierarchical data to get all Excel items
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

      // Use the sendCostBatchToServer alternative:
      // Create a WebSocket if it doesn't exist
      let ws = (window as { ws?: WebSocket }).ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected, trying to reconnect");
        // Try to reconnect
        try {
          // Use environment variable for WebSocket URL, provide a default if not set
          const wsUrl =
            import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8001";

          ws = new WebSocket(wsUrl);
          (window as { ws?: WebSocket }).ws = ws;
          // Wait for connection
          await new Promise((resolve, reject) => {
            if (ws) {
              ws.onopen = resolve;
              ws.onerror = reject;
              // Set timeout
              setTimeout(
                () => reject(new Error("WebSocket connection timeout")),
                5000
              );
            } else {
              reject(new Error("WebSocket is undefined"));
            }
          });
        } catch (error) {
          console.error("Failed to connect to WebSocket:", error);
          throw new Error("WebSocket connection failed");
        }
      }

      // Create a unique message ID
      const messageId = `batch_${Date.now()}${Math.random()
        .toString(36)
        .substring(2, 7)}`;

      // Prepare the message with both matched items and all Excel data
      const message = {
        type: "save_cost_batch_full", // Use the new message type
        messageId,
        payload: {
          projectName,
          matchedItems: enhancedData,
          allExcelItems: flattenedExcelItems,
        },
      };

      // Send the message
      ws.send(JSON.stringify(message));
      console.log(`Full cost batch sent to server for project ${projectName}`);

      // Wait for response with promise
      const response: BatchResponseData = await new Promise(
        (resolve, reject) => {
          const responseHandler = (event: MessageEvent) => {
            try {
              const response: BatchResponseData = JSON.parse(event.data);

              // Check if this is the response for our message
              if (
                response.type === "save_cost_batch_full_response" &&
                response.messageId === messageId
              ) {
                ws.removeEventListener("message", responseHandler);
                clearTimeout(timeoutId);
                resolve(response);
              }
            } catch {
              // Ignore parse errors from other messages
            }
          };

          // Add the event listener
          ws.addEventListener("message", responseHandler);

          // Set a timeout
          const timeoutId = setTimeout(() => {
            ws.removeEventListener("message", responseHandler);
            reject(
              new Error("Timeout waiting for save_cost_batch_full_response")
            );
          }, 30000);

          // Handle WebSocket close
          const closeHandler = () => {
            ws.removeEventListener("message", responseHandler);
            clearTimeout(timeoutId);
            reject(new Error("WebSocket connection closed"));
          };
          ws.addEventListener("close", closeHandler, { once: true });

          // Clean up the close handler when promise resolves
          Promise.resolve().then(() => {
            ws.removeEventListener("close", closeHandler);
          });
        }
      );

      if (response.status === "success") {
        // Notify parent component (MainPage) about the successful update
        if (onFileUploaded) {
          const fileName = metaFile.file.name;
          const currentDate = new Date().toLocaleString("de-CH");
          const status = "Gespeichert"; // Update status to indicate successful save

          // Get original cost data if needed (or pass enhancedData)
          const costData = Array.isArray(metaFile.data)
            ? metaFile.data
            : metaFile.data.data;

          onFileUploaded(fileName, currentDate, status, costData, true);
        }
      } else {
        // Handle error from backend
        console.error(
          "Error saving cost data to backend:",
          response.message || "Unknown error"
        );
        // Optionally: show an error message to the user
        // TODO: Add user-facing error feedback
      }
    } catch (error) {
      console.error("Failed to send cost data batch:", error);
      // Optionally: show an error message to the user
      // TODO: Add user-facing error feedback
    } finally {
      setIsLoading(false);
      setPreviewOpen(false); // Close the modal regardless of success/failure
    }
  };

  const handleFileUploaded = async (newMetaFile: MetaFile) => {
    setMetaFile(newMetaFile);
    setIsLoading(true);
    setMappingMessage("Excel Daten werden gespeichert...");

    try {
      // Extract data array based on format
      const costData = Array.isArray(newMetaFile.data)
        ? newMetaFile.data
        : newMetaFile.data.data;

      // Flatten the hierarchical data to get all Excel items
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

      // Create flattened Excel items from the hierarchical data
      const flattenedExcelItems = getAllItems(costData);

      // Create or get a WebSocket connection
      let ws: WebSocket;
      const customWindow = window as unknown as {
        ws?: WebSocket;
        VITE_WEBSOCKET_URL?: string;
      };

      if (customWindow.ws && customWindow.ws.readyState === WebSocket.OPEN) {
        ws = customWindow.ws;
      } else {
        // Try to create a new connection
        let wsUrl = "ws://localhost:8001";
        if (customWindow.VITE_WEBSOCKET_URL) {
          wsUrl = customWindow.VITE_WEBSOCKET_URL;
        } else if (import.meta.env.VITE_WEBSOCKET_URL) {
          wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
        }

        ws = new WebSocket(wsUrl);
        customWindow.ws = ws;

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
          const onOpen = () => {
            ws.removeEventListener("open", onOpen);
            ws.removeEventListener("error", onError);
            resolve();
          };

          const onError = () => {
            ws.removeEventListener("open", onOpen);
            ws.removeEventListener("error", onError);
            reject(new Error("WebSocket connection failed"));
          };

          ws.addEventListener("open", onOpen);
          ws.addEventListener("error", onError);

          // Set timeout
          setTimeout(() => {
            ws.removeEventListener("open", onOpen);
            ws.removeEventListener("error", onError);
            reject(new Error("WebSocket connection timeout"));
          }, 5000);
        });
      }

      // First send a delete message to remove existing data for this project
      const deleteMessageId = `delete_${Date.now()}${Math.random()
        .toString(36)
        .substring(2, 7)}`;

      // Send delete message - this will clear existing data
      const deleteMessage = {
        type: "delete_project_data",
        messageId: deleteMessageId,
        payload: {
          projectName,
        },
      };

      ws.send(JSON.stringify(deleteMessage));
      console.log(
        `Sent delete request for existing project data: ${projectName}`
      );

      // Wait briefly to ensure delete completes
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Create a unique message ID
      const messageId = `upload_${Date.now()}${Math.random()
        .toString(36)
        .substring(2, 7)}`;

      // Send the Excel data to the server immediately
      const message = {
        type: "save_excel_data",
        messageId,
        payload: {
          projectName,
          excelItems: flattenedExcelItems,
          replaceExisting: true, // Add this flag to ensure it replaces existing data
        },
      };

      ws.send(JSON.stringify(message));

      // Wait for server response
      const response = await new Promise<{
        status: string;
        message: string;
        insertedCount: number;
      }>((resolve, reject) => {
        const responseHandler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);

            if (
              data.type === "save_excel_data_response" &&
              data.messageId === messageId
            ) {
              ws.removeEventListener("message", responseHandler);
              clearTimeout(timeoutId);
              resolve(data);
            }
          } catch {
            // Ignore parse errors from other messages
          }
        };
        ws.addEventListener("message", responseHandler);

        const timeoutId = setTimeout(() => {
          ws.removeEventListener("message", responseHandler);
          reject(new Error("Timeout waiting for save_excel_data_response"));
        }, 10000);
      });

      if (response.status !== "success") {
        console.error("Error saving Excel data:", response.message);
      }
    } catch (error) {
      console.error("Error uploading Excel data:", error);
    } finally {
      setIsLoading(false);
    }

    // Pass the cost data to the parent component
    if (onFileUploaded && newMetaFile.data) {
      const fileName = newMetaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Vorschau";

      // Extract data array based on format
      const costData = Array.isArray(newMetaFile.data)
        ? newMetaFile.data
        : newMetaFile.data.data;

      onFileUploaded(fileName, currentDate, status, costData);
    }
  };

  // Add event listener for BIM mapping status
  useEffect(() => {
    const handleMappingStatus = (event: BimMappingStatusEvent) => {
      // Update both loading state and message
      if (event.detail.isMapping) {
        setIsLoading(true);
        setMappingMessage(
          event.detail.message || "BIM Daten werden verarbeitet..."
        );
      } else {
        setIsLoading(false);
      }
    };

    // Add event listener
    window.addEventListener(
      "bim-mapping-status",
      handleMappingStatus as EventListener
    );

    // Clean up
    return () => {
      window.removeEventListener(
        "bim-mapping-status",
        handleMappingStatus as EventListener
      );
    };
  }, []);

  return (
    <Box
      className="flex flex-col h-full"
      position="relative"
      sx={{ overflow: "hidden" }}
    >
      {/* Single Loading Indicator */}
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

      {!metaFile ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflow: "hidden",
          }}
        >
          <FileDropzone
            onFileUploaded={handleFileUploaded}
            setIsLoading={setIsLoading}
          />
          {/* Render the elements component below the dropzone with flex: 1 to expand */}
          {elementsComponent}
        </Box>
      ) : (
        <div style={{ height: "100%", overflow: "hidden" }}>
          <div className="flex flex-col h-full">
            <FileInfo
              metaFile={metaFile}
              onRemoveFile={handleRemoveFile}
              onSendData={handleShowPreview}
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

            {/* Preview Modal */}
            <PreviewModal
              open={previewOpen}
              onClose={() => setPreviewOpen(false)}
              onConfirm={handleConfirmPreview}
              metaFile={metaFile}
              totalCost={totalCost}
            />
          </div>
        </div>
      )}
    </Box>
  );
};

export default CostUploader;
