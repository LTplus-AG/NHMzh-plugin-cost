import {
  Typography,
  Button,
  IconButton,
  ListItem,
  ListItemIcon,
  Divider,
  Snackbar,
  Alert,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import { useState, useEffect, useCallback } from "react";
import { Delete as DeleteIcon } from "@mui/icons-material";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { fileSize } from "./utils";
import { MetaFile, CostItem } from "./types";
import SendIcon from "@mui/icons-material/Send";
import { useKafka } from "../../contexts/KafkaContext";
import EbkpMapper from "./EbkpMapper";

// Helper function to get all items from a hierarchical structure
const getAllItems = (items: CostItem[]): CostItem[] => {
  let result: CostItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children && item.children.length > 0) {
      result = result.concat(getAllItems(item.children));
    }
  }
  return result;
};

interface FileInfoProps {
  metaFile: MetaFile;
  onRemoveFile: () => void;
  onSendData: () => void;
}

// Define a type to track code mapping results for diagnostics
interface MappingResult {
  excelCode: string;
  normalizedCode: string;
  foundElements: number;
  totalArea: number;
  status: "success" | "warning" | "error";
  message?: string;
}

const FileInfo = ({ metaFile, onRemoveFile, onSendData }: FileInfoProps) => {
  const {
    connectionStatus,
    sendMessage,
    registerMessageHandler,
    getProjectElements,
  } = useKafka();

  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error" | "info" | "warning";
  }>({
    open: false,
    message: "",
    severity: "info",
  });

  const [mapper, setMapper] = useState<EbkpMapper | null>(null);
  const [mappingStats, setMappingStats] = useState<{
    totalElements: number;
    uniqueCodes: number;
    mappedItems: number;
  }>({
    totalElements: 0,
    uniqueCodes: 0,
    mappedItems: 0,
  });

  // Results of individual code mappings for diagnostics
  const [mappingResults, setMappingResults] = useState<MappingResult[]>([]);

  // Show/hide detailed mapping diagnostic info
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Fixed project name - could be made configurable in the future
  const currentProject = "Recyclingzentrum Juch-Areal";

  // Add a state to track if mapping has been applied
  const [mappingApplied, setMappingApplied] = useState<boolean>(false);

  // Function to request re-application of cost data on the server
  const requestReapplyCostData = useCallback(async () => {
    if (connectionStatus !== "CONNECTED") {
      setNotification({
        open: true,
        message: "Cannot request reapply: Not connected.",
        severity: "warning",
      });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const reapplyMessageId =
        "reapply_" +
        Date.now().toString() +
        Math.random().toString(36).substring(2, 10);

      const reapplyMessage = {
        type: "reapply_costs",
        timestamp: new Date().toISOString(),
        messageId: reapplyMessageId,
      };

      // Register handler with KafkaContext
      registerMessageHandler(reapplyMessageId, (response) => {
        if (response.status === "success") {
          setNotification({
            open: true,
            message: "Server re-applied cost data.",
            severity: "success",
          });
          resolve();
        } else {
          setNotification({
            open: true,
            message: "Error requesting re-apply.",
            severity: "error",
          });
          reject(new Error("Re-apply request failed"));
        }
      });

      try {
        sendMessage(JSON.stringify(reapplyMessage));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }).catch((error) => {
      setNotification({
        open: true,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error sending re-apply request",
        severity: "error",
      });
    });
  }, [connectionStatus, sendMessage, registerMessageHandler]);

  // Define initializeMapper first
  const initializeMapper = useCallback(async () => {
    try {
      // Fetch project elements
      const elements = await getProjectElements(currentProject);

      if (elements.length === 0) {
        setNotification({
          open: true,
          message: `No elements found for project: ${currentProject}`,
          severity: "warning",
        });
        return;
      }

      // Create new mapper
      const newMapper = new EbkpMapper(elements);
      setMapper(newMapper);

      // Get statistics
      const stats = newMapper.getStatistics();
      setMappingStats({
        totalElements: stats.totalElements,
        uniqueCodes: stats.uniqueCodes,
        mappedItems: 0, // Will be updated when metaFile changes
      });
    } catch (error) {
      setNotification({
        open: true,
        message: `Error loading project elements: ${
          error instanceof Error ? error.message : String(error)
        }`,
        severity: "error",
      });
    }
  }, [currentProject, getProjectElements, setNotification]);

  // Function to completely reset the mapper state, with initializeMapper as dependency
  const resetMapperState = useCallback(() => {
    setMapper(null);
    setMappingStats({
      totalElements: 0,
      uniqueCodes: 0,
      mappedItems: 0,
    });
    setMappingResults([]);

    // Force re-initialization on next render if connection is active
    if (connectionStatus === "CONNECTED") {
      // Small timeout to ensure clean reset before reinitialization
      setTimeout(() => {
        initializeMapper();
      }, 100);
    }
  }, [connectionStatus, initializeMapper]);

  // Reset mapper when metaFile changes to null (file deleted)
  useEffect(() => {
    if (!metaFile) {
      resetMapperState();
    }
  }, [metaFile, resetMapperState]);

  // Listen for custom file removal event
  useEffect(() => {
    const handleFileRemoved = () => {
      resetMapperState();
    };

    // Add event listener
    window.addEventListener("cost-file-removed", handleFileRemoved);

    // Clean up on unmount
    return () => {
      window.removeEventListener("cost-file-removed", handleFileRemoved);
    };
  }, [resetMapperState]);

  // Only initialize once
  useEffect(() => {
    if (!mapper && connectionStatus === "CONNECTED") {
      initializeMapper();
    }
  }, [connectionStatus, mapper, initializeMapper]);

  // Effect to map quantities when metaFile or mapper changes
  useEffect(() => {
    // Only process if we have both a mapper and metaFile data
    if (mapper && metaFile && metaFile.data && !mappingApplied) {
      try {
        // Extract cost items from metaFile
        const costItems = Array.isArray(metaFile.data)
          ? metaFile.data
          : metaFile.data.data;

        // Get all items (including children)
        const allItems = getAllItems(costItems);

        if (allItems.length === 0) {
          setNotification({
            open: true,
            message: "No items found in the Excel file",
            severity: "warning",
          });
          return;
        }

        // Check items with eBKP codes
        const itemsWithEbkp = allItems.filter(
          (item) => item.ebkp && item.ebkp !== ""
        );

        if (itemsWithEbkp.length === 0) {
          setNotification({
            open: true,
            message: "No eBKP codes found in the uploaded file",
            severity: "warning",
          });
          setMappingApplied(true); // Mark as applied even though there's nothing to map
          return;
        }

        // Collect mapping results for diagnostics
        const results: MappingResult[] = [];

        // For each item with an eBKP code, check if it can be mapped
        allItems.forEach((item) => {
          if (item.ebkp && item.ebkp !== "") {
            const normalizedCode = mapper.normalizeEbkpCode(item.ebkp);
            const elements = mapper.getElementsForEbkp(item.ebkp);
            const totalArea = mapper.getTotalAreaForEbkp(item.ebkp);

            let status: "success" | "warning" | "error";
            let message = "";

            if (elements.length > 0 && totalArea > 0) {
              status = "success";
              message = `Mapped to ${elements.length} elements`;
            } else if (elements.length > 0) {
              status = "warning";
              message = "Elements found but no area/quantity data";
            } else {
              status = "error";
              message = "No matching elements found";
            }

            results.push({
              excelCode: item.ebkp,
              normalizedCode,
              foundElements: elements.length,
              totalArea,
              status,
              message,
            });
          }
        });

        // Update diagnostics
        setMappingResults(results);

        // Update the file data with quantities
        const updatedItems = mapper.mapQuantitiesToCostItems(costItems);

        // Count items with updated quantities
        const updatedItemsCount = getAllItems(updatedItems).filter(
          (item) => item.menge && item.menge > 0 && item.ebkp
        ).length;

        // Update statistics
        setMappingStats((prev) => ({
          ...prev,
          mappedItems: updatedItemsCount,
        }));

        // Update metaFile with the new data
        if (Array.isArray(metaFile.data)) {
          metaFile.data = updatedItems;
        } else {
          metaFile.data.data = updatedItems;
        }

        // Show notification
        setNotification({
          open: true,
          message: `Successfully mapped ${updatedItemsCount} quantities from BIM model`,
          severity: "success",
        });

        // Request reapply to update the server, but only once
        if (updatedItemsCount > 0) {
          setTimeout(() => {
            requestReapplyCostData().catch(() => {});
          }, 500);
        }

        // Mark as applied to prevent further reapplies
        setMappingApplied(true);
      } catch (error) {
        console.error("Error mapping quantities:", error);
        setNotification({
          open: true,
          message: `Error mapping quantities: ${
            error instanceof Error ? error.message : String(error)
          }`,
          severity: "error",
        });
        setMappingApplied(true); // Mark as applied even on error to prevent constant retries
      }
    }
  }, [mapper, metaFile, requestReapplyCostData, mappingApplied]);

  // Reset mappingApplied when metaFile changes
  useEffect(() => {
    if (metaFile) {
      // Reset the flag when a new file is uploaded
      setMappingApplied(false);
    }
  }, [metaFile?.file]); // Only dependency is the file object itself

  const handleCloseNotification = (
    _event?: React.SyntheticEvent | Event,
    reason?: string
  ) => {
    if (reason === "clickaway") {
      return;
    }
    setNotification({ ...notification, open: false });
  };

  // Display statistics about the mapping
  const renderMappingStatus = () => {
    if (mappingStats.totalElements > 0) {
      return (
        <div>
          <Typography variant="body2" sx={{ color: "green", mt: 1 }}>
            {mappingStats.uniqueCodes} unique eBKP codes available
          </Typography>
          {mappingStats.mappedItems > 0 && (
            <Typography variant="body2" sx={{ color: "green" }}>
              {mappingStats.mappedItems} items updated with BIM quantities
            </Typography>
          )}
          <Button
            size="small"
            variant="text"
            color="primary"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
          >
            {showDiagnostics ? "Hide Diagnostics" : "Show Diagnostics"}
          </Button>
        </div>
      );
    }
    return null;
  };

  // Display mapping diagnostics
  const renderDiagnostics = () => {
    if (!showDiagnostics || mappingResults.length === 0) return null;

    return (
      <Box sx={{ mt: 2, mb: 2 }}>
        <Typography variant="h6">eBKP Mapping Diagnostics</Typography>
        <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Excel Code</TableCell>
                <TableCell>Normalized</TableCell>
                <TableCell align="right">Elements</TableCell>
                <TableCell align="right">Area (m²)</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappingResults.map((result, index) => (
                <TableRow
                  key={index}
                  sx={{
                    backgroundColor:
                      result.status === "error"
                        ? "#ffebee"
                        : result.status === "warning"
                        ? "#fff8e1"
                        : "inherit",
                  }}
                >
                  <TableCell>{result.excelCode}</TableCell>
                  <TableCell>{result.normalizedCode}</TableCell>
                  <TableCell align="right">{result.foundElements}</TableCell>
                  <TableCell align="right">
                    {result.totalArea.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Typography
                      color={
                        result.status === "error"
                          ? "error"
                          : result.status === "warning"
                          ? "warning.main"
                          : "success.main"
                      }
                    >
                      {result.message}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  };

  return (
    <>
      <ListItem sx={{ mt: 4 }}>
        <ListItemIcon>
          <InsertDriveFileIcon color="primary" />
        </ListItemIcon>
        <div className="flex-grow">
          <Typography sx={{ color: "#666" }}>{metaFile.file.name}</Typography>
          <Typography variant="body2" sx={{ color: "#888" }} className="pb-2">
            {fileSize(metaFile.file.size || 0)}
          </Typography>
          {renderMappingStatus()}
        </div>
        <ListItemIcon className="flex gap-6">
          <IconButton edge="end" onClick={onRemoveFile}>
            <DeleteIcon />
          </IconButton>
          <Button
            variant="contained"
            color="primary"
            sx={{ minWidth: "180px" }}
            onClick={onSendData}
            startIcon={<SendIcon />}
          >
            Vorschau anzeigen
          </Button>
        </ListItemIcon>
      </ListItem>

      {renderDiagnostics()}

      <Divider sx={{ my: 2 }} />

      <Typography
        variant="h5"
        className="mb-4"
        sx={{ color: "#000", fontWeight: 500 }}
      >
        Kostenübersicht
      </Typography>

      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={handleCloseNotification}
      >
        <Alert
          onClose={handleCloseNotification}
          severity={notification.severity}
          sx={{ width: "100%" }}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default FileInfo;
