import { ObjectId } from 'mongodb';

// Element-related interfaces
export interface ElementData {
  _id?: string | ObjectId;
  project_id?: string | ObjectId;
  ebkp_code: string;
  area?: number;
  volume?: number;
  length?: number;
  metadata?: Record<string, any>;
  created_at?: Date;
  updated_at?: Date;
}

export interface QtoElement {
  _id: ObjectId;
  project_id: ObjectId;
  global_id?: string;
  ebkp_code?: string;
  area?: number;
  volume?: number;
  length?: number;
  quantity?: number | { type: string; value: number };
  original_area?: number;
  status?: string;
  properties?: {
    area?: number;
    classification?: {
      id?: string;
      system?: string;
    };
    ebkph?: string;
    project_name?: string;
    [key: string]: any;
  };
  classification?: {
    id?: string;
  };
  ebkph?: string;
  metadata?: Record<string, any>;
  created_at?: Date;
  updated_at?: Date;
}

// Cost-related interfaces
export interface CostResult {
  unitCost: number;
  totalCost: number;
  currency?: string;
  method?: string;
}

export interface CostData {
  _id: ObjectId;
  project_id: ObjectId;
  element_id?: ObjectId;
  global_id?: string;
  ebkp_code: string;
  unit_cost: number;
  quantity: number;
  total_cost: number;
  currency: string;
  calculation_date: Date;
  calculation_method: string;
  metadata: {
    ebkp_code: string;
    source: string;
    [key: string]: any;
  };
  created_at: Date;
  updated_at: Date;
}

export interface CostElement extends QtoElement {
  qto_element_id: ObjectId;
  qto_status: string;
  cost_item_id?: ObjectId;
  unit_cost: number;
  total_cost: number;
  currency: string;
  qto_created_at?: Date;
  qto_updated_at?: Date;
}

export interface CostSummary {
  project_id: ObjectId;
  elements_count: number;
  cost_data_count: number;
  total_from_cost_data: number;
  total_from_elements: number;
  created_at: Date;
  updated_at: Date;
}

// Project-related interfaces
export interface Project {
  _id: ObjectId;
  name: string;
  metadata?: {
    filename?: string;
    upload_timestamp?: string;
    file_id?: string;
    [key: string]: any;
  };
  created_at?: Date;
  updated_at?: Date;
}

// Kennwerte-related interfaces
export interface Kennwerte {
  project: string;
  kennwerte: Record<string, number>;
  timestamp: string;
}

// Excel/Cost import interfaces
export interface EnhancedCostItem {
  ebkp: string;
  bezeichnung?: string;
  menge?: number;
  kennwert?: number;
  chf?: number;
  totalChf?: number;
  children?: EnhancedCostItem[];
}

// Kafka-related interfaces
export interface CostDataKafka {
  id: string;  // CRITICAL: Must be 'id' for Kafka consumers (internal DB uses global_id)
  cost: number;
  cost_unit: number;
}

export interface KafkaMetadata {
  project: string;
  filename: string;
  timestamp: string;
  fileId: string;
}

export interface KafkaMessage {
  project: string;
  filename: string;
  timestamp: string;
  fileId: string;
  data: CostDataKafka[];
}

// API Response interfaces
export interface ProjectResponse {
  id: string;
  name: string;
}

export interface ElementsResponse {
  elements: QtoElement[];
  modelMetadata: {
    filename: string;
    element_count: number;
    upload_timestamp: string;
    project_id: string | null;
  };
}

export interface CostElementsResponse {
  elements: CostElement[];
  summary: {
    count: number;
    uniqueEbkpCodes: number;
    ebkpCodes: string[];
    totalArea: number;
    totalCost: number;
    currency: string;
  };
}

export interface CostElementsByEbkpResponse {
  elements: CostElement[];
  summary: {
    count: number;
    projects: Array<{ id: string; name: string }>;
    ebkpCode: string;
    totalArea: number;
    totalCost: number;
    avgUnitCost: number;
    currency: string;
  };
}

export interface SaveCostDataBatchResult {
  deletedCostElements: number;
  processedBimElements: number;
  skippedBimElements: number;
  processedExcelOnlyItems: number;
  insertedCostElements: number;
  projectId: ObjectId;
  kafkaSent: number;
} 