import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tabs,
  Tab,
  Box,
  Typography,

  TextField,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Chip,
  Divider,
  IconButton,

  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Stepper,
  Step,
  StepLabel,
  StepContent
} from '@mui/material';
import {
  FileDownload,
  FileUpload,
  Close,
  CheckCircle,
  Warning,
  Error as ErrorIcon,

  Refresh,
  Preview,
  Settings
} from '@mui/icons-material';
import { ExcelService, ExcelExportConfig, ExcelImportResult } from '../utils/excelService';

import { EbkpStat } from './EbkpCostForm';

interface Props {
  open: boolean;
  onClose: () => void;
  stats: EbkpStat[];
  kennwerte: Record<string, number>;
  onImportData: (data: Record<string, number>) => void;
  exportConfig?: ExcelExportConfig;
  onExportConfigChange?: (config: ExcelExportConfig) => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`excel-tabpanel-${index}`}
      aria-labelledby={`excel-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

const ExcelDialog: React.FC<Props> = ({
  open,
  onClose,
  stats,
  kennwerte,
  onImportData,
  exportConfig: externalExportConfig,
  onExportConfigChange
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [exportConfig, setExportConfig] = useState<ExcelExportConfig>(
    externalExportConfig || {
      fileName: `Kostenkennwerte_${new Date().toISOString().split('T')[0]}`
    }
  );
  
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ExcelImportResult | null>(null);
  const [importStep, setImportStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, unknown>[]>([]);

  // Update internal config when external config changes
  React.useEffect(() => {
    if (externalExportConfig) {
      setExportConfig(externalExportConfig);
    }
  }, [externalExportConfig]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    // Reset import state when switching tabs
    if (newValue === 0) {
      setImportResult(null);
      setImportStep(0);
      setSelectedFile(null);
      setPreviewData([]);
    }
  };

  const handleExportConfigChange = (newConfig: ExcelExportConfig) => {
    setExportConfig(newConfig);
    onExportConfigChange?.(newConfig);
  };

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      await ExcelService.exportToExcel(stats, kennwerte, exportConfig);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  }, [stats, kennwerte, exportConfig]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setImportStep(1);
      setImportResult(null);
      setPreviewData([]);
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!selectedFile) return;
    
    setIsImporting(true);
    try {
      const result = await ExcelService.importFromExcel(selectedFile);
      setImportResult(result);
      setImportStep(2);
      
      if (result.success) {
        // Generate preview data
        const preview = result.data.slice(0, 10).map(item => ({
          ebkpCode: item.groupKey,
          kennwert: item.kennwert !== undefined ? item.kennwert : null
        }));
        setPreviewData(preview);
      }
    } catch (error) {
      setImportResult({
        success: false,
        data: [],
        errors: [`Fehler beim Import: ${error instanceof Error ? (error as Error).message : 'Unbekannter Fehler'}`],
        warnings: []
      });
      setImportStep(2);
    } finally {
      setIsImporting(false);
    }
  }, [selectedFile]);

  const handleApplyImport = useCallback(() => {
    if (!importResult?.success) return;
    
    const newKennwerte: Record<string, number> = {};
    importResult.data.forEach(item => {
      if (item.kennwert !== undefined && item.kennwert !== null) {
        newKennwerte[item.groupKey] = item.kennwert;
      }
    });
    
    onImportData(newKennwerte);
    setImportStep(3);
    
    // Close dialog after a brief delay
    setTimeout(() => {
      onClose();
      setImportStep(0);
      setImportResult(null);
      setSelectedFile(null);
      setPreviewData([]);
    }, 2000);
  }, [importResult, onImportData, onClose]);

  const resetImport = useCallback(() => {
    setImportStep(0);
    setImportResult(null);
    setSelectedFile(null);
    setPreviewData([]);
  }, []);



  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { minHeight: '70vh' }
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="div">
          Excel Export/Import
        </Typography>
        <IconButton onClick={onClose} size="small">
          <Close />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ p: 0 }}>
        <Tabs value={activeTab} onChange={handleTabChange} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab 
            label="Export" 
            icon={<FileDownload />} 
            iconPosition="start"
            sx={{ minHeight: 60 }}
          />
          <Tab 
            label="Import" 
            icon={<FileUpload />} 
            iconPosition="start"
            sx={{ minHeight: 60 }}
          />
        </Tabs>

                <TabPanel value={activeTab} index={0}>
          <Box sx={{ px: 3 }}>
            <Typography variant="h6" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Settings />
              Excel Export
            </Typography>
            
            <Alert severity="info" sx={{ mb: 3 }}>
              Exportiert alle eBKP-Codes mit aktuellen Kennwerten. Sie können die Kennwerte in Excel bearbeiten und dann wieder importieren.
            </Alert>
            
            <Box sx={{ mb: 4 }}>
              <TextField
                label="Dateiname"
                value={exportConfig.fileName}
                onChange={(e) => handleExportConfigChange({ ...exportConfig, fileName: e.target.value })}
                fullWidth
                helperText="Ohne .xlsx Erweiterung"
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <Preview />
              <Typography variant="h6">Vorschau</Typography>
            </Box>

            <Paper elevation={1} sx={{ p: 2, backgroundColor: 'grey.50' }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>Anzahl eBKP-Codes:</strong> {stats.length}
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>Dateiname:</strong> {exportConfig.fileName}.xlsx
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>Spalten:</strong> eBKP Code, Kennwert (CHF)
              </Typography>
            </Paper>
          </Box>
        </TabPanel>

        <TabPanel value={activeTab} index={1}>
          <Box sx={{ px: 3 }}>
            <Stepper activeStep={importStep} orientation="vertical">
              <Step>
                <StepLabel>Excel-Datei auswählen</StepLabel>
                <StepContent>
                  <Box sx={{ mb: 2 }}>
                    <input
                      accept=".xlsx,.xls"
                      style={{ display: 'none' }}
                      id="excel-file-input"
                      type="file"
                      onChange={handleFileSelect}
                    />
                    <label htmlFor="excel-file-input">
                      <Button
                        variant="contained"
                        component="span"
                        startIcon={<FileUpload />}
                        sx={{ mr: 2 }}
                      >
                        Datei auswählen
                      </Button>
                    </label>
                    {selectedFile && (
                      <Chip 
                        label={selectedFile.name} 
                        onDelete={() => setSelectedFile(null)}
                        color="primary"
                      />
                    )}
                  </Box>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Wählen Sie eine Excel-Datei (.xlsx) aus, die mit diesem Tool exportiert wurde.
                  </Alert>
                </StepContent>
              </Step>

              <Step>
                <StepLabel>Datei analysieren</StepLabel>
                <StepContent>
                  <Box sx={{ mb: 2 }}>
                    <Button
                      variant="contained"
                      onClick={handleImport}
                      disabled={!selectedFile || isImporting}
                      startIcon={isImporting ? <LinearProgress /> : <Preview />}
                    >
                      {isImporting ? 'Analysiere...' : 'Datei analysieren'}
                    </Button>
                  </Box>
                  {isImporting && <LinearProgress sx={{ mb: 2 }} />}
                </StepContent>
              </Step>

              <Step>
                <StepLabel>Vorschau und Bestätigung</StepLabel>
                <StepContent>
                  {importResult && (
                    <Box sx={{ mb: 2 }}>
                      {importResult.success ? (
                        <>
                          <Alert severity="success" sx={{ mb: 2 }}>
                            <strong>{importResult.data.length} Datensätze</strong> erfolgreich gelesen
                          </Alert>
                          
                          {importResult.warnings.length > 0 && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                              <Typography variant="subtitle2">Warnungen:</Typography>
                              <List dense>
                                {importResult.warnings.map((warning, index) => (
                                  <ListItem key={index}>
                                    <ListItemIcon><Warning fontSize="small" /></ListItemIcon>
                                    <ListItemText primary={warning} />
                                  </ListItem>
                                ))}
                              </List>
                            </Alert>
                          )}

                          {previewData.length > 0 && (
                            <Paper elevation={1} sx={{ mb: 2 }}>
                              <Typography variant="subtitle1" sx={{ p: 2, pb: 0 }}>
                                Vorschau (erste 10 Einträge):
                              </Typography>
                              <TableContainer>
                                <Table size="small">
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>eBKP Code</TableCell>
                                      <TableCell align="right">Kennwert (CHF)</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                                                         {previewData.map((row, index) => (
                                       <TableRow key={index}>
                                         <TableCell>{String(row.ebkpCode ?? '')}</TableCell>
                                         <TableCell align="right">
                                           {typeof row.kennwert === 'number' ? row.kennwert.toFixed(2) : '-'}
                                         </TableCell>
                                       </TableRow>
                                     ))}
                                  </TableBody>
                                </Table>
                              </TableContainer>
                            </Paper>
                          )}

                          <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button
                              variant="contained"
                              onClick={handleApplyImport}
                              startIcon={<CheckCircle />}
                              color="success"
                            >
                              Kennwerte übernehmen
                            </Button>
                            <Button
                              variant="outlined"
                              onClick={resetImport}
                              startIcon={<Refresh />}
                            >
                              Neu starten
                            </Button>
                          </Box>
                        </>
                      ) : (
                        <>
                          <Alert severity="error" sx={{ mb: 2 }}>
                            <Typography variant="subtitle2">Fehler beim Import:</Typography>
                            <List dense>
                              {importResult.errors.map((error, index) => (
                                <ListItem key={index}>
                                  <ListItemIcon><ErrorIcon fontSize="small" /></ListItemIcon>
                                  <ListItemText primary={error} />
                                </ListItem>
                              ))}
                            </List>
                          </Alert>
                          <Button
                            variant="outlined"
                            onClick={resetImport}
                            startIcon={<Refresh />}
                          >
                            Neu versuchen
                          </Button>
                        </>
                      )}
                    </Box>
                  )}
                </StepContent>
              </Step>

              <Step>
                <StepLabel>Abgeschlossen</StepLabel>
                <StepContent>
                  <Alert severity="success" sx={{ mb: 2 }}>
                    <Typography variant="subtitle2">
                      Kennwerte erfolgreich übernommen!
                    </Typography>
                    <Typography variant="body2">
                      Die Werte wurden in die Benutzeroberfläche übertragen.
                    </Typography>
                  </Alert>
                </StepContent>
              </Step>
            </Stepper>
          </Box>
        </TabPanel>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {activeTab === 0 ? (
          <>
            <Button onClick={onClose} variant="outlined">
              Schliessen
            </Button>
            <Button
              onClick={handleExport}
              variant="contained"
              disabled={isExporting}
              startIcon={isExporting ? <LinearProgress /> : <FileDownload />}
            >
              {isExporting ? 'Exportiere...' : 'Excel exportieren'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose} variant="outlined">
            Schliessen
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ExcelDialog; 