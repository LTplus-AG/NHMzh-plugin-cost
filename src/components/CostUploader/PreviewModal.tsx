import React, { useState, useEffect, useMemo } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  Box,
  CircularProgress,
  Chip,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Collapse,
  IconButton,
  Tooltip,
  Alert,
  AlertTitle,
  Tabs,
  Tab,
} from "@mui/material";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningIcon from "@mui/icons-material/Warning";
import InfoIcon from "@mui/icons-material/Info";
import { MetaFile, CostItem } from "./types";
import { useApi } from "../../contexts/ApiContext";
import logger from "../../utils/logger";

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
}

interface MatchInfo {
  code: string;
  costUnit: number;
  elementCount: number;
  excelItem?: CostItem;
}

interface ElementInfo {
  ebkphCodes: string[];
  elementCount: number;
  projects: string[];
  costCodes: string[];
}

// Define an interface for the data expected in window.__ELEMENT_INFO
interface WindowElementInfo {
  elementCount: number;
  ebkphCodes: string[];
  projects: string[];
  costCodes: string[];
}

// Function to normalize an EBKP code for comparison
const normalizeEbkpCode = (code: string | undefined): string => {
  if (!code) return "";

  // Convert to uppercase and trim
  const upperCode = code.toUpperCase().trim();

  // Remove spaces
  let normalized = upperCode.replace(/\s+/g, "");

  // Handle formats like C01.01 -> C1.1
  normalized = normalized.replace(/([A-Z])0*(\d+)\.0*(\d+)/g, "$1$2.$3");

  // Handle formats like C01 -> C1
  normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");

  // Handle special case "C.1" format (missing number after letter)
  normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");

  return normalized;
};

// Function to check if two codes match (including partial matches)
const codesMatch = (
  code1: string | undefined,
  code2: string | undefined
): boolean => {
  if (!code1 || !code2) return false;

  const normalized1 = normalizeEbkpCode(code1);
  const normalized2 = normalizeEbkpCode(code2);

  // Direct match
  if (normalized1 === normalized2) return true;

  // Partial match (e.g., C2 matching C2.1)
  if (normalized1.length >= 2 && normalized2.length >= 2) {
    const prefix1 = normalized1.match(/^([A-Z]\d+)/)?.[1];
    const prefix2 = normalized2.match(/^([A-Z]\d+)/)?.[1];
    if (prefix1 && prefix2 && prefix1 === prefix2) return true;
  }

  return false;
};

