// Types used in the CostUploader component

export interface MetaFile {
  file: File;
  data: CostItem[] | { data: CostItem[] };
}

export interface CostItem {
  // Standard Excel fields
  ebkp?: string;
  bezeichnung?: string;
  kennwert?: number;
  factor?: number;
  menge?: number;
  einheit?: string;
  totalChf?: number;
  chf?: number; // Add this for direct CHF value
  kommentar?: string;

  // Fields for hierarchical display
  id: string; // Unique ID for the row (e.g., EBKP code)
  level: string | number; // Hierarchical level (e.g., C, C2, C2.1)
  category?: string; // Category name (like Bezeichnung)
  children?: CostItem[];

  // Fields added after BIM mapping/Kafka integration
  area?: number; // Area from BIM
  areaSource?: string; // Source of the area data (e.g., BIM, Manual)
  element_count?: number; // Number of elements with this code
  fromKafka?: boolean; // Flag indicating data came from Kafka
  kafkaSource?: string; // Source system for Kafka data (e.g., BIM)
  kafkaTimestamp?: string; // Timestamp of Kafka message
  is_structural?: boolean; // Add this property
  fire_rating?: string; // Add this property

  // Fields to retain original data from Excel after merging
  originalItem?: Partial<CostItem>;
}

// Define a more specific type for the enhanced data passed to onConfirm
// Based on the structure created in handleConfirm
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
  factor: number;
  bezeichnung: string;
  originalItem?: Partial<CostItem>; // Make originalItem optional and partial
}

// Represents the structure of the parsed Excel file
export interface ParsedExcelData {
  fileName: string;
  data: CostItem[];
  summary: {
    totalCost: number;
    categories: Record<string, number>;
  };
}
