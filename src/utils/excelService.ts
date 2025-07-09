import * as ExcelJS from 'exceljs';
import { EbkpStat } from '../components/EbkpCostForm';



export interface ExcelExportConfig {
  fileName: string;
}

export interface ExcelImportData {
  groupKey: string;
  displayName: string;
  kennwert?: number;
}

export interface ExcelImportResult {
  success: boolean;
  data: ExcelImportData[];
  errors: string[];
  warnings: string[];
}

export class ExcelService {
  
  static async exportToExcel(
    stats: EbkpStat[],
    kennwerte: Record<string, number>,
    config: ExcelExportConfig
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    
    // Add metadata
    workbook.creator = 'Cost Plugin';
    workbook.lastModifiedBy = 'Cost Plugin';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Create main worksheet
    const worksheet = workbook.addWorksheet('Kostenkennwerte');
    
    // Setup headers - simplified to just eBKP code and kennwert
    const headers = ['eBKP Code', 'Kennwert (CHF)'];
    
    // Add headers
    const headerRow = worksheet.addRow(headers);
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    
    // Create worksheet data
    const wsData: Array<Array<string | number>> = [headers];
    
    // Add data rows
    stats.forEach(stat => {
      const kennwert = kennwerte[stat.code];
      const row: Array<string | number> = [stat.code, kennwert !== undefined ? kennwert : ''];
      
      // Add quantity columns based on selected quantity type
      // Assuming quantityColumns is defined elsewhere or passed as an argument
      // For now, we'll just add the kennwert and then unit/totalCost
      row.push(stat.code); // eBKP Code
      row.push(kennwert !== undefined ? kennwert : ''); // Kennwert
      row.push(stat.unit || ''); // Unit
      row.push(stat.totalCost || 0); // Total Cost
      
      wsData.push(row);
    });
    
    // Add data rows to worksheet
    wsData.forEach(row => worksheet.addRow(row));
    
    // Auto-fit columns
    worksheet.columns.forEach(column => {
      if (column && column.eachCell) {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = Math.min(maxLength + 2, 50);
      }
    });
    
    // Create buffer and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.fileName}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
  
  static async importFromExcel(file: File): Promise<ExcelImportResult> {
    const result: ExcelImportResult = {
      success: false,
      data: [],
      errors: [],
      warnings: []
    };
    
    try {
      const workbook = new ExcelJS.Workbook();
      const buffer = await file.arrayBuffer();
      await workbook.xlsx.load(buffer);
      
      const worksheet = workbook.getWorksheet('Kostenkennwerte');
      if (!worksheet) {
        result.errors.push('Arbeitsblatt "Kostenkennwerte" nicht gefunden');
        return result;
      }
      
      const headerRow = worksheet.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value?.toString() || '';
      });
      
      // Find column indices (ExcelJS headers array is 1-based)
      const ebkpIndex = headers.indexOf('eBKP Code');
      const kennwertIndex = headers.indexOf('Kennwert (CHF)');
      
      if (ebkpIndex === -1) {
        result.errors.push('Spalte "eBKP Code" nicht gefunden');
        return result;
      }
      
      // Process data rows
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        
        const ebkpCode = row.getCell(ebkpIndex).value?.toString();
        if (!ebkpCode) {
          result.warnings.push(`Zeile ${rowNumber}: eBKP Code ist leer`);
          return;
        }
        
        const kennwertValue = row.getCell(kennwertIndex).value;
        let kennwert: number | undefined = undefined;
        
        if (typeof kennwertValue === 'number') {
          kennwert = kennwertValue;
        } else if (typeof kennwertValue === 'string') {
          const parsed = parseFloat(kennwertValue.trim());
          if (!isNaN(parsed)) {
            kennwert = parsed;
          }
        }
        
        const importData: ExcelImportData = {
          groupKey: ebkpCode,
          displayName: ebkpCode,
          kennwert: kennwert
        };
        
        result.data.push(importData);
      });
      
      result.success = true;
      
    } catch (error) {
      result.errors.push(`Fehler beim Lesen der Excel-Datei: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
    }
    
    return result;
  }
  

} 