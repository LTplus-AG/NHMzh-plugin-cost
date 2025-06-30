import { CostItem, ExcelRow, REQUIRED_HEADERS } from "./types";
import * as ExcelJS from "exceljs";

// Helper to extract numbers and return null if zero
export const extractNumber = (
  row: ExcelRow,
  key: string,
  index: number
): number | null => {
  if (index === -1) {
    return null;
  }

  // The issue: Excel-to-JSON conversion might use different casing or formatting for keys
  // Find the actual key in the row that matches our header (case-insensitive)
  const rowKeys = Object.keys(row);
  const actualKey = rowKeys.find(
    (k) => k.trim().toLowerCase() === key.trim().toLowerCase()
  );

  const value = actualKey ? row[actualKey] : undefined;

  if (value === undefined || value === null || value === "") {
    return null;
  }

  // Check if the value is an eBKP placeholder like {{eBKP:B06.01}}
  if (typeof value === "string" && value.match(/\{\{eBKP:[^}]+\}\}/)) {
    // Return null for placeholders - they will be handled separately
    return null;
  }

  // Special case for Menge - we want to keep the value even if it's 0 or 1
  if (key.toLowerCase().includes("menge")) {
    const numValue = Number(value);
    return isNaN(numValue) ? null : numValue;
  }

  // For all other values, convert to number and return null if zero
  const numValue = Number(value);
  const result = isNaN(numValue) || numValue === 0 ? null : numValue;
  return result;
};

