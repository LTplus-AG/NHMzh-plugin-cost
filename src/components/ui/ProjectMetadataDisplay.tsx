import React from "react";
import { Box, Tooltip, Typography, CircularProgress } from "@mui/material";

export interface CostProjectMetadata {
  filename: string;
  upload_timestamp: string; // Corresponds to "Stand"
  element_count?: number;
}

interface ProjectMetadataDisplayProps {
  metadata: CostProjectMetadata | null;
  loading: boolean;
  // initialLoading: boolean; // We might not need this if logic is simpler in MainPage.tsx
  // selectedProject: boolean; // This logic will be handled by the caller in MainPage.tsx
}

const ProjectMetadataDisplay: React.FC<ProjectMetadataDisplayProps> = ({
  metadata,
  loading,
}) => {
  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          // mt: 1, // Margin can be controlled by parent
          height: "24px", // Adjusted height slightly for body2
          color: "text.secondary", // Default text color for loading
        }}
      >
        <CircularProgress size={16} thickness={5} sx={{ color: "inherit" }} />
        <Typography variant="caption" color="inherit">
          Lade Metadaten...
        </Typography>
      </Box>
    );
  }

  if (!metadata) {
    return (
      <Box sx={{ height: "24px" /* mt: 1*/ }}>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontStyle: "italic" }}
        >
          Keine Modelldaten verfügbar.
        </Typography>
      </Box>
    );
  }

  const formatTime = (timestamp: string): string => {
    if (!timestamp) return "N/A";
    try {
      // Attempt to parse directly, assuming it might be a pre-formatted time or full ISO
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        // Check if date is invalid
        // If direct parsing fails, assume it's a string that might need 'Z'
        const utcTimestamp =
          timestamp.endsWith("Z") || timestamp.includes("+") // basic check for timezone
            ? timestamp
            : timestamp + "Z";
        const parsedDate = new Date(utcTimestamp);
        if (isNaN(parsedDate.getTime())) return "Invalid Time"; // Still invalid
        return parsedDate.toLocaleTimeString("de-CH", {
          // de-CH for HH:MM
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return date.toLocaleTimeString("de-CH", {
        // de-CH for HH:MM
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      console.error("Error formatting time:", e);
      return "Ungültige Zeit";
    }
  };

  // For the full tooltip, we might want a more comprehensive date format
  const formattedFullTimestamp = (timestamp: string): string => {
    if (!timestamp) return "N/A";
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        const utcTimestamp =
          timestamp.endsWith("Z") || timestamp.includes("+")
            ? timestamp
            : timestamp + "Z";
        const parsedDate = new Date(utcTimestamp);
        if (isNaN(parsedDate.getTime())) return "Invalid Date";
        return parsedDate.toLocaleString("de-CH", {
          dateStyle: "short",
          timeStyle: "medium",
        });
      }
      return date.toLocaleString("de-CH", {
        dateStyle: "short",
        timeStyle: "medium",
      });
    } catch (e) {
      console.error("Error formatting full timestamp:", e);
      return "Ungültiges Datum";
    }
  };

  const timeString = formatTime(metadata.upload_timestamp);
  const fullTimestampForTooltip = formattedFullTimestamp(
    metadata.upload_timestamp
  );

  const tooltipTitle = `Modell: ${metadata.filename} | Elemente: ${
    metadata.element_count ?? "N/A"
  } | Stand: ${fullTimestampForTooltip}`;

  return (
    <Box
      sx={{
        // mt: 1, // Controlled by parent
        display: "flex",
        alignItems: "center",
        gap: 1,
        minWidth: 0,
        height: "24px", // Consistent height
        color: "text.secondary", // Default color for the text
      }}
    >
      <Tooltip title={tooltipTitle}>
        <Typography
          variant="body2" // Using body2 as per LCA example, seems more appropriate than h2
          // color="text.secondary" // Inherit from Box
          sx={{
            fontStyle: "italic",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "100%",
          }}
        >
          {metadata.filename} ({metadata.element_count ?? "-"} Elemente)
          {timeString !== "N/A" &&
          timeString !== "Invalid Time" &&
          timeString !== "Ungültige Zeit"
            ? ` - Stand: ${timeString}`
            : ""}
        </Typography>
      </Tooltip>
    </Box>
  );
};

export default ProjectMetadataDisplay;
