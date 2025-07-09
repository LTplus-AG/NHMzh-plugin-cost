const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8001";

export async function getProjects() {
  const response = await fetch(`${API_BASE_URL}/api/projects`);
  if (!response.ok) throw new Error("Failed to fetch projects");
  return response.json();
}

export async function getCostElements(projectId: string) {
  const response = await fetch(`${API_BASE_URL}/api/cost-elements/${projectId}`);
  if (!response.ok) throw new Error("Failed to fetch cost elements");
  return response.json();
}

export async function confirmCosts(payload: any) {
  const response = await fetch(`${API_BASE_URL}/api/confirm-costs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to confirm costs");
  return response.json();
} 