// Format number consistently with fixed decimal places
export const formatNumber = (
  value: number | null | undefined,
  decimals: number = 2
): string => {
  // Return empty string for null, undefined, NaN, or zero values
  if (value === null || value === undefined || isNaN(value) || value === 0) {
    return "";
  }

  // Format number with thousand separators and fixed decimals
  try {
    const formatted = value.toLocaleString("de-CH", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    // Add just a single non-breaking space for a more normal amount of padding
    return `${formatted}\u00A0`;
  } catch {
    // If any error occurs during formatting, return empty string
    return "";
  }
};

export const processExcelData = (
  data: ExcelRow[],
  headers: string[]
): CostItem[] => {
  if (data.length === 0) {
    return [];
  }

  const items: CostItem[] = [];

  // Normalize headers for comparison
  const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());

  // Find the correct column headers (these are the actual keys in the row objects)
  const ebkpHeader =
    headers.find((h) => h.trim().toLowerCase() === "ebkp") || "";
  const bezeichnungHeader =
    headers.find((h) => h.trim().toLowerCase() === "bezeichnung") || "";
  const mengeHeader =
    headers.find((h) => h.trim().toLowerCase() === "menge") ||
    headers.find((h) => h.trim().toLowerCase() === "mengenbezug") ||
    "";
  const einheitHeader =
    headers.find((h) => h.trim().toLowerCase() === "einheit") || "";
  const kennwertHeader =
    headers.find((h) => h.trim().toLowerCase() === "kennwert") || "";
  const chfHeader = headers.find((h) => h.trim().toLowerCase() === "chf") || "";
  const totalChfHeader =
    headers.find((h) => h.trim().toLowerCase() === "total chf") || "";
  const kommentarHeader =
    headers.find((h) => h.trim().toLowerCase() === "kommentar") || "";

  // Get indexes for the columns
  // These index variables are used in extractNumber function calls
  const kennwertIndex = normalizedHeaders.findIndex((h) => h === "kennwert");
  const chfIndex = normalizedHeaders.findIndex((h) => h === "chf");
  const totalChfIndex = normalizedHeaders.findIndex((h) => h === "total chf");

  // Removed unused index variables: ebkpIndex, bezeichnungIndex, mengeIndex, einheitIndex, kommentarIndex
  // These indexes aren't needed since we access the data using the header names directly

  // Create parent map for organizing the hierarchy
  const parentMap: Record<string, CostItem> = {};
  const topLevelMap: Record<string, CostItem> = {};

  // First pass: Create top-level parent items (e.g., "A", "B", etc.)
  for (const row of data) {
    const ebkpCode = ebkpHeader ? String(row[ebkpHeader] || "").trim() : "";

    // Skip rows without eBKP code
    if (!ebkpCode) continue;

    // Check if this is a top-level code (just a letter like "A", "B")
    const isTopLevel = /^[A-Z]$/.test(ebkpCode);

    if (isTopLevel) {
      const bezeichnung = bezeichnungHeader
        ? String(row[bezeichnungHeader] || "")
        : "";
      const totalChf = totalChfHeader
        ? extractNumber(row, totalChfHeader, totalChfIndex)
        : null;

      const topLevelItem: CostItem = {
        ebkp: ebkpCode,
        bezeichnung,
        menge: undefined,
        einheit: "",
        kennwert: undefined,
        chf: undefined,
        totalChf: totalChf ?? undefined,
        kommentar: "",
        children: [],
        expanded: false,
      };

      items.push(topLevelItem);
      topLevelMap[ebkpCode] = topLevelItem;
    }
  }

  // If we didn't find any explicit top-level codes, create them based on the first letter of other codes
  if (Object.keys(topLevelMap).length === 0) {
    const uniqueFirstLetters = new Set<string>();

    // Get unique first letters from eBKP codes
    for (const row of data) {
      const ebkpCode = ebkpHeader ? String(row[ebkpHeader] || "").trim() : "";
      if (ebkpCode && /^[A-Z]/.test(ebkpCode)) {
        uniqueFirstLetters.add(ebkpCode[0]);
      }
    }

    // Create top-level items for each unique first letter
    for (const letter of uniqueFirstLetters) {
      const topLevelItem: CostItem = {
        ebkp: letter,
        bezeichnung: letter,
        menge: undefined,
        einheit: "",
        kennwert: undefined,
        chf: undefined,
        totalChf: undefined,
        kommentar: "",
        children: [],
        expanded: false,
      };

      items.push(topLevelItem);
      topLevelMap[letter] = topLevelItem;
    }
  }

  // Second pass: Create second-level parent items (e.g., "A01", "B02")
  for (const row of data) {
    const ebkpCode = ebkpHeader ? String(row[ebkpHeader] || "").trim() : "";

    // Skip rows without eBKP code
    if (!ebkpCode) continue;

    // Check if this is a second-level code (letter followed by numbers without dots)
    const isSecondLevel = /^[A-Z]\d+$/.test(ebkpCode);

    if (isSecondLevel) {
      const topLevelParentCode = ebkpCode[0]; // First letter
      const topLevelParent = topLevelMap[topLevelParentCode];

      if (topLevelParent) {
        // Extract values safely
        const bezeichnung = bezeichnungHeader
          ? String(row[bezeichnungHeader] || "")
          : "";
        const menge = mengeHeader
          ? row[mengeHeader] !== undefined &&
            row[mengeHeader] !== null &&
            row[mengeHeader] !== ""
            ? Number(row[mengeHeader])
            : null
          : null;
        const einheit = einheitHeader ? String(row[einheitHeader] || "") : "";
        const kennwert = kennwertHeader
          ? extractNumber(row, kennwertHeader, kennwertIndex)
          : null;
        const chf = chfHeader ? extractNumber(row, chfHeader, chfIndex) : null;
        const totalChf = totalChfHeader
          ? extractNumber(row, totalChfHeader, totalChfIndex)
          : null;
        const kommentar = kommentarHeader
          ? String(row[kommentarHeader] || "")
          : "";

        const secondLevelItem: CostItem = {
          ebkp: ebkpCode,
          bezeichnung,
          menge: menge ?? undefined,
          einheit,
          kennwert: kennwert ?? undefined,
          chf: chf ?? undefined,
          totalChf: totalChf ?? undefined,
          kommentar,
          children: [],
          expanded: false,
        };

        if (topLevelParent.children) {
          topLevelParent.children.push(secondLevelItem);
        }
        parentMap[ebkpCode] = secondLevelItem; // Store for third-level items
      }
    }
  }

  // Third pass: Create third-level items (e.g., "A01.01", "B02.02")
  for (const row of data) {
    const ebkpCode = ebkpHeader ? String(row[ebkpHeader] || "").trim() : "";

    // Skip rows without eBKP code
    if (!ebkpCode) continue;

    // Check if this is a third-level code (contains a dot)
    if (ebkpCode.includes(".")) {
      const parentCode = ebkpCode.split(".")[0];
      const parentItem = parentMap[parentCode];

      if (parentItem) {
        // Extract values safely
        const bezeichnung = bezeichnungHeader
          ? String(row[bezeichnungHeader] || "")
          : "";
        const menge = mengeHeader
          ? row[mengeHeader] !== undefined &&
            row[mengeHeader] !== null &&
            row[mengeHeader] !== ""
            ? Number(row[mengeHeader])
            : null
          : null;
        const einheit = einheitHeader ? String(row[einheitHeader] || "") : "";
        const kennwert = kennwertHeader
          ? extractNumber(row, kennwertHeader, kennwertIndex)
          : null;
        const chf = chfHeader ? extractNumber(row, chfHeader, chfIndex) : null;
        const totalChf = totalChfHeader
          ? extractNumber(row, totalChfHeader, totalChfIndex)
          : null;
        const kommentar = kommentarHeader
          ? String(row[kommentarHeader] || "")
          : "";

        const thirdLevelItem: CostItem = {
          ebkp: ebkpCode,
          bezeichnung,
          menge: menge ?? undefined,
          einheit,
          kennwert: kennwert ?? undefined,
          chf: chf ?? undefined,
          totalChf: totalChf ?? undefined,
          kommentar,
          children: [],
          expanded: false,
        };

        if (parentItem.children) {
          parentItem.children.push(thirdLevelItem);
        }
      }
    }
  }

  return items;
};

