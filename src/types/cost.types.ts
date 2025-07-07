import { MongoElement } from './common.types';

export interface CostEbkpGroup {
  code: string;
  name: string | null;
  elements: MongoElement[];
  totalQuantity: number;
  availableQuantities: Array<{
    value: number;
    type: string;
    unit: string;
    label: string;
  }>;
  selectedQuantityType?: string;
  kennwert?: number;
}

export interface HierarchicalCostEbkpGroup {
  mainGroup: string;
  mainGroupName: string;
  subGroups: CostEbkpGroup[];
  totalElements: number;
  totalQuantity: number;
  totalCost: number;
} 