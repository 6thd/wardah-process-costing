import { Request, Response, NextFunction } from 'express';

export interface ProxyConfig {
  proxyService: {
    port: number;
    allowedOrigins: string[];
    endpoints: {
      financial: string;
      accounting: string;
      reports: string;
    };
    security: {
      rateLimit: {
        windowMs: number;
        max: number;
      };
      cors: {
        credentials: boolean;
        methods: string[];
      };
    };
    cache: {
      enabled: boolean;
      ttl: number;
    };
  };
  wardah: {
    apiEndpoint: string;
    timeoutMs: number;
    retryAttempts: number;
  };
  gemini: {
    dashboardPath: string;
    updateInterval: number;
    features: {
      realTimeUpdates: boolean;
      dataExport: boolean;
      customFilters: boolean;
    };
  };
}

export interface WardahResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    roles: string[];
  };
}

export type ProxyMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => void | Promise<void>;