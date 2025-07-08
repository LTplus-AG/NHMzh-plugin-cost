import SendIcon from "@mui/icons-material/Send";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  FormLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Step,
  StepLabel,
  Stepper,
  Typography
} from "@mui/material";
import { useCallback, useEffect, useState, useRef } from "react";
import { useKafka } from "../contexts/KafkaContext";
import { MongoElement } from "../types/common.types";
import PreviewModal, { EnhancedCostItem } from "./CostUploader/PreviewModal";
import EbkpCostForm, { EbkpStat } from "./EbkpCostForm";
import { MetaFile } from "./CostUploader/types";
import ProjectMetadataDisplay, {
  CostProjectMetadata,
} from "./ui/ProjectMetadataDisplay";
import SmartExcelButton from "./SmartExcelButton";
import { useExcelDialog } from "../hooks/useExcelDialog";
import { ExcelService } from "../utils/excelService";
import ExcelImportDialog from "./ExcelImportDialog";

const getAvailableQuantities = (el: MongoElement) => {
  const quantities = [];
  
  if (el.available_quantities && el.available_quantities.length > 0) {
    return el.available_quantities;
  }
  
  const elAny = el as MongoElement & { area?: number; length?: number; volume?: number };
  
  if (elAny.area && elAny.area > 0) {
    quantities.push({
      value: elAny.area,
      type: "area",
      unit: "m²",
      label: "Area"
    });
  }
  
  if (elAny.length && elAny.length > 0) {
    quantities.push({
      value: elAny.length,
      type: "length",
      unit: "m",
      label: "Length"
    });
  }
  
  if (elAny.volume && elAny.volume > 0) {
    quantities.push({
      value: elAny.volume,
      type: "volume",
      unit: "m³",
      label: "Volume"
    });
  }
  
  if (quantities.length === 0 || !quantities.some(q => q.type === 'count')) {
    quantities.push({
      value: 1,
      type: "count",
      unit: "Stk",
      label: "Count"
    });
  }
  
  return quantities;
};

const getSelectedQuantity = (
  el: MongoElement,
  selectedType?: string
): { value: number; unit: string; type: string } => {
  const availableQuantities = getAvailableQuantities(el);
  
  if (availableQuantities.length === 0) {
    return { value: 1, unit: "Stk", type: "count" };
  }
  
  if (selectedType) {
    const selected = availableQuantities.find(q => q.type === selectedType);
    if (selected) {
      return {
        value: selected.value,
        unit: selected.unit,
        type: selected.type
      };
    }
  }
  
  const defaultQty = availableQuantities[0];
  return {
    value: defaultQty.value,
    unit: defaultQty.unit,
    type: defaultQty.type
  };
};

interface Project {
  id: string;
  name: string;
}

