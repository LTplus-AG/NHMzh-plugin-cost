import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import logger from '../utils/logger';
import { CostItem } from "../components/CostUploader/types";
import { costApi, CostUpdateNotification } from "../services/costApi";
import type { BackendElement as ApiBackendElement } from "../services/costApi";

// Define types for cost items
interface MongoElement {
  _id: string;
  project_id: string;
  element_type: string;
  quantity: number;
  properties: {
    category?: string;
    level?: string;
    area?: number;
    is_structural?: boolean;
    is_external?: boolean;
    ebkph?: string;
  };
  classification?: {
    id: string;
    name: string;
    system: string;
  };
  created_at: string;
  updated_at: string;
}

interface ProjectUpdate {
  projectId: string;
  projectName: string;
  elementCount: number;
  totalCost?: number;
  timestamp: string;
}

// Interface for eBKP code information
interface EbkpCodeInfo {
  code: string;
  type?: string;
  description?: string;
}

// Interface for project element
interface ProjectElement {
  id: string;
  ebkpCode: string;
  quantity?: {
    value: number;
    type: string;
    unit: string;
  };
  area: number;
  description?: string;
  category?: string;
  level?: string;
  ifc_class?: string;
  type_name?: string;
  name?: string;
  is_structural?: boolean;
  is_external?: boolean;
}

// Interface for project data cache
interface ProjectData {
  elements: ProjectElement[];
  ebkpMap: Record<string, ProjectElement[]>;
  lastFetched: number;
}

// Kafka context interface
interface ApiContextProps {
  connectionStatus: string;
  sendCostUpdate: (
    projectId: string,
    projectName: string,
    totalCost: number,
    elementsWithCost: number
  ) => Promise<boolean>;
  projectUpdates: Record<string, ProjectUpdate>;
  replaceEbkpPlaceholders: (text: string) => string;
  calculateUpdatedChf: (item: CostItem) => number;
  getAreaData: (code: string) => {
    value?: number;
    count?: number;
    timestamp?: string;
    source?: string;
  } | null;
  formatTimestamp: (timestamp: string) => string;
  mongoGetElements: (projectId: string) => Promise<MongoElement[]>;
  mongoProjectCost: (projectId: string) => Promise<number>;
  availableEbkpCodes: EbkpCodeInfo[];
  matchCodes: (codes: string[]) => EbkpCodeInfo[];
  getProjectElements: (projectName: string) => Promise<ProjectElement[]>;
  getElementsForEbkp: (
    projectName: string,
    ebkpCode: string
  ) => Promise<ProjectElement[]>;
  getCachedProjectData: (projectName: string) => ProjectData | null;
  reapplyCostData: (projectName: string) => Promise<void>; // Add new function
  backendUrl: string;
  ebkpLoadError: string | null; // Add error state to interface
}

// Create the context with default values
const ApiContext = createContext<ApiContextProps>({
  connectionStatus: "DISCONNECTED",
  sendCostUpdate: async () => false,
  projectUpdates: {},
  replaceEbkpPlaceholders: (text) => text,
  calculateUpdatedChf: () => 0,
  getAreaData: () => null,
  formatTimestamp: (timestamp) => timestamp,
  mongoGetElements: async () => [],
  mongoProjectCost: async () => 0,
  availableEbkpCodes: [],
  matchCodes: () => [],
  getProjectElements: async () => [],
  getElementsForEbkp: async () => [],
  getCachedProjectData: () => null,
  reapplyCostData: async () => {}, // Add dummy implementation
  backendUrl: "",
  ebkpLoadError: null,
});

// Export the hook to use the context
export const useApi = () => useContext(ApiContext);

// Provider component props
interface ApiProviderProps {
  children: ReactNode;
}

// Interface for element info stored on window object
interface ElementInfo {
  elementCount: number;
  ebkphCodes: string[];
  projects: string[];
  costCodes: string[];
}

// Extend Window interface to include our custom property
declare global {
  interface Window {
    __ELEMENT_INFO?: ElementInfo;
  }
}

