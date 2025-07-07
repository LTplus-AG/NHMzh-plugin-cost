import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  AlertTitle,
  Chip,
  LinearProgress,
  IconButton,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Fade,
  Collapse
} from '@mui/material';
import {
  CloudUpload,
  CheckCircle,
  Error as ErrorIcon,
  Warning,
  Info,
  Close,
  FileDownload,
  Refresh,
  ExpandMore,
  ExpandLess
} from '@mui/icons-material';
import { ExcelService, ExcelImportResult } from '../utils/excelService';
import * as ExcelJS from 'exceljs';
import { EbkpStat } from './EbkpCostForm';

interface Props {
  open: boolean;
  onClose: () => void;
  onImportComplete: (kennwerte: Record<string, number>) => void;
  stats: EbkpStat[];
  currentKennwerte: Record<string, number>;
}

type ImportStep = 'file-selection' | 'processing' | 'preview' | 'complete';

const ExcelImportDialog: React.FC<Props> = ({
  open,
  onClose,
  onImportComplete,
  stats,
  currentKennwerte
}) => {
  const [activeStep, setActiveStep] = useState<ImportStep>('file-selection');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ExcelImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setActiveStep('processing');
      processFile(file);
    }
  }, []);

  const processFile = async (file: File) => {
    try {
      const result = await ExcelService.importFromExcel(file);
      setImportResult(result);
      
      if (result.success && result.data.length > 0) {
        setActiveStep('preview');
      } else {
        setActiveStep('file-selection');
      }
    } catch (error) {
      console.error('Import processing failed:', error);
      setImportResult({
        success: false,
        data: [],
        errors: ['Fehler beim Verarbeiten der Datei. Bitte überprüfen Sie das Dateiformat.'],
        warnings: []
      });
      setActiveStep('file-selection');
    }
  };

  const handleImportConfirm = () => {
    if (!importResult?.data) return;

    const kennwerteToImport: Record<string, number> = {};
    importResult.data.forEach(item => {
      if (item.kennwert !== undefined) {
        kennwerteToImport[item.groupKey] = item.kennwert;
      }
    });

    onImportComplete(kennwerteToImport);
    setActiveStep('complete');
    setTimeout(() => {
      handleClose();
    }, 1500);
  };

  const handleClose = () => {
    setActiveStep('file-selection');
    setSelectedFile(null);
    setImportResult(null);
    setShowErrors(false);
    setShowWarnings(false);
    onClose();
  };

  const downloadTemplate = async () => {
    // Create a workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Kostenkennwerte');

    // Add headers
    const headers = ['eBKP Code', 'Kennwert (CHF)'];
    const headerRow = worksheet.addRow(headers);
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data rows from stats and currentKennwerte
    stats.forEach(stat => {
      const kennwert = currentKennwerte[stat.code] || '';
      worksheet.addRow([stat.code, kennwert]);
    });

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

    // Write workbook to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    
    // Create Blob with correct Excel MIME type
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    // Generate URL and trigger download with .xlsx filename
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kostenkennwerte-template-${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getChangedValues = () => {
    if (!importResult?.data) return [];
    
    return importResult.data.filter(item => {
      const currentValue = currentKennwerte[item.groupKey];
      return item.kennwert !== undefined && item.kennwert !== currentValue;
    });
  };

  const getNewValues = () => {
    if (!importResult?.data) return [];
    
    return importResult.data.filter(item => {
      const currentValue = currentKennwerte[item.groupKey];
      return item.kennwert !== undefined && currentValue === undefined;
    });
  };

  const renderFileSelection = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <CloudUpload sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
      <Typography variant="h6" gutterBottom>
        Excel-Datei auswählen
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Wählen Sie eine Excel-Datei (.xlsx) mit Ihren Kostenkennwerten aus
      </Typography>
      
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
          size="large"
          startIcon={<CloudUpload />}
          sx={{ mb: 2 }}
        >
          Datei auswählen
        </Button>
      </label>

      <Box sx={{ mt: 3 }}>
        <Button
          variant="outlined"
          startIcon={<FileDownload />}
          onClick={downloadTemplate}
          size="small"
        >
          Vorlage herunterladen
        </Button>
      </Box>

      {importResult && !importResult.success && (
        <Alert severity="error" sx={{ mt: 3, textAlign: 'left' }}>
          <AlertTitle>Import fehlgeschlagen</AlertTitle>
          {importResult.errors.map((error, index) => (
            <Typography key={index} variant="body2">{error}</Typography>
          ))}
        </Alert>
      )}
    </Box>
  );

  const renderProcessing = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <LinearProgress sx={{ mb: 3 }} />
      <Typography variant="h6" gutterBottom>
        Verarbeite Datei...
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {selectedFile?.name}
      </Typography>
    </Box>
  );

  const renderPreview = () => {
    if (!importResult) return null;

    const changedValues = getChangedValues();
    const newValues = getNewValues();
    const totalChanges = changedValues.length + newValues.length;

    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Import-Vorschau
          </Typography>
          <Chip 
            label={`${totalChanges} Änderungen`}
            color={totalChanges > 0 ? 'primary' : 'default'}
            variant="filled"
          />
        </Box>

        {/* Summary Cards */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
          <Card variant="outlined">
            <CardContent sx={{ py: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircle color="success" />
                <Box>
                  <Typography variant="h6">{importResult.data.length}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Einträge gefunden
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent sx={{ py: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Info color="primary" />
                <Box>
                  <Typography variant="h6">{newValues.length}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Neue Werte
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent sx={{ py: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Refresh color="warning" />
                <Box>
                  <Typography variant="h6">{changedValues.length}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Änderungen
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* Errors and Warnings */}
        {importResult.errors.length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <AlertTitle>
              Fehler ({importResult.errors.length})
              <IconButton size="small" onClick={() => setShowErrors(!showErrors)}>
                {showErrors ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            </AlertTitle>
            <Collapse in={showErrors}>
              <List dense>
                {importResult.errors.map((error, index) => (
                  <ListItem key={index}>
                    <ListItemIcon><ErrorIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary={error} />
                  </ListItem>
                ))}
              </List>
            </Collapse>
          </Alert>
        )}

        {importResult.warnings.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>
              Warnungen ({importResult.warnings.length})
              <IconButton size="small" onClick={() => setShowWarnings(!showWarnings)}>
                {showWarnings ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            </AlertTitle>
            <Collapse in={showWarnings}>
              <List dense>
                {importResult.warnings.map((warning, index) => (
                  <ListItem key={index}>
                    <ListItemIcon><Warning fontSize="small" /></ListItemIcon>
                    <ListItemText primary={warning} />
                  </ListItem>
                ))}
              </List>
            </Collapse>
          </Alert>
        )}

        {/* Preview Table */}
        {totalChanges > 0 && (
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>eBKP Code</TableCell>
                  <TableCell align="right">Aktueller Wert</TableCell>
                  <TableCell align="right">Neuer Wert</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...newValues, ...changedValues].map((item, index) => {
                  const currentValue = currentKennwerte[item.groupKey];
                  const isNew = currentValue === undefined;
                  
                  return (
                    <TableRow key={index}>
                      <TableCell>{item.groupKey}</TableCell>
                      <TableCell align="right">
                        {currentValue !== undefined ? `CHF ${currentValue.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{ fontWeight: 'bold', color: isNew ? 'success.main' : 'warning.main' }}>
                          CHF {item.kennwert?.toFixed(2)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={isNew ? 'Neu' : 'Änderung'}
                          color={isNew ? 'success' : 'warning'}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {totalChanges === 0 && (
          <Alert severity="info">
            <AlertTitle>Keine Änderungen</AlertTitle>
            Die importierten Werte entsprechen den aktuellen Werten.
          </Alert>
        )}
      </Box>
    );
  };

  const renderComplete = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Fade in={true}>
        <Box>
          <CheckCircle sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Import erfolgreich!
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Die Kennwerte wurden erfolgreich importiert.
          </Typography>
        </Box>
      </Fade>
    </Box>
  );

  const getStepContent = () => {
    switch (activeStep) {
      case 'file-selection':
        return renderFileSelection();
      case 'processing':
        return renderProcessing();
      case 'preview':
        return renderPreview();
      case 'complete':
        return renderComplete();
      default:
        return null;
    }
  };

  const canProceed = activeStep === 'preview' && importResult?.success && getChangedValues().length + getNewValues().length > 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: 500,
          maxHeight: '90vh'
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Excel Import</Typography>
        <IconButton onClick={handleClose} size="small">
          <Close />
        </IconButton>
      </DialogTitle>
      
      <DialogContent>
        {getStepContent()}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        {activeStep === 'file-selection' && (
          <Button onClick={handleClose}>
            Abbrechen
          </Button>
        )}
        
        {activeStep === 'preview' && (
          <>
            <Button 
              onClick={() => {
                setActiveStep('file-selection');
                setSelectedFile(null);
                setImportResult(null);
              }}
            >
              Neue Datei
            </Button>
            <Button
              variant="contained"
              onClick={handleImportConfirm}
              disabled={!canProceed}
              startIcon={<CheckCircle />}
            >
              Importieren
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ExcelImportDialog; 