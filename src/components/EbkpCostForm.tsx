import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FilterListIcon from "@mui/icons-material/FilterList";
import GroupWorkIcon from "@mui/icons-material/GroupWork";
import SearchIcon from "@mui/icons-material/Search";
import SortIcon from "@mui/icons-material/Sort";
import {
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";

import { useEbkpGroups } from "../hooks/useEbkpGroups";
import { MongoElement } from "../types/common.types";
import { getZeroQuantityStyles } from "../utils/zeroQuantityHighlight";
import { hasElementMissingQuantity } from '../utils/quantityUtils';
import MainCostEbkpGroupRow from "./CostUploader/MainCostEbkpGroupRow";

export interface EbkpStat {
  code: string;
  quantity: number;
  unit?: string;
  availableQuantities?: Array<{
    value: number;
    type: string;
    unit: string;
    label: string;
  }>;
  selectedQuantityType?: string;
  elements?: MongoElement[];
}

interface Props {
  stats: EbkpStat[];
  kennwerte: Record<string, number>;
  onKennwertChange: (code: string, value: number) => void;
  onQuantityTypeChange?: (code: string, quantityType: string) => void;
  totalCost?: number;
  elements?: MongoElement[];
}

type GroupingStrategy = 'ebkp' | 'ifc_class' | 'type_name' | 'level' | 'material' | 'structural';
type SortField = 'group' | 'quantity' | 'cost' | 'kennwert' | 'element_count';
type SortDirection = 'asc' | 'desc';

interface GroupedData {
  groupKey: string;
  displayName: string;
  elements: MongoElement[];
  totalQuantity: number;
  availableQuantities: Array<{
    value: number;
    type: string;
    unit: string;
    label: string;
  }>;
  selectedQuantityType?: string;
}

const EbkpCostForm: React.FC<Props> = ({
  stats,
  kennwerte,
  onKennwertChange,
  onQuantityTypeChange,
  elements = []
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>('group');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showFilters, setShowFilters] = useState(false);
  const [groupingStrategy, setGroupingStrategy] = useState<GroupingStrategy>('ebkp');
  const [quantityTypeFilter, setQuantityTypeFilter] = useState<string[]>([]);
  const [hasKennwertFilter, setHasKennwertFilter] = useState<'all' | 'with' | 'without'>('all');

  // Hierarchical table state
  const [expandedMainGroups, setExpandedMainGroups] = useState<string[]>([]);
  const [expandedEbkp, setExpandedEbkp] = useState<string[]>([]);

  // Use hierarchical groups hook for EBKP grouping
  const { ebkpGroups, hierarchicalGroups } = useEbkpGroups(stats, kennwerte);



  // Expand/collapse functionality
  const toggleMainGroup = (mainGroup: string) => {
    setExpandedMainGroups(prev =>
      prev.includes(mainGroup)
        ? prev.filter(g => g !== mainGroup)
        : [...prev, mainGroup]
    );
  };

  const toggleEbkpGroup = (code: string) => {
    setExpandedEbkp(prev =>
      prev.includes(code)
        ? prev.filter(c => c !== code)
        : [...prev, code]
    );
  };

  // Determine if all groups are expanded
  const areAllGroupsExpanded = useMemo(() => {
    if (hierarchicalGroups) {
      // Check if all main groups are expanded
      const allMainGroupsExpanded = hierarchicalGroups.every(group =>
        expandedMainGroups.includes(group.mainGroup)
      );

      // Check if all sub-groups are expanded
      const allSubGroupsCodes = hierarchicalGroups.flatMap(group =>
        group.subGroups.map(subGroup => subGroup.code)
      );
      const allSubGroupsExpanded = allSubGroupsCodes.every(code =>
        expandedEbkp.includes(code)
      );

      return allMainGroupsExpanded && allSubGroupsExpanded;
    } else {
      // For flat view, check if all EBKP groups are expanded
      return ebkpGroups.every(group => expandedEbkp.includes(group.code));
    }
  }, [hierarchicalGroups, ebkpGroups, expandedMainGroups, expandedEbkp]);

  const toggleExpandAll = () => {
    if (areAllGroupsExpanded) {
      // Collapse all
      setExpandedMainGroups([]);
      setExpandedEbkp([]);
    } else {
      // Expand all
      if (hierarchicalGroups) {
        const allMainGroups = hierarchicalGroups.map(group => group.mainGroup);
        const allSubGroupsCodes = hierarchicalGroups.flatMap(group =>
          group.subGroups.map(subGroup => subGroup.code)
        );
        setExpandedMainGroups(allMainGroups);
        setExpandedEbkp(allSubGroupsCodes);
      } else {
        // For flat view, expand all EBKP groups
        const allCodes = ebkpGroups.map(group => group.code);
        setExpandedEbkp(allCodes);
      }
    }
  };

  // Helper function to check if a group has missing quantities
  const hasGroupMissingQuantities = (group: GroupedData): boolean => {
    const selectedQuantityType = group.selectedQuantityType || group.availableQuantities[0]?.type;

    return group.elements.some(element => {
      return hasElementMissingQuantity(element, selectedQuantityType);
    });
  };

  const groupedData = useMemo((): GroupedData[] => {
    if (groupingStrategy === 'ebkp') {
      const result = stats.map(stat => ({
        groupKey: stat.code,
        displayName: stat.code,
        elements: stat.elements || [],
        totalQuantity: stat.quantity,
        availableQuantities: stat.availableQuantities || [],
        selectedQuantityType: stat.selectedQuantityType
      }));
      return result;
    }

    const groups = new Map<string, MongoElement[]>();

    elements.forEach((element) => {
      let groupKey = '';

      switch (groupingStrategy) {
        case 'ifc_class':
          groupKey = element.ifc_class || 'Unknown';
          break;
        case 'type_name':
          groupKey = element.type_name || 'Unknown';
          break;
        case 'level':
          groupKey = element.level || 'Unknown';
          break;
        case 'material':
          groupKey = element.materials?.[0]?.name || 'Unknown';
          break;
        case 'structural':
          groupKey = element.is_structural ? 'Structural' : 'Non-Structural';
          break;
        default:
          groupKey = 'Unknown';
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(element);
    });

    const result = Array.from(groups.entries()).map(([groupKey, groupElements]) => {
      const availableQuantities = new Map<string, { value: number; unit: string; label: string }>();

      groupElements.forEach((element) => {
        if (element.available_quantities && element.available_quantities.length > 0) {
          element.available_quantities.forEach(qty => {
            const existing = availableQuantities.get(qty.type);
            if (existing) {
              existing.value += qty.value;
            } else {
              availableQuantities.set(qty.type, {
                value: qty.value,
                unit: qty.unit,
                label: qty.label
              });
            }
          });
        } else {
          const elementAny = element as MongoElement & { area?: number; length?: number; volume?: number };
          if (elementAny.area && elementAny.area > 0) {
            const existing = availableQuantities.get('area');
            if (existing) {
              existing.value += elementAny.area;
            } else {
              availableQuantities.set('area', {
                value: elementAny.area,
                unit: 'm²',
                label: 'Area'
              });
            }
          }


          if (elementAny.length && elementAny.length > 0) {
            const existing = availableQuantities.get('length');
            if (existing) {
              existing.value += elementAny.length;
            } else {
              availableQuantities.set('length', {
                value: elementAny.length,
                unit: 'm',
                label: 'Length'
              });
            }
          }


          if (elementAny.volume && elementAny.volume > 0) {
            const existing = availableQuantities.get('volume');
            if (existing) {
              existing.value += elementAny.volume;
            } else {
              availableQuantities.set('volume', {
                value: elementAny.volume,
                unit: 'm³',
                label: 'Volume'
              });
            }
          }
        }
      });

      if (!availableQuantities.has('count')) {
        availableQuantities.set('count', {
          value: groupElements.length,
          unit: 'Stk',
          label: 'Count'
        });
      }

      const finalQuantities = Array.from(availableQuantities.entries()).map(([type, data]) => ({
        value: data.value,
        type,
        unit: data.unit,
        label: data.label
      }));

      const groupData = {
        groupKey,
        displayName: groupKey,
        elements: groupElements,
        totalQuantity: Array.from(availableQuantities.values())[0]?.value || 0,
        availableQuantities: finalQuantities
      };



      return groupData;
    });

    return result;
  }, [stats, elements, groupingStrategy]);

  const handleChange = (groupKey: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    onKennwertChange(groupKey, isNaN(value) ? 0 : value);
  };

  const handleQuantityTypeChange = (groupKey: string) => (e: SelectChangeEvent<string>) => {
    if (onQuantityTypeChange) {
      onQuantityTypeChange(groupKey, e.target.value);
    }
  };

  const uniqueQuantityTypes = useMemo(() => {
    const types = new Set<string>();
    groupedData.forEach(group => {
      group.availableQuantities.forEach(qty => types.add(qty.type));
    });
    return Array.from(types);
  }, [groupedData]);

  const filteredAndSortedData = useMemo(() => {
    const filtered = groupedData.filter(group => {
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesGroup = group.displayName.toLowerCase().includes(searchLower) ||
          group.groupKey.toLowerCase().includes(searchLower);
        const matchesQuantityType = group.availableQuantities.some(qty =>
          qty.type.toLowerCase().includes(searchLower) ||
          qty.label.toLowerCase().includes(searchLower)
        );

        if (!matchesGroup && !matchesQuantityType) {
          return false;
        }
      }

      if (quantityTypeFilter.length > 0) {
        const hasFilteredType = group.availableQuantities.some(qty =>
          quantityTypeFilter.includes(qty.type)
        );

        if (!hasFilteredType) {
          return false;
        }
      }

      if (hasKennwertFilter !== 'all') {
        const hasKennwert = kennwerte[group.groupKey] && kennwerte[group.groupKey] > 0;

        if (hasKennwertFilter === 'with' && !hasKennwert) {
          return false;
        }
        if (hasKennwertFilter === 'without' && hasKennwert) {
          return false;
        }
      }

      return true;
    });

    // Sort - prioritize groups with missing quantities at the top
    filtered.sort((a, b) => {
      // First priority: groups with missing quantities should come first
      const aMissingQuantities = hasGroupMissingQuantities(a);
      const bMissingQuantities = hasGroupMissingQuantities(b);

      if (aMissingQuantities && !bMissingQuantities) return -1; // a comes first
      if (!aMissingQuantities && bMissingQuantities) return 1;  // b comes first

      // If both have same missing quantity status, sort by the selected field
      let aValue: string | number, bValue: string | number;

      switch (sortField) {
        case 'group':
          aValue = a.displayName;
          bValue = b.displayName;
          break;
        case 'quantity':
          aValue = a.totalQuantity || 0;
          bValue = b.totalQuantity || 0;
          break;
        case 'cost':
          aValue = (kennwerte[a.groupKey] || 0) * a.totalQuantity;
          bValue = (kennwerte[b.groupKey] || 0) * b.totalQuantity;
          break;
        case 'kennwert':
          aValue = kennwerte[a.groupKey] || 0;
          bValue = kennwerte[b.groupKey] || 0;
          break;
        case 'element_count':
          aValue = a.elements.length;
          bValue = b.elements.length;
          break;
        default:
          return 0;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // Convert to numbers for arithmetic operations
      const numA = typeof aValue === 'number' ? aValue : 0;
      const numB = typeof bValue === 'number' ? bValue : 0;

      if (sortDirection === 'asc') {
        return numA - numB;
      } else {
        return numB - numA;
      }
    });

    return filtered;
  }, [groupedData, searchTerm, sortField, sortDirection, quantityTypeFilter, hasKennwertFilter, kennwerte, hasGroupMissingQuantities]);

  const handleQuantityTypeFilterChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    setQuantityTypeFilter(typeof value === 'string' ? value.split(',') : value);
  };

  const clearAllFilters = () => {
    setSearchTerm("");
    setQuantityTypeFilter([]);
    setHasKennwertFilter('all');
  };

  const activeFiltersCount = [
    searchTerm ? 1 : 0,
    quantityTypeFilter.length,
    hasKennwertFilter !== 'all' ? 1 : 0
  ].reduce((a, b) => a + b, 0);

  const getSelectedQuantity = (group: GroupedData) => {
    const selectedType = group.selectedQuantityType || group.availableQuantities[0]?.type;
    return group.availableQuantities.find(q => q.type === selectedType) || group.availableQuantities[0];
  };



  return (
    <Box sx={{ mt: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" color="primary">
          Kennwerte nach {
            groupingStrategy === 'ebkp' ? 'eBKP' :
              groupingStrategy === 'ifc_class' ? 'IFC-Klasse' :
                groupingStrategy === 'type_name' ? 'Typ-Name' :
                  groupingStrategy === 'level' ? 'Ebene' :
                    groupingStrategy === 'material' ? 'Material' :
                      groupingStrategy === 'structural' ? 'Tragwerk' : 'Gruppe'
          }
        </Typography>
      </Box>

      {/* Search and Filter Toolbar */}
      <Paper elevation={1} sx={{ p: 2, mb: 2, backgroundColor: 'grey.50' }}>
        {/* First Row: Grouping */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Gruppierung</InputLabel>
            <Select
              value={groupingStrategy}
              onChange={(e) => setGroupingStrategy(e.target.value as GroupingStrategy)}
              startAdornment={<GroupWorkIcon sx={{ mr: 1, color: 'action.active' }} />}
            >
              <MenuItem value="ebkp">eBKP-Code</MenuItem>
              <MenuItem value="ifc_class">IFC-Klasse</MenuItem>
              <MenuItem value="type_name">Typ-Name</MenuItem>
              <MenuItem value="level">Ebene</MenuItem>
              <MenuItem value="material">Material</MenuItem>
              <MenuItem value="structural">Tragwerk</MenuItem>
            </Select>
          </FormControl>

          <Typography variant="body2" color="text.secondary">
            {filteredAndSortedData.length} Gruppen
          </Typography>
        </Box>

        {/* Second Row: Search and Controls - Fix overlap with proper spacing */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 2, alignItems: 'center' }}>
          {/* Search */}
          <TextField
            placeholder="Suche nach Gruppe oder Mengenart..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            fullWidth
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
              endAdornment: searchTerm && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearchTerm("")}>
                    <ClearIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          {/* Sort */}
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Sortierung</InputLabel>
            <Select
              value={`${sortField}-${sortDirection}`}
              onChange={(e) => {
                const [field, direction] = e.target.value.split('-') as [SortField, SortDirection];
                setSortField(field);
                setSortDirection(direction);
              }}
              startAdornment={<SortIcon sx={{ mr: 1, color: 'action.active' }} />}
            >
              <MenuItem value="group-asc">Gruppe ↑</MenuItem>
              <MenuItem value="group-desc">Gruppe ↓</MenuItem>
              <MenuItem value="element_count-desc">Anzahl ↓</MenuItem>
              <MenuItem value="element_count-asc">Anzahl ↑</MenuItem>
              <MenuItem value="quantity-desc">Menge ↓</MenuItem>
              <MenuItem value="quantity-asc">Menge ↑</MenuItem>
              <MenuItem value="cost-desc">Kosten ↓</MenuItem>
              <MenuItem value="cost-asc">Kosten ↑</MenuItem>
              <MenuItem value="kennwert-desc">Kennwert ↓</MenuItem>
              <MenuItem value="kennwert-asc">Kennwert ↑</MenuItem>
            </Select>
          </FormControl>

          {/* Filter Toggle */}
          <Button
            variant={showFilters ? "contained" : "outlined"}
            size="small"
            startIcon={<FilterListIcon />}
            onClick={() => setShowFilters(!showFilters)}
            sx={{ minWidth: 140, whiteSpace: 'nowrap' }}
          >
            Filter {activeFiltersCount > 0 && `(${activeFiltersCount})`}
            {showFilters ? <ExpandLessIcon sx={{ ml: 1 }} /> : <ExpandMoreIcon sx={{ ml: 1 }} />}
          </Button>
        </Box>

        {/* Collapsible Filters */}
        <Collapse in={showFilters}>
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, alignItems: 'start' }}>
            {/* Quantity Type Filter */}
            <FormControl size="small">
              <InputLabel>Mengenarten</InputLabel>
              <Select
                multiple
                value={quantityTypeFilter}
                onChange={handleQuantityTypeFilterChange}
                input={<OutlinedInput label="Mengenarten" />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((value) => (
                      <Chip key={value} label={value} size="small" />
                    ))}
                  </Box>
                )}
                MenuProps={{
                  PaperProps: {
                    style: { maxHeight: 300 }
                  }
                }}
              >
                {uniqueQuantityTypes.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type === 'area' ? 'Fläche' :
                      type === 'length' ? 'Länge' :
                        type === 'volume' ? 'Volumen' :
                          type === 'count' ? 'Stück' : type}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Kennwert Filter */}
            <FormControl size="small">
              <InputLabel>Kennwerte</InputLabel>
              <Select
                value={hasKennwertFilter}
                onChange={(e) => setHasKennwertFilter(e.target.value as 'all' | 'with' | 'without')}
              >
                <MenuItem value="all">Alle</MenuItem>
                <MenuItem value="with">Mit Kennwert</MenuItem>
                <MenuItem value="without">Ohne Kennwert</MenuItem>
              </Select>
            </FormControl>

            {/* Clear Filters */}
            {activeFiltersCount > 0 && (
              <Button
                variant="text"
                size="small"
                onClick={clearAllFilters}
                startIcon={<ClearIcon />}
                color="secondary"
                sx={{ justifySelf: 'start' }}
              >
                Filter zurücksetzen
              </Button>
            )}
          </Box>
        </Collapse>
      </Paper>

      {/* Results Summary */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {filteredAndSortedData.length} von {groupedData.length} Gruppen
          {searchTerm && ` (gefiltert nach "${searchTerm}")`}
        </Typography>
        {filteredAndSortedData.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Sortiert nach {
                sortField === 'group' ? 'Gruppe' :
                  sortField === 'quantity' ? 'Menge' :
                    sortField === 'cost' ? 'Gesamtkosten' :
                      sortField === 'kennwert' ? 'Kennwert' :
                        sortField === 'element_count' ? 'Anzahl' : sortField
              } {sortDirection === 'asc' ? '↑' : '↓'}
            </Typography>
            {(() => {
              const groupsWithMissingQuantities = filteredAndSortedData.filter(group => hasGroupMissingQuantities(group)).length;
              return groupsWithMissingQuantities > 0 ? (
                <Chip
                  label={`${groupsWithMissingQuantities} mit fehlenden Mengen`}
                  size="small"
                  color="warning"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
              ) : null;
            })()}
          </Box>
        )}
      </Box>

      {/* Render based on grouping strategy */}
      {groupingStrategy === 'ebkp' && hierarchicalGroups ? (
        /* Hierarchical EBKP Table */
        <TableContainer component={Paper} elevation={2}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: "rgba(0, 0, 0, 0.04)" }}>
                <TableCell sx={{ py: 2, fontWeight: 'bold' }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Tooltip title={areAllGroupsExpanded ? "Alle zuklappen" : "Alle aufklappen"}>
                      <IconButton
                        size="small"
                        onClick={toggleExpandAll}
                        sx={{
                          color: "primary.main",
                          backgroundColor: areAllGroupsExpanded ? "rgba(25, 118, 210, 0.08)" : "transparent",
                          "&:hover": {
                            backgroundColor: "rgba(25, 118, 210, 0.12)",
                          },
                          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                          transform: areAllGroupsExpanded ? "rotate(90deg)" : "rotate(0deg)",
                        }}
                      >
                        <ChevronRightIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    EBKP Gruppe / Bezeichnung
                  </Box>
                </TableCell>
                <TableCell sx={{ py: 2, fontWeight: 'bold', textAlign: 'right' }}>
                  Menge
                </TableCell>
                <TableCell sx={{ py: 2, fontWeight: 'bold', textAlign: 'right' }}>
                  Kennwert (CHF)
                </TableCell>
                <TableCell sx={{ py: 2, fontWeight: 'bold', textAlign: 'right' }}>
                  Gesamtkosten
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {hierarchicalGroups.map((group) => (
                <MainCostEbkpGroupRow
                  key={group.mainGroup}
                  group={group}
                  isExpanded={expandedMainGroups.includes(group.mainGroup)}
                  toggleExpand={toggleMainGroup}
                  expandedEbkp={expandedEbkp}
                  toggleExpandEbkp={toggleEbkpGroup}
                  kennwerte={kennwerte}
                  onKennwertChange={onKennwertChange}
                  onQuantityTypeChange={onQuantityTypeChange}
                />
              ))}
              {hierarchicalGroups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      Keine EBKP-Gruppen verfügbar
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Es wurden keine Elemente mit EBKP-Klassifikation gefunden.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        /* Cards Grid - For non-EBKP grouping strategies */
        <Box sx={{ display: 'grid', gap: 2 }}>
          {filteredAndSortedData.length === 0 ? (
            <Paper elevation={1} sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Keine Ergebnisse gefunden
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {searchTerm ? `Keine Gruppen entsprechen "${searchTerm}"` : 'Keine Gruppen entsprechen den aktuellen Filtern'}
              </Typography>
              {activeFiltersCount > 0 && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={clearAllFilters}
                  sx={{ mt: 2 }}
                  startIcon={<ClearIcon />}
                >
                  Filter zurücksetzen
                </Button>
              )}
            </Paper>
          ) : (
            filteredAndSortedData.map((group) => {
              const selectedQuantity = getSelectedQuantity(group);
              const hasZeroQuantity = hasGroupMissingQuantities(group);

              return (
                <Tooltip
                  key={group.groupKey}
                  title={hasZeroQuantity ? `Enthält Elemente ohne ${selectedQuantity.label || selectedQuantity.type} - Gruppe ${group.displayName}` : ''}
                  arrow
                  placement="left"
                >
                  <Paper
                    elevation={2}
                    sx={getZeroQuantityStyles(hasZeroQuantity, {
                      p: 3,
                      transition: 'all 0.3s ease-in-out',
                      '&:hover': {
                        elevation: 4,
                        transform: 'translateY(-2px)',
                        boxShadow: '0 8px 25px rgba(0,0,0,0.15)'
                      },
                      background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
                      border: '1px solid',
                      borderColor: 'divider'
                    })}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                      {/* Group Code Badge */}
                      <Box sx={{ minWidth: 80 }}>
                        <Chip
                          label={group.displayName}
                          color="primary"
                          variant="filled"
                          sx={{
                            fontWeight: 'bold',
                            fontSize: '0.875rem',
                            height: 32,
                            '& .MuiChip-label': { px: 2 }
                          }}
                        />
                        {group.elements.length > 0 && (
                          <Box sx={{ mt: 0.5 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {group.elements.length} Element{group.elements.length !== 1 ? 'e' : ''}
                            </Typography>
                            {hasZeroQuantity && (
                              <Typography variant="caption" sx={{
                                color: 'warning.main',
                                fontWeight: 'bold',
                                fontSize: '0.65rem',
                                display: 'block'
                              }}>
                                {(() => {
                                  const selectedQuantityType = group.selectedQuantityType || group.availableQuantities[0]?.type;
                                  const elementsWithMissingQuantities = group.elements.filter(element => {
                                    return hasElementMissingQuantity(element, selectedQuantityType);
                                  }).length;
                                  return `${elementsWithMissingQuantities} ohne Mengen`;
                                })()}
                              </Typography>
                            )}
                          </Box>
                        )}
                      </Box>

                      {/* Quantity Selection */}
                      <Box sx={{ flex: 1, minWidth: 300 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 'medium' }}>
                          Mengenauswahl
                        </Typography>
                        {group.availableQuantities && group.availableQuantities.length > 1 ? (
                          <FormControl fullWidth size="small">
                            <Select
                              value={group.selectedQuantityType || group.availableQuantities[0]?.type || ""}
                              onChange={handleQuantityTypeChange(group.groupKey)}
                              displayEmpty
                              sx={{
                                '& .MuiSelect-select': {
                                  py: 1.5,
                                  fontSize: '0.875rem',
                                  display: 'flex',
                                  alignItems: 'center'
                                },
                                '& .MuiOutlinedInput-root': {
                                  transition: 'all 0.2s ease-in-out',
                                  backgroundColor: 'background.paper',
                                  '&:hover': {
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                    backgroundColor: 'grey.50'
                                  },
                                  '&.Mui-focused': {
                                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.15)',
                                    backgroundColor: 'background.paper'
                                  }
                                }
                              }}
                              renderValue={(value) => {
                                const selected = group.availableQuantities?.find(q => q.type === value);
                                if (!selected) return '';
                                return (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                                    <Box sx={{ flex: 1 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                        {selected.label}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {selected.type === 'area' ? 'Flächenberechnung' :
                                          selected.type === 'length' ? 'Längenberechnung' :
                                            selected.type === 'volume' ? 'Volumenberechnung' :
                                              selected.type === 'count' ? 'Stückzahl' : 'Andere'}
                                      </Typography>
                                    </Box>
                                    <Chip
                                      label={`${selected.value.toLocaleString("de-CH")} ${selected.unit}`}
                                      size="small"
                                      color={hasZeroQuantity ? "warning" : "primary"}
                                      variant="filled"
                                      sx={{
                                        fontWeight: 'bold',
                                        fontSize: '0.75rem',
                                        color: hasZeroQuantity ? 'warning.contrastText' : 'primary.contrastText'
                                      }}
                                    />
                                  </Box>
                                );
                              }}
                            >
                              {group.availableQuantities.map((qty) => (
                                <MenuItem
                                  key={qty.type}
                                  value={qty.type}
                                  sx={{
                                    py: 2,
                                    '&:hover': {
                                      backgroundColor: 'primary.light',
                                      '& .MuiChip-root': {
                                        backgroundColor: 'primary.main',
                                        color: 'white'
                                      }
                                    }
                                  }}
                                >
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                    <Box>
                                      <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                        {qty.label}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {qty.type === 'area' ? 'Flächenberechnung' :
                                          qty.type === 'length' ? 'Längenberechnung' :
                                            qty.type === 'volume' ? 'Volumenberechnung' :
                                              qty.type === 'count' ? 'Stückzahl' : 'Andere'}
                                      </Typography>
                                    </Box>
                                    <Chip
                                      label={`${qty.value.toLocaleString("de-CH")} ${qty.unit}`}
                                      size="small"
                                      variant="outlined"
                                      color={qty.type === (group.selectedQuantityType || group.availableQuantities?.[0]?.type) ? 'primary' : 'default'}
                                      sx={{ ml: 1, fontSize: '0.75rem', fontWeight: 'bold' }}
                                    />
                                  </Box>
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        ) : group.availableQuantities && group.availableQuantities.length === 1 ? (
                          <Box sx={{
                            p: 1.5,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            backgroundColor: 'grey.50',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}>
                            <Box>
                              <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                {group.availableQuantities[0].label}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Einzige verfügbare Option
                              </Typography>
                            </Box>
                            <Chip
                              label={`${group.availableQuantities[0].value.toLocaleString("de-CH")} ${group.availableQuantities[0].unit}`}
                              size="small"
                              color={hasZeroQuantity ? "warning" : "primary"}
                              variant="filled"
                              sx={{
                                fontWeight: 'bold',
                                color: hasZeroQuantity ? 'warning.contrastText' : 'primary.contrastText'
                              }}
                            />
                          </Box>
                        ) : (
                          <Box sx={{
                            p: 1.5,
                            border: '1px solid',
                            borderColor: 'warning.main',
                            borderRadius: 1,
                            backgroundColor: 'warning.light',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <Chip label="Keine Mengen verfügbar" size="small" color="warning" />
                          </Box>
                        )}
                      </Box>

                      {/* Cost Input and Calculation */}
                      <Box sx={{ minWidth: 200 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 'medium' }}>
                          Kennwert (CHF)
                        </Typography>
                        <TextField
                          type="number"
                          variant="outlined"
                          size="small"
                          value={kennwerte[group.groupKey] ?? ""}
                          onChange={handleChange(group.groupKey)}
                          inputProps={{ step: "0.01", min: 0 }}
                          fullWidth
                          placeholder="0.00"
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              transition: 'all 0.2s ease-in-out',
                              '&:hover': {
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                              },
                              '&.Mui-focused': {
                                boxShadow: '0 4px 12px rgba(25, 118, 210, 0.15)'
                              }
                            }
                          }}
                        />
                      </Box>

                      {/* Total Cost Display */}
                      <Box sx={{ minWidth: 150, textAlign: 'right' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 'medium' }}>
                          Gesamtkosten
                        </Typography>
                        <Box sx={{
                          p: 1.5,
                          borderRadius: 1,
                          backgroundColor: kennwerte[group.groupKey] ? 'success.light' : 'grey.100',
                          border: '1px solid',
                          borderColor: kennwerte[group.groupKey] ? 'success.main' : 'grey.300',
                          minHeight: 40,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <Typography
                            variant="h6"
                            sx={{
                              fontWeight: 'bold',
                              color: kennwerte[group.groupKey] ? 'success.dark' : 'text.secondary',
                              fontSize: '1rem'
                            }}
                          >
                            {kennwerte[group.groupKey] && selectedQuantity
                              ? `CHF ${(kennwerte[group.groupKey] * selectedQuantity.value).toLocaleString("de-CH", {
                                maximumFractionDigits: 2,
                              })}`
                              : "CHF -"}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  </Paper>
                </Tooltip>
              );
            })
          )}
        </Box>
      )}

    </Box>
  );
};

export default EbkpCostForm;