// Use a different name for the local BackendElement to avoid conflict
interface LocalBackendElement {
  _id?: string;  // Make optional
  project_id?: string;  // Make optional
  id?: string;  // Add id as optional
  ifc_id?: string;
  global_id?: string;
  ifc_class?: string;
  name?: string;
  type_name?: string;
  level?: string;
  quantity?: {
    value: number;
    type: string;
    unit: string;
  };
  area?: number;
  is_structural?: boolean;
  is_external?: boolean;
  classification?: {
    id: string;
    name: string;
    system: string;
  };
  properties?: {
    category?: string;
    ebkph?: string;
    level?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export const ApiProvider: React.FC<ApiProviderProps> = ({ children }) => {
  const [connectionStatus] = useState("CONNECTED");
  const [projectUpdates] = useState<
    Record<string, ProjectUpdate>
  >({});
  const [availableEbkpCodes, setAvailableEbkpCodes] = useState<
    EbkpCodeInfo[]
  >([]);
  const [projectDataCache, setProjectDataCache] = useState<
    Record<string, ProjectData>
  >({});
  const [ebkpLoadError, setEbkpLoadError] = useState<string | null>(null); // Add error state

  // Get backend URL from environment or use default
  const backendUrl =
    import.meta.env.VITE_COST_BACKEND_URL || "http://localhost:8001";

  // Load available EBKP codes on mount
  useEffect(() => {
    const loadEbkpCodes = async () => {
      try {
        setEbkpLoadError(null); // Clear any previous errors
        const codes = await costApi.getAvailableEbkpCodes();
        setAvailableEbkpCodes(codes);
      } catch (error) {
        logger.error("Error loading EBKP codes:", error);
        // Set error state when an error occurs
        setEbkpLoadError(error instanceof Error ? error.message : "Failed to load EBKP codes");
      }
    };

    loadEbkpCodes();
    
    // Poll for project updates every 30 seconds
    const interval = setInterval(loadEbkpCodes, 30000);
    return () => clearInterval(interval);
  }, [backendUrl]);

  // Send cost update to backend
  const sendCostUpdate = async (
    projectId: string,
    projectName: string,

  ): Promise<boolean> => {
    try {
      const notification: CostUpdateNotification = {
        project: projectName,
        timestamp: new Date().toISOString(),
        elements: []
      };

      const response = await costApi.sendCostUpdate(notification);
      return response.success;
    } catch (error) {
      logger.error(
        `Error sending cost update for project ${projectId}:`,
        error
      );
      return false;
    }
  };

  // Function to replace eBKP placeholders in text
  const replaceEbkpPlaceholders = (text: string): string => {
    if (!text) return text;
    return text.replace(/\{ebkp\}/g, "eBKP");
  };

  // Function to calculate updated CHF value
  const calculateUpdatedChf = (item: CostItem): number => {
    if (!item.menge || !item.kennwert) return 0;
    return item.menge * item.kennwert;
  };

  // Function to format timestamp
  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      logger.error("Error formatting timestamp:", error);
      return timestamp;
    }
  };

  // Function to match codes with available eBKP codes
  const matchCodes = (codes: string[]): EbkpCodeInfo[] => {
    if (!codes || !codes.length || !availableEbkpCodes.length) {
      return [];
    }

    const normalizedCodes = codes.map((code) => normalizeCode(code));
    return availableEbkpCodes.filter((codeInfo) =>
      normalizedCodes.some((code) => code === codeInfo.code)
    );
  };

  // Helper function to normalize a code
  const normalizeCode = (code: string): string => {
    return code.trim().toUpperCase();
  };

  // Map backend element to project element
  const mapBackendElementToProjectElement = (
    element: ApiBackendElement | LocalBackendElement
  ): ProjectElement => {
    // Cast to LocalBackendElement for consistent access
    const el = element as LocalBackendElement;
    let ebkpCode = "";

    if (el.classification && el.classification.id) {
      ebkpCode = el.classification.id;
    } else if (el.properties && el.properties.ebkph) {
      ebkpCode = el.properties.ebkph;
    } else {
      const possibleFields = ["ebkp_code", "ebkp", "ebkph"];
      for (const field of possibleFields) {
        if (el[field]) {
          ebkpCode = el[field] as string;
          break;
        }
      }
    }

    let area = 0;
    if (el.quantity && typeof el.quantity === 'object' && 'value' in el.quantity) {
      area = el.quantity.value;
    } else if (typeof el.quantity === 'number') {
      area = el.quantity;
    } else if (el.area) {
      area = el.area;
    }

    return {
      id: el.global_id || el.id || el._id || "",
      ebkpCode: ebkpCode,
      quantity: typeof el.quantity === 'object' ? el.quantity : undefined,
      area: area,
      description: el.name || "",
      category: el.ifc_class || el.properties?.category || "",
      level: el.level || el.properties?.level || "",
      ifc_class: el.ifc_class || "",
      type_name: el.type_name || "",
      name: el.name || "",
      is_structural: el.is_structural || false,
      is_external: el.is_external || false,
    };
  };

