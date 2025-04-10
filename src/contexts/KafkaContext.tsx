import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import { CostItem } from "../components/CostUploader/types";

// MongoDB element data structure
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

// Project update type
interface ProjectUpdate {
  projectId: string;
  projectName: string;
  elementCount: number;
  totalCost?: number;
  timestamp: string;
}

// Add a new interface for eBKP codes
interface EbkpCodeInfo {
  code: string;
  type?: string;
  description?: string;
}

// Add types for cached project data
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

interface ProjectData {
  elements: ProjectElement[];
  ebkpMap: Record<string, ProjectElement[]>;
  lastFetched: number;
}

// Define the context shape
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
  connectionStatus: "CONNECTING",
  sendCostUpdate: () => Promise.resolve(false),
  projectUpdates: {},
  replaceEbkpPlaceholders: (text: string) => text,
  calculateUpdatedChf: () => 0,
  getAreaData: () => null,
  formatTimestamp: (timestamp: string) => timestamp,
  mongoGetElements: () => Promise.resolve([]),
  mongoProjectCost: () => Promise.resolve(0),
  sendMessage: () => {},
  registerMessageHandler: () => {},
  availableEbkpCodes: [],
  matchCodes: () => [],
  getProjectElements: () => Promise.resolve([]),
  getElementsForEbkp: () => Promise.resolve([]),
  getCachedProjectData: () => null,
  backendUrl: "",
});

// Custom hook to use the Kafka context
export const useKafka = () => useContext(KafkaContext);

// Define the provider component props
interface KafkaProviderProps {
  children: ReactNode;
}

// Define ElementInfo interface for the window.__ELEMENT_INFO property
interface ElementInfo {
  elementCount: number;
  ebkphCodes: string[];
  projects: string[];
  costCodes: string[];
}

// Extend the global Window interface
declare global {
  interface Window {
    __ELEMENT_INFO?: ElementInfo;
  }
}

// Add an interface for the backend element structure above the mapBackendElementToProjectElement function
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