const MainPage = () => {
  const Instructions = [
    {
      label: "Kennwerte eingeben",
      description: `Tragen Sie für jede eBKP-Gruppe einen Kennwert ein.`,
    },
    {
      label: "Kostenübersicht",
      description: `Die Kosten werden automatisch anhand der Mengen berechnet.`,
    },
  ];

  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [modelMetadata, setModelMetadata] = useState<CostProjectMetadata | null>(
    null
  );

  const { backendUrl } = useKafka();

  const [loadingElements, setLoadingElements] = useState(false);
  const [currentElements, setCurrentElements] = useState<MongoElement[]>([]);


  const [ebkpStats, setEbkpStats] = useState<EbkpStat[]>([]);
  const [kennwerte, setKennwerte] = useState<Record<string, number>>({});
  const [quantitySelections, setQuantitySelections] = useState<Record<string, string>>(() => {
    // Initialize quantity selections from localStorage only if a project is already selected
    if (!selectedProject) return {};
    try {
      const savedSelections = localStorage.getItem(`cost-plugin-quantity-selections-${selectedProject}`);
      return savedSelections ? JSON.parse(savedSelections) : {};
    } catch (error) {
      console.warn('Failed to load saved quantity selections:', error);
      return {};
    }
  });
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  
  // Add a ref to track if we're loading kennwerte
  const isLoadingKennwerteRef = useRef(false);
  
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [metaFileForPreview, setMetaFileForPreview] = useState<MetaFile | null>(null);

  // Excel dialog state
  const {
    isOpen: excelDialogOpen,
    openDialog: openExcelDialog,
    closeDialog: closeExcelDialog,
    isImporting,
    isExporting,
    setIsExporting,
    activity,
    recordExport,
    recordImport,
  } = useExcelDialog();

  // Load Kennwerte from backend when project changes
  useEffect(() => {
    if (selectedProject) {
      isLoadingKennwerteRef.current = true;
      loadKennwerteFromBackend(selectedProject).finally(() => {
        // Set loading to false after a small delay to ensure the state has been updated
        setTimeout(() => {
          isLoadingKennwerteRef.current = false;
        }, 100);
      });
    } else {
      // No project selected, clear kennwerte
      setKennwerte({});
    }
  }, [selectedProject]);

  // Function to load kennwerte from backend database
  const loadKennwerteFromBackend = async (projectName: string) => {
    try {
      const backendUrl = import.meta.env.VITE_COST_BACKEND_URL || 'http://localhost:8001';
      const response = await fetch(`${backendUrl}/get-kennwerte/${projectName}`);
      if (response.ok) {
        const data = await response.json();
        if (data.kennwerte && typeof data.kennwerte === 'object') {
          setKennwerte(data.kennwerte);
          console.log(`Loaded ${Object.keys(data.kennwerte).length} kennwerte from backend for project ${projectName}`);
        } else {
          // Don't reset to empty object, keep existing state
          console.log(`No kennwerte found in backend response for project ${projectName}`);
        }
      } else if (response.status === 404) {
        // Project not found or no kennwerte saved yet - this is normal for new projects
        console.log(`No saved kennwerte found for project ${projectName} (this is normal for new projects)`);
        // Don't reset kennwerte here - let the user start fresh
      } else {
        console.warn(`Failed to load kennwerte for project ${projectName}: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error loading kennwerte from backend:", error);
      // Don't reset kennwerte on error - keep existing state
    }
  };

  // Save Kennwerte to backend whenever they change
  useEffect(() => {
    // Don't save on initial mount, when no project is selected, or while loading
    if (!selectedProject || isLoadingKennwerteRef.current) return;
    
    // Save after a debounce delay, regardless of whether kennwerte is empty
    // This ensures that clearing kennwerte also gets persisted
    const timeoutId = setTimeout(() => {
      saveKennwerteToBackend(selectedProject, kennwerte);
    }, 1500); // Increased debounce to 1500ms to avoid too many saves

    return () => clearTimeout(timeoutId);
  }, [kennwerte, selectedProject]);

  // Function to save kennwerte to backend database
  const saveKennwerteToBackend = async (projectName: string, kennwerteData: Record<string, number>) => {
    try {
      const backendUrl = import.meta.env.VITE_COST_BACKEND_URL || 'http://localhost:8001';
      const response = await fetch(`${backendUrl}/save-kennwerte`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectName,
          kennwerte: kennwerteData,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`Saved kennwerte to backend for project ${projectName}`);
        setLastSaved(new Date().toLocaleTimeString('de-CH'));
      } else {
        console.error("Failed to save kennwerte to backend");
      }
    } catch (error) {
      console.error("Error saving kennwerte to backend:", error);
    }
  };

  // Save quantity selections to localStorage whenever they change (project-specific)
  useEffect(() => {
    if (!selectedProject) return;
    
    try {
      const key = `cost-plugin-quantity-selections-${selectedProject}`;
      localStorage.setItem(key, JSON.stringify(quantitySelections));
      setLastSaved(new Date().toLocaleTimeString('de-CH'));

    } catch (error) {
      console.warn('Failed to save quantity selections to localStorage:', error);
    }
  }, [quantitySelections, selectedProject]);

  const fetchElementsForProject = useCallback(
    async (projectName: string | null) => {
      if (!projectName) {
        setCurrentElements([]);
        setLoadingElements(false);
        setModelMetadata(null);
        setEbkpStats([]);
        return [];
      }

      setLoadingElements(true);
      setModelMetadata(null);

      try {
        const encodedProjectName = encodeURIComponent(projectName);
        if (!backendUrl) {
          setLoadingElements(false);
          return [];
        }
        const apiUrl = `${backendUrl}/project-elements/${encodedProjectName}`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch elements: ${response.statusText} (${response.status})`
          );
        }
        const data = await response.json();
        const elements = Array.isArray(data) ? data : data.elements || [];
        const metadata = data.modelMetadata || null;



        if (elements && elements.length > 0) {
          setCurrentElements(elements);
          if (metadata && metadata.filename) {
            setModelMetadata({
              filename: metadata.filename,
              element_count: elements.length,
              upload_timestamp: metadata.timestamp,
            });
          } else {
            setModelMetadata({
              filename: selectedProject || "Unbekanntes Modell",
              element_count: elements.length,
              upload_timestamp: new Date().toISOString(),
            });
          }

          const statMap: Record<string, { 
            quantity: number; 
            unit?: string;
            availableQuantities?: Array<{ value: number; type: string; unit: string; label: string }>;
            selectedQuantityType?: string;
            elements: MongoElement[];
          }> = {};

          elements.forEach((el: MongoElement) => {
            const code =
              el.classification?.id || el.properties?.ebkph || "Unknown";

            if (!statMap[code]) {
              statMap[code] = { 
                quantity: 0, 
                unit: undefined,
                availableQuantities: [],
                selectedQuantityType: quantitySelections[code],
                elements: []
              };
            }
            statMap[code].elements.push(el);
          });



          // Now calculate aggregated quantities for each EBKP code
          Object.keys(statMap).forEach(code => {
            const stat = statMap[code];
            const selectedType = quantitySelections[code];
            let totalQuantity = 0;
            let unit = "";
            const allAvailableQuantities = new Map();

            // Aggregate quantities from all elements in this EBKP group
            stat.elements.forEach(el => {
              const availableQuantities = getAvailableQuantities(el);
              const selectedQty = getSelectedQuantity(el, selectedType);
              
              totalQuantity += selectedQty.value;
              unit = selectedQty.unit; // Use unit from selected quantity type
              
              // Collect all unique quantity types available across elements
              availableQuantities.forEach(qty => {
                const key = qty.type;
                if (!allAvailableQuantities.has(key)) {
                  allAvailableQuantities.set(key, {
                    value: 0,
                    type: qty.type,
                    unit: qty.unit,
                    label: qty.label
                  });
                }
                // Aggregate the quantity for this type
                const currentQty = getSelectedQuantity(el, qty.type);
                allAvailableQuantities.get(key).value += currentQty.value;
              });
            });

            stat.quantity = totalQuantity;
            stat.unit = unit;
            stat.availableQuantities = Array.from(allAvailableQuantities.values());
            stat.selectedQuantityType = selectedType || (stat.availableQuantities[0]?.type);
          });

          const stats = Object.entries(statMap).map(([code, v]) => ({
            code,
            quantity: v.quantity,
            unit: v.unit,
            availableQuantities: v.availableQuantities,
            selectedQuantityType: v.selectedQuantityType,
            elements: v.elements,
          }));

          setEbkpStats(stats);
          return elements;
        } else {
          setCurrentElements([]);
          setEbkpStats([]);
          setModelMetadata(null);
          return [];
        }
      } catch (error) {
        console.error("Error fetching project elements:", error);
        setCurrentElements([]);
        setEbkpStats([]);
        setModelMetadata(null);
        return [];
      } finally {
        setLoadingElements(false);
      }
    },
    [backendUrl, selectedProject]
  );

  useEffect(() => {
    if (backendUrl) {
      const fetchProjects = async () => {
        setLoadingProjects(true);
        try {
          const response = await fetch(`${backendUrl}/projects`);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const projects: Project[] = await response.json();
          setProjectsList(projects);
          if (projects.length > 0 && !selectedProject) {
            setSelectedProject(projects[0].name);
          }
        } catch (error) {
          console.error("Failed to fetch projects:", error);
          setProjectsList([]);
        } finally {
          setLoadingProjects(false);
        }
      };
      fetchProjects();
    }
  }, [backendUrl]);

  useEffect(() => {
    if (selectedProject) {
      fetchElementsForProject(selectedProject);
    } else {
      setCurrentElements([]);
      setEbkpStats([]);
      setModelMetadata(null);
    }
  }, [selectedProject]);

  const handleProjectChange = (event: SelectChangeEvent<string>) => {
    const newProjectName = event.target.value;
    setSelectedProject(newProjectName);
  };



  const clearSavedData = () => {
    if (!selectedProject) return;
    
    try {
      // Clear quantity selections from localStorage (still using localStorage for these)
      const selectionsKey = `cost-plugin-quantity-selections-${selectedProject}`;
      localStorage.removeItem(selectionsKey);
      
      // Clear kennwerte from state (will trigger save to backend with empty object)
      setKennwerte({});
      setQuantitySelections({});
      setLastSaved(null);

      if (currentElements.length > 0) {
        recalculateStats({});
      }
      
      console.log(`Cleared all saved data for project ${selectedProject}`);
    } catch (error) {
      console.warn('Failed to clear saved data:', error);
    }
  };

  const handlePreviewCosts = () => {
    if (!selectedProject || ebkpStats.length === 0) return;
    
    const costItems = ebkpStats
      .filter(stat => stat.quantity > 0 && kennwerte[stat.code] > 0)
      .map(stat => ({
        ebkp: stat.code,
        bezeichnung: `${stat.code} - Baugruppe`,
        menge: stat.quantity,
        einheit: stat.unit || 'm²',
        kennwert: kennwerte[stat.code] || 0,
        chf: (kennwerte[stat.code] || 0) * stat.quantity,
        totalChf: (kennwerte[stat.code] || 0) * stat.quantity,
        category: stat.code.charAt(0),
        level: "1",
        is_structural: true,
        fire_rating: "",
        area: stat.quantity,
        areaSource: "BIM"
      }));

    const metaFile: MetaFile = {
      file: new File([JSON.stringify(costItems)], `${selectedProject}_costs.json`, { type: 'application/json' }),
      data: costItems,
      headers: ['eBKP', 'Bezeichnung', 'Menge', 'Einheit', 'Kennwert', 'CHF', 'Total CHF'],
      valid: true
    };

    setMetaFileForPreview(metaFile);
    setPreviewModalOpen(true);
  };

  const handleConfirmCosts = async (enhancedData: EnhancedCostItem[]) => {
    try {
      if (!selectedProject) {
        console.error('Missing project');
        return;
      }

      // Get WebSocket connection
      const ws = (window as { ws?: WebSocket }).ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected, trying to reconnect");
        try {
          const wsUrl: string =
            (window as { VITE_WEBSOCKET_URL?: string }).VITE_WEBSOCKET_URL ||
            import.meta.env.VITE_WEBSOCKET_URL ||
            "ws://localhost:8001";
          const newWs = new WebSocket(wsUrl);
          (window as { ws?: WebSocket }).ws = newWs;
          await new Promise((resolve, reject) => {
            newWs.onopen = resolve;
            newWs.onerror = reject;
            setTimeout(() => reject(new Error("WS connect timeout")), 5000);
          });
        } catch (error) {
          console.error("Failed to connect to WebSocket:", error);
          throw new Error("WebSocket connection failed");
        }
      }

      // Create message ID
      const messageId = `batch_${Date.now()}${Math.random()
        .toString(36)
        .substring(2, 7)}`;

      // Create Excel items from current cost data
      const allExcelItems = ebkpStats
        .filter(stat => stat.quantity > 0 && kennwerte[stat.code] > 0)
        .map(stat => ({
          ebkp: stat.code,
          bezeichnung: `${stat.code} - Baugruppe`,
          menge: stat.quantity,
          einheit: stat.unit || 'm²',
          kennwert: kennwerte[stat.code] || 0,
          chf: (kennwerte[stat.code] || 0) * stat.quantity,
          totalChf: (kennwerte[stat.code] || 0) * stat.quantity,
          category: stat.code.charAt(0),
          level: "1",
          is_structural: true,
          fire_rating: "",
          area: stat.quantity,
          areaSource: "BIM"
        }));

      // Send WebSocket message
      const message = {
        type: "save_cost_batch_full",
        messageId,
        payload: {
          projectName: selectedProject,
          matchedItems: enhancedData,
          allExcelItems: allExcelItems,
        },
      };

      const wsToUse = (window as { ws?: WebSocket }).ws;
      if (!wsToUse) {
        throw new Error("WebSocket not available");
      }
      wsToUse.send(JSON.stringify(message));
      console.log(`Full cost batch sent to server for project ${selectedProject}`);

      // Wait for response
      const response = await new Promise((resolve, reject) => {
        const responseHandler = (event: MessageEvent) => {
          try {
            const responseData = JSON.parse(event.data);
            if (
              responseData.type === "save_cost_batch_full_response" &&
              responseData.messageId === messageId
            ) {
              wsToUse?.removeEventListener("message", responseHandler);
              clearTimeout(timeoutId);
              resolve(responseData);
            }
          } catch {
            /* Ignore */
          }
        };
        wsToUse?.addEventListener("message", responseHandler);
        const timeoutId = setTimeout(() => {
          wsToUse?.removeEventListener("message", responseHandler);
          reject(new Error("Timeout waiting for save_cost_batch_full_response"));
        }, 30000);
        wsToUse?.addEventListener("close", () => clearTimeout(timeoutId), {
          once: true,
        });
      });

      const responseData = response as { status?: string; message?: string };
      if (responseData.status === "success") {
        console.log('Cost data uploaded successfully:', response);
        // Close the preview modal
        setPreviewModalOpen(false);
        // Optionally show success message or refresh data
      } else {
        console.error('Error saving cost data backend:', responseData.message || "Unknown error");
      }
      
    } catch (error) {
      console.error('Error uploading cost data:', error);
    }
  };

  const recalculateStats = useCallback((newQuantitySelections: Record<string, string>) => {
    if (currentElements.length === 0) return;
    
    const statMap: Record<string, { 
      quantity: number; 
      unit?: string;
      availableQuantities?: Array<{ value: number; type: string; unit: string; label: string }>;
      selectedQuantityType?: string;
      elements: MongoElement[];
    }> = {};

    // Group elements by EBKP code
    currentElements.forEach((el: MongoElement) => {
      const code = el.classification?.id || el.properties?.ebkph || "Unknown";
      
      if (!statMap[code]) {
        statMap[code] = { 
          quantity: 0, 
          unit: undefined,
          availableQuantities: [],
          selectedQuantityType: newQuantitySelections[code],
          elements: []
        };
      }
      statMap[code].elements.push(el);
    });

    // Calculate aggregated quantities for each EBKP code
    Object.keys(statMap).forEach(code => {
      const stat = statMap[code];
      const selectedType = newQuantitySelections[code];
      let totalQuantity = 0;
      let unit = "";
      const allAvailableQuantities = new Map();

      // Aggregate quantities from all elements in this EBKP group
      stat.elements.forEach(el => {
        const availableQuantities = getAvailableQuantities(el);
        const selectedQty = getSelectedQuantity(el, selectedType);
        
        totalQuantity += selectedQty.value;
        unit = selectedQty.unit;
        
        // Collect all unique quantity types available across elements
        availableQuantities.forEach(qty => {
          const key = qty.type;
          if (!allAvailableQuantities.has(key)) {
            allAvailableQuantities.set(key, {
              value: 0,
              type: qty.type,
              unit: qty.unit,
              label: qty.label
            });
          }
          const currentQty = getSelectedQuantity(el, qty.type);
          allAvailableQuantities.get(key).value += currentQty.value;
        });
      });

      stat.quantity = totalQuantity;
      stat.unit = unit;
      stat.availableQuantities = Array.from(allAvailableQuantities.values());
      stat.selectedQuantityType = selectedType || (stat.availableQuantities[0]?.type);
    });

    const stats = Object.entries(statMap).map(([code, v]) => ({
      code,
      quantity: v.quantity,
      unit: v.unit,
      availableQuantities: v.availableQuantities,
      selectedQuantityType: v.selectedQuantityType,
      elements: v.elements,
    }));
    

    setEbkpStats(stats);
  }, [currentElements]);

  const handleQuantityTypeChange = useCallback((code: string, quantityType: string) => {
    
    const newSelections = {
      ...quantitySelections,
      [code]: quantityType
    };
    
    setQuantitySelections(newSelections);
    recalculateStats(newSelections);
  }, [quantitySelections, recalculateStats]);



  const totalCost = ebkpStats.reduce(
    (sum, s) => sum + (kennwerte[s.code] || 0) * s.quantity,
    0
  );

  // Excel handlers
  const handleExcelExport = async (): Promise<void> => {
    setIsExporting(true);
    try {
      await ExcelService.exportToExcel(ebkpStats, kennwerte, {
        fileName: `kostenkennwerte-${selectedProject}-${new Date().toISOString().split('T')[0]}`
      });
      recordExport();
    } catch (error) {
      console.error('Excel export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSmartExcelImport = () => {
    openExcelDialog();
  };

  const handleExcelImportComplete = (importedKennwerte: Record<string, number>) => {
    setKennwerte(prev => ({ ...prev, ...importedKennwerte }));
    recordImport();
  };



  return (
    <Box
      sx={{
        padding: "0",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      <Box className="w-full flex" sx={{ flexGrow: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <div className="w-1/4 min-w-[300px] max-w-[400px] px-8 pt-4 pb-0 bg-light text-primary flex flex-col h-full overflow-y-auto">
          <div className="flex flex-col h-full">
            <Typography variant="h3" className="text-5xl mb-2" color="primary">
              Kosten
            </Typography>
            <div className="flex mt-2 gap-1 flex-col">
              <FormLabel focused htmlFor="select-project">Projekt:</FormLabel>
              <FormControl variant="outlined" focused>
                <Select
                  id="select-project"
                  size="small"
                  value={selectedProject || ""}
                  onChange={handleProjectChange}
                  labelId="select-project"
                  disabled={loadingProjects}
                >
                  {loadingProjects && (
                    <MenuItem value="" disabled>
                      <CircularProgress size={20} sx={{ mr: 1 }} />
                      Lade Projekte...
                    </MenuItem>
                  )}
                  {!loadingProjects && projectsList.length === 0 && (
                    <MenuItem value="" disabled>
                      Keine Projekte gefunden
                    </MenuItem>
                  )}
                  {!loadingProjects &&
                    projectsList.map((project) => (
                      <MenuItem key={project.id} value={project.name}>
                        {project.name}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </div>



            {/* Data persistence section */}
            <Box sx={{ mt: 2, mb: 2 }}>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                Gespeicherte Daten
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    💾 Kennwerte: {Object.keys(kennwerte).length} gespeichert
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    📊 Mengenauswahl: {Object.keys(quantitySelections).length} gespeichert
                  </Typography>
                </Box>
                {lastSaved && (
                  <Typography variant="caption" color="success.main" sx={{ fontSize: '0.7rem' }}>
                    ✅ Zuletzt gespeichert: {lastSaved}
                  </Typography>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={clearSavedData}
                  sx={{ mt: 1, fontSize: "0.75rem" }}
                  disabled={Object.keys(kennwerte).length === 0 && Object.keys(quantitySelections).length === 0}
                >
                  🗑️ Alle Daten löschen
                </Button>
              </Box>
            </Box>

            <div className="flex flex-col mt-auto">
              <div>
                <Typography variant="subtitle1" className="font-bold mb-2" color="primary">
                  Anleitung
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Stepper orientation="vertical" nonLinear className="max-w-xs">
                  {Instructions.map((step) => (
                    <Step key={step.label} active>
                      <StepLabel>
                        <span className="leading-tight text-primary font-bold" style={{ color: "#0D0599" }}>
                          {step.label}
                        </span>
                      </StepLabel>
                      <div className="ml-8 -mt-2">
                        <span className="text-sm leading-none" style={{ color: "#0D0599" }}>
                          {step.description}
                        </span>
                      </div>
                    </Step>
                  ))}
                </Stepper>
              </div>
            </div>
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 w-3/4 flex flex-col overflow-y-auto">
          <div className="flex-grow px-10 pt-4 pb-10 flex flex-col">
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 2,
                minHeight: "40px",
              }}
            >
              {selectedProject && (
                <ProjectMetadataDisplay
                  metadata={modelMetadata}
                  loading={loadingElements && !modelMetadata}
                />
              )}
              
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                {selectedProject && ebkpStats.length > 0 && (
                  <SmartExcelButton
                    onExport={handleExcelExport}
                    onImport={handleSmartExcelImport}
                    isExporting={isExporting}
                    isImporting={isImporting}
                    lastExportTime={activity.lastExportTime}
                    lastImportTime={activity.lastImportTime}
                    exportCount={activity.exportCount}
                    importCount={activity.importCount}
                  />
                )}
                
                {selectedProject && totalCost > 0 && (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<SendIcon />}
                    onClick={handlePreviewCosts}
                    sx={{
                      fontWeight: 500,
                      textTransform: "none",
                      backgroundColor: "#0D0599",
                      "&:hover": {
                        backgroundColor: "#0A0477",
                      },
                    }}
                  >
                    Kosten übermitteln
                  </Button>
                )}
              </Box>
            </Box>

            <EbkpCostForm
              stats={ebkpStats}
              kennwerte={kennwerte}
              onKennwertChange={(code: string, value: number) => {
                console.log(`Updating kennwert for ${code}: ${value}`);
                setKennwerte((prev) => ({ ...prev, [code]: value }))
              }}
              onQuantityTypeChange={handleQuantityTypeChange}
              totalCost={totalCost}
              elements={currentElements}
            />


          </div>
        </div>
      </Box>
      
      <PreviewModal
        open={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        onConfirm={handleConfirmCosts}
        metaFile={metaFileForPreview}
        calculatedTotalCost={totalCost}
      />

      {/* Excel Import Dialog */}
      <ExcelImportDialog
        open={excelDialogOpen}
        onClose={closeExcelDialog}
        onImportComplete={handleExcelImportComplete}
        stats={ebkpStats}
        currentKennwerte={kennwerte}
      />
    </Box>
  );
};

export default MainPage;
