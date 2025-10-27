import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  SelectChangeEvent,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import { MongoElement } from "../../types/common.types";
import { CostEbkpGroup } from "../../types/cost.types";
import { getZeroQuantityStyles, isZeroQuantity } from "../../utils/zeroQuantityHighlight";
import { hasElementMissingQuantity } from "../../utils/quantityUtils";
import logger from '../../utils/logger';

interface CostEbkpGroupRowProps {
  group: CostEbkpGroup;
  isExpanded: boolean;
  toggleExpand: (code: string) => void;
  kennwerte: Record<string, number>;
  onKennwertChange: (code: string, value: number) => void;
  onQuantityTypeChange?: (code: string, quantityType: string) => void;
  isSubGroup?: boolean;
}

// Helper function to get element quantity value (extracted outside component)
const getElementQuantityValue = (element: MongoElement, selectedQuantityType: string) => {
  // PRIORITY 1: Check if user edited quantity in QTO (most important!)
  if (element.quantity && typeof element.quantity === 'object' && element.quantity.value > 0) {
    // Return the user-edited value if type matches
    if (element.quantity.type === selectedQuantityType) {
      return element.quantity.value;
    }
    // If different type, fall through to Priority 2 (original IFC quantities)
  }

  // PRIORITY 2: Fallback to original IFC quantities
  switch (selectedQuantityType) {
    case 'area':
      return element.area;
    case 'volume':
      return element.volume;
    case 'length':
      return element.length;
    case 'count':
      return 1;
    default:
      return element.area;
  }
};

