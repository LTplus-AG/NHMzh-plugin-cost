import { useState, useEffect, useCallback } from 'react';
import { ExcelExportConfig } from '../utils/excelService';

const EXCEL_CONFIG_KEY = 'cost-plugin-excel-config';
const EXCEL_ACTIVITY_KEY = 'cost-plugin-excel-activity';

interface ExcelActivity {
  exportCount: number;
  importCount: number;
  lastExportTime?: Date;
  lastImportTime?: Date;
}

const getDefaultActivity = (): ExcelActivity => ({
  exportCount: 0,
  importCount: 0
});

export const useExcelDialog = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportConfig, setExportConfig] = useState<ExcelExportConfig>({
    fileName: `Kostenkennwerte_${new Date().toISOString().split('T')[0]}`
  });
  const [activity, setActivity] = useState<ExcelActivity>(getDefaultActivity);

  // Load saved config and activity on mount
  useEffect(() => {
    try {
      const savedConfig = localStorage.getItem(EXCEL_CONFIG_KEY);
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        setExportConfig(prev => ({
          ...prev,
          ...parsed,
          // Always update filename with current date
          fileName: `Kostenkennwerte_${new Date().toISOString().split('T')[0]}`
        }));
      }

      const savedActivity = localStorage.getItem(EXCEL_ACTIVITY_KEY);
      if (savedActivity) {
        const parsed = JSON.parse(savedActivity);
        setActivity({
          ...parsed,
          lastExportTime: parsed.lastExportTime ? new Date(parsed.lastExportTime) : undefined,
          lastImportTime: parsed.lastImportTime ? new Date(parsed.lastImportTime) : undefined
        });
      }
    } catch (error) {
      console.warn('Failed to load Excel data from localStorage:', error);
    }
  }, []);

  // Save config when it changes
  useEffect(() => {
    try {
      // Don't save the filename as it should be date-based
      const configToSave = Object.keys(exportConfig).reduce((acc, key) => {
        if (key !== 'fileName') {
          acc[key] = exportConfig[key as keyof typeof exportConfig];
        }
        return acc;
      }, {} as typeof exportConfig);
      localStorage.setItem(EXCEL_CONFIG_KEY, JSON.stringify(configToSave));
    } catch (error) {
      console.warn('Failed to save Excel config to localStorage:', error);
    }
  }, [exportConfig]);

  // Save activity when it changes
  useEffect(() => {
    try {
      localStorage.setItem(EXCEL_ACTIVITY_KEY, JSON.stringify(activity));
    } catch (error) {
      console.warn('Failed to save Excel activity to localStorage:', error);
    }
  }, [activity]);

  const openDialog = () => setIsOpen(true);

  const closeDialog = () => setIsOpen(false);

  const updateExportConfig = (config: Partial<ExcelExportConfig>) => {
    setExportConfig(prev => ({ ...prev, ...config }));
  };

  const recordExport = useCallback(() => {
    setActivity(prev => ({
      ...prev,
      exportCount: prev.exportCount + 1,
      lastExportTime: new Date()
    }));
  }, []);

  const recordImport = useCallback(() => {
    setActivity(prev => ({
      ...prev,
      importCount: prev.importCount + 1,
      lastImportTime: new Date()
    }));
  }, []);

  return {
    isOpen,
    isExporting,
    isImporting,
    exportConfig,
    activity,
    openDialog,
    closeDialog,
    updateExportConfig,
    setIsExporting,
    setIsImporting,
    recordExport,
    recordImport
  };
}; 