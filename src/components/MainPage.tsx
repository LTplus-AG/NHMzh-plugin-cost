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
import { useKafka } from "../contexts/KafkaContext";
import ProjectMetadataDisplay, {
  CostProjectMetadata,
} from "./ui/ProjectMetadataDisplay";
import { MongoElement } from "../types/common.types";
import EbkpCostForm, { EbkpStat } from "./EbkpCostForm";

const getElementQuantity = (
  el: MongoElement
): { qty: number; unit?: string } => {
  const ex = el as Record<string, unknown>;
  if (el.quantity?.type === "Area" && typeof el.quantity.value === "number") {
    return { qty: el.quantity.value, unit: el.quantity.unit };
  }
  if (typeof ex.area === "number") {
    return { qty: ex.area as number, unit: el.quantity?.unit };
  }
  if (typeof el.properties?.area === "number") {
    return { qty: el.properties.area, unit: el.quantity?.unit };
  }
  if (typeof ex.original_area === "number") {
    return { qty: ex.original_area as number, unit: el.quantity?.unit };
  }
  if (typeof el.quantity?.value === "number") {
    return { qty: el.quantity.value, unit: el.quantity.unit };
  }
  if (typeof el.quantity_value === "number") {
    return { qty: el.quantity_value, unit: el.quantity?.unit };
  }
  if (typeof ex.length === "number") {
    return { qty: ex.length as number, unit: el.quantity?.unit };
  }
  if (typeof ex.volume === "number") {
    return { qty: ex.volume as number, unit: el.quantity?.unit };
  }
  if (typeof ex.quantity === "number") {
    return { qty: ex.quantity as number, unit: el.quantity?.unit };
  }
  return { qty: 0, unit: el.quantity?.unit };
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
  const [elementsByEbkp, setElementsByEbkp] = useState<Record<string, number>>({});
  const [elementsByCategory, setElementsByCategory] = useState<
    Record<string, number>
  >({});

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedEbkps, setSelectedEbkps] = useState<string[]>([]);

  const [ebkpStats, setEbkpStats] = useState<EbkpStat[]>([]);
  const [kennwerte, setKennwerte] = useState<Record<string, number>>({});

  const fetchElementsForProject = useCallback(
    async (projectName: string | null) => {
      if (!projectName) {
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});
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

          const categoryCounts: Record<string, number> = {};
          const ebkpCounts: Record<string, number> = {};
          const statMap: Record<string, { quantity: number; unit?: string }> = {};

          elements.forEach((el: MongoElement) => {
            const category =
              el.ifc_class || el.properties?.category || "Unknown";
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;

            const code =
              el.classification?.id || el.properties?.ebkph || "Unknown";
            ebkpCounts[code] = (ebkpCounts[code] || 0) + 1;

            const { qty, unit } = getElementQuantity(el);
            if (!statMap[code]) statMap[code] = { quantity: 0, unit };
            statMap[code].quantity += qty;
            if (!statMap[code].unit && unit) statMap[code].unit = unit;
          });

          setElementsByCategory(categoryCounts);
          setElementsByEbkp(ebkpCounts);
          const stats = Object.entries(statMap).map(([code, v]) => ({
            code,
            quantity: v.quantity,
            unit: v.unit,
          }));
          setEbkpStats(stats);
          setKennwerte((prev) => {
            const updated: Record<string, number> = {};
            stats.forEach((s) => {
              if (prev[s.code] !== undefined) updated[s.code] = prev[s.code];
            });
            return updated;
          });
          return elements;
        } else {
          setCurrentElements([]);
          setElementsByCategory({});
          setElementsByEbkp({});
          setEbkpStats([]);
          setModelMetadata(null);
          return [];
        }
      } catch (error) {
        console.error("Error fetching project elements:", error);
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});
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
      setElementsByCategory({});
      setElementsByEbkp({});
      setEbkpStats([]);
      setModelMetadata(null);
    }
  }, [selectedProject]);

  const handleProjectChange = (event: SelectChangeEvent<string>) => {
    const newProjectName = event.target.value;
    setSelectedProject(newProjectName);
  };

  const toggleCategoryFilter = (category: string) => {
    if (selectedCategories.includes(category)) {
      setSelectedCategories((prev) => prev.filter((c) => c !== category));
    } else {
      setSelectedEbkps([]);
      setSelectedCategories((prev) =>
        prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
      );
    }
  };

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

  const totalCost = ebkpStats.reduce(
    (sum, s) => sum + (kennwerte[s.code] || 0) * s.quantity,
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
                    <TableCell>
                      {element.type_name || element.element_type || element.ifc_class || "—"}
                    </TableCell>
                    <TableCell>{element.name || "—"}</TableCell>
                    <TableCell>{element.level || element.properties?.level || "—"}</TableCell>
                    <TableCell>
                      {element.materials && element.materials.length > 0
                        ? element.materials[0].name
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {element.classification?.id || element.properties?.ebkph || "—"}
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
            </Box>

            <EbkpCostForm
              stats={ebkpStats}
              kennwerte={kennwerte}
              onKennwertChange={(code, value) =>
                setKennwerte((prev) => ({ ...prev, [code]: value }))
              }
            />

            <Box sx={{ p: 2, mt: 4, mb: 0, border: "1px solid #e0e0e0", borderRadius: 1, background: "#f5f5f5", flex: 1, display: "flex", flexDirection: "column", width: "100%" }}>
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }} color="common.black">
                Projektelemente
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => fetchElementsForProject(selectedProject)}
                  disabled={loadingElements || loadingProjects}
                  sx={{ ml: 1, height: 20, fontSize: "0.7rem", py: 0 }}
                >
                  Aktualisieren
                </Button>
              </Typography>
              <Box sx={{ flex: 1, overflow: "visible" }}>{renderElementStats()}</Box>
            </Box>
          </div>
        </div>
      </Box>
    </Box>
  );
};

export default MainPage;
