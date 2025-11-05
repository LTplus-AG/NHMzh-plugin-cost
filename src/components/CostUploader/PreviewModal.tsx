import React, { useState, useMemo } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  Box,
  Chip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  AlertTitle,
  Tabs,
  Tab,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningIcon from "@mui/icons-material/Warning";
import { MetaFile, CostItem } from "./types";
import { EbkpStat } from "../EbkpCostForm";

// Define a more specific type for the enhanced data passed to onConfirm
// Based on the structure created in handleConfirm
// Export it here as well to try and resolve import issues
export interface EnhancedCostItem extends CostItem {
  id: string;
  category: string;
  level: string;
  is_structural: boolean;
  fire_rating: string;
  ebkp: string;
  ebkph: string;
  ebkph1: string;
  ebkph2: string;
  ebkph3: string;
  cost_unit: number;
  area: number;
  cost: number;
  element_count: number;
  fileID: string;
  fromKafka: boolean;
  kafkaSource: string;
  kafkaTimestamp: string;
  areaSource: string;
  einheit: string;
  menge: number;
  totalChf: number;
  kennwert: number;
  bezeichnung: string;
  originalItem?: Partial<CostItem>; // Make originalItem optional and partial
}

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (matches: EnhancedCostItem[]) => void;
  metaFile: MetaFile | null;
  calculatedTotalCost: number;
  ebkpStats: EbkpStat[];
  kennwerte: Record<string, number>;
}

// Helper function to get main group from eBKP code (C, E, F, G, etc.)
const getMainGroup = (code: string): string => {
  const match = code.match(/^([A-Z])/);
  return match ? match[1] : "Unknown";
};

