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
import ProjectMetadataDisplay, {
  CostProjectMetadata,
} from "./ui/ProjectMetadataDisplay";
import { MongoElement } from "../types/common.types"; // Corrected Import Path for MongoElement
import { useCostCalculation } from "../hooks/useCostCalculation"; // Import the hook

// Define a type for cost file info
type CostFileInfo = {
  fileName: string | null;
  date: string | null;
  status: string | null;
};

// Project data with real name mapping - CHANGED: Now fetched from API
interface Project {
  id: string;
  name: string;
  // elements?: MongoElement[]; // We load elements separately based on selected project
}

// REMOVED: Unused ProjectCostSummary interface

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

  // REMOVED: Hardcoded projectDetailsMap

  // State for projects fetched from API
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string>(""); // Initialize as empty string

  const [costFileInfo, setCostFileInfo] = useState<CostFileInfo>({
    fileName: null,
    date: null,
    status: null,
  });

  // NEW State: Store cost data from the uploaded file
  const [uploadedCostData, setUploadedCostData] = useState<CostItem[] | null>(
    null
  );
  const [processedCostData, setProcessedCostData] = useState<CostItem[] | null>(
    null
  ); // State for post-BIM data

  // NEW State for Model Metadata
  const [modelMetadata, setModelMetadata] =
    useState<CostProjectMetadata | null>(null);

  const { backendUrl } = useKafka();

  const [loadingElements, setLoadingElements] = useState(false);
  // REMOVED: State for projectDetails (now just projectsList)

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

  const handleCostFileUploaded = useCallback(
    (
      fileName: string | null,
      date?: string,
      status?: string,
      costData?: CostItem[] | { data: CostItem[] } | null, // This is the UPDATED hierarchical data after BIM mapping
      isUpdate?: boolean // This flag indicates if it's the final save (true) or just preview update (false)
    ) => {
      if (status === "Gelöscht" || !fileName) {
        setCostFileInfo({ fileName: null, date: null, status: null });
        setUploadedCostData(null); // Clear initial data
        setProcessedCostData(null); // Clear processed data
        return;
      }

      const newStatus = isUpdate ? "Erfolgreich" : status || "Vorschau";
      const newDate = date || new Date().toLocaleString("de-CH");

      setCostFileInfo({
        fileName: fileName,
        date: newDate,
        status: newStatus,
      });

      // Extract the hierarchical array of CostItems
      const dataArray: CostItem[] | null = costData
        ? Array.isArray(costData)
          ? costData
          : costData.data
        : null;

      // If this is the first time data is uploaded (not an update/final save),
      // store it as the initial uploaded data.
      if (!isUpdate && dataArray && !uploadedCostData) {
        setUploadedCostData(dataArray);
      }

      // Store the potentially processed data (always update this when callback is called)
      setProcessedCostData(dataArray);
    },
    [uploadedCostData] // Re-run if uploadedCostData changes (for initial set)
  );

  // REMOVED: Unused formatCurrency function

  const handleTemplateDownload = () => {
    const templateUrl = `/templates/241212_Kosten-Template.xlsx`;
    const link = document.createElement("a");
    link.href = templateUrl;
    link.download = "241212_Kosten-Template.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Fetch elements for the selected project name
  const fetchElementsForProject = useCallback(
    async (projectName: string | null) => {
      // Do nothing if projectName is null or empty
      if (!projectName) {
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});
        setLoadingElements(false);
        setModelMetadata(null); // Clear metadata if no project
        return [];
      }

      setLoadingElements(true);
      setModelMetadata(null); // Clear previous metadata while loading new

      try {
        const encodedProjectName = encodeURIComponent(projectName);

        if (!backendUrl) {
          console.error("Backend URL not available from context");
          setLoadingElements(false);
          return [];
        }

        // Simplified health check - assume available or let fetch fail
        const apiUrl = `${backendUrl}/project-elements/${encodedProjectName}`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
          throw new Error(
            `Failed to fetch elements: ${response.statusText} (${response.status})`
          );
        }

        const data = await response.json();
        const elements = Array.isArray(data) ? data : data.elements || [];
        const modelMetadata = data.modelMetadata || null;

        if (elements && elements.length > 0) {
          setCurrentElements(elements);

          if (modelMetadata && modelMetadata.filename) {
            setModelMetadata({
              filename: modelMetadata.filename,
              element_count: elements.length,
              upload_timestamp: modelMetadata.timestamp,
            });
          } else {
            setModelMetadata({
              filename: selectedProject || "Unbekanntes Modell",
              element_count: elements.length,
              upload_timestamp: new Date().toISOString(),
            });
          }

          const categoryCounts: Record<string, number> = {};
          const ebkpCounts: Record<string, number> = {};

          elements.forEach((element: MongoElement) => {
            const category =
              element.ifc_class || element.properties?.category || "Unknown";
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;

            const ebkpCode =
              element.classification?.id ||
              element.properties?.ebkph ||
              "Unknown";
            ebkpCounts[ebkpCode] = (ebkpCounts[ebkpCode] || 0) + 1;
          });

          setElementsByCategory(categoryCounts);
          setElementsByEbkp(ebkpCounts);
          return elements;
        } else {
          setCurrentElements([]);
          setElementsByCategory({});
          setElementsByEbkp({});
          setModelMetadata(null); // No elements, no metadata
          return [];
        }
      } catch (error) {
        console.error("Error fetching project elements:", error);
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});
        setModelMetadata(null); // Error, clear metadata
        return [];
      } finally {
        setLoadingElements(false);
      }
    },
    [backendUrl, selectedProject] // Depend only on backendUrl and selectedProject
  );

  // Fetch the list of projects when the component mounts or backendUrl changes
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
          // Set the first project as selected *only if* no project is currently selected
          // and the fetched list is not empty.
          if (projects.length > 0 && !selectedProject) {
            setSelectedProject(projects[0].name);
          }
        } catch (error) {
          console.error("Failed to fetch projects:", error);
          setProjectsList([]); // Reset to empty on error
        } finally {
          setLoadingProjects(false);
        }
      };

      fetchProjects();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]); // <-- DEPEND ONLY ON backendUrl

  // Fetch elements when the selected project changes (and is valid)
  useEffect(() => {
    // Only fetch if selectedProject has a valid value (not empty string)
    if (selectedProject) {
      fetchElementsForProject(selectedProject);
    } else {
      // Clear elements if project is deselected or becomes invalid
      setCurrentElements([]);
      setElementsByCategory({});
      setElementsByEbkp({});
      setModelMetadata(null); // Clear metadata if project is deselected
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]); // Depend only on selectedProject (fetchElementsForProject is stable due to useCallback)

  // Define the handler for project change
  const handleProjectChange = (event: SelectChangeEvent<string>) => {
    const newProjectName = event.target.value;
    setSelectedProject(newProjectName); // This will trigger the useEffect above to fetch elements
  };

  // Function to toggle category filter
  const toggleCategoryFilter = (category: string) => {
    if (selectedCategories.includes(category)) {
      setSelectedCategories((prev) => prev.filter((c) => c !== category));
    } else {
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
    if (selectedEbkps.includes(ebkp)) {
      setSelectedEbkps((prev) => prev.filter((e) => e !== ebkp));
    } else {
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

      if (selectedCategories.length > 0) {
        return selectedCategories.includes(category);
      } else if (selectedEbkps.length > 0) {
        return selectedEbkps.includes(ebkp);
      }

      return true;
    });
  };

  // Calculate initial total from raw Excel upload
  const { totalCost: initialExcelTotal } = useCostCalculation(uploadedCostData);

  // Calculate final total from processed data (after BIM mapping)
  const { totalCost: finalTotalCost } = useCostCalculation(processedCostData);

  // Determine which total to display in the sidebar
  const displayTotalInSidebar = processedCostData
    ? finalTotalCost
    : initialExcelTotal;

  // Function to render element statistics
  const renderElementStats = () => {
    if (loadingElements || loadingProjects) {
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
              height: "calc(100vh - 500px)", // Adjust height as needed
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
                  value={selectedProject || ""} // Ensure value is not null/undefined
                  onChange={handleProjectChange}
                  labelId="select-project"
                  disabled={loadingProjects} // Disable while loading
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

            {/* Display Total Cost Box */}
            {costFileInfo.fileName && displayTotalInSidebar > 0 && (
              <Box
                sx={{
                  mt: 3, // Margin top
                  mb: 2, // Margin bottom
                  p: 2,
                  background: "linear-gradient(to right top, #F1D900, #fff176)",
                  borderRadius: "4px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  minHeight: "60px",
                  boxShadow: 1,
                }}
              >
                <Typography
                  variant="h5"
                  component="p"
                  color="common.black"
                  fontWeight="bold"
                >
                  CHF{" "}
                  {displayTotalInSidebar.toLocaleString("de-CH", {
                    // Use displayTotalInSidebar
                    maximumFractionDigits: 0,
                  })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Kostenschätzung (Berechnet{" "}
                  {processedCostData ? "aus IFC & Excel" : "aus Excel"})
                </Typography>
              </Box>
            )}

            {/* Uploaded File Info */}
            {costFileInfo.fileName && (
              <div
                className="mb-4 mt-2 flex flex-col overflow-hidden"
                style={{ minHeight: "auto" }}
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
                mb: 2, // Reduced margin as metadata is smaller
                minHeight: "40px", // Ensure space for metadata or button
              }}
            >
              {selectedProject && (
                <ProjectMetadataDisplay
                  metadata={modelMetadata}
                  loading={loadingElements && !modelMetadata} // Show loading only if elements are loading AND metadata isn't set yet
                />
              )}

              {/* Conditionally show title if no project is selected, or if metadata is not the primary focus yet */}
              {!selectedProject &&
                !costFileInfo.fileName &&
                projectsList.length > 0 && (
                  <Typography variant="h2" className="text-5xl">
                    Kostendaten hochladen
                  </Typography>
                )}

              {/* "Kosten-Template herunterladen" Button */}
              {/* Show if no cost file is uploaded, and ensure it's on the right if metadata is shown */}
              {!costFileInfo.fileName && (
                <Button
                  variant="outlined"
                  color="primary"
                  size="medium"
                  startIcon={<DownloadIcon />}
                  onClick={handleTemplateDownload}
                  sx={{
                    ml: selectedProject && modelMetadata ? "auto" : undefined, // Pushes to the right if metadata is present
                  }}
                >
                  Kosten-Template herunterladen
                </Button>
              )}
            </Box>

            {/* Cost Uploader Component */}
            <div className="flex-grow flex flex-col">
              <CostUploader
                onFileUploaded={handleCostFileUploaded}
                totalElements={currentElements.length}
                bimElements={currentElements}
                projectName={selectedProject}
                costData={processedCostData || uploadedCostData}
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
                        disabled={loadingElements || loadingProjects}
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