// Provider component that will wrap the app
export const KafkaProvider: React.FC<KafkaProviderProps> = ({ children }) => {
  const [backendUrl, setBackendUrl] = useState<string>("");
  const [projectUpdates, setProjectUpdates] = useState<
    Record<string, ProjectUpdate>
  >({});
  const [connectionStatus, setConnectionStatus] =
    useState<string>("CONNECTING");
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [availableEbkpCodes, setAvailableEbkpCodes] = useState<EbkpCodeInfo[]>(
    []
  );

  // Add state for project elements cache
  const [projectDataCache, setProjectDataCache] = useState<
    Record<string, ProjectData>
  >({});

  // Message response handlers - store callbacks for messages with specific messageIds
  const [messageHandlers] = useState<
    Record<string, (data: Record<string, unknown>) => void>
  >({});

  // Connect to WebSocket and listen for messages
  useEffect(() => {
    // Check if WebSocket is supported
    if (!("WebSocket" in window)) {
      console.error("WebSockets are not supported in this browser");
      setConnectionStatus("DISCONNECTED");
      return;
    }

    // Function to establish WebSocket connection
    const connectWebSocket = () => {
      // Use environment variable for WebSocket URL, provide a default if not set
      const wsUrl = import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8001";

      console.log("Connecting to WebSocket at:", wsUrl);

      // Extract the HTTP URL from WebSocket URL for REST API calls
      try {
        const wsProtocol = wsUrl.startsWith("wss:") ? "https:" : "http:";
        const httpUrl = wsUrl.replace(/^ws(s)?:\/\//, "");
        const apiBaseUrl = `${wsProtocol}//${httpUrl}`;
        setBackendUrl(apiBaseUrl);
      } catch (error) {
        console.error("Error setting backend URL:", error);
        setBackendUrl("");
      }

      let ws: WebSocket | null = null;

      try {
        // Set up connection timeout
        const timeoutId = setTimeout(() => {
          if (ws && ws.readyState !== WebSocket.OPEN) {
            if (ws) ws.close();
            setConnectionStatus("DISCONNECTED");
          }
        }, 5000);

        // Initialize WebSocket
        ws = new WebSocket(wsUrl);
        setWebsocket(ws);

        ws.onopen = () => {
          clearTimeout(timeoutId);
          setConnectionStatus("CONNECTED");
          requestAvailableEbkpCodes(ws);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as Record<string, unknown>;

            // Handle receiving eBKP codes list from server
            if (
              data.type === "available_ebkp_codes" &&
              Array.isArray(data.codes)
            ) {
              // Transform the codes into our EbkpCodeInfo format
              const codeObjects: EbkpCodeInfo[] = data.codes.map(
                (code: string) => ({
                  code,
                  type: code.split(".")[0], // Extract main type like C1, C2, etc.
                })
              );

              setAvailableEbkpCodes(codeObjects);
              return;
            }

            // Check if this message has a messageId that has a registered handler
            if (
              typeof data.messageId === "string" &&
              messageHandlers[data.messageId]
            ) {
              // Call the registered handler for this message ID
              messageHandlers[data.messageId](data);
              // Clean up the handler after use
              delete messageHandlers[data.messageId];
              return;
            }

            // Skip connection status messages
            if (data.type === "connection") {
              // Update connection status if included in the message
              if (typeof data.kafka === "string") {
                setConnectionStatus(data.kafka);
              }
              return;
            }

            // Handle project update notifications
            if (
              data.type === "project_update" &&
              typeof data.projectName === "string" &&
              typeof data.projectId === "string" &&
              typeof data.totalElements === "number" &&
              typeof data.timestamp === "string"
            ) {
              // Store project update information
              setProjectUpdates((prev) => ({
                ...prev,
                [data.projectName as string]: {
                  projectId: data.projectId as string,
                  projectName: data.projectName as string,
                  elementCount: data.totalElements as number,
                  totalCost:
                    typeof data.totalCost === "number"
                      ? data.totalCost
                      : undefined,
                  timestamp: data.timestamp as string,
                },
              }));

              return;
            }
          } catch (err) {
            console.error("Error parsing WebSocket message:", err);
          }
        };

        ws.onerror = (event) => {
          console.error("WebSocket error in KafkaContext:", event);
          setConnectionStatus("DISCONNECTED");
        };

        ws.onclose = () => {
          setConnectionStatus("DISCONNECTED");
        };

        // Clean up on unmount
        return () => {
          clearTimeout(timeoutId);
          if (ws) {
            ws.close();
          }
        };
      } catch (error) {
        console.error("Failed to initialize WebSocket in KafkaContext:", error);
        setConnectionStatus("DISCONNECTED");
        return () => {}; // Empty cleanup function
      }
    };

    connectWebSocket();
  }, [messageHandlers]); // Add messageHandlers as a dependency

  // Send cost update to Kafka via WebSocket server
  const sendCostUpdate = async (
    projectId: string,
    projectName: string,
    totalCost: number,
    elementsWithCost: number
  ): Promise<boolean> => {
    if (!backendUrl) {
      console.error("Backend URL not available for API calls");
      return false;
    }

    try {
      // Create notification payload similar to qto_producer.py
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

      // Send to WebSocket server
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

  // Function to send a message via WebSocket
  const sendMessage = (message: string): void => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.error("Cannot send message: WebSocket is not connected");
      throw new Error("WebSocket is not connected");
    }

    try {
      websocket.send(message);

      // Check if the message has a messageId
      const parsedMessage = JSON.parse(message);
      if (parsedMessage.messageId) {
        console.log(`Sent message with ID: ${parsedMessage.messageId}`);
      }
    } catch (error) {
      console.error("Error sending WebSocket message:", error);
      throw error;
    }
  };

  // Function to register a message handler for a specific messageId
  const registerMessageHandler = (
    messageId: string,
    handler: (data: Record<string, unknown>) => void
  ): void => {
    messageHandlers[messageId] = handler;
  };

  // Function to request available eBKP codes from the server
  const requestAvailableEbkpCodes = (ws: WebSocket | null) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const message = {
        type: "get_available_ebkp_codes",
        timestamp: new Date().toISOString(),
        messageId: `ebkp_codes_${Date.now()}`,
      };
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("Error requesting eBKP codes:", error);
    }
  };

  // Function to match codes with available eBKP codes
  const matchCodes = (codes: string[]): EbkpCodeInfo[] => {
    if (!codes || !codes.length || !availableEbkpCodes.length) {
      return [];
    }

    // Normalize input codes
    const normalizedCodes = codes.map((code) => normalizeCode(code));

    // Find matching codes from available codes
    return availableEbkpCodes.filter((codeInfo) =>
      normalizedCodes.some((code) => code === codeInfo.code)
    );
  };

  // Helper function to normalize a code (similar to backend)
  const normalizeCode = (code: string): string => {
    return code.trim().toUpperCase();
  };

  // Update the mapBackendElementToProjectElement function to better handle eBKP codes
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
      id: element._id,
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
      if (!backendUrl) {
        return [];
      }

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

        const elements = await response.json();
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

    // Convert to uppercase and trim
    const upperCode = code.toUpperCase().trim();

    // Remove spaces
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
    [projectDataCache, normalizeEbkpCode]
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
