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
  // Direct quantity properties
  area?: number;
  volume?: number;
  length?: number;
  original_area?: number;
  original_volume?: number;
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
  properties: {
    category?: string;
    level?: string;
    area?: number;
    is_structural?: boolean;
    is_external?: boolean;
    ebkph?: string;
  };
  created_at: string;
  updated_at: string;
}
