import { useState, useEffect, useCallback } from "react";
import {
  Typography,
  Select,
  MenuItem,
  FormControl,
  FormLabel,
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
import RefreshIcon from "@mui/icons-material/Refresh";
import { useKafka } from "../contexts/KafkaContext";
import { MongoElement } from "../types/common.types";
import ProjectMetadataDisplay, { CostProjectMetadata } from "./ui/ProjectMetadataDisplay";
import EbkpCostInput from "./EbkpCostInput";

interface Project {
  id: string;
  name: string;
}

const MainPage = () => {
  const { backendUrl } = useKafka();
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string>("");

  const [currentElements, setCurrentElements] = useState<MongoElement[]>([]);
  const [elementsByEbkp, setElementsByEbkp] = useState<Record<string, number>>({});
  const [quantitiesByEbkp, setQuantitiesByEbkp] = useState<Record<string, number>>({});
  const [elementsByCategory, setElementsByCategory] = useState<Record<string, number>>({});
  const [kennwerte, setKennwerte] = useState<Record<string, number>>({});
  const [modelMetadata, setModelMetadata] = useState<CostProjectMetadata | null>(null);
  const [loadingElements, setLoadingElements] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedEbkps, setSelectedEbkps] = useState<string[]>([]);

  const fetchElementsForProject = useCallback(
    async (projectName: string | null) => {
      if (!projectName) {
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});
        setQuantitiesByEbkp({});
        setModelMetadata(null);
        return [];
      }

      setLoadingElements(true);
      try {
        const encodedProjectName = encodeURIComponent(projectName);
        if (!backendUrl) {
          setLoadingElements(false);
          return [];
        }
        const apiUrl = `${backendUrl}/project-elements/${encodedProjectName}`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch elements: ${response.statusText} (${response.status})`);
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
              filename: projectName,
              element_count: elements.length,
              upload_timestamp: new Date().toISOString(),
            });
          }
          const categoryCounts: Record<string, number> = {};
          const ebkpCounts: Record<string, number> = {};
          const qtyCounts: Record<string, number> = {};

          elements.forEach((element: MongoElement) => {
            const category = element.ifc_class || element.properties?.category || "Unknown";
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            const ebkpCode = element.classification?.id || element.properties?.ebkph || "Unknown";
            ebkpCounts[ebkpCode] = (ebkpCounts[ebkpCode] || 0) + 1;
            const qty =
              (element.quantity && typeof element.quantity === "object" && element.quantity.value) ||
              element.properties?.area ||
              0;
            qtyCounts[ebkpCode] = (qtyCounts[ebkpCode] || 0) + qty;
          });

          setElementsByCategory(categoryCounts);
          setElementsByEbkp(ebkpCounts);
          setQuantitiesByEbkp(qtyCounts);
          return elements;
        } else {
          setCurrentElements([]);
          setElementsByCategory({});
          setElementsByEbkp({});
          setQuantitiesByEbkp({});
          setModelMetadata(null);
          return [];
        }
      } catch (error) {
        console.error("Error fetching project elements:", error);
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});
        setQuantitiesByEbkp({});
        setModelMetadata(null);
        return [];
      } finally {
        setLoadingElements(false);
      }
    },
    [backendUrl]
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
      setElementsByCategory({});
      setElementsByEbkp({});
      setQuantitiesByEbkp({});
      setModelMetadata(null);
    }
  }, [selectedProject, fetchElementsForProject]);

  const handleProjectChange = (event: SelectChangeEvent<string>) => {
    const newProjectName = event.target.value;
    setSelectedProject(newProjectName);
    setKennwerte({});
  };

  const toggleCategoryFilter = (category: string) => {
    if (selectedCategories.includes(category)) {
      setSelectedCategories((prev) => prev.filter((c) => c !== category));
    } else {
      setSelectedEbkps([]);
      setSelectedCategories((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]));
    }
  };

  const toggleEbkpFilter = (ebkp: string) => {
    if (selectedEbkps.includes(ebkp)) {
      setSelectedEbkps((prev) => prev.filter((e) => e !== ebkp));
    } else {
      setSelectedCategories([]);
      setSelectedEbkps((prev) => (prev.includes(ebkp) ? prev.filter((e) => e !== ebkp) : [...prev, ebkp]));
    }
  };

  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedEbkps([]);
  };

  const getFilteredElements = () => {
    if (selectedCategories.length === 0 && selectedEbkps.length === 0) {
      return currentElements;
    }
    return currentElements.filter((element) => {
      const category = element.ifc_class || element.properties?.category || "Unknown";
      const ebkp = element.classification?.id || element.properties?.ebkph || "Unknown";
      if (selectedCategories.length > 0) {
        return selectedCategories.includes(category);
      } else if (selectedEbkps.length > 0) {
        return selectedEbkps.includes(ebkp);
      }
      return true;
    });
  };

  const totalCost = Object.entries(quantitiesByEbkp).reduce(
    (sum, [code, qty]) => sum + qty * (kennwerte[code] || 0),
    0
  );

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
                variant={selectedCategories.includes(category) ? "filled" : "outlined"}
                color={selectedCategories.includes(category) ? "primary" : "default"}
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
        <Box sx={{ mb: 1, flexGrow: 1, display: "flex", flexDirection: "column" }}>
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
              {(selectedCategories.length > 0 || selectedEbkps.length > 0) && ` (${filteredElements.length} gefiltert)`}
            </Typography>
            {(selectedCategories.length > 0 || selectedEbkps.length > 0) && (
              <Button size="small" variant="text" color="primary" onClick={clearFilters} sx={{ minWidth: 0, p: 0.5 }}>
                Filter löschen
              </Button>
            )}
          </Box>
          <TableContainer sx={{ overflow: "auto", height: "calc(100vh - 500px)", minHeight: "200px" }}>
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
                    <TableCell>{element.type_name || element.element_type || element.ifc_class || "—"}</TableCell>
                    <TableCell>{element.name || "—"}</TableCell>
                    <TableCell>{element.level || element.properties?.level || "—"}</TableCell>
                    <TableCell>{element.materials && element.materials.length > 0 ? element.materials[0].name : "—"}</TableCell>
                    <TableCell>{element.classification?.id || element.properties?.ebkph || "—"}</TableCell>
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
    <Box sx={{ padding: "0", display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      <Box className="w-full flex" sx={{ flexGrow: 1, overflow: "hidden" }}>
        <div className="w-1/4 min-w-[300px] max-w-[400px] px-8 pt-4 pb-0 bg-light text-primary flex flex-col h-full overflow-y-auto">
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
            {totalCost > 0 && (
              <Box
                sx={{
                  mt: 3,
                  mb: 2,
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
                <Typography variant="h5" component="p" color="common.black" fontWeight="bold">
                  CHF {totalCost.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Kostenschätzung
                </Typography>
              </Box>
            )}
            <div className="flex flex-col mt-4">
              <EbkpCostInput quantities={quantitiesByEbkp} kennwerte={kennwerte} onKennwerteChange={setKennwerte} />
            </div>
            <div className="flex flex-col mt-auto">
              <Typography variant="subtitle1" className="font-bold mb-2" color="primary">
                Anleitung
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Geben Sie für jeden eBKP-Code einen Kennwert ein. Die Kosten werden automatisch berechnet.
              </Typography>
            </div>
          </div>
        </div>
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
                <ProjectMetadataDisplay metadata={modelMetadata} loading={loadingElements && !modelMetadata} />
              )}
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => fetchElementsForProject(selectedProject)}
                disabled={loadingElements || loadingProjects}
                variant="outlined"
                sx={{ ml: "auto" }}
              >
                Aktualisieren
              </Button>
            </Box>
            <Box sx={{ flex: 1, overflow: "visible" }}>{renderElementStats()}</Box>
          </div>
        </div>
      </Box>
    </Box>
  );
};

export default MainPage;
