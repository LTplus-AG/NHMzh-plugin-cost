export interface MongoElement {
  _id: string;
  project_id: string;
  ifc_id?: string;
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
  quantity_value?: number;
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

// Add other shared types here in the future
