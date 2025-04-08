import { useState, useEffect, ReactNode, useCallback } from "react";
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
    costData?: CostItem[],
    isUpdate?: boolean
  ) => void;
  totalElements: number;
  totalCost: number;
  elementsComponent?: ReactNode;
  projectName: string;
  triggerPreview?: boolean;
  onPreviewClosed?: () => void;
}

const CostUploader = ({
  onFileUploaded,
  totalElements,
  totalCost,
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

  // Add state to track the number of mapped items
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
          const wsUrl =
            import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8001";

          ws = new WebSocket(wsUrl);
          (window as { ws?: WebSocket }).ws = ws;
          await new Promise((resolve, reject) => {
            if (ws) {
              ws.onopen = resolve;
              ws.onerror = reject;
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
              const response: BatchResponseData = JSON.parse(event.data);

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

          ws.addEventListener("message", responseHandler);

          const timeoutId = setTimeout(() => {
            ws.removeEventListener("message", responseHandler);
            reject(
              new Error("Timeout waiting for save_cost_batch_full_response")
            );
          }, 30000);

          const closeHandler = () => {
            ws.removeEventListener("message", responseHandler);
            clearTimeout(timeoutId);
            reject(new Error("WebSocket connection closed"));
          };
          ws.addEventListener("close", closeHandler, { once: true });

          Promise.resolve().then(() => {
            ws.removeEventListener("close", closeHandler);
          });
        }
      );

      if (response.status === "success") {
        if (onFileUploaded) {
          const fileName = metaFile.file.name;
          const currentDate = new Date().toLocaleString("de-CH");
          const status = "Gespeichert";

          const costData = Array.isArray(metaFile.data)
            ? metaFile.data
            : metaFile.data.data;

          onFileUploaded(fileName, currentDate, status, costData, true);
        }
      } else {
        console.error(
          "Error saving cost data to backend:",
          response.message || "Unknown error"
        );
        // TODO: Add user-facing error feedback
      }
    } catch (error) {
      console.error("Failed to send cost data batch:", error);
      // TODO: Add user-facing error feedback
    } finally {
      setIsLoading(false);
      handleClosePreviewInternal();
    }
  };

  const handleFileUploaded = async (newMetaFile: MetaFile) => {
    setMetaFile(newMetaFile);
    setIsLoading(true);
    setMappingMessage("Excel Daten werden gespeichert...");
    console.log("handleFileUploaded started");

    try {
      const costData = Array.isArray(newMetaFile.data)
        ? newMetaFile.data
        : newMetaFile.data.data;

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
      console.log("Excel data flattened");

      let ws: WebSocket | undefined;
      const customWindow = window as unknown as {
        ws?: WebSocket;
        VITE_WEBSOCKET_URL?: string;
      };

      if (customWindow.ws && customWindow.ws.readyState === WebSocket.OPEN) {
        ws = customWindow.ws;
        console.log("Reusing existing WebSocket connection");
      } else {
        console.log(
          "No existing WebSocket connection found or connection not open. Attempting to create new connection."
        );
        let wsUrl = "ws://localhost:8001";
        if (customWindow.VITE_WEBSOCKET_URL) {
          wsUrl = customWindow.VITE_WEBSOCKET_URL;
          console.log(`Using WebSocket URL from window: ${wsUrl}`);
        } else if (import.meta.env.VITE_WEBSOCKET_URL) {
          wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
          console.log(`Using WebSocket URL from env: ${wsUrl}`);
        } else {
          console.log(`Using default WebSocket URL: ${wsUrl}`);
        }

        try {
          ws = new WebSocket(wsUrl);
          customWindow.ws = ws;
          console.log("New WebSocket object created");

          await new Promise<void>((resolve, reject) => {
            console.log("Waiting for WebSocket connection to open...");
            const onOpen = () => {
              console.log("WebSocket connection opened successfully");
              ws?.removeEventListener("open", onOpen);
              ws?.removeEventListener("error", onError);
              resolve();
            };

            const onError = (event: Event) => {
              console.error("WebSocket connection error:", event);
              ws?.removeEventListener("open", onOpen);
              ws?.removeEventListener("error", onError);
              reject(new Error("WebSocket connection failed"));
            };

            ws?.addEventListener("open", onOpen);
            ws?.addEventListener("error", onError);

            const timeoutId = setTimeout(() => {
              console.error("WebSocket connection timed out after 5 seconds");
              ws?.removeEventListener("open", onOpen);
              ws?.removeEventListener("error", onError);
              reject(new Error("WebSocket connection timeout"));
            }, 5000);

            ws?.addEventListener("open", () => clearTimeout(timeoutId), {
              once: true,
            });
            ws?.addEventListener("error", () => clearTimeout(timeoutId), {
              once: true,
            });
          });
        } catch (connectionError) {
          console.error(
            "Failed to establish WebSocket connection:",
            connectionError
          );
          setIsLoading(false);
          return;
        }
      }

      if (!ws) {
        console.error(
          "WebSocket connection is not available after attempting to establish."
        );
        setIsLoading(false);
        return;
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
          replaceExisting: false,
        },
      };

      console.log(
        `Attempting to send save_excel_data message (ID: ${messageId}) for update/insert`
      );
      try {
        ws.send(JSON.stringify(message));
        console.log(`Sent save_excel_data message (ID: ${messageId})`);
      } catch (sendError) {
        console.error(
          `Error sending save_excel_data message (ID: ${messageId}):`,
          sendError
        );
        setIsLoading(false);
        return;
      }

      console.log(`Waiting for save_excel_data_response (ID: ${messageId})...`);
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
              console.log(
                `Received save_excel_data_response (ID: ${messageId}):`,
                data
              );
              ws?.removeEventListener("message", responseHandler);
              clearTimeout(timeoutId);
              resolve(data);
            }
          } catch (parseError) {
            console.warn(
              "Ignoring WebSocket message parse error:",
              parseError,
              "Data:",
              event.data
            );
          }
        };
        ws?.addEventListener("message", responseHandler);

        const timeoutId = setTimeout(() => {
          console.error(
            `Timeout waiting for save_excel_data_response (ID: ${messageId}) after 10 seconds`
          );
          ws?.removeEventListener("message", responseHandler);
          reject(new Error("Timeout waiting for save_excel_data_response"));
        }, 10000);

        const closeHandler = () => {
          console.warn(
            `WebSocket closed while waiting for save_excel_data_response (ID: ${messageId})`
          );
          ws?.removeEventListener("message", responseHandler);
          clearTimeout(timeoutId);
          reject(
            new Error("WebSocket connection closed while waiting for response")
          );
        };
        ws?.addEventListener("close", closeHandler, { once: true });

        Promise.resolve().finally(() => {
          ws?.removeEventListener("close", closeHandler);
        });
      });

      if (response.status !== "success") {
        console.error(
          `Error saving Excel data (ID: ${messageId}):`,
          response.message
        );
      } else {
        console.log(
          `Successfully saved Excel data (ID: ${messageId}). Count: ${response.insertedCount}`
        );
      }
    } catch (error) {
      console.error("Error during handleFileUploaded process:", error);
    } finally {
      console.log("handleFileUploaded finished, setting isLoading to false.");
      setIsLoading(false);
    }

    if (onFileUploaded && newMetaFile.data) {
      console.log("Calling onFileUploaded callback for parent component.");
      const fileName = newMetaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Vorschau";

      const costData = Array.isArray(newMetaFile.data)
        ? newMetaFile.data
        : newMetaFile.data.data;

      onFileUploaded(fileName, currentDate, status, costData, false);
    } else {
      console.log(
        "Skipping onFileUploaded callback (no callback function or no data)."
      );
    }
  };

  const handleQuantitiesMapped = useCallback((count: number) => {
    console.log(`BIM mapper updated ${count} items with quantities`);

    // Store the count in state
    setMappedItemsCount(count);

    if (count > 0) {
      setMappingMessage(`${count} Mengen aus BIM-Modell aktualisiert`);
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
      }, 1500);
    }
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
          <FileDropzone
            onFileUploaded={handleFileUploaded}
            setIsLoading={setIsLoading}
          />
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
              totalCost={totalCost}
            />
          </div>
        </div>
      )}
    </Box>
  );
};

export default CostUploader;
