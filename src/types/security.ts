// src/types/security.ts
// Security module type definitions

export interface JWTPayload {
  exp: number
  iat: number
  sub: string
  tenant_id?: string
  app_metadata?: {
    tenant_id?: string
  }
  user_metadata?: {
    tenant_id?: string
  }
  [key: string]: any
}

export interface SecureUser {
  id: string
  email: string
  tenant_id: string | null
  [key: string]: any
}

export interface SecurityHeaders {
  'X-Tenant-ID': string
  'X-Client-Version': string
  'X-Request-Source': string
}

export interface RateLimitInfo {
  count: number
  resetTime: number
}