import {
  Typography,
  Select,
  MenuItem,
  FormControl,
  FormLabel,
  Stepper,
  Step,
  StepLabel,
  Divider,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Chip,
  Box,
  Button,
  CircularProgress,
  SelectChangeEvent,
} from "@mui/material";
import { useState, useEffect, useCallback } from "react";
import CostUploader from "./CostUploader/index";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import { CostItem } from "./CostUploader/types";
import { useKafka } from "../contexts/KafkaContext";

// Define a type for cost file info
type CostFileInfo = {
  fileName: string | null;
  date: string | null;
  status: string | null;
};

// MongoDB element data structure
interface MongoElement {
  _id: string;
  project_id: string;
  ifc_id?: string;
  global_id?: string;
  ifc_class?: string;
  name?: string;
  type_name?: string;
  element_type?: string;
  level?: string;
  quantity?: {
    value: number;
    type: string;
    unit: string;
  };
  original_quantity?: {
    value: number;
    type: string;
  };
  quantity_value?: number;
  is_structural?: boolean;
  is_external?: boolean;
  classification?: {
    id: string;
    name: string;
    system: string;
  };
  materials?: Array<{
    name: string;
    unit?: string;
    volume?: number;
    fraction?: number;
  }>;
  properties: {
    category?: string;
    level?: string;
    area?: number;
    is_structural?: boolean;
    is_external?: boolean;
    ebkph?: string;
  };
  created_at: string;
  updated_at: string;
}

// Project data with real name mapping
interface ProjectDetails {
  id: string;
  name: string;
  elements?: MongoElement[];
}

// Define a type for project cost summary data
interface ProjectCostSummary {
  created_at: string;
  elements_count: number;
  cost_data_count: number;
  total_from_cost_data: number;
  total_from_elements: number;
  updated_at: string;
}

