import { useEffect, useState, useCallback, useRef } from "react";
import { MetaFile, CostItem } from "./types";
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

interface BimMapperProps {
  metaFile: MetaFile | null;
  projectName: string;
  onQuantitiesMapped?: (updatedCount: number) => void;
}

/**
 * Component that handles mapping BIM quantities to Excel data
 * This is separated from UI components to keep proper separation of concerns
 */
const BimMapper = ({
  metaFile,
  projectName,
  onQuantitiesMapped,
}: BimMapperProps) => {
  const {
    connectionStatus,
    sendMessage,
    registerMessageHandler,
    getProjectElements,
  } = useKafka();

  const [mapper, setMapper] = useState<EbkpMapper | null>(null);

  // Track current file to avoid re-processing the same file
  const currentFileRef = useRef<string | null>(null);
  // Flag to track if we've already sent data to server for this file
  const dataSubmittedRef = useRef<boolean>(false);
  // Flag to track if quantities have been mapped for this file
  const quantitiesMappedRef = useRef<boolean>(false);

  // Function to request re-application of cost data on the server
  const requestReapplyCostData = useCallback(async () => {
    // Avoid duplicate server updates for the same file
    if (dataSubmittedRef.current) {
      console.log(
        "Data already submitted to server for this file, skipping update"
      );
      return false;
    }

    if (connectionStatus !== "CONNECTED") {
      console.warn("Cannot request reapply: WebSocket not connected");
      return false;
    }

    try {
      const reapplyMessageId = `reapply_${Date.now()}${Math.random()
        .toString(36)
        .substring(2, 10)}`;

      const reapplyMessage = {
        type: "reapply_costs",
        timestamp: new Date().toISOString(),
        messageId: reapplyMessageId,
        projectName, // Include project name for clarity
      };

      console.log(
        `Sending one-time reapply request for project ${projectName}`
      );

      await new Promise<void>((resolve, reject) => {
        // Register handler with KafkaContext
        registerMessageHandler(reapplyMessageId, (response) => {
          if (response.status === "success") {
            console.log("Server re-applied cost data successfully");
            // Mark that we've submitted data for this file
            dataSubmittedRef.current = true;
            resolve();
          } else {
            console.error("Error re-applying cost data:", response.message);
            reject(new Error("Re-apply request failed"));
          }
        });

        try {
          sendMessage(JSON.stringify(reapplyMessage));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      return true;
    } catch (error) {
      console.error("Error in requestReapplyCostData:", error);
      return false;
    }
  }, [connectionStatus, sendMessage, registerMessageHandler, projectName]);

  // Initialize the mapper
  const initializeMapper = useCallback(async () => {
    if (!projectName) {
      console.warn("Cannot initialize mapper: Project name is empty");
      return;
    }

    try {
      console.log(`Initializing mapper for project: ${projectName}`);
      // Fetch project elements
      const elements = await getProjectElements(projectName);

      if (elements.length === 0) {
        console.warn(`No elements found for project: ${projectName}`);
        return;
      }

      console.log(
        `Loaded ${elements.length} elements for project ${projectName}`
      );

      // Create new mapper
      const newMapper = new EbkpMapper(elements);
      setMapper(newMapper);

      // Get statistics
      const stats = newMapper.getStatistics();
      console.log(
        `BIM data loaded: ${stats.totalElements} elements, ${stats.uniqueCodes} unique eBKP codes`
      );
    } catch (error) {
      console.error(
        `Error loading project elements: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }, [projectName, getProjectElements]);

  // Function to reset the mapper state
  const resetMapperState = useCallback(() => {
    setMapper(null);
    currentFileRef.current = null;
    dataSubmittedRef.current = false;
    quantitiesMappedRef.current = false;
    console.log("BIM mapper state reset");
  }, []);

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

  // Initialize mapper once on connection
  useEffect(() => {
    if (!mapper && connectionStatus === "CONNECTED") {
      initializeMapper();
    }
  }, [connectionStatus, mapper, initializeMapper]);

  // Effect to map quantities when a new file is loaded
  useEffect(() => {
    // Only process if we have both a mapper and metaFile data
    // And only if we haven't already mapped quantities for this file
    const fileName = metaFile?.file?.name || null;

    if (!mapper || !metaFile || !metaFile.data) {
      return;
    }

    // Check if we're dealing with a new file
    const isNewFile = fileName !== currentFileRef.current;

    // Only proceed if this is a new file or we haven't mapped quantities yet
    if (!isNewFile && quantitiesMappedRef.current) {
      return;
    }

    // Update current file reference
    currentFileRef.current = fileName;

    try {
      console.log(`Processing file: ${fileName || "unknown"}`);

      // Extract cost items from metaFile
      const costItems = Array.isArray(metaFile.data)
        ? metaFile.data
        : metaFile.data.data;

      // Get all items (including children)
      const allItems = getAllItems(costItems);

      if (allItems.length === 0) {
        console.warn("No items found in the Excel file");
        quantitiesMappedRef.current = true; // Mark as processed to avoid repeated attempts
        return;
      }

      // Check items with eBKP codes
      const itemsWithEbkp = allItems.filter(
        (item) => item.ebkp && item.ebkp !== ""
      );

      if (itemsWithEbkp.length === 0) {
        console.warn("No eBKP codes found in the uploaded file");
        quantitiesMappedRef.current = true;
        return;
      }

      console.log(
        `Found ${itemsWithEbkp.length} items with eBKP codes in Excel data`
      );

      // Update the file data with quantities
      const updatedItems = mapper.mapQuantitiesToCostItems(costItems);

      // Count items with updated quantities
      const updatedItemsCount = getAllItems(updatedItems).filter(
        (item) => item.menge && item.menge > 0 && item.ebkp
      ).length;

      console.log(
        `Updated ${updatedItemsCount} items with quantities from BIM model`
      );

      // Update metaFile with the new data
      if (Array.isArray(metaFile.data)) {
        metaFile.data = updatedItems;
      } else {
        metaFile.data.data = updatedItems;
      }

      // Call callback if provided
      if (onQuantitiesMapped) {
        onQuantitiesMapped(updatedItemsCount);
      }

      // Request reapply to update the server, but only once per file and only if we have updates
      if (updatedItemsCount > 0 && !dataSubmittedRef.current) {
        setTimeout(() => {
          requestReapplyCostData().catch(() => {});
        }, 500);
      }

      // Mark as processed to prevent further mapping
      quantitiesMappedRef.current = true;
    } catch (error) {
      console.error("Error mapping quantities:", error);
      quantitiesMappedRef.current = true; // Make sure we don't retry on error
    }
  }, [mapper, metaFile, onQuantitiesMapped, requestReapplyCostData]);

  // Reset state when metaFile changes to a new file
  useEffect(() => {
    if (metaFile?.file) {
      const newFileName = metaFile.file.name;

      // Only reset state if the file actually changed
      if (currentFileRef.current !== newFileName) {
        console.log(
          `New file detected (${newFileName}), resetting mapping state`
        );
        quantitiesMappedRef.current = false;
        dataSubmittedRef.current = false;
        currentFileRef.current = newFileName;
      }
    }
  }, [metaFile?.file?.name]); // Only dependency is the file name itself

  // This component doesn't render anything - it's purely functional
  return null;
};

export default BimMapper;
