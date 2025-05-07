import {
  useEffect,
  useState,
  useCallback,
  useRef,
  Dispatch,
  SetStateAction,
} from "react";
import { MetaFile, CostItem } from "./types";
import { useKafka } from "../../contexts/KafkaContext";
import EbkpMapper from "./EbkpMapper";
import { MongoElement } from "../../types/common.types";

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

// Elements adapted for EbkpMapper: MongoElement with guaranteed string 'id' & 'ebkpCode'.
type AdaptedBimElement = MongoElement & {
  id: string;
  ebkpCode: string;
};

interface BimMapperProps {
  metaFile: MetaFile | null;
  projectName: string;
  onQuantitiesMapped?: (bimMappedCount: number) => void;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setMappingMessage: Dispatch<SetStateAction<string>>;
  ifcElements?: MongoElement[];
}

/**
 * Component that handles mapping BIM quantities to Excel data
 * This is separated from UI components to keep proper separation of concerns
 */
const BimMapper = ({
  metaFile,
  projectName,
  onQuantitiesMapped,
  setIsLoading,
  setMappingMessage,
  ifcElements,
}: BimMapperProps) => {
  const { connectionStatus, sendMessage, registerMessageHandler } = useKafka();

  const [mapper, setMapper] = useState<EbkpMapper | null>(null);

  // Track current file to avoid re-processing the same file
  const currentFileRef = useRef<string | null>(null);
  // Flag to track if we've already sent data to server for this file
  const dataSubmittedRef = useRef<boolean>(false);
  // Flag to track if quantities have been mapped for this file
  const quantitiesMappedRef = useRef<boolean>(false);

  // Function to request re-application of cost data on the server
  const requestReapplyCostData = useCallback(async () => {
    if (dataSubmittedRef.current) {
      console.log("Data already submitted to server, skipping reapply");
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
        projectName,
      };
      console.log(`Sending reapply request for project ${projectName}`);
      await new Promise<void>((resolve, reject) => {
        registerMessageHandler(reapplyMessageId, (response) => {
          if (response.status === "success") {
            console.log("Server re-applied cost data successfully");
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
  const initializeMapper = useCallback(() => {
    if (!projectName) {
      console.warn("Cannot initialize mapper: Project name is empty");
      return;
    }
    if (!ifcElements || ifcElements.length === 0) {
      console.warn(
        `Cannot initialize mapper for project ${projectName}: No IFC elements provided or array is empty.`
      );
      setMapper(null);
      return;
    }

    try {
      console.log(
        `Initializing mapper for project: ${projectName} with ${ifcElements.length} provided IFC elements.`
      );

      const adaptedElements: AdaptedBimElement[] = ifcElements.map(
        (element) => ({
          ...element,
          id: element._id,
          ebkpCode:
            element.classification?.id || element.properties?.ebkph || "",
        })
      );

      const newMapper = new EbkpMapper(adaptedElements);
      setMapper(newMapper);
      const stats = newMapper.getStatistics();
      console.log(
        `BIM data loaded for mapper: ${stats.totalElements} elements, ${stats.uniqueCodes} unique eBKP codes`
      );
    } catch (error) {
      console.error(
        `Error initializing EbkpMapper: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      setMapper(null);
    }
  }, [projectName, ifcElements]);

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

  // Initialize mapper once on connection and when ifcElements change
  useEffect(() => {
    if (projectName && ifcElements && ifcElements.length > 0) {
      initializeMapper();
    } else {
      setMapper(null);
      console.log("Project name or IFC elements not available, mapper reset.");
    }
  }, [projectName, ifcElements, initializeMapper]);

  // Effect to map quantities when a new file is loaded
  useEffect(() => {
    const fileName = metaFile?.file?.name || null;
    if (!mapper || !metaFile || !metaFile.data) {
      return;
    }
    if (fileName === currentFileRef.current && quantitiesMappedRef.current) {
      return; // Already processed this file
    }

    setIsLoading(true);
    setMappingMessage("Mengen werden aus BIM-Modell zugeordnet...");
    currentFileRef.current = fileName;

    const processingTimeout = setTimeout(() => {
      try {
        console.log(
          `Processing file for BIM mapping: ${fileName || "unknown"}`
        );
        const costItems = Array.isArray(metaFile.data)
          ? metaFile.data
          : metaFile.data.data;
        const allItems = getAllItems(costItems);
        if (allItems.length === 0) {
          console.warn("No items found in the Excel file for mapping");
          quantitiesMappedRef.current = true;
          setIsLoading(false);
          return;
        }
        const itemsWithEbkp = allItems.filter(
          (item) => item.ebkp && item.ebkp !== ""
        );
        if (itemsWithEbkp.length === 0) {
          console.warn("No eBKP codes found in the uploaded file for mapping");
          quantitiesMappedRef.current = true;
          setIsLoading(false);
          return;
        }
        console.log(
          `Found ${itemsWithEbkp.length} items with eBKP codes in Excel data for mapping`
        );
        const updatedItems = mapper.mapQuantitiesToCostItems(costItems);

        // It's crucial that mapQuantitiesToCostItems preserves original items if not mapped,
        // or clearly indicates mapping status (e.g., via areaSource) and updates chf.
        const flatAllProcessedItems = getAllItems(updatedItems);

        const bimMappedCount = flatAllProcessedItems.filter(
          (item) => item.areaSource === "IFC"
        ).length;

        console.log(
          `Mapping complete: ${bimMappedCount} items updated with quantities from BIM model.`
        );
        // If you want to log unmatched count based on the flat list:
        // const unmatchedCount = flatAllProcessedItems.length - bimMappedCount;
        // console.log(`${unmatchedCount} items were not directly mapped to BIM quantities (retained Excel/original values).`);

        // The metaFile.data should still contain the complete list of updatedItems (hierarchical) for other consumers if needed.
        if (Array.isArray(metaFile.data)) {
          metaFile.data = updatedItems;
        } else {
          metaFile.data.data = updatedItems;
        }

        if (onQuantitiesMapped) {
          onQuantitiesMapped(bimMappedCount);
        }

        if (bimMappedCount > 0 && !dataSubmittedRef.current) {
          setTimeout(() => {
            requestReapplyCostData().catch(() => {});
          }, 500);
        }
        quantitiesMappedRef.current = true;
      } catch (error) {
        console.error("Error mapping quantities:", error);
        quantitiesMappedRef.current = true;
      } finally {
        setIsLoading(false);
      }
    }, 50);
    return () => clearTimeout(processingTimeout);
  }, [
    mapper,
    metaFile,
    onQuantitiesMapped,
    requestReapplyCostData,
    setIsLoading,
    setMappingMessage,
  ]);

  // Reset state when metaFile changes to a new file
  useEffect(() => {
    if (metaFile?.file) {
      const newFileName = metaFile.file.name;

      // Only reset state if the file actually changed
      if (currentFileRef.current !== newFileName) {
        console.log(
          `New file detected (${newFileName}), resetting mapping state for quantities and submission`
        );
        quantitiesMappedRef.current = false;
        dataSubmittedRef.current = false;
        currentFileRef.current = newFileName;
      }
    }
  }, [metaFile]); // Depend on metaFile object directly

  // This component doesn't render anything - it's purely functional
  return null;
};

export default BimMapper;
