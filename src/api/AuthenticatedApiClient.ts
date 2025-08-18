import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

// Store the auth token getter function
let getAuthToken: (() => Promise<string | null>) | null = null;

/**
 * Set the auth token getter function
 * This should be called once when the app initializes with authentication
 */
export const setAuthTokenGetter = (getter: () => Promise<string | null>) => {
  getAuthToken = getter;
};

/**
 * Create authenticated axios instance
 */
const createAuthenticatedAxios = (): AxiosInstance => {
  const instance = axios.create({
    baseURL: process.env.NODE_ENV === 'production' 
      ? '/api' 
      : 'http://localhost:3004',
    timeout: 30000,
  });

  // Request interceptor to add auth token
  instance.interceptors.request.use(
    async (config) => {
      // Get the auth token
      const token = getAuthToken ? await getAuthToken() : null;
      
      if (token) {
        config.headers = config.headers || {};
        config.headers['Authorization'] = `Bearer ${token}`;
      }
      
      // Log the request for debugging
      console.debug(`Making authenticated request to: ${config.url}`);
      
      return config;
    },
    (error) => {
      console.error('Request interceptor error:', error);
      return Promise.reject(error);
    }
  );

  // Response interceptor to handle auth errors
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      return response;
    },
    (error) => {
      if (error.response?.status === 401) {
        console.warn('Received 401 Unauthorized response');
        // The auth provider should handle token refresh or re-login
      } else if (error.response?.status === 403) {
        console.warn('Received 403 Forbidden response - insufficient permissions');
      }
      return Promise.reject(error);
    }
  );

  return instance;
};

/**
 * Authenticated Cost API Client
 */
export class AuthenticatedCostApiClient {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = createAuthenticatedAxios();
  }

  /**
   * Get list of projects filtered by user permissions
   * @returns List of project names the user has access to
   */
  async getProjects(): Promise<string[]> {
    try {
      const response = await this.axiosInstance.get('/projects');
      console.info(`User has access to ${response.data.length} projects`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.error('Access denied to projects list');
        throw new Error('You don\'t have permission to access projects');
      }
      console.error('Error fetching projects:', error);
      throw error;
    }
  }

  /**
   * Get cost calculations for a specific project
   * @param projectId - The ID of the project
   * @returns Cost calculation data
   */
  async getCostCalculations(projectId: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/projects/${encodeURIComponent(projectId)}/costs`);
      console.info(`Successfully retrieved cost calculations for project: ${projectId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.error(`Access denied to project: ${projectId}`);
        throw new Error(`You don't have permission to access project: ${projectId}`);
      }
      console.error(`Error fetching cost calculations for project '${projectId}':`, error);
      throw error;
    }
  }

  /**
   * Save cost calculations for a project
   * @param projectId - The ID of the project
   * @param calculations - The cost calculation data
   * @returns Response with operation status
   */
  async saveCostCalculations(projectId: string, calculations: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post(
        `/projects/${encodeURIComponent(projectId)}/costs`,
        calculations
      );
      console.info(`Successfully saved cost calculations for project: ${projectId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 403) {
        throw new Error(`You don't have permission to modify cost data for project: ${projectId}`);
      }
      console.error(`Error saving cost calculations for project '${projectId}':`, error);
      throw error;
    }
  }

  /**
   * Get EBKP classifications
   * @returns EBKP classification data
   */
  async getEBKPClassifications(): Promise<any> {
    try {
      const response = await this.axiosInstance.get('/ebkp/classifications');
      return response.data;
    } catch (error: any) {
      console.error('Error fetching EBKP classifications:', error);
      throw error;
    }
  }

  /**
   * Get cost templates
   * @returns Cost template data
   */
  async getCostTemplates(): Promise<any> {
    try {
      const response = await this.axiosInstance.get('/cost-templates');
      return response.data;
    } catch (error: any) {
      console.error('Error fetching cost templates:', error);
      throw error;
    }
  }

  /**
   * Export cost results to Excel
   * @param projectId - The ID of the project
   * @param format - Export format ('xlsx' or 'csv')
   * @returns Blob data for download
   */
  async exportCostResults(projectId: string, format: 'xlsx' | 'csv' = 'xlsx'): Promise<Blob> {
    try {
      const response = await this.axiosInstance.get(
        `/projects/${encodeURIComponent(projectId)}/costs/export`,
        {
          params: { format },
          responseType: 'blob'
        }
      );
      console.info(`Successfully exported cost results for project: ${projectId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 403) {
        throw new Error(`You don't have permission to export cost data for project: ${projectId}`);
      }
      console.error(`Error exporting cost results for project '${projectId}':`, error);
      throw error;
    }
  }

  /**
   * Import cost data from Excel
   * @param projectId - The ID of the project
   * @param file - The Excel file to import
   * @returns Response with import status
   */
  async importCostData(projectId: string, file: File): Promise<any> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await this.axiosInstance.post(
        `/projects/${encodeURIComponent(projectId)}/costs/import`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }
      );
      console.info(`Successfully imported cost data for project: ${projectId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 403) {
        throw new Error(`You don't have permission to import cost data for project: ${projectId}`);
      }
      console.error(`Error importing cost data for project '${projectId}':`, error);
      throw error;
    }
  }

  /**
   * Delete cost calculations for a project
   * @param projectId - The ID of the project
   * @returns Response with operation status
   */
  async deleteCostCalculations(projectId: string): Promise<any> {
    try {
      const response = await this.axiosInstance.delete(
        `/projects/${encodeURIComponent(projectId)}/costs`
      );
      console.info(`Successfully deleted cost calculations for project: ${projectId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 403) {
        throw new Error(`You don't have permission to delete cost data for project: ${projectId}`);
      }
      console.error(`Error deleting cost calculations for project '${projectId}':`, error);
      throw error;
    }
  }

  /**
   * Get project materials and quantities from QTO service
   * @param projectId - The ID of the project
   * @returns Material and quantity data
   */
  async getProjectMaterials(projectId: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/projects/${encodeURIComponent(projectId)}/materials`);
      console.info(`Successfully retrieved materials for project: ${projectId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 403) {
        console.error(`Access denied to project materials: ${projectId}`);
        throw new Error(`You don't have permission to access materials for project: ${projectId}`);
      }
      console.error(`Error fetching materials for project '${projectId}':`, error);
      throw error;
    }
  }

  /**
   * Health check endpoint
   * @returns Health status of the API
   */
  async getHealth(): Promise<any> {
    try {
      const response = await this.axiosInstance.get('/health');
      return response.data;
    } catch (error: any) {
      console.error('Health check failed:', error);
      throw error;
    }
  }
}

// Create and export a default authenticated instance
const authenticatedCostApiClient = new AuthenticatedCostApiClient();
export default authenticatedCostApiClient;