  // Function to fetch and cache project elements
  const fetchProjectElements = useCallback(
    async (projectName: string): Promise<ProjectElement[]> => {
      const cachedData = projectDataCache[projectName];
      const now = Date.now();
      if (cachedData && now - cachedData.lastFetched < 5 * 60 * 1000) {
        return cachedData.elements;
      }

      try {
        const elements = await costApi.getProjectElements(projectName);
        const mappedElements = elements.map((element: ApiBackendElement) =>
          mapBackendElementToProjectElement(element)
        );

        const elementsWithEbkp = mappedElements.filter(
          (el: ProjectElement) => el.ebkpCode
        );

        const ebkpMap: Record<string, ProjectElement[]> = {};
        elementsWithEbkp.forEach((element: ProjectElement) => {
          const normalizedCode = normalizeEbkpCode(element.ebkpCode);
          if (!ebkpMap[normalizedCode]) {
            ebkpMap[normalizedCode] = [];
          }
          ebkpMap[normalizedCode].push(element);
        });

        const projectData: ProjectData = {
          elements: elementsWithEbkp,
          ebkpMap,
          lastFetched: now,
        };

        setProjectDataCache((prev) => ({
          ...prev,
          [projectName]: projectData,
        }));

        const ebkphCodes = elementsWithEbkp.map(
          (e: ProjectElement) => e.ebkpCode
        );
        window.__ELEMENT_INFO = {
          elementCount: elementsWithEbkp.length,
          ebkphCodes: ebkphCodes,
          projects: [projectName],
          costCodes: ebkphCodes,
        };

        return elementsWithEbkp;
      } catch (error) {
        logger.error(
          `Error fetching project elements: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return [];
      }
    },
    [projectDataCache]
  );

  // Function to get elements for a specific eBKP code
  const getElementsForEbkp = useCallback(
    async (
      projectName: string,
      ebkpCode: string
    ): Promise<ProjectElement[]> => {
      const normalizedCode = normalizeEbkpCode(ebkpCode);

      let cachedData = projectDataCache[projectName];
      if (!cachedData) {
        await fetchProjectElements(projectName);
        cachedData = projectDataCache[projectName];
      }

      if (!cachedData) {
        return [];
      }

      return cachedData.ebkpMap[normalizedCode] || [];
    },
    [fetchProjectElements, projectDataCache]
  );

  // Helper function to normalize eBKP codes
  const normalizeEbkpCode = (code: string): string => {
    if (!code) return "";

    const upperCode = code.toUpperCase().trim();
    let normalized = upperCode.replace(/\s+/g, "");
    normalized = normalized.replace(/([A-Z])0*(\d+)\.0*(\d+)/g, "$1$2.$3");
    normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");
    normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");

    return normalized;
  };

  // Function to get area and count data for a specific code
  const getAreaData = useCallback(
    (code: string) => {
      if (!code) return null;

      const normalizedCode = normalizeEbkpCode(code);

      for (const projectName in projectDataCache) {
        const projectData = projectDataCache[projectName];
        if (!projectData || !projectData.ebkpMap) continue;

        const elements = projectData.ebkpMap[normalizedCode] || [];

        if (elements.length > 0) {
          const totalArea = elements.reduce((sum, el) => sum + el.area, 0);

          return {
            value: totalArea,
            count: elements.length,
            timestamp: new Date().toISOString(),
            source: "BIM",
          };
        }
      }

      return null;
    },
    [projectDataCache]
  );

  // Function to get all project elements
  const getProjectElements = useCallback(
    async (projectName: string): Promise<ProjectElement[]> => {
      return await fetchProjectElements(projectName);
    },
    [fetchProjectElements]
  );

  // Function to get cached project data
  const getCachedProjectData = useCallback(
    (projectName: string): ProjectData | null => {
      return projectDataCache[projectName] || null;
    },
    [projectDataCache]
  );

  // Re-apply cost data
  const reapplyCostData = async (projectName: string): Promise<void> => {
    try {
      await costApi.reapplyCosts(projectName);
      // Don't return anything to match the Promise<void> type
    } catch (error) {
      logger.error("Error re-applying cost data:", error);
      // Don't return anything, just log the error
    }
  };

  return (
    <ApiContext.Provider
      value={{
        connectionStatus,
        sendCostUpdate,
        projectUpdates,
        replaceEbkpPlaceholders,
        calculateUpdatedChf,
        getAreaData,
        formatTimestamp,
        mongoGetElements: () => Promise.resolve([]),
        mongoProjectCost: () => Promise.resolve(0),
        availableEbkpCodes,
        matchCodes,
        getProjectElements,
        getElementsForEbkp,
        getCachedProjectData,
        backendUrl,
        ebkpLoadError,
        reapplyCostData,
      }}
    >
      {children}
    </ApiContext.Provider>
  );
};
