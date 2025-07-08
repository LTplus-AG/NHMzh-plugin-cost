import React, {
  createContext,
  useContext,
  ReactNode,
  useEffect,
  useState,
  useCallback,
} from "react";

// Define types for cost items
interface CostItem {
  menge: number;
  kennwert: number;
}

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
interface KafkaContextProps {
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
  sendMessage: (message: string) => void;
  registerMessageHandler: (
    messageId: string,
    handler: (data: Record<string, unknown>) => void
  ) => void;
  availableEbkpCodes: EbkpCodeInfo[];
  matchCodes: (codes: string[]) => EbkpCodeInfo[];
  getProjectElements: (projectName: string) => Promise<ProjectElement[]>;
  getElementsForEbkp: (
    projectName: string,
    ebkpCode: string
  ) => Promise<ProjectElement[]>;
  getCachedProjectData: (projectName: string) => ProjectData | null;
  backendUrl: string;
}

// Create the context with default values
const KafkaContext = createContext<KafkaContextProps>({
  connectionStatus: "DISCONNECTED",
  sendCostUpdate: async () => false,
  projectUpdates: {},
  replaceEbkpPlaceholders: (text) => text,
  calculateUpdatedChf: () => 0,
  getAreaData: () => null,
  formatTimestamp: (timestamp) => timestamp,
  mongoGetElements: async () => [],
  mongoProjectCost: async () => 0,
  sendMessage: () => {},
  registerMessageHandler: () => {},
  availableEbkpCodes: [],
  matchCodes: () => [],
  getProjectElements: async () => [],
  getElementsForEbkp: async () => [],
  getCachedProjectData: () => null,
  backendUrl: "",
});

// Export the hook to use the context
export const useKafka = () => useContext(KafkaContext);

// Provider component props
interface KafkaProviderProps {
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

interface BackendElement {
  _id: string;
  project_id: string;
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

export const KafkaProvider: React.FC<KafkaProviderProps> = ({ children }) => {
  const [connectionStatus, setConnectionStatus] = useState("CONNECTED"); // Always connected for HTTP
  const [projectUpdates, setProjectUpdates] = useState<
    Record<string, ProjectUpdate>
  >({});
  const [availableEbkpCodes, setAvailableEbkpCodes] = useState<
    EbkpCodeInfo[]
  >([]);
  const [projectDataCache, setProjectDataCache] = useState<
    Record<string, ProjectData>
  >({});

  // Get backend URL from environment or use default
  const backendUrl =
    import.meta.env.VITE_COST_BACKEND_URL || "http://localhost:8001";

  // Load available EBKP codes on mount
  useEffect(() => {
    const loadEbkpCodes = async () => {
      try {
        const response = await fetch(`${backendUrl}/available-ebkp-codes`);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.codes)) {
            const codeObjects: EbkpCodeInfo[] = data.codes.map(
              (code: string) => ({
                code,
                type: code.split(".")[0],
              })
            );
            setAvailableEbkpCodes(codeObjects);
          }
        }
      } catch (error) {
        console.error("Error loading EBKP codes:", error);
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
    totalCost: number,
    elementsWithCost: number
  ): Promise<boolean> => {
    try {
      const notification = {
        eventType: "COST_UPDATED",
        timestamp: new Date().toISOString(),
        producer: "plugin-cost",
        payload: {
          projectId: projectId,
          projectName: projectName,
          elementCount: elementsWithCost,
          totalCost: totalCost,
        },
        metadata: {
          version: "1.0",
          correlationId: `cost-update-${Date.now()}`,
        },
      };

      const response = await fetch(`${backendUrl}/send-cost-update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(notification),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to send cost update: ${response.status} ${response.statusText}`
        );
      }

      return true;
    } catch (error) {
      console.error(
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
      console.error("Error formatting timestamp:", error);
      return timestamp;
    }
  };

  // Legacy function - no longer needed for HTTP
  const sendMessage = (message: string): void => {
    console.warn("sendMessage is deprecated for HTTP-based communication");
  };

  // Legacy function - no longer needed for HTTP
  const registerMessageHandler = (
    messageId: string,
    handler: (data: Record<string, unknown>) => void
  ): void => {
    console.warn("registerMessageHandler is deprecated for HTTP-based communication");
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
    element: BackendElement
  ): ProjectElement => {
    let ebkpCode = "";

    if (element.classification && element.classification.id) {
      ebkpCode = element.classification.id;
    } else if (element.properties && element.properties.ebkph) {
      ebkpCode = element.properties.ebkph;
    } else {
      const possibleFields = ["ebkp_code", "ebkp", "ebkph"];
      for (const field of possibleFields) {
        if (element[field]) {
          ebkpCode = element[field] as string;
          break;
        }
      }
    }

    let area = 0;
    if (element.quantity && element.quantity.value) {
      area = element.quantity.value;
    } else if (element.area) {
      area = element.area;
    }

    return {
      id: element.global_id || element._id,
      ebkpCode: ebkpCode,
      quantity: element.quantity,
      area: area,
      description: element.name || "",
      category: element.ifc_class || element.properties?.category || "",
      level: element.level || element.properties?.level || "",
      ifc_class: element.ifc_class || "",
      type_name: element.type_name || "",
      name: element.name || "",
      is_structural: element.is_structural || false,
      is_external: element.is_external || false,
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
        const response = await fetch(
          `${backendUrl}/project-elements/${encodeURIComponent(projectName)}`
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch project elements: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        const elements = data.elements || [];
        const mappedElements = elements.map((element: BackendElement) =>
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
        console.error(
          `Error fetching project elements: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return [];
      }
    },
    [backendUrl, projectDataCache]
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

  return (
    <KafkaContext.Provider
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
        sendMessage,
        registerMessageHandler,
        availableEbkpCodes,
        matchCodes,
        getProjectElements,
        getElementsForEbkp,
        getCachedProjectData,
        backendUrl,
      }}
    >
      {children}
    </KafkaContext.Provider>
  );
};