const PreviewModal: React.FC<PreviewModalProps> = ({
  open,
  onClose,
  onConfirm,
  metaFile,
  calculatedTotalCost,
}) => {
  const [loading, setLoading] = useState(false);
  const [elementInfo, setElementInfo] = useState<ElementInfo | null>(null);
  const [potentialMatches, setPotentialMatches] = useState<MatchInfo[]>([]);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const { getAreaData } = useApi();

  const costItems = metaFile?.data
    ? Array.isArray(metaFile.data)
      ? metaFile.data
      : metaFile.data.data
    : [];

  // Local helper function
  const getAllCostItems = (items: CostItem[]): CostItem[] => {
    let result: CostItem[] = [];
    items.forEach((item) => {
      result.push(item);
      if (item.children && item.children.length > 0) {
        result = result.concat(getAllCostItems(item.children));
      }
    });
    return result;
  };

  // Get all cost items (flattened)
  const allCostItems = getAllCostItems(costItems);

  // Create more structured cost data for better lookup
  const costItemsByEbkp = allCostItems.reduce(
    (acc: { [key: string]: CostItem }, item) => {
      if (item.ebkp) {
        // Use normalized code as key
        const normalizedCode = normalizeEbkpCode(item.ebkp);
        acc[normalizedCode] = item;
      }
      return acc;
    },
    {}
  );

  // Toggle expanded state for an item
  const toggleExpand = (code: string) => {
    setExpandedItems((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  // Immediately analyze the data when the modal opens
  useEffect(() => {
    if (open && metaFile) {
      analyzeData();
    }
  }, [open, metaFile]);

  // Function to analyze data locally without waiting for API response
  const analyzeData = () => {
    setLoading(true);

    // Start with default element info
    let currentElementInfo: ElementInfo = {
      elementCount: 0,
      ebkphCodes: [],
      projects: [],
      costCodes: [],
    };

    // Here we can use pre-cached data from the application
    // This data is already in window.__ELEMENT_INFO if available
    if (
      (
        window as Window &
          typeof globalThis & { __ELEMENT_INFO?: WindowElementInfo }
      ).__ELEMENT_INFO
    ) {
      currentElementInfo = (
        window as Window &
          typeof globalThis & { __ELEMENT_INFO: WindowElementInfo }
      ).__ELEMENT_INFO;
    }
    // Or we can check if we have costCodes from the UI
    else if (document.querySelector("[data-cost-codes]")) {
      const costCodesStr =
        document
          .querySelector("[data-cost-codes]")
          ?.getAttribute("data-cost-codes") || "[]";
      try {
        const costCodes = JSON.parse(costCodesStr);
        currentElementInfo.costCodes = costCodes;
      } catch (e) {
        logger.error("Error parsing cost codes from DOM", e);
      }
    }
    // If we still don't have any codes, use the eBKP codes from the Excel file
    if (
      (!currentElementInfo.ebkphCodes ||
        currentElementInfo.ebkphCodes.length === 0) &&
      (!currentElementInfo.costCodes ||
        currentElementInfo.costCodes.length === 0)
    ) {
      // Extract all eBKP codes from the Excel file
      const excelCodes = allCostItems
        .filter((item) => item.ebkp && item.ebkp.trim() !== "")
        .map((item) => item.ebkp as string);

      // Use these as both ebkphCodes and costCodes
      currentElementInfo.ebkphCodes = excelCodes;
      currentElementInfo.costCodes = excelCodes;

      // Set a reasonable element count based on the number of unique codes
      const uniqueCodes = new Set(
        excelCodes.map((code) => normalizeEbkpCode(code))
      );
      currentElementInfo.elementCount = uniqueCodes.size * 3; // Assume ~3 elements per code


    }

    setElementInfo(currentElementInfo);

    // Calculate matches - try all possible normalization techniques for maximum matches
    const matches: MatchInfo[] = [];

    // First try direct matches with eBKP codes
    if (
      currentElementInfo.ebkphCodes &&
      currentElementInfo.ebkphCodes.length > 0
    ) {
      currentElementInfo.ebkphCodes.forEach((ifcCode) => {
        // Find matching Excel item
        const normalizedIfcCode = normalizeEbkpCode(ifcCode);

        Object.entries(costItemsByEbkp).forEach(([excelCode, item]) => {
          const normalizedExcelCode = normalizeEbkpCode(excelCode);

          if (normalizedIfcCode === normalizedExcelCode) {
            // Found a match
            const areaData = getAreaData(ifcCode);
            const elementCount = areaData?.count || 1;

            matches.push({
              code: ifcCode,
              costUnit: item.kennwert || 0,
              elementCount: elementCount,
              excelItem: item,
            });
          }
        });
      });
    }

    // Next try to match with server's costCodes (more likely to match)
    if (
      currentElementInfo.costCodes &&
      currentElementInfo.costCodes.length > 0
    ) {
      currentElementInfo.costCodes.forEach((serverCode) => {
        // Skip if we already have a match for this code
        if (matches.some((m) => codesMatch(m.code, serverCode))) {
          return;
        }

        // Find matching Excel item
        const normalizedServerCode = normalizeEbkpCode(serverCode);

        Object.entries(costItemsByEbkp).forEach(([excelCode, item]) => {
          const normalizedExcelCode = normalizeEbkpCode(excelCode);

          if (
            normalizedServerCode === normalizedExcelCode &&
            !matches.some((m) => codesMatch(m.code, excelCode))
          ) {
            // Found a match - use typical element count of 5 if no area data
            const areaData = getAreaData(serverCode);
            const elementCount = areaData?.count || 5;

            matches.push({
              code: serverCode,
              costUnit: item.kennwert || 0,
              elementCount: elementCount,
              excelItem: item,
            });
          }
        });
      });
    }

    // Also check for partial matches (e.g., C2 matching C2.1)
    if (Object.keys(costItemsByEbkp).length > 0) {
      Object.entries(costItemsByEbkp).forEach(([excelCode, item]) => {
        // Skip if we already have a match for this code
        if (matches.some((m) => codesMatch(m.code, excelCode))) {
          return;
        }

        const normalizedExcelCode = normalizeEbkpCode(excelCode);

        // Check if this is a parent code that can match with children
        // For example, if we have C2 in Excel, it could match with C2.1, C2.2 in IFC
        if (normalizedExcelCode.length >= 2) {
          const prefix = normalizedExcelCode.match(/^([A-Z]\d+)/)?.[1];

          if (prefix) {
            // Look for IFC codes that start with this prefix
            const matchingCodes = currentElementInfo.ebkphCodes.filter(
              (ifcCode) => normalizeEbkpCode(ifcCode).startsWith(prefix)
            );

            if (matchingCodes.length > 0) {
              // Found potential match(es)
              matchingCodes.forEach((matchCode) => {
                if (!matches.some((m) => codesMatch(m.code, matchCode))) {
                  const areaData = getAreaData(matchCode);
                  const elementCount = areaData?.count || 3;

                  matches.push({
                    code: matchCode,
                    costUnit: item.kennwert || 0,
                    elementCount: elementCount,
                    excelItem: item,
                  });
                }
              });
            }
          }
        }
      });
    }

    setPotentialMatches(matches);
    setLoading(false);
  };

  // Group potential matches by primary code
  const groupedMatches: { [key: string]: MatchInfo[] } = {};

  potentialMatches.forEach((match) => {
    // Group by first part of the code (e.g., C2 from C2.1)
    const group = match.code.match(/^([A-Z]\d+)/)?.[1] || match.code;

    if (!groupedMatches[group]) {
      groupedMatches[group] = [];
    }

    groupedMatches[group].push(match);
  });

  // Helper function to get color based on percentage
  const getColorByPercentage = (percentage: number) => {
    if (percentage >= 70) return "#4caf50"; // Green
    if (percentage >= 40) return "#2196f3"; // Blue
    if (percentage >= 20) return "#ff9800"; // Orange
    return "#f44336"; // Red
  };

  // Calculate stats for the preview - UPDATED
  // Get unique Excel codes (normalized)
  const uniqueExcelCodes = new Set(
    allCostItems
      .filter((item) => item.ebkp)
      .map((item) => normalizeEbkpCode(item.ebkp))
  );

  // Count systems vs. building elements
  const systemCodes = allCostItems
    .filter(
      (item) =>
        item.ebkp?.startsWith("D") &&
        (item.einheit === "Stk." ||
          item.einheit === "Stück" ||
          item.einheit === "Stk")
    )
    .map((item) => normalizeEbkpCode(item.ebkp || ""));

  const systemCodesSet = new Set(systemCodes);

  // Calculate building elements (non-system items)
  const buildingElementCodes = new Set(
    Array.from(uniqueExcelCodes).filter((code) => !systemCodesSet.has(code))
  );

  // Get the total count of relevant Excel codes
  const totalCodesInExcel = buildingElementCodes.size; // Only count building elements, not systems

  // First, get the matches that pass our filter criteria
  const matchesWithCosts = potentialMatches.filter((match) => {
    // Skip system items (D codes with "Stk." unit)
    if (
      match.excelItem?.ebkp?.startsWith("D") &&
      (match.excelItem.einheit === "Stk." ||
        match.excelItem.einheit === "Stück" ||
        match.excelItem.einheit === "Stk")
    ) {
      return false;
    }

    return match.costUnit > 0 && match.elementCount > 0;
  });

  // Count the actual number of BIM elements that will be updated (summing elementCount)
  const totalElementsToUpdate = matchesWithCosts.reduce(
    (sum, match) => sum + match.elementCount,
    0
  );

  // Only count unique eBKP codes that got quantities from BIM mapping
  const actualMatchedCodes = new Set(
    matchesWithCosts.map((match) =>
      normalizeEbkpCode(match.excelItem?.ebkp || "")
    )
  );

  // Count direct matches - Excel codes that exactly match BIM codes
  const directMatchCount = potentialMatches.filter(
    (m) => normalizeEbkpCode(m.excelItem?.ebkp) === normalizeEbkpCode(m.code)
  ).length;

  const totalCodesWithMatches = actualMatchedCodes.size;

  // Calculate different metrics to express matching quality

  // 1. EBKP code match rate - how many Excel codes were matched with BIM
  const codeMatchPercentage =
    totalCodesInExcel > 0
      ? Math.round((totalCodesWithMatches / totalCodesInExcel) * 100)
      : 0;

  // 2. BIM coverage - proportion of BIM elements that will receive costs
  const totalAvailableElements = elementInfo ? elementInfo.elementCount : 0;
  const bimCoveragePercentage =
    totalAvailableElements > 0
      ? Math.round((totalElementsToUpdate / totalAvailableElements) * 100)
      : 0;

  // 3. Unique BIM code coverage - proportion of unique BIM codes that were matched
  const uniqueBimCodes = new Set(
    potentialMatches.map((m) => normalizeEbkpCode(m.code))
  );
  const uniqueBimCodeCount = uniqueBimCodes.size;
  const bimCodeCoveragePercentage =
    uniqueBimCodeCount > 0
      ? Math.round((totalCodesWithMatches / uniqueBimCodeCount) * 100)
      : 0;

  // 4. Direct match quality - percentage of matches that are direct (not fuzzy)
  const directMatchPercentage =
    potentialMatches.length > 0
      ? Math.round((directMatchCount / potentialMatches.length) * 100)
      : 0;

  // 5. Overall matching quality score - weighted average of the above metrics
  // Giving more weight to code matches and direct matches
  const matchingQualityScore = Math.round(
    codeMatchPercentage * 0.4 +
      bimCoveragePercentage * 0.3 +
      bimCodeCoveragePercentage * 0.1 +
      directMatchPercentage * 0.2
  );

  // We'll use this as our main quality indicator
  const matchPercentage = codeMatchPercentage;
  const elementPercentage = bimCoveragePercentage;
  const medianPercentage = matchingQualityScore;

  // DEBUG: Count codes by first letter
  const firstLetterCounts: Record<string, number> = {};
  uniqueExcelCodes.forEach((code) => {
    const firstChar = code.charAt(0);
    firstLetterCounts[firstChar] = (firstLetterCounts[firstChar] || 0) + 1;
  });



  // Corrected costByGroup calculation
  const costByGroup = useMemo(() => {
    if (!metaFile?.data) return {};

    const hierarchicalData = Array.isArray(metaFile.data)
      ? metaFile.data
      : metaFile.data.data;

    if (!hierarchicalData) return {};

    // 1. Flatten the hierarchy
    const flatItems = getAllCostItems(hierarchicalData);

    // 2. Filter for LEAF nodes only
    const leafItems = flatItems.filter(
      (item) => !item.children || item.children.length === 0
    );

    // 3. Group leaf nodes and sum their chf
    const groups: { [key: string]: number } = {};
    leafItems.forEach((item) => {
      if (!item.ebkp) return; // Skip leaf items without eBKP

      // Determine the group key (use the item's own ebkp)
      const groupKey = item.ebkp;

      if (!groups[groupKey]) {
        groups[groupKey] = 0;
      }
      // Sum the final chf of this leaf item
      groups[groupKey] += item.chf || item.totalChf || 0;
    });

    // Filter out zero values before returning
    const filteredGroups: { [key: string]: number } = {};
    for (const [key, value] of Object.entries(groups)) {
      if (value > 0) {
        filteredGroups[key] = value;
      }
    }
    return filteredGroups;
  }, [metaFile]); // Depend on metaFile

  // Return the data when confirmed
  const handleConfirm = () => {
    // Display loading state
    setLoading(true);

    // Log the number of matches with zero unit cost that will be ignored
    const zeroUnitCostCount = potentialMatches.filter(
      (m) => !m.costUnit || m.costUnit <= 0
    ).length;
    if (zeroUnitCostCount > 0) {
      // Skip items with zero unit cost
    }

    // Prepare the enhanced data to send to backend
    // We only need to send QTO elements that matched with costs
    // IMPORTANT: The Excel data has already been saved to costData on file upload
    // We're only updating costElements here, NOT deleting/replacing costData
    const enhancedData: EnhancedCostItem[] = potentialMatches
      .filter((match) => match.costUnit > 0) // Skip items with zero cost
      .map((match) => {
        const costItem = match.excelItem || { bezeichnung: "", category: "" };
        // Use BIM-mapped values from match.excelItem
        const bimMappedArea = costItem.area !== undefined ? costItem.area : 0; // Area/Quantity from BIM mapping
        const unitCost =
          costItem.kennwert !== undefined ? costItem.kennwert : 0; // Unit cost from Excel
        const totalItemCost = costItem.chf !== undefined ? costItem.chf : 0; // Total CHF for this item, after BIM mapping

        // Create a QTO-based object with cost data
        return {
          id: match.code, // This is the eBKP code, which acts as an identifier for the group of elements
          ebkp: match.code,
          ebkph: match.code,
          ebkph1: match.code.match(/^([A-Z]\d+)/)?.[1] || "",
          ebkph2: match.code.match(/^[A-Z]\d+\.(\d+)/)?.[1] || "",
          ebkph3: "",
          // QTO element properties (these are illustrative, real properties come from actual BIM elements later)
          category: String(costItem.bezeichnung || costItem.category || ""),
          level: String(costItem.level || ""),
          is_structural:
            typeof costItem.is_structural === "boolean"
              ? costItem.is_structural
              : true, // Default to true if not a boolean
          fire_rating: String(costItem.fire_rating || ""), // Ensure string, default to empty string
          // Cost data from BIM-mapped Excel item
          cost_unit: unitCost,
          area: bimMappedArea,
          quantity: bimMappedArea, // Use BIM-mapped area as quantity
          cost: totalItemCost, // Use BIM-mapped total cost for this item
          element_count: match.elementCount, // This is the count of BIM elements for this eBKP code
          // Source information
          fileID: metaFile?.file.name || "unknown",
          fromKafka: true, // Indicates these are prepared for Kafka, based on BIM data
          kafkaSource: "BIM",
          kafkaTimestamp: new Date().toISOString(),
          areaSource: costItem.areaSource || "BIM", // Prefer actual source
          // Additional properties needed for consistency (mostly from original Excel item)
          einheit: costItem.einheit || "m²", // Prefer actual unit
          menge: bimMappedArea, // Use BIM-mapped area
          totalChf: totalItemCost, // Use BIM-mapped total cost
          kennwert: unitCost, // Same as cost_unit
          bezeichnung: String(costItem.bezeichnung || ""),
          // originalItem: costItem.originalItem // Retain original if needed, but costElements will be built from QTO
        } as EnhancedCostItem;
      });



    // First close the modal to avoid blocking UI
    onClose();

    // Call onConfirm with the enhanced data
    onConfirm(enhancedData);

    setLoading(false);
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
          sx={{ mb: -1 }}
        >
          <Tab label="Übersicht" />
          <Tab label="Details" />
          <Tab label="Nicht gefundene Codes" />
        </Tabs>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        {loading ? (
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            minHeight="300px"
          >
            <CircularProgress />
          </Box>
        ) : (
          <Box>
            {/* Tab 0: Overview */}
            {activeTab === 0 && (
              <>
                {/* Summary Section */}
                <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <Typography
                        variant="subtitle1"
                        gutterBottom
                        fontWeight="medium"
                      >
                        Zuordnung BIM-zu-Excel
                      </Typography>

                      <Box display="flex" alignItems="center" mb={2}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            backgroundColor: "#f5f5f5",
                            borderRadius: "8px",
                            position: "relative",
                            overflow: "hidden",
                            padding: "8px 16px",
                            mr: 1.5,
                            boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                            border: "1px solid #e0e0e0",
                            width: "240px",
                            height: "36px",
                          }}
                        >
                          <Box
                            sx={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              height: "100%",
                              width: `${matchPercentage}%`,
                              backgroundColor:
                                getColorByPercentage(matchPercentage),
                              opacity: 0.7,
                              zIndex: 0,
                            }}
                          />
                          <Typography
                            fontWeight="bold"
                            sx={{
                              position: "relative",
                              zIndex: 1,
                              color: "#333",
                              fontSize: "0.95rem",
                            }}
                          >
                            {totalCodesWithMatches}/{totalCodesInExcel} eBKP
                            Codes
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          mit BIM verknüpft ({matchPercentage}%)
                        </Typography>
                      </Box>

                      {elementInfo && (
                        <Box display="flex" alignItems="center" mb={2}>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              backgroundColor: "#f5f5f5",
                              borderRadius: "8px",
                              position: "relative",
                              overflow: "hidden",
                              padding: "8px 16px",
                              mr: 1.5,
                              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                              border: "1px solid #e0e0e0",
                              width: "240px",
                              height: "36px",
                            }}
                          >
                            <Box
                              sx={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                height: "100%",
                                width: `${elementPercentage}%`,
                                backgroundColor:
                                  getColorByPercentage(elementPercentage),
                                opacity: 0.7,
                                zIndex: 0,
                              }}
                            />
                            <Typography
                              fontWeight="bold"
                              sx={{
                                position: "relative",
                                zIndex: 1,
                                color: "#333",
                                fontSize: "0.95rem",
                              }}
                            >
                              {totalElementsToUpdate}/{totalAvailableElements}{" "}
                              BIM Elemente
                            </Typography>
                          </Box>
                          <Typography variant="body2" color="text.secondary">
                            zugeordnet ({elementPercentage}%)
                          </Typography>
                        </Box>
                      )}

                      {/* Move Übereinstimmungsqualität here */}
                      <Typography
                        variant="subtitle1"
                        fontWeight="bold"
                        sx={{ mt: 3, mb: 1 }}
                      >
                        Übereinstimmungsqualität
                      </Typography>

                      <Box
                        sx={{
                          width: "100%",
                          mb: 2,
                          position: "relative",
                          height: 30,
                        }}
                      >
                        {/* Background bar */}
                        <Box
                          sx={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            height: "100%",
                            width: "100%",
                            backgroundColor: "#eee",
                            borderRadius: 1,
                          }}
                        />

                        {/* Progress bar */}
                        <Box
                          sx={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            height: "100%",
                            width: `${medianPercentage}%`,
                            backgroundColor:
                              getColorByPercentage(medianPercentage),
                            borderRadius: 1,
                            transition: "width 1s ease-in-out",
                          }}
                        />

                        {/* Percentage text */}
                        <Box
                          sx={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            height: "100%",
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Typography fontWeight="bold" color="text.secondary">
                            {medianPercentage}% Übereinstimmung
                          </Typography>
                        </Box>
                      </Box>

                      <Box display="flex" flexWrap="wrap" gap={1} mt={2}>
                        {potentialMatches.length > 0 && (
                          <>
                            <Tooltip title="Direkte Übereinstimmungen mit BIM Elementen">
                              <Chip
                                icon={<CheckCircleIcon />}
                                label={`${
                                  potentialMatches.filter(
                                    (m) =>
                                      normalizeEbkpCode(m.excelItem?.ebkp) ===
                                      normalizeEbkpCode(m.code)
                                  ).length
                                } Direkte Übereinstimmungen`}
                                color="success"
                              />
                            </Tooltip>

                            <Tooltip title="Diese eBKP Elementgruppen haben keine Übereinstimmung">
                              <Chip
                                icon={<WarningIcon />}
                                label={`${
                                  totalCodesInExcel - totalCodesWithMatches
                                } Nicht gefundene Elementgruppen`}
                                color="warning"
                              />
                            </Tooltip>

                            <Tooltip title="BIM Elemente mit Kosten">
                              <Chip
                                icon={<InfoIcon />}
                                label={`${totalElementsToUpdate} Elemente mit Kosten`}
                                color="primary"
                              />
                            </Tooltip>
                          </>
                        )}

                        {potentialMatches.length === 0 && (
                          <Alert severity="warning" sx={{ width: "100%" }}>
                            <AlertTitle>
                              Keine direkten Übereinstimmungen gefunden
                            </AlertTitle>
                            Die eBKP Elementgruppen in der Excel-Datei haben
                            keine direkte Übereinstimmung mit BIM Elementen.
                            Prüfen Sie, ob die Codes korrekt sind oder ob
                            Formatierungsunterschiede bestehen.
                          </Alert>
                        )}
                      </Box>

                      {/* Display warning if low match percentage */}
                      {medianPercentage < 30 && (
                        <Alert severity="warning" sx={{ mt: 2 }}>
                          <AlertTitle>Niedrige Übereinstimmung</AlertTitle>
                          Nur {medianPercentage}% Gesamtübereinstimmung zwischen
                          BIM und Excel-Daten.
                        </Alert>
                      )}
                    </Grid>

                    <Grid item xs={12} md={6}>
                      <Typography
                        variant="subtitle1"
                        gutterBottom
                        fontWeight="medium"
                      >
                        Gesamtkostenschätzung (Berechnet)
                      </Typography>

                      <Typography
                        variant="h4"
                        color="primary.main"
                        fontWeight="bold"
                      >
                        CHF{" "}
                        {calculatedTotalCost.toLocaleString("de-CH", {
                          maximumFractionDigits: 0,
                        })}
                      </Typography>

                      <Box sx={{ mt: 1 }}>
                        {Object.entries(costByGroup)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 15) // Limit to top 15 chips
                          .map(([group, cost], index) => (
                            <Chip
                              key={group}
                              label={`${group}: ${cost.toLocaleString("de-CH", {
                                maximumFractionDigits: 0,
                              })} CHF`}
                              size="small"
                              variant="outlined"
                              color={index < 3 ? "primary" : "default"}
                              sx={{
                                mr: 0.5,
                                mb: 0.5,
                                fontWeight: index < 3 ? "bold" : "normal",
                              }}
                            />
                          ))}
                        {Object.keys(costByGroup).length > 15 && (
                          <Chip
                            label="..."
                            size="small"
                            sx={{ mr: 0.5, mb: 0.5 }}
                          />
                        )}
                      </Box>
                    </Grid>
                  </Grid>
                </Paper>
              </>
            )}

            {/* Tab 1: Detailed Matches */}
            {activeTab === 1 && (
              <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  BIM Elemente und zugeordnete Kosten
                </Typography>

                {elementInfo && (
                  <Box mb={2}>
                    <Typography variant="body2">
                      Im System sind <strong>{elementInfo.elementCount}</strong>{" "}
                      BIM Elemente verfügbar. Die folgenden Elemente wurden
                      zugeordnet:
                    </Typography>
                  </Box>
                )}

                {potentialMatches.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox"></TableCell>
                          <TableCell>eBKP-Code</TableCell>
                          <TableCell>Bezeichnung</TableCell>
                          <TableCell align="right">Anzahl Elemente</TableCell>
                          <TableCell align="right">Kennwert (CHF/m²)</TableCell>
                          <TableCell align="right">Total (CHF)</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {Object.entries(groupedMatches).map(
                          ([group, matches]) => {
                            const isGroupExpanded =
                              expandedItems.includes(group);
                            const totalGroupElements = matches.reduce(
                              (sum, m) => sum + m.elementCount,
                              0
                            );
                            const totalGroupCost = matches.reduce(
                              (sum, m) => sum + m.costUnit * m.elementCount,
                              0
                            );

                            return (
                              <React.Fragment key={group}>
                                {/* Group row */}
                                <TableRow
                                  hover
                                  sx={{
                                    backgroundColor: "rgba(0, 0, 0, 0.02)",
                                  }}
                                >
                                  <TableCell padding="checkbox">
                                    <IconButton
                                      size="small"
                                      onClick={() => toggleExpand(group)}
                                    >
                                      {isGroupExpanded ? (
                                        <KeyboardArrowUpIcon />
                                      ) : (
                                        <KeyboardArrowDownIcon />
                                      )}
                                    </IconButton>
                                  </TableCell>
                                  <TableCell colSpan={2}>
                                    <Typography fontWeight="bold">
                                      {group} Gruppe ({matches.length} Codes)
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="right">
                                    <Typography fontWeight="bold">
                                      {totalGroupElements}
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="right">
                                    <Typography fontWeight="bold">-</Typography>
                                  </TableCell>
                                  <TableCell align="right">
                                    <Typography fontWeight="bold">
                                      {totalGroupCost.toLocaleString("de-CH")}
                                    </Typography>
                                  </TableCell>
                                </TableRow>

                                {/* Individual matches */}
                                <TableRow>
                                  <TableCell
                                    padding="none"
                                    colSpan={6}
                                    sx={{ p: 0, border: 0 }}
                                  >
                                    <Collapse
                                      in={isGroupExpanded}
                                      timeout="auto"
                                      unmountOnExit
                                    >
                                      <Box>
                                        <Table size="small">
                                          <TableBody>
                                            {matches.map((match) => {
                                              const estimatedTotal =
                                                match.costUnit *
                                                match.elementCount;
                                              const isDirectMatch =
                                                normalizeEbkpCode(
                                                  match.excelItem?.ebkp
                                                ) ===
                                                normalizeEbkpCode(match.code);

                                              return (
                                                <TableRow
                                                  key={match.code}
                                                  hover
                                                  sx={{
                                                    backgroundColor:
                                                      isDirectMatch
                                                        ? "rgba(76, 175, 80, 0.04)"
                                                        : "rgba(33, 150, 243, 0.04)",
                                                    borderLeft: isDirectMatch
                                                      ? "3px solid #4caf50"
                                                      : "3px solid #2196f3",
                                                  }}
                                                >
                                                  <TableCell padding="checkbox"></TableCell>
                                                  <TableCell>
                                                    <Box
                                                      display="flex"
                                                      alignItems="center"
                                                    >
                                                      <Typography variant="body2">
                                                        {match.code}
                                                      </Typography>
                                                      {isDirectMatch ? (
                                                        <Tooltip title="Direkte Übereinstimmung">
                                                          <CheckCircleIcon
                                                            fontSize="small"
                                                            color="success"
                                                            sx={{ ml: 1 }}
                                                          />
                                                        </Tooltip>
                                                      ) : (
                                                        <Tooltip
                                                          title={`Auto-Zuordnung (Excel: ${match.excelItem?.ebkp})`}
                                                        >
                                                          <InfoIcon
                                                            fontSize="small"
                                                            color="info"
                                                            sx={{ ml: 1 }}
                                                          />
                                                        </Tooltip>
                                                      )}
                                                    </Box>
                                                  </TableCell>
                                                  <TableCell>
                                                    <Typography variant="body2">
                                                      {match.excelItem
                                                        ?.bezeichnung ||
                                                        "Unbekannt"}
                                                    </Typography>
                                                  </TableCell>
                                                  <TableCell align="right">
                                                    <Chip
                                                      size="small"
                                                      label={match.elementCount}
                                                      color="primary"
                                                    />
                                                  </TableCell>
                                                  <TableCell align="right">
                                                    <Box>
                                                      {match.costUnit.toLocaleString(
                                                        "de-CH"
                                                      )}
                                                    </Box>
                                                  </TableCell>
                                                  <TableCell align="right">
                                                    <Box>
                                                      {estimatedTotal.toLocaleString(
                                                        "de-CH"
                                                      )}
                                                    </Box>
                                                  </TableCell>
                                                </TableRow>
                                              );
                                            })}
                                          </TableBody>
                                        </Table>
                                      </Box>
                                    </Collapse>
                                  </TableCell>
                                </TableRow>
                              </React.Fragment>
                            );
                          }
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="warning">
                    <AlertTitle>Keine Übereinstimmungen gefunden</AlertTitle>
                    Die eBKP Elementgruppen in der Excel-Datei stimmen nicht mit
                    den BIM Elementen überein. Prüfen Sie die Codes auf
                    Tippfehler oder abweichende Formatierung.
                  </Alert>
                )}
              </Paper>
            )}

            {/* Tab 2: Missing Matches */}
            {activeTab === 2 && (
              <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
                <Box display="flex" alignItems="center" mb={2}>
                  <WarningIcon color="warning" sx={{ mr: 1 }} />
                  <Typography variant="subtitle1" fontWeight="bold">
                    Nicht zugeordnete Kostenposten
                  </Typography>
                </Box>

                <Typography variant="body2" paragraph>
                  Die folgenden eBKP Elementgruppen aus der Excel-Datei haben
                  keine passenden BIM Elemente:
                </Typography>

                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>eBKP-Code</TableCell>
                        <TableCell>Bezeichnung</TableCell>
                        <TableCell align="right">Menge</TableCell>
                        <TableCell align="right">Einheit</TableCell>
                        <TableCell align="right">Kennwert (CHF/m²)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {allCostItems
                        .filter(
                          (item) =>
                            item.ebkp &&
                            !potentialMatches.some((match) =>
                              codesMatch(match.excelItem?.ebkp, item.ebkp)
                            )
                        )
                        .map((item, index) => (
                          <TableRow key={`${item.ebkp}-${index}`} hover>
                            <TableCell>{item.ebkp}</TableCell>
                            <TableCell>
                              {item.bezeichnung || "Unbekannt"}
                            </TableCell>
                            <TableCell align="right">
                              {item.menge?.toLocaleString("de-CH") || "-"}
                            </TableCell>
                            <TableCell align="right">
                              {item.einheit || "m²"}
                            </TableCell>
                            <TableCell align="right">
                              {item.kennwert?.toLocaleString("de-CH") || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          Abbrechen
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="primary"
          disabled={loading || totalElementsToUpdate === 0}
        >
          Kosten aktualisieren
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PreviewModal;
