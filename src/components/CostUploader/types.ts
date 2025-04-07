export interface CostItem {
  /** Child cost items (for hierarchical structure) */
  children?: CostItem[];
  /** Internal ID for cost items */
  costId?: string;
  /** Key for React rendering */
  key?: string;

  /** eBKP code (primary identifier for cost matching) */
  ebkp?: string;
  /** Alternative eBKP code field */
  ebkph?: string;
  /** Description/name of the item */
  bezeichnung?: string;
  /** Additional notes */
  kommentar?: string;

  /** Quantity value (typically in m² or linear meters) */
  menge?: number;
  /** Unit of measurement (m², m, etc.) */
  einheit?: string;

  /** Type of quantity measurement (area, length, etc.) from MongoDB */
  quantityType?: string;
  /** Unit of quantity (m², m, each, etc.) from MongoDB */
  quantityUnit?: string;

  /** Unit cost (per unit of measurement) */
  kennwert?: number;
  /** Total cost value in CHF */
  chf?: number;
  /** Alternative unit cost field */
  cost_unit?: number;
  /** Total cost in CHF (calculated) */
  totalChf?: number;

  /** BIM data area value from MongoDB */
  area?: number;
  /** Source of the area data ('IFC', 'BIM', etc.) */
  areaSource?: string;
  /** Timestamp when the BIM data was processed */
  kafkaTimestamp?: string;
  /** Number of database elements associated with this item */
  dbElements?: number;
  /** Total area from database elements */
  dbArea?: number;
  /** Number of elements for this item */
  element_count?: number;

  /** Original values before BIM data was applied */
  originalValues?: {
    /** Original quantity value before BIM data was applied */
    menge?: number;
    /** Original cost value before BIM data was applied */
    chf?: number;
    [key: string]: unknown;
  };

  /** Level information (floor, story, etc.) */
  level?: string | number;
  /** Element ID */
  id?: string;

  /** For MongoDB integration - allows additional properties */
  [key: string]: unknown;
}

// Types for Kafka cost message
export interface CostDataItem {
  id: string;
  category: string;
  level: string;
  is_structural: boolean;
  fire_rating: string;
  ebkph: string;
  cost: number;
  cost_unit: number;
  area?: number;
  timestamp?: string;
}

export interface CostMessage {
  project: string;
  filename: string;
  timestamp: string;
  data: CostDataItem[];
}

export interface ExcelRow {
  [key: string]: string | number;
}

export type MetaFile = {
  file: File;
  data:
    | CostItem[]
    | {
        project?: string;
        data: CostItem[];
      };
  headers: string[];
  missingHeaders?: string[];
  valid: boolean | null;
};

export interface CostUploaderProps {
  onFileUploaded?: (
    fileName: string,
    date?: string,
    status?: string,
    costData?: CostItem[],
    isUpdate?: boolean
  ) => void;
}

export const REQUIRED_HEADERS = [
  "eBKP",
  "Bezeichnung",
  "Menge",
  "Einheit",
  "Kennwert",
  "CHF",
  "Total CHF",
  "Kommentar",
];

export type ColumnWidthsType = {
  expandIcon: string;
  ebkp: string;
  bezeichnung: string;
  menge: string;
  einheit: string;
  kennwert: string;
  chf: string;
  totalChf: string;
  kommentar: string;
};

export type ColumnHighlightsType = {
  kennwert: string;
  chf: string;
  totalChf: string;
};