export const parseExcelFile = async (
  file: File
): Promise<{
  data: CostItem[];
  headers: string[];
  missingHeaders?: string[];
  valid: boolean;
}> => {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      throw new Error("No worksheet found");
    }

    // Get headers from first row
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value || "");
    });

    // Normalize the headers to lowercase for case-insensitive comparison
    const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

    // Check if all required headers exist (case-insensitive)
    const missingHeaders = REQUIRED_HEADERS.filter(
      (header) => !normalizedHeaders.includes(header.toLowerCase())
    );

    // Convert worksheet to JSON data
    const jsonData: ExcelRow[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header row
      
      const rowData: ExcelRow = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        if (header) {
          // Convert ExcelJS CellValue to string or number
          const cellValue = cell.value;
          if (cellValue !== null && cellValue !== undefined) {
            if (typeof cellValue === 'object' && 'text' in cellValue) {
              // Handle rich text objects
              rowData[header] = cellValue.text;
            } else if (typeof cellValue === 'string' || typeof cellValue === 'number') {
              rowData[header] = cellValue;
            } else {
              rowData[header] = String(cellValue);
            }
          } else {
            rowData[header] = "";
          }
        }
      });
      
      // Only add non-empty rows
      if (Object.values(rowData).some(value => value !== null && value !== undefined && value !== "")) {
        jsonData.push(rowData);
      }
    });

    // Make sure valid is always boolean
    const valid = jsonData.length > 0 && missingHeaders.length === 0;

    const processedData = processExcelData(jsonData, headers);

    return {
      data: processedData,
      headers: headers,
      missingHeaders: missingHeaders.length > 0 ? missingHeaders : undefined,
      valid,
    };
  } catch (error) {
    throw error;
  }
};

export const fileSize = (size: number): string => {
  if (size === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(size) / Math.log(k));
  return parseFloat((size / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};