const MainPage = () => {
  const Instructions = [
    {
      label: "Kostendaten hochladen",
      description: `Laden Sie Ihre Kostendaten im Excel-Format hoch. Die Daten werden anschliessend in einer hierarchischen Übersicht angezeigt.`,
    },
    {
      label: "Daten überprüfen",
      description:
        "Überprüfen Sie die Daten in der Vorschau. Klicken Sie auf die Pfeile, um Details anzuzeigen.",
    },
    {
      label: "Daten senden",
      description:
        "Nach Überprüfung der Daten können Sie diese über den Button 'Daten senden' einreichen.",
    },
  ];

  const projectDetailsMap: Record<string, ProjectDetails> = {
    "Recyclingzentrum Juch-Areal": {
      id: "67e391836c096bf72bc23d97",
      name: "Recyclingzentrum Juch-Areal",
    },
    "Gesamterneuerung Stadthausanlage": {
      id: "67e392836c096bf72bc23d98",
      name: "Gesamterneuerung Stadthausanlage",
    },
    "Amtshaus Walche": {
      id: "67e393836c096bf72bc23d99",
      name: "Amtshaus Walche",
    },
    "Gemeinschaftszentrum Wipkingen": {
      id: "67e394836c096bf72bc23d9a",
      name: "Gemeinschaftszentrum Wipkingen",
    },
  };

  const [selectedProject, setSelectedProject] = useState(
    Object.keys(projectDetailsMap)[0]
  );
  const [costFileInfo, setCostFileInfo] = useState<CostFileInfo>({
    fileName: null,
    date: null,
    status: null,
  });
  const [totalCostSum, setTotalCostSum] = useState<number>(0);
  const [isLoadingCost, setIsLoadingCost] = useState<boolean>(false);

  const { backendUrl } = useKafka();

  const [loadingElements, setLoadingElements] = useState(false);
  const [projectDetails, setProjectDetails] =
    useState<Record<string, ProjectDetails>>(projectDetailsMap);

  const [currentElements, setCurrentElements] = useState<MongoElement[]>([]);
  const [elementsByEbkp, setElementsByEbkp] = useState<Record<string, number>>(
    {}
  );
  const [elementsByCategory, setElementsByCategory] = useState<
    Record<string, number>
  >({});

  // Add state for filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedEbkps, setSelectedEbkps] = useState<string[]>([]);

  const fetchProjectCostData = async (projectName: string) => {
    setIsLoadingCost(true);
    let retryCount = 0;
    const maxRetries = 2; // Reduce from 3 to 2 retries to minimize noise
    const initialBackoff = 500; // 500ms

    // Create a local flag to track if we've already logged the main error
    let errorLogged = false;

    const attemptFetch = async (): Promise<number> => {
      try {
        // Use backendUrl from KafkaContext for cost data
        if (!backendUrl) {
          console.error("Backend URL not available from context");
          return 0; // Or handle appropriately
        }

        // Attempt to fetch cost data
        const response = await fetch(
          `${backendUrl}/project-cost/${encodeURIComponent(projectName)}`
        );

        if (!response.ok) {
          // Parse the error details (if any)
          let errorDetails = "";
          try {
            const errorText = await response.text();
            const errorJson = JSON.parse(errorText);
            errorDetails = errorJson.error || errorText;

            // Log the main error only once, not on every retry
            if (!errorLogged) {
              console.error(`Backend API error: ${errorDetails}`);
              errorLogged = true;
            }
          } catch {
            // Parse error - just use a default message
            errorDetails = "Unknown error";
          }

          // If we've hit the max retries, return default value
          if (retryCount >= maxRetries) {
            if (!errorLogged) {
              console.error(
                `Max retries exceeded for project cost data: ${errorDetails}`
              );
            }
            return 0;
          }

          // Otherwise retry with exponential backoff (less verbose logging)
          retryCount++;
          const backoff = initialBackoff * Math.pow(2, retryCount - 1);
          console.log(
            `Retrying cost data fetch (attempt ${retryCount}/${maxRetries})`
          );

          await new Promise((resolve) => setTimeout(resolve, backoff));
          return attemptFetch();
        }

        const costSummary: ProjectCostSummary = await response.json();

        if (costSummary && costSummary.total_from_elements !== undefined) {
          return costSummary.total_from_elements;
        } else if (
          costSummary &&
          costSummary.total_from_cost_data !== undefined
        ) {
          return costSummary.total_from_cost_data;
        }

        return 0;
      } catch (error) {
        // Only log the first occurrence of an error to reduce noise
        if (!errorLogged) {
          console.error("Error fetching project cost data:", error);
          errorLogged = true;
        }

        // If we've hit the max retries, return default value
        if (retryCount >= maxRetries) {
          return 0;
        }

        // Otherwise retry with exponential backoff
        retryCount++;
        const backoff = initialBackoff * Math.pow(2, retryCount - 1);
        console.log(
          `Retrying cost data fetch (attempt ${retryCount}/${maxRetries})`
        );

        await new Promise((resolve) => setTimeout(resolve, backoff));
        return attemptFetch();
      }
    };

    try {
      const totalCost = await attemptFetch();
      setTotalCostSum(totalCost);
    } catch (error) {
      // Final fallback - only log once at the end of all retries
      if (!errorLogged) {
        console.error("Failed to fetch cost data after all retries:", error);
      }
      setTotalCostSum(0); // Set to zero as a fallback
    } finally {
      setIsLoadingCost(false);
    }
  };

  const handleCostFileUploaded = useCallback(
    (
      fileName: string | null,
      date?: string,
      status?: string,
      costData?: CostItem[],
      isUpdate?: boolean
    ) => {
      if (status === "Gelöscht" || !fileName) {
        fetchProjectCostData(selectedProject);
        setCostFileInfo({ fileName: null, date: null, status: null });
        setTotalCostSum(0);
        console.log("Cost file info reset.");
        return;
      }

      let calculatedTotal = 0;
      if (costData && costData.length > 0) {
        calculatedTotal = costData.reduce((sum, item) => {
          return sum + (item.totalChf || 0);
        }, 0);
        setTotalCostSum(calculatedTotal);
      }

      const newStatus = isUpdate ? "Erfolgreich" : status || "Vorschau";
      const newDate = date || new Date().toLocaleString("de-CH");

      setCostFileInfo({
        fileName: fileName,
        date: newDate,
        status: newStatus,
      });

      console.log(`Cost file info updated: ${fileName}, Status: ${newStatus}`);

      if (newStatus === "Erfolgreich" || newStatus === "Gespeichert") {
        setTimeout(() => {
          fetchProjectCostData(selectedProject);
        }, 1000);
      }
    },
    [selectedProject]
  );

  const formatCurrency = (amount: number): string => {
    return amount.toLocaleString("de-CH", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  const handleTemplateDownload = () => {
    const templateUrl = `/templates/241212_Kosten-Template.xlsx`;
    const link = document.createElement("a");
    link.href = templateUrl;
    link.download = "241212_Kosten-Template.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchElementsForProject = async (projectName: string) => {
    setLoadingElements(true);

    try {
      const encodedProjectName = encodeURIComponent(projectName);

      // Use backendUrl from KafkaContext
      if (!backendUrl) {
        console.error("Backend URL not available from context");
        setLoadingElements(false);
        return [];
      }

      let backendAvailable = false;

      try {
        // Try health endpoint first
        try {
          const healthResponse = await fetch(`${backendUrl}/health`, {
            method: "HEAD",
          });
          backendAvailable = healthResponse.ok;
          console.log(`Health check: ${healthResponse.status}`);
        } catch {
          // If health endpoint fails, try the root path
          const rootResponse = await fetch(backendUrl, { method: "HEAD" });
          backendAvailable = rootResponse.ok;
          console.log(`Root path check: ${rootResponse.status}`);
        }
      } catch (error) {
        console.warn("Backend server appears to be unavailable:", error);
        backendAvailable = false;
      }

      if (!backendAvailable) {
        console.warn("Backend server unavailable, skipping API call");
        setLoadingElements(false);

        // Instead of using mock data, return empty data
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});

        return [];
      }

      // Try with the path parameter format directly
      const apiUrl = `${backendUrl}/project-elements/${encodedProjectName}`;
      console.log(`Fetching from API URL: ${apiUrl}`);
      const response = await fetch(apiUrl);
      console.log(`API response status: ${response.status}`);

      // Also fetch cost summary for this project to update the total cost
      await fetchProjectCostData(projectName);

      // Check if response is ok
      if (!response.ok) {
        throw new Error(
          `Failed to fetch elements: ${response.statusText} (${response.status})`
        );
      }

      // Parse response text
      const text = await response.text();
      if (!text || text.trim() === "") {
        setLoadingElements(false);
        return [];
      }

      // Try to parse JSON
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        setLoadingElements(false);
        return [];
      }

      // Format for processing - make sure we have the expected structure
      // The response is usually an array of elements directly
      const elements = Array.isArray(data) ? data : data.elements || [];

      // Process the elements to extract stats
      if (elements && elements.length > 0) {
        // Update current elements
        setCurrentElements(elements);

        // Count elements by category and eBKP code
        const categoryCounts: Record<string, number> = {};
        const ebkpCounts: Record<string, number> = {};

        elements.forEach((element: MongoElement) => {
          // Count by category - from ifc_class if available
          const category =
            element.ifc_class || element.properties?.category || "Unknown";
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;

          // Count by eBKP code - prioritize classification.id
          const ebkpCode =
            element.classification?.id ||
            element.properties?.ebkph ||
            "Unknown";
          ebkpCounts[ebkpCode] = (ebkpCounts[ebkpCode] || 0) + 1;
        });

        setElementsByCategory(categoryCounts);
        setElementsByEbkp(ebkpCounts);

        // Store project details if we have a project ID in the elements
        if (elements[0]?.project_id) {
          const projectId = elements[0].project_id;
          setProjectDetails((prev) => ({
            ...prev,
            [projectName]: {
              ...prev[projectName],
              id: projectId,
              elements: elements,
            },
          }));
        }

        // Finish loading
        setLoadingElements(false);

        // Return the elements
        return elements;
      } else {
        // No elements found
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});
        setLoadingElements(false);
        return [];
      }
    } catch {
      setLoadingElements(false);
      return [];
    }
  };

  // Define the handler for project change
  const handleProjectChange = (event: SelectChangeEvent<string>) => {
    const newProject = event.target.value;
    setSelectedProject(newProject);

    // When project changes, fetch both elements and cost data for the new project
    setLoadingElements(true);
    Promise.all([
      fetchElementsForProject(newProject),
      fetchProjectCostData(newProject),
    ])
      .catch(() => {})
      .finally(() => {
        setLoadingElements(false);
      });
  };

  // Load project data on component mount and when backendUrl becomes available
  useEffect(() => {
    // Only run if we have a selected project AND the backendUrl is ready
    if (selectedProject && backendUrl) {
      setLoadingElements(true);
      console.log(
        `MainPage: Backend URL ready (${backendUrl}), fetching initial data...`
      ); // Add log
      // Initial data load when the page first opens or backendUrl is ready
      Promise.all([
        fetchElementsForProject(selectedProject),
        fetchProjectCostData(selectedProject),
      ])
        .catch((error) => {
          console.error("Error during initial data fetch:", error); // Add error log
        })
        .finally(() => {
          setLoadingElements(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, backendUrl]); // Add backendUrl dependency

  // Add a refresh button function for cost data
  const refreshCostData = () => {
    fetchProjectCostData(selectedProject);
  };

  // Function to toggle category filter
  const toggleCategoryFilter = (category: string) => {
    // If clicking an already selected category, just deselect it
    if (selectedCategories.includes(category)) {
      setSelectedCategories((prev) => prev.filter((c) => c !== category));
    } else {
      // When selecting a category, clear eBKP filters and set the new category
      setSelectedEbkps([]);
      setSelectedCategories((prev) =>
        prev.includes(category)
          ? prev.filter((c) => c !== category)
          : [...prev, category]
      );
    }
  };

  // Function to toggle eBKP filter
  const toggleEbkpFilter = (ebkp: string) => {
    // If clicking an already selected eBKP, just deselect it
    if (selectedEbkps.includes(ebkp)) {
      setSelectedEbkps((prev) => prev.filter((e) => e !== ebkp));
    } else {
      // When selecting an eBKP, clear category filters and set the new eBKP
      setSelectedCategories([]);
      setSelectedEbkps((prev) =>
        prev.includes(ebkp) ? prev.filter((e) => e !== ebkp) : [...prev, ebkp]
      );
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedEbkps([]);
  };

  // Function to get filtered elements
  const getFilteredElements = () => {
    if (selectedCategories.length === 0 && selectedEbkps.length === 0) {
      return currentElements;
    }

    return currentElements.filter((element) => {
      const category =
        element.ifc_class || element.properties?.category || "Unknown";
      const ebkp =
        element.classification?.id || element.properties?.ebkph || "Unknown";

      // Either match by category OR match by eBKP (since they're now mutually exclusive)
      if (selectedCategories.length > 0) {
        return selectedCategories.includes(category);
      } else if (selectedEbkps.length > 0) {
        return selectedEbkps.includes(ebkp);
      }

      return true;
    });
  };

  // Function to render element statistics
  const renderElementStats = () => {
    if (loadingElements) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      );
    }

    if (currentElements.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          Keine Elemente gefunden für dieses Projekt.
        </Typography>
      );
    }

    const filteredElements = getFilteredElements();

    return (
      <>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }} color="common.black">
            Elemente nach Kategorie:
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {Object.entries(elementsByCategory).map(([category, count]) => (
              <Chip
                key={category}
                label={`${category}: ${count}`}
                size="small"
                variant={
                  selectedCategories.includes(category) ? "filled" : "outlined"
                }
                color={
                  selectedCategories.includes(category) ? "primary" : "default"
                }
                onClick={() => toggleCategoryFilter(category)}
                sx={{ cursor: "pointer" }}
              />
            ))}
          </Box>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }} color="common.black">
            Elemente nach eBKP:
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {Object.entries(elementsByEbkp).map(([code, count]) => (
              <Chip
                key={code}
                label={`${code}: ${count}`}
                size="small"
                variant={selectedEbkps.includes(code) ? "filled" : "outlined"}
                color={selectedEbkps.includes(code) ? "primary" : "default"}
                onClick={() => toggleEbkpFilter(code)}
                sx={{ cursor: "pointer" }}
              />
            ))}
          </Box>
        </Box>

        <Box
          sx={{ mb: 1, flexGrow: 1, display: "flex", flexDirection: "column" }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
            }}
          >
            <Typography variant="subtitle2" color="common.black">
              Neueste Elemente:
              {(selectedCategories.length > 0 || selectedEbkps.length > 0) &&
                ` (${filteredElements.length} gefiltert)`}
            </Typography>

            {(selectedCategories.length > 0 || selectedEbkps.length > 0) && (
              <Button
                size="small"
                variant="text"
                color="primary"
                onClick={clearFilters}
                sx={{ minWidth: 0, p: 0.5 }}
              >
                Filter löschen
              </Button>
            )}
          </Box>

          <TableContainer
            sx={{
              overflow: "auto",
              height: "calc(100vh - 500px)",
              minHeight: "200px",
            }}
          >
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Element ID</TableCell>
                  <TableCell>Typ</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Level</TableCell>
                  <TableCell>Material</TableCell>
                  <TableCell>eBKP</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredElements.map((element) => (
                  <TableRow key={element._id}>
                    <TableCell>{element._id.substring(0, 6)}...</TableCell>
                    <TableCell>
                      {element.type_name ||
                        element.element_type ||
                        element.ifc_class ||
                        "—"}
                    </TableCell>
                    <TableCell>{element.name || "—"}</TableCell>
                    <TableCell>
                      {element.level || element.properties?.level || "—"}
                    </TableCell>
                    <TableCell>
                      {element.materials && element.materials.length > 0
                        ? element.materials[0].name
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {element.classification?.id ||
                        element.properties?.ebkph ||
                        "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </>
    );
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
        {/* Sidebar - fixed, no scroll */}
        <div className="w-1/4 min-w-[300px] max-w-[400px] px-8 pt-4 pb-0 bg-light text-primary flex flex-col h-full overflow-y-auto">
          {/* Header und Inhalte */}
          <div className="flex flex-col h-full">
            <Typography variant="h3" className="text-5xl mb-2" color="primary">
              Kosten
            </Typography>
            <div className="flex mt-2 gap-1 flex-col">
              <FormLabel focused htmlFor="select-project">
                Projekt:
              </FormLabel>
              <FormControl variant="outlined" focused>
                <Select
                  id="select-project"
                  size="small"
                  value={selectedProject}
                  onChange={handleProjectChange}
                  labelId="select-project"
                >
                  {Object.keys(projectDetails).map((projectName) => (
                    <MenuItem key={projectName} value={projectName}>
                      {projectName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>

            {/* Total Cost Sum Box */}
            <Box
              sx={{
                p: 2,
                mt: 2,
                mb: 2,
                background: "linear-gradient(to right top, #F1D900, #fff176)",
                borderRadius: 1,
                textAlign: "center",
                position: "relative",
              }}
            >
              {isLoadingCost && (
                <CircularProgress
                  size={16}
                  sx={{
                    position: "absolute",
                    top: 5,
                    right: 5,
                    color: "#666",
                  }}
                />
              )}
              <Typography
                variant="h4"
                component="p"
                color="common.black"
                fontWeight="bold"
              >
                {formatCurrency(totalCostSum)}
                <Typography
                  component="span"
                  variant="h6"
                  sx={{ ml: 1, opacity: 0.7, fontWeight: "normal" }}
                >
                  CHF
                </Typography>
              </Typography>
              <Typography
                variant="caption"
                sx={{ mt: 0.5, display: "block", cursor: "pointer" }}
                onClick={refreshCostData}
              >
                Aktualisiert: {new Date().toLocaleTimeString()}
              </Typography>
            </Box>

            {/* Hochgeladene Dateien Section - Only show if there are files */}
            {costFileInfo.fileName && (
              <div
                className="mb-4 mt-2 flex flex-col overflow-hidden"
                style={{ minHeight: "150px" }}
              >
                <Typography
                  variant="subtitle1"
                  className="font-bold mb-2"
                  color="primary"
                >
                  Hochgeladene Datei
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
                >
                  <InsertDriveFileIcon
                    color="primary"
                    fontSize="small"
                    sx={{ mr: 0.5, fontSize: "1rem" }}
                  />
                  <Typography
                    variant="body2"
                    sx={{ wordBreak: "break-word", flexGrow: 1 }}
                  >
                    {costFileInfo.fileName}
                  </Typography>
                </Box>
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Datum:
                  </Typography>
                  <Typography variant="body2">{costFileInfo.date}</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Status:
                  </Typography>
                  <Chip
                    label={costFileInfo.status}
                    color={
                      costFileInfo.status === "Vorschau"
                        ? "warning"
                        : costFileInfo.status === "Gelöscht"
                        ? "default"
                        : "success"
                    }
                    size="small"
                    variant="outlined"
                    sx={{ height: 20, fontSize: "0.7rem" }}
                  />
                </Box>
              </div>
            )}

            {/* Fusszeile - Position at bottom when files aren't shown */}
            <div className={`flex flex-col mt-auto`}>
              {/* Anleitung Section */}
              <div>
                <Typography
                  variant="subtitle1"
                  className="font-bold mb-2"
                  color="primary"
                >
                  Anleitung
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Stepper orientation="vertical" nonLinear className="max-w-xs">
                  {Instructions.map((step) => (
                    <Step key={step.label} active>
                      <StepLabel>
                        <span
                          className="leading-tight text-primary font-bold"
                          style={{ color: "#0D0599" }}
                        >
                          {step.label}
                        </span>
                      </StepLabel>
                      <div className="ml-8 -mt-2">
                        <span
                          className="text-sm leading-none"
                          style={{ color: "#0D0599" }}
                        >
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

        {/* Hauptbereich - single scrollbar */}
        <div className="flex-1 w-3/4 flex flex-col overflow-y-auto">
          <div className="flex-grow px-10 pt-4 pb-10 flex flex-col">
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 6,
              }}
            >
              {!costFileInfo.fileName && (
                <Typography variant="h2" className="text-5xl">
                  Kostendaten hochladen
                </Typography>
              )}

              {!costFileInfo.fileName && (
                <Button
                  variant="outlined"
                  color="primary"
                  size="medium"
                  startIcon={<DownloadIcon />}
                  onClick={handleTemplateDownload}
                >
                  Kosten-Template herunterladen
                </Button>
              )}
            </Box>

            {/* Cost Uploader Component */}
            <div className="flex-grow flex flex-col">
              <CostUploader
                onFileUploaded={handleCostFileUploaded}
                totalElements={0}
                totalCost={totalCostSum}
                projectName={selectedProject}
                elementsComponent={
                  <Box
                    sx={{
                      p: 2,
                      mt: 4,
                      mb: 0,
                      border: "1px solid #e0e0e0",
                      borderRadius: 1,
                      background: "#f5f5f5",
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      fontWeight="bold"
                      sx={{ mb: 2 }}
                      color="common.black"
                    >
                      Projektelemente
                      <Button
                        size="small"
                        startIcon={<RefreshIcon />}
                        onClick={() => fetchElementsForProject(selectedProject)}
                        disabled={loadingElements}
                        variant="outlined"
                        sx={{ ml: 1, height: 20, fontSize: "0.7rem", py: 0 }}
                      >
                        Aktualisieren
                      </Button>
                    </Typography>

                    <Box sx={{ flex: 1, overflow: "visible" }}>
                      {renderElementStats()}
                    </Box>
                  </Box>
                }
              />
            </div>
          </div>
        </div>
      </Box>
    </Box>
  );
};

export default MainPage;
