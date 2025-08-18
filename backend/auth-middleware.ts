/**
 * Authentication middleware for Cost backend service
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import axios from 'axios';
import { config } from './config';
import logger from './logger';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
      token?: string;
    }
  }
}

// User interface
export interface User {
  id: string;
  email: string;
  name: string;
  preferred_username: string;
  roles: string[];
  projects?: UserProject[];
}

export interface UserProject {
  projectId: string;
  projectName: string;
  erzProjectCode: string;
  roles: string[];
}

// Role definitions for Cost plugin
const PLUGIN_ROLES = {
  read: [
    'Admin', 'Projektleitung_Architektur', 'Projektleitung_Statik',
    'Projektleitung_Gebaudetechnik', 'Fachplanung_Kosten',
    'Fachplanung_Oekobilanz', 'Fachplanung_Gebaudetechnik', 'Viewer'
  ],
  write: [
    'Admin', 'Fachplanung_Kosten'
  ],
  delete: ['Admin']
};

// Cache for public keys
const keyCache = new Map<string, string>();

// JWKS client for fetching public keys from Keycloak
let jwksClientInstance: jwksClient.JwksClient | null = null;

const getJwksClient = (): jwksClient.JwksClient => {
  if (!jwksClientInstance) {
    const authority = config.keycloak.authority;
    jwksClientInstance = jwksClient({
      jwksUri: `${authority}/protocol/openid-connect/certs`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes
    });
  }
  return jwksClientInstance;
};

const getSigningKey = async (kid: string): Promise<string> => {
  // Check cache first
  if (keyCache.has(kid)) {
    return keyCache.get(kid)!;
  }

  const client = getJwksClient();
  const key = await client.getSigningKey(kid);
  const signingKey = key.getPublicKey();
  
  // Cache the key
  keyCache.set(kid, signingKey);
  
  return signingKey;
};

const extractUserFromToken = (payload: any): User => {
  const roles: string[] = [];
  
  // Extract realm roles
  if (payload.realm_access?.roles) {
    roles.push(...payload.realm_access.roles);
  }
  
  // Extract resource/client roles
  if (payload.resource_access) {
    Object.values(payload.resource_access).forEach((resource: any) => {
      if (resource.roles) {
        roles.push(...resource.roles);
      }
    });
  }
  
  // Extract groups (if mapped to token)
  if (payload.groups) {
    roles.push(...payload.groups);
  }
  
  return {
    id: payload.sub,
    email: payload.email || '',
    name: payload.name || payload.preferred_username || '',
    preferred_username: payload.preferred_username || '',
    roles,
  };
};

const verifyToken = async (token: string): Promise<User> => {
  // Decode token header to get kid
  const decodedToken = jwt.decode(token, { complete: true });
  
  if (!decodedToken || typeof decodedToken === 'string') {
    throw new Error('Invalid token format');
  }
  
  const kid = decodedToken.header.kid;
  
  if (!kid) {
    throw new Error('Token missing kid in header');
  }
  
  // Get the signing key
  const signingKey = await getSigningKey(kid);
  
  // Verify the token
  const verified = jwt.verify(token, signingKey, {
    algorithms: ['RS256'],
    issuer: config.keycloak.authority,
    audience: config.keycloak.clientId,
  }) as any;
  
  return extractUserFromToken(verified);
};

export const authMiddleware = (options: { optional?: boolean } = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        if (options.optional) {
          return next();
        }
        return res.status(401).json({ error: 'No authorization header provided' });
      }

      const [bearer, token] = authHeader.split(' ');
      
      if (bearer !== 'Bearer' || !token) {
        if (options.optional) {
          return next();
        }
        return res.status(401).json({ error: 'Invalid authorization header format' });
      }

      // Verify the token
      const user = await verifyToken(token);
      
      // Check if user has any valid role for this plugin
      const hasValidRole = user.roles.some(role => PLUGIN_ROLES.read.includes(role));
      if (!hasValidRole) {
        return res.status(403).json({ 
          error: 'User does not have permission to access this plugin',
          requiredRoles: PLUGIN_ROLES.read
        });
      }
      
      // Attach user and token to request
      req.user = user;
      req.token = token;
      
      next();
    } catch (error) {
      logger.error('Authentication error:', error);
      
      if (options.optional) {
        return next();
      }
      
      if (error instanceof Error) {
        if (error.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
          return res.status(401).json({ error: 'Invalid token' });
        }
      }
      
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };
};

// Middleware to require specific permission levels
export const requireReadPermission = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  const hasPermission = req.user.roles.some(role => PLUGIN_ROLES.read.includes(role));
  if (!hasPermission) {
    return res.status(403).json({ 
      error: 'Insufficient permissions for read operation',
      required: PLUGIN_ROLES.read,
      userRoles: req.user.roles 
    });
  }

  next();
};

export const requireWritePermission = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  const hasPermission = req.user.roles.some(role => PLUGIN_ROLES.write.includes(role));
  if (!hasPermission) {
    return res.status(403).json({ 
      error: 'Insufficient permissions for write operation',
      required: PLUGIN_ROLES.write,
      userRoles: req.user.roles 
    });
  }

  next();
};

export const requireDeletePermission = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  const hasPermission = req.user.roles.some(role => PLUGIN_ROLES.delete.includes(role));
  if (!hasPermission) {
    return res.status(403).json({ 
      error: 'Insufficient permissions for delete operation',
      required: PLUGIN_ROLES.delete,
      userRoles: req.user.roles 
    });
  }

  next();
};

// Project service integration
export const checkProjectAccess = async (
  projectId: string,
  action: 'read' | 'write' | 'delete',
  user: User,
  token: string
): Promise<boolean> => {
  // Admin users have access to all projects
  if (user.roles.includes('Admin')) {
    return true;
  }

  try {
    // Fetch user's projects from the project service
    const projectServiceUrl = config.projectService?.url || 'http://localhost:3001';
    const response = await axios.get(`${projectServiceUrl}/api/projects/my-projects`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const projects = response.data.projects || [];

    // Check if user has access to this project
    for (const project of projects) {
      if (project.projectId === projectId || project.erzProjectCode === projectId) {
        const projectRoles = project.roles || [];
        
        if (action === 'read') {
          return projectRoles.some((role: string) => PLUGIN_ROLES.read.includes(role));
        } else if (action === 'write') {
          return projectRoles.some((role: string) => PLUGIN_ROLES.write.includes(role));
        } else if (action === 'delete') {
          return projectRoles.some((role: string) => PLUGIN_ROLES.delete.includes(role));
        }
      }
    }

    return false;
  } catch (error) {
    logger.error('Error checking project access:', error);
    return false;
  }
};

// Middleware to check project-specific access
export const requireProjectAccess = (action: 'read' | 'write' | 'delete' = 'read') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.token) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const projectId = req.params.projectId || req.params.project_name;
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const hasAccess = await checkProjectAccess(projectId, action, req.user, req.token);
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: `You don't have ${action} permission for project: ${projectId}`
      });
    }

    next();
  };
};