const PreviewModal: React.FC<PreviewModalProps> = ({
  open,
  onClose,
  onConfirm,
  metaFile,
  calculatedTotalCost,
  ebkpStats,
  kennwerte,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);

  // Calculate completeness statistics
  const completenessStats = useMemo(() => {
    const totalGroups = ebkpStats.length;
    const groupsWithCosts = ebkpStats.filter(
      (stat) => kennwerte[stat.code] && kennwerte[stat.code] > 0
    ).length;
    const groupsMissingCosts = ebkpStats.filter(
      (stat) => !kennwerte[stat.code] || kennwerte[stat.code] <= 0
    );
    const completionPercentage =
      totalGroups > 0 ? Math.round((groupsWithCosts / totalGroups) * 100) : 0;

    return {
      totalGroups,
      groupsWithCosts,
      groupsMissingCosts,
      completionPercentage,
      isComplete: completionPercentage === 100,
    };
  }, [ebkpStats, kennwerte]);

  // Calculate cost breakdown by main group (C, E, F, G, etc.)
  const costByMainGroup = useMemo(() => {
    const groups: Record<string, number> = {};
    ebkpStats.forEach((stat) => {
      const kennwert = kennwerte[stat.code] || 0;
      const totalCost = kennwert * stat.quantity;
      const mainGroup = getMainGroup(stat.code);
      groups[mainGroup] = (groups[mainGroup] || 0) + totalCost;
    });
    return groups;
  }, [ebkpStats, kennwerte]);

  // Prepare sorted groups for display (incomplete first, then by code)
  const sortedGroups = useMemo(() => {
    return [...ebkpStats].sort((a, b) => {
      const aHasCost = kennwerte[a.code] && kennwerte[a.code] > 0;
      const bHasCost = kennwerte[b.code] && kennwerte[b.code] > 0;

      // Incomplete groups first
      if (aHasCost !== bHasCost) {
        return aHasCost ? 1 : -1;
      }

      // Then sort by code
      return a.code.localeCompare(b.code);
    });
  }, [ebkpStats, kennwerte]);

  const filteredGroups = useMemo(() => {
    if (showOnlyMissing) {
      return sortedGroups.filter((stat) => !kennwerte[stat.code] || kennwerte[stat.code] <= 0);
    }
    return sortedGroups;
  }, [showOnlyMissing, sortedGroups, kennwerte]);

  // Simplified handleConfirm - create enhanced data from ebkpStats
  const handleConfirm = () => {
    // Create enhanced data from ebkpStats with costs
    const enhancedData: EnhancedCostItem[] = ebkpStats
      .filter((stat) => kennwerte[stat.code] && kennwerte[stat.code] > 0)
      .map((stat) => {
        const kennwert = kennwerte[stat.code] || 0;
        const totalCost = kennwert * stat.quantity;
        const elementCount = stat.elements?.length || 0;

        return {
          id: stat.code,
          ebkp: stat.code,
          ebkph: stat.code,
          ebkph1: stat.code.match(/^([A-Z]\d+)/)?.[1] || "",
          ebkph2: stat.code.match(/^[A-Z]\d+\.(\d+)/)?.[1] || "",
          ebkph3: "",
          category: "",
          level: "",
          is_structural: false,
          fire_rating: "",
          cost_unit: kennwert,
          area: stat.quantity,
          quantity: stat.quantity,
          cost: totalCost,
          element_count: elementCount,
          fileID: metaFile?.file.name || "unknown",
          fromKafka: true,
          kafkaSource: "BIM",
          kafkaTimestamp: new Date().toISOString(),
          areaSource: "BIM",
          einheit: stat.unit || "m²",
          menge: stat.quantity,
          totalChf: totalCost,
          kennwert: kennwert,
          bezeichnung: "",
        } as EnhancedCostItem;
      });

    // Close the modal
    onClose();

    // Call onConfirm with the enhanced data
    onConfirm(enhancedData);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        <Typography variant="h5" component="div">
          Kosten-Update Vorschau
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          Überprüfen Sie die Kostenermittlung, bevor Sie die Daten übermitteln
        </Typography>

        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          textColor="primary"
          indicatorColor="primary"
          sx={{
            borderBottom: 1,
            borderColor: "divider",
            minHeight: 40,
            "& .MuiTabs-indicator": { height: 2, borderRadius: 0 },
          }}
        >
          <Tab label="Übersicht" sx={{ minHeight: 40, textTransform: "none", fontWeight: 500 }} />
          <Tab label="Alle eBKP-Gruppen" sx={{ minHeight: 40, textTransform: "none", fontWeight: 500 }} />
        </Tabs>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Box>
          {/* Tab 0: Overview */}
          {activeTab === 0 && (
            <>
              <Box sx={{ p: 3, mb: 3 }}>
                <Grid container spacing={3}>
                  {/* Completion Status Card */}
                  <Grid item xs={12} md={6}>
                    <Typography
                      variant="subtitle1"
                      gutterBottom
                      fontWeight="bold"
                    >
                      Vollständigkeit
                    </Typography>

                    <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                      <Chip
                        label={
                          <Box component="span">
                            <Box component="span" fontWeight="bold">
                              {completenessStats.groupsWithCosts} von {completenessStats.totalGroups} eBKP
                            </Box>
                            {" "}-Gruppen mit Kennwerten
                          </Box>
                        }
                        color={completenessStats.isComplete ? "success" : "warning"}
                        sx={{ height: 36, borderRadius: 2, fontSize: "0.875rem" }}
                      />
                      {completenessStats.isComplete ? (
                        <CheckCircleIcon sx={{ color: "#2e7d32", fontSize: 28 }} />
                      ) : (
                        <WarningIcon sx={{ color: "#ed6c02", fontSize: 28 }} />
                      )}
                    </Box>

                    {/* Readiness Indicator */}
                    {completenessStats.isComplete ? (
                      <Alert severity="success" variant="outlined" sx={{ mt: 2 }}>
                        <AlertTitle>Bereit zur Übermittlung</AlertTitle>
                        Alle eBKP-Gruppen haben Kennwerte eingetragen.
                      </Alert>
                    ) : (
                      <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
                        <AlertTitle>
                          {completenessStats.groupsMissingCosts.length} Gruppen
                          fehlen Kennwerte
                        </AlertTitle>
                        Bitte geben Sie für alle eBKP-Gruppen Kennwerte ein,
                        bevor Sie die Daten übermitteln.
                        {completenessStats.groupsMissingCosts.length > 0 && (
                          <Box sx={{ mt: 1 }}>
                            <Typography variant="body2">
                              Fehlende Gruppen:{" "}
                              <Box component="span" fontWeight="bold">
                                {(showAllMissing
                                  ? completenessStats.groupsMissingCosts
                                  : completenessStats.groupsMissingCosts.slice(0, 6)
                                )
                                  .map((stat) => stat.code)
                                  .join(", ")}
                              </Box>
                            </Typography>
                            {completenessStats.groupsMissingCosts.length > 6 && (
                              <Button size="small" onClick={() => setShowAllMissing((v) => !v)} sx={{ mt: 0.5, px: 0 }}>
                                {showAllMissing ? "Weniger anzeigen" : `+${completenessStats.groupsMissingCosts.length - 6} weitere anzeigen`}
                              </Button>
                            )}
                          </Box>
                        )}
                      </Alert>
                    )}
                  </Grid>

                  {/* Total Cost Card */}
                  <Grid item xs={12} md={6}>
                    <Typography
                      variant="subtitle1"
                      gutterBottom
                      fontWeight="bold"
                    >
                      Gesamtkostenschätzung
                    </Typography>

                    <Typography
                      variant="h4"
                      color="primary.main"
                      fontWeight="bold"
                      sx={{ mb: 2 }}
                    >
                      CHF{" "}
                      {calculatedTotalCost.toLocaleString("de-CH", {
                        maximumFractionDigits: 0,
                      })}
                    </Typography>

                    {/* Cost breakdown by main group */}
                    <Box sx={{ mt: 1 }}>
                      {Object.entries(costByMainGroup)
                        .sort((a, b) => b[1] - a[1])
                        .map(([group, cost]) => (
                          <Chip
                            key={group}
                            label={`${group}: ${(cost / 1000000).toFixed(3)} Mio. CHF`}
                            size="small"
                            variant="outlined"
                            sx={{ mr: 0.5, mb: 0.5 }}
                          />
                        ))}
                    </Box>
                  </Grid>
                </Grid>
              </Box>
            </>
          )}

          {/* Tab 1: All Groups */}
          {activeTab === 1 && (
            <Box sx={{ p: 2, mb: 3 }}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Alle eBKP-Gruppen
              </Typography>

              <Box display="flex" gap={1} mb={1.5}>
                <Chip
                  label={`Alle ${ebkpStats.length}`}
                  color={!showOnlyMissing ? "primary" : undefined}
                  variant={!showOnlyMissing ? "filled" : "outlined"}
                  onClick={() => setShowOnlyMissing(false)}
                />
                <Chip
                  label={`Fehlende ${completenessStats.groupsMissingCosts.length}`}
                  color="warning"
                  variant={showOnlyMissing ? "filled" : "outlined"}
                  onClick={() => setShowOnlyMissing(true)}
                />
              </Box>

              <TableContainer>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Status</TableCell>
                      <TableCell>eBKP</TableCell>
                      <TableCell>Bezeichnung</TableCell>
                      <TableCell align="right">Menge</TableCell>
                      <TableCell align="right">Einheit</TableCell>
                      <TableCell align="right">Kennwert (CHF)</TableCell>
                      <TableCell align="right">Gesamtkosten (CHF)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredGroups.map((stat) => {
                      const kennwert = kennwerte[stat.code] || 0;
                      const hasCost = kennwert > 0;
                      const totalCost = hasCost ? kennwert * stat.quantity : 0;

                      return (
                        <TableRow
                          key={stat.code}
                          hover
                          sx={{
                            backgroundColor: hasCost ? "transparent" : "rgba(237, 108, 2, 0.05)",
                          }}
                        >
                          <TableCell>
                            {hasCost ? (
                              <CheckCircleIcon
                                sx={{ color: "#4caf50", fontSize: 20 }}
                              />
                            ) : (
                              <WarningIcon
                                sx={{ color: "#ff9800", fontSize: 20 }}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              fontWeight={hasCost ? "normal" : "bold"}
                            >
                              {stat.code}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {stat.code}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2">
                              {stat.quantity.toLocaleString("de-CH", {
                                maximumFractionDigits: 1,
                              })}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2">
                              {stat.unit || "m²"}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {hasCost ? (
                              <Typography variant="body2">
                                {kennwert.toLocaleString("de-CH")}
                              </Typography>
                            ) : (
                              <Typography
                                variant="body2"
                                color="warning.main"
                                fontWeight="bold"
                              >
                                -
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {hasCost ? (
                              <Typography variant="body2" fontWeight="medium">
                                {totalCost.toLocaleString("de-CH", {
                                  maximumFractionDigits: 0,
                                })}
                              </Typography>
                            ) : (
                              <Typography
                                variant="body2"
                                color="warning.main"
                                fontWeight="bold"
                              >
                                -
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          Abbrechen
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="primary"
        >
          Kosten aktualisieren
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PreviewModal;
