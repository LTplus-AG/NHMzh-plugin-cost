export interface AvailableQuantity {
  value: number;
  type: string; // 'area', 'length', 'volume', 'count'
  unit: string; // 'm²', 'm', 'm³', 'Stk'
  label: string; // 'Area', 'Length', 'Volume', 'Count'
}

export interface MongoElement {
  _id: string;
  project_id: string;
  global_id?: string;
  ifc_class?: string;
  name?: string;
  type_name?: string;
  element_type?: string;
  level?: string;
  quantity?: {
    value: number;
    type: string;
    unit: string;
  };
  original_quantity?: {
    value: number;
    type: string;
  };
  available_quantities?: AvailableQuantity[]; // All available quantity options
  quantity_value?: number;
  
  // Direct quantity properties - latest BIM-derived quantities
  /** Latest BIM-derived area in square meters */
  area?: number;
  /** Latest BIM-derived volume in cubic meters */
  volume?: number;
  /** Latest BIM-derived length in meters */
  length?: number;
  
  // Original imported values before BIM mapping or overrides
  /** Raw imported area value before any BIM mapping or overrides */
  original_area?: number;
  /** Raw imported volume value before any BIM mapping or overrides */
  original_volume?: number;
  /** Raw imported length value before any BIM mapping or overrides */
  original_length?: number;
  
  is_structural?: boolean;
  is_external?: boolean;
  classification?: {
    id: string;
    name: string;
    system: string;
  };
  materials?: Array<{
    name: string;
    unit?: string;
    volume?: number;
    fraction?: number;
  }>;
  
  /**
   * @deprecated Legacy properties object - may contain stale data.
   * Use direct quantity fields (area, volume, length) instead.
   */
  properties: {
    category?: string;
    level?: string;
    /** @deprecated Use direct area field instead */
    area?: number;
    is_structural?: boolean;
    is_external?: boolean;
    ebkph?: string;
  };
  
  created_at: string;
  updated_at: string;
}
