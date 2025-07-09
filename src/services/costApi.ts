// Define proper interfaces for API payloads and responses
export interface CostConfirmationPayload {
  project: string;
  data: Array<{
    id: string;
    cost: number;
    ebkp_code: string;
    [key: string]: string | number | boolean | null; // More specific than any
  }>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface EbkpCodeInfo {
  code: string;
  type: string;
}

export interface BackendElement {
  id: string;
  name: string;
  ebkp?: string;
  quantity?: number;
  unit?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface Project {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface CostUpdateNotification {
  project: string;
  timestamp: string;
  elements: Array<{
    id: string;
    cost: number;
    ebkp_code: string;
  }>;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8001";

async function getProjects(): Promise<Project[]> {
  const response = await fetch(`${API_BASE_URL}/projects`);
  if (!response.ok) throw new Error("Failed to fetch projects");
  return response.json();
}

async function getProjectElements(projectName: string): Promise<BackendElement[]> {
  const response = await fetch(`${API_BASE_URL}/project-elements/${encodeURIComponent(projectName)}`);
  if (!response.ok) throw new Error("Failed to fetch project elements");
  const data = await response.json();
  return data.elements || [];
}

async function getAvailableEbkpCodes(): Promise<EbkpCodeInfo[]> {
  const response = await fetch(`${API_BASE_URL}/available-ebkp-codes`);
  if (!response.ok) throw new Error("Failed to fetch EBKP codes");
  const data = await response.json();
  if (Array.isArray(data.codes)) {
    return data.codes.map((code: string) => ({
      code,
      type: code.split(".")[0],
    }));
  }
  return [];
}

async function getKennwerte(projectName: string): Promise<Record<string, number>> {
  const response = await fetch(`${API_BASE_URL}/get-kennwerte/${encodeURIComponent(projectName)}`);
  if (!response.ok) throw new Error("Failed to fetch kennwerte");
  const data = await response.json();
  return data.kennwerte || {};
}

async function saveKennwerte(projectName: string, kennwerte: Record<string, number>): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/save-kennwerte`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project: projectName,
      kennwerte,
      timestamp: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error("Failed to save kennwerte");
  return response.json();
}

async function reapplyCosts(projectName: string): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/reapply-costs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectName }),
  });
  if (!response.ok) throw new Error("Failed to re-apply costs");
  return response.json();
}

async function confirmCosts(payload: CostConfirmationPayload): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/confirm-costs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to confirm costs");
  return response.json();
}

async function sendCostUpdate(notification: CostUpdateNotification): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/send-cost-update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(notification),
  });
  if (!response.ok) throw new Error("Failed to send cost update");
  return response.json();
}

// Export as a single object
export const costApi = {
  getProjects,
  getProjectElements,
  getAvailableEbkpCodes,
  getKennwerte,
  saveKennwerte,
  reapplyCosts,
  confirmCosts,
  sendCostUpdate,
}; 