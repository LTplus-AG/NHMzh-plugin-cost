import {
  Typography,
  Select,
  MenuItem,
  FormControl,
  FormLabel,
  Divider,
  Box,
  CircularProgress,
  SelectChangeEvent,
  Stepper,
  Step,
  StepLabel,
} from "@mui/material";
import { useState, useEffect, useCallback, useMemo } from "react";
import RefreshIcon from "@mui/icons-material/Refresh";
import ProjectMetadataDisplay, {
  CostProjectMetadata,
} from "./ui/ProjectMetadataDisplay";
import EbkpCostInputTable from "./ui/EbkpCostInputTable";
import { MongoElement } from "../types/common.types";
import { useKafka } from "../contexts/KafkaContext";

interface Project {
  id: string;
  name: string;
}

const MainPage = () => {
  const Instructions = [
    {
      label: "Kennwerte eingeben",
      description:
        "Geben Sie für jede eBKP-Kategorie einen Kennwert ein. Die Kosten werden automatisch berechnet.",
    },
    {
      label: "Kosten überprüfen",
      description: "Prüfen Sie die berechneten Kosten pro Kategorie und insgesamt.",
    },
    {
      label: "Speichern",
      description: "Speichern Sie die erfassten Kennwerte und Kosten.",
    },
  ];

  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string>("");

  const [modelMetadata, setModelMetadata] = useState<CostProjectMetadata | null>(
    null
  );
  const [loadingElements, setLoadingElements] = useState(false);
  const [currentElements, setCurrentElements] = useState<MongoElement[]>([]);
  const [kennwerte, setKennwerte] = useState<Record<string, number>>({});

  const { backendUrl } = useKafka();

  const fetchElementsForProject = useCallback(
    async (projectName: string | null) => {
      if (!projectName) {
        setCurrentElements([]);
        setModelMetadata(null);
        return [];
      }
      setLoadingElements(true);
      setModelMetadata(null);
      try {
        const encodedProjectName = encodeURIComponent(projectName);
        if (!backendUrl) {
          console.error("Backend URL not available from context");
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
              filename: projectName,
              element_count: elements.length,
              upload_timestamp: new Date().toISOString(),
            });
          }
          return elements;
        } else {
          setCurrentElements([]);
          setModelMetadata(null);
          return [];
        }
      } catch (error) {
        console.error("Error fetching project elements:", error);
        setCurrentElements([]);
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
      setModelMetadata(null);
    }
  }, [selectedProject, fetchElementsForProject]);

  const handleProjectChange = (event: SelectChangeEvent<string>) => {
    setSelectedProject(event.target.value);
  };

  const ebkpStats = useMemo(() => {
    const stats: Record<string, { count: number; quantity: number }> = {};
    currentElements.forEach((el) => {
      const code =
        el.classification?.id || el.properties?.ebkph || "Unknown";
      const qty =
        el.quantity?.value ?? el.properties?.area ?? el.quantity_value ?? 0;
      if (!stats[code]) stats[code] = { count: 0, quantity: 0 };
      stats[code].count += 1;
      stats[code].quantity += qty;
    });
    return stats;
  }, [currentElements]);

  const totalCost = useMemo(() => {
    return Object.entries(ebkpStats).reduce((sum, [code, info]) => {
      const kw = kennwerte[code] || 0;
      return sum + kw * info.quantity;
    }, 0);
  }, [ebkpStats, kennwerte]);

  const handleKennwertChange = (code: string, value: number) => {
    setKennwerte((prev) => ({ ...prev, [code]: value }));
  };

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
    return (
      <EbkpCostInputTable
        stats={ebkpStats}
        kennwerte={kennwerte}
        onKennwertChange={handleKennwertChange}
      />
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
                <Typography
                  variant="h5"
                  component="p"
                  color="common.black"
                  fontWeight="bold"
                >
                  CHF {totalCost.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Kostenschätzung aus IFC
                </Typography>
              </Box>
            )}
            <div className={`flex flex-col mt-auto`}>
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
              <Box sx={{ ml: "auto" }}>
                <RefreshIcon
                  onClick={() => fetchElementsForProject(selectedProject)}
                  style={{ cursor: "pointer" }}
                />
              </Box>
            </Box>
            <Box sx={{ flex: 1, overflow: "visible" }}>{renderElementStats()}</Box>
          </div>
        </div>
      </Box>
    </Box>
  );
};

export default MainPage;