const CostEbkpGroupRow: React.FC<CostEbkpGroupRowProps> = ({
  group,
  isExpanded,
  toggleExpand,
  kennwerte,
  onKennwertChange,
  onQuantityTypeChange,
  isSubGroup = false,
}) => {
  const [showAllElements, setShowAllElements] = useState(false);
  const [showOnlyFailing, setShowOnlyFailing] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState<'success' | 'error'>('success');

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToastMessage('GUID erfolgreich kopiert!');
      setToastSeverity('success');
      setShowToast(true);
    } catch (err) {
      logger.error('Failed to copy text: ', err);
      setToastMessage('Fehler beim Kopieren der GUID');
      setToastSeverity('error');
      setShowToast(true);
    }
  };

  const handleToastClose = () => {
    setShowToast(false);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('de-CH', {
      style: 'currency',
      currency: 'CHF',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatQuantity = (value: number) => {
    return new Intl.NumberFormat('de-CH', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleKennwertChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    onKennwertChange(group.code, isNaN(value) ? 0 : value);
  };

  const handleQuantityTypeChange = (e: SelectChangeEvent<string>) => {
    if (onQuantityTypeChange) {
      onQuantityTypeChange(group.code, e.target.value);
    }
  };

  const getSelectedQuantity = () => {
    if (group.selectedQuantityType) {
      const selected = group.availableQuantities.find(q => q.type === group.selectedQuantityType);
      if (selected) {
        return { value: selected.value, unit: selected.unit };
      }
    }

    const defaultQty = group.availableQuantities[0];
    return defaultQty ? { value: defaultQty.value, unit: defaultQty.unit } : { value: 0, unit: '' };
  };

  const selectedQuantity = getSelectedQuantity();
  const kennwert = kennwerte[group.code] || 0;
  const totalCost = selectedQuantity.value * kennwert;

  // Check if any child elements have zero quantities for the selected quantity type
  const selectedQuantityType = group.selectedQuantityType || group.availableQuantities[0]?.type;
  const elementsWithZeroQuantity = group.elements.filter(element => {
    // Use hasElementMissingQuantity which properly checks edited quantities first
    return hasElementMissingQuantity(element, selectedQuantityType);
  });

  const hasZeroQuantity = elementsWithZeroQuantity.length > 0;
  const elementsWithMissingQuantities = elementsWithZeroQuantity.length;

  // Memoize filtered and sorted elements for performance
  const processedElements = useMemo(() => {
    // Filter elements if showing only failing ones
    const filteredElements = showOnlyFailing
      ? group.elements.filter(element => isZeroQuantity(getElementQuantityValue(element, selectedQuantityType)))
      : [...group.elements];

    // Sort elements to show those with missing quantities first
    const sortedElements = filteredElements.sort((a, b) => {
      const aHasMissingQuantity = isZeroQuantity(getElementQuantityValue(a, selectedQuantityType));
      const bHasMissingQuantity = isZeroQuantity(getElementQuantityValue(b, selectedQuantityType));

      // Elements with missing quantities come first
      if (aHasMissingQuantity && !bHasMissingQuantity) return -1;
      if (!aHasMissingQuantity && bHasMissingQuantity) return 1;

      // If both have same status, maintain original order
      return 0;
    });

    // Show either first 5 or all elements based on showAllElements state
    return (showAllElements || showOnlyFailing) ? sortedElements : sortedElements.slice(0, 5);
  }, [group.elements, selectedQuantityType, showOnlyFailing, showAllElements]);

  return (
    <>
      {/* Toast Notification */}
      <Snackbar
        open={showToast}
        autoHideDuration={3000}
        onClose={handleToastClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleToastClose}
          severity={toastSeverity}
          sx={{ width: '100%' }}
        >
          {toastMessage}
        </Alert>
      </Snackbar>

      {/* Main Group Row */}
      <Tooltip
        title={hasZeroQuantity ? `Enthält ${elementsWithMissingQuantities} Element${elementsWithMissingQuantities !== 1 ? 'e' : ''} ohne Mengen - Gruppe ${group.code}` : ''}
        arrow
        placement="left"
      >
        <TableRow
          sx={getZeroQuantityStyles(hasZeroQuantity, {
            backgroundColor: isSubGroup ? "rgba(0, 0, 0, 0.02)" : "inherit",
            "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.04)" },
          })}
        >
          <TableCell sx={{ py: 1.5, pl: hasZeroQuantity ? (isSubGroup ? 2.5 : 0.5) : (isSubGroup ? 3 : 1) }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {group.elements.length > 0 && (
                <IconButton
                  size="small"
                  onClick={() => toggleExpand(group.code)}
                  sx={{ p: 0.5 }}
                >
                  {isExpanded ? (
                    <KeyboardArrowDownIcon fontSize="small" />
                  ) : (
                    <KeyboardArrowRightIcon fontSize="small" />
                  )}
                </IconButton>
              )}
              <Chip
                label={group.code}
                color="primary"
                variant="outlined"
                size="small"
                sx={{ fontWeight: 'bold' }}
              />
              {group.elements.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Typography variant="caption" color="text.secondary">
                    {group.elements.length} Element{group.elements.length !== 1 ? 'e' : ''}
                  </Typography>
                  {elementsWithMissingQuantities > 0 && (
                    <Typography variant="caption" sx={{
                      color: 'warning.main',
                      fontWeight: 'bold',
                      fontSize: '0.65rem'
                    }}>
                      {elementsWithMissingQuantities} ohne Mengen
                    </Typography>
                  )}
                  {isExpanded && elementsWithMissingQuantities > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                      <Button
                        size="small"
                        variant={showOnlyFailing ? "contained" : "outlined"}
                        onClick={() => {
                          setShowOnlyFailing(!showOnlyFailing);
                          if (!showOnlyFailing) {
                            setShowAllElements(true); // Show all when filtering to failing
                          }
                        }}
                        sx={{
                          fontSize: '0.6rem',
                          py: 0.25,
                          px: 0.75,
                          minWidth: 'auto'
                        }}
                      >
                        {showOnlyFailing ? 'Alle' : 'Nur fehlende'}
                      </Button>
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          </TableCell>

          <TableCell sx={{ py: 1.5, textAlign: "right" }}>
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
              <Typography variant="body2" sx={{
                fontWeight: hasZeroQuantity ? 'bold' : 500,
                color: hasZeroQuantity ? 'warning.main' : 'inherit'
              }}>
                {formatQuantity(selectedQuantity.value)} {selectedQuantity.unit}
              </Typography>

              {group.availableQuantities.length > 1 && (
                <FormControl size="small" sx={{ minWidth: 80 }}>
                  <Select
                    value={group.selectedQuantityType || group.availableQuantities[0]?.type || ''}
                    onChange={handleQuantityTypeChange}
                    variant="outlined"
                    sx={{ fontSize: '0.75rem' }}
                  >
                    {group.availableQuantities.map((qty) => (
                      <MenuItem key={qty.type} value={qty.type}>
                        {qty.type === 'area' ? 'Fläche' :
                          qty.type === 'length' ? 'Länge' :
                            qty.type === 'volume' ? 'Volumen' :
                              qty.type === 'count' ? 'Stück' : qty.type}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Box>
          </TableCell>

          <TableCell sx={{ py: 1.5, textAlign: "right" }}>
            <TextField
              type="number"
              value={kennwert}
              onChange={handleKennwertChange}
              variant="outlined"
              size="small"
              sx={{ width: 120 }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Typography variant="caption" color="text.secondary">CHF</Typography>
                  </InputAdornment>
                ),
              }}
            />
          </TableCell>

          <TableCell sx={{ py: 1.5, textAlign: "right" }}>
            <Typography variant="subtitle2" fontWeight="bold">
              {formatCurrency(totalCost)}
            </Typography>
          </TableCell>
        </TableRow>
      </Tooltip>

      {/* Collapsible Elements */}
      {group.elements.length > 0 && (
        <TableRow>
          <TableCell
            colSpan={4}
            sx={{
              py: 0,
              border: "none",
              backgroundColor: "rgba(0, 0, 0, 0.01)"
            }}
          >
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ py: 1, pl: 4 }}>
                <Table size="small">
                  <TableBody>
                    {processedElements.map((element: MongoElement) => {
                      // For individual elements, check if they have zero quantity for the selected type
                      const quantityValue = getElementQuantityValue(element, selectedQuantityType);
                      const elementHasZeroQuantity = isZeroQuantity(quantityValue);

                      return (
                        <Tooltip
                          key={element._id}
                          title={
                            <Box sx={{ p: 0.5 }}>
                              <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block' }}>
                                {element.type_name || element.ifc_class || 'Unknown'}
                              </Typography>
                              {element.name && (
                                <Typography variant="caption" sx={{ display: 'block', fontStyle: 'italic' }}>
                                  "{element.name}"
                                </Typography>
                              )}
                              {element.global_id && (
                                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.65rem' }}>
                                  GUID: {element.global_id}
                                </Typography>
                              )}
                              {elementHasZeroQuantity && (
                                <Typography variant="caption" sx={{ display: 'block', color: 'warning.light', fontWeight: 'bold' }}>
                                  ⚠ Keine {selectedQuantityType === 'area' ? 'Fläche' :
                                    selectedQuantityType === 'length' ? 'Länge' :
                                      selectedQuantityType === 'volume' ? 'Volumen' : 'Menge'} vorhanden
                                </Typography>
                              )}
                              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.65rem', mt: 0.5 }}>
                                Ebene: {element.level || 'Unbekannt'}
                              </Typography>
                              {element.materials && element.materials.length > 0 && (
                                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.65rem' }}>
                                  Materialien: {element.materials.map(m => m.name).join(', ')}
                                </Typography>
                              )}
                            </Box>
                          }
                          arrow
                          placement="left"
                        >
                          <TableRow sx={getZeroQuantityStyles(elementHasZeroQuantity, { border: "none" })}>
                            <TableCell sx={{ py: 1, border: "none", pl: elementHasZeroQuantity ? 3.5 : 4 }}>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                {/* Main element info */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="caption" sx={{
                                    color: elementHasZeroQuantity ? 'warning.main' : 'text.secondary',
                                    fontWeight: elementHasZeroQuantity ? 'bold' : 500,
                                    fontSize: '0.8rem'
                                  }}>
                                    {element.type_name || element.ifc_class || 'Unknown'}
                                  </Typography>

                                  {/* Status badges */}
                                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                                    {element.is_structural && (
                                      <Chip
                                        label="Tragwerk"
                                        size="small"
                                        color="primary"
                                        variant="outlined"
                                        sx={{ fontSize: '0.6rem', height: 16 }}
                                      />
                                    )}
                                    {element.is_external && (
                                      <Chip
                                        label="Extern"
                                        size="small"
                                        color="secondary"
                                        variant="outlined"
                                        sx={{ fontSize: '0.6rem', height: 16 }}
                                      />
                                    )}
                                  </Box>

                                  {element.global_id && (
                                    <Tooltip title={`GUID kopieren: ${element.global_id}`} arrow>
                                      <IconButton
                                        size="small"
                                        aria-label={`GUID kopieren${element.global_id ? `: ${element.global_id}` : ''}`}
                                        onClick={() => {
                                          if (element.global_id) {
                                            copyToClipboard(element.global_id);
                                          } else {
                                            setToastMessage('Keine GUID verfügbar');
                                            setToastSeverity('error');
                                            setShowToast(true);
                                          }
                                        }}
                                        sx={{
                                          p: 0.25,
                                          fontSize: '0.7rem',
                                          color: 'text.secondary',
                                          '&:hover': {
                                            color: 'primary.main',
                                            backgroundColor: 'rgba(25, 118, 210, 0.04)'
                                          }
                                        }}
                                      >
                                        <ContentCopyIcon sx={{ fontSize: '0.7rem' }} />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Box>

                                {/* Element name if different from type */}
                                {element.name && element.name !== element.type_name && (
                                  <Typography variant="caption" sx={{
                                    color: 'text.secondary',
                                    fontSize: '0.7rem',
                                    fontStyle: 'italic'
                                  }}>
                                    "{element.name}"
                                  </Typography>
                                )}

                                {/* Quantities info */}
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {/* Show edited quantity prominently if it exists */}
                                  {element.quantity && typeof element.quantity === 'object' && Number.isFinite(Number(element.quantity.value)) && (
                                    <Chip
                                      label={`✏️ ${formatQuantity(Number(element.quantity.value))} ${element.quantity.unit || ''}`}
                                      size="small"
                                      color="success"
                                      variant="filled"
                                      sx={{
                                        fontSize: '0.7rem',
                                        fontWeight: 'bold',
                                        height: 20
                                      }}
                                    />
                                  )}
                                  
                                  {/* Original IFC quantities */}
                                  {element.area !== undefined && (
                                    <Typography variant="caption" sx={{
                                      color: selectedQuantityType === 'area' && elementHasZeroQuantity ? 'warning.main' : 'text.secondary',
                                      fontSize: '0.65rem',
                                      fontWeight: selectedQuantityType === 'area' ? 'bold' : 'normal',
                                      textDecoration: element.quantity && Number(element.quantity.value) > 0 && element.quantity.type === 'area' ? 'line-through' : 'none',
                                      opacity: element.quantity && Number(element.quantity.value) > 0 && element.quantity.type === 'area' ? 0.5 : 1
                                    }}>
                                      A: {formatQuantity(element.area)} m²
                                    </Typography>
                                  )}
                                  {element.length !== undefined && (
                                    <Typography variant="caption" sx={{
                                      color: selectedQuantityType === 'length' && elementHasZeroQuantity ? 'warning.main' : 'text.secondary',
                                      fontSize: '0.65rem',
                                      fontWeight: selectedQuantityType === 'length' ? 'bold' : 'normal',
                                      textDecoration: element.quantity && Number(element.quantity.value) > 0 && element.quantity.type === 'length' ? 'line-through' : 'none',
                                      opacity: element.quantity && Number(element.quantity.value) > 0 && element.quantity.type === 'length' ? 0.5 : 1
                                    }}>
                                      L: {formatQuantity(element.length)} m
                                    </Typography>
                                  )}
                                  {element.volume !== undefined && (
                                    <Typography variant="caption" sx={{
                                      color: selectedQuantityType === 'volume' && elementHasZeroQuantity ? 'warning.main' : 'text.secondary',
                                      fontSize: '0.65rem',
                                      fontWeight: selectedQuantityType === 'volume' ? 'bold' : 'normal',
                                      textDecoration: element.quantity && Number(element.quantity.value) > 0 && element.quantity.type === 'volume' ? 'line-through' : 'none',
                                      opacity: element.quantity && Number(element.quantity.value) > 0 && element.quantity.type === 'volume' ? 0.5 : 1
                                    }}>
                                      V: {formatQuantity(element.volume)} m³
                                    </Typography>
                                  )}
                                </Box>

                                {/* Materials info */}
                                {element.materials && element.materials.length > 0 && (
                                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {element.materials.slice(0, 2).map((material, idx) => (
                                      <Chip
                                        key={idx}
                                        label={material.name}
                                        size="small"
                                        variant="outlined"
                                        sx={{
                                          fontSize: '0.6rem',
                                          height: 16,
                                          color: 'text.secondary',
                                          borderColor: 'rgba(0,0,0,0.12)'
                                        }}
                                      />
                                    ))}
                                    {element.materials.length > 2 && (
                                      <Typography variant="caption" sx={{
                                        color: 'text.secondary',
                                        fontSize: '0.6rem',
                                        alignSelf: 'center'
                                      }}>
                                        +{element.materials.length - 2} weitere
                                      </Typography>
                                    )}
                                  </Box>
                                )}
                              </Box>
                            </TableCell>
                            <TableCell sx={{ py: 1, border: "none", textAlign: "right", verticalAlign: 'top' }}>
                              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                  {element.level || 'Unbekannte Ebene'}
                                </Typography>
                                {element.classification && (
                                  <Typography variant="caption" sx={{
                                    color: 'text.secondary',
                                    fontSize: '0.65rem',
                                    textAlign: 'right'
                                  }}>
                                    {element.classification.system}: {element.classification.id}
                                  </Typography>
                                )}
                              </Box>
                            </TableCell>
                            <TableCell sx={{ py: 1, border: "none" }} />
                            <TableCell sx={{ py: 1, border: "none" }} />
                          </TableRow>
                        </Tooltip>
                      );
                    })}
                    {group.elements.length > 5 && !showAllElements && !showOnlyFailing && (
                      <TableRow>
                        <TableCell sx={{ py: 0.5, border: "none" }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                              <Typography variant="caption" color="text.secondary">
                                ... und {group.elements.length - 5} weitere
                              </Typography>
                              {(() => {
                                // Count remaining elements with missing quantities
                                const remainingElements = group.elements.slice(5);
                                const remainingWithMissingQuantities = remainingElements.filter(element => {
                                  const quantityValue = getElementQuantityValue(element, selectedQuantityType);
                                  return isZeroQuantity(quantityValue);
                                }).length;

                                return remainingWithMissingQuantities > 0 ? (
                                  <Typography variant="caption" sx={{
                                    color: 'warning.main',
                                    fontWeight: 'bold',
                                    fontSize: '0.6rem'
                                  }}>
                                    {remainingWithMissingQuantities} weitere ohne Mengen
                                  </Typography>
                                ) : null;
                              })()}
                            </Box>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => setShowAllElements(true)}
                              startIcon={<ExpandMoreIcon />}
                              sx={{
                                fontSize: '0.65rem',
                                py: 0.25,
                                px: 1,
                                minWidth: 'auto'
                              }}
                            >
                              Alle anzeigen
                            </Button>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                      </TableRow>
                    )}
                    {group.elements.length > 5 && showAllElements && !showOnlyFailing && (
                      <TableRow>
                        <TableCell sx={{ py: 0.5, border: "none" }}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => setShowAllElements(false)}
                            startIcon={<ExpandLessIcon />}
                            sx={{
                              fontSize: '0.65rem',
                              py: 0.25,
                              px: 1,
                              minWidth: 'auto'
                            }}
                          >
                            Weniger anzeigen
                          </Button>
                        </TableCell>
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                        <TableCell sx={{ py: 0.5, border: "none" }} />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

export default CostEbkpGroupRow; 