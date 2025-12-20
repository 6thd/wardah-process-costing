/**
 * Core Security Tests
 * Tests for JWT parsing and tenant validation - standalone implementations
 */

import { describe, it, expect } from 'vitest';

/**
 * Local implementation of isValidUUID for testing
 * Same logic as src/core/security.ts
 */
const isValidUUID = (uuid: string): boolean => {
  if (!uuid?.length || uuid.length !== 36) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Local implementation of parseJWTPayload for testing
 * Same logic as src/core/security.ts
 */
const parseJWTPayload = (token: string): Record<string, any> | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const payload = JSON.parse(atob(parts[1]));
    
    // Basic JWT validation
    if (!payload.exp || !payload.iat || !payload.sub) {
      return null;
    }
    
    // Check expiration
    if (payload.exp * 1000 < Date.now()) {
      return null;
    }
    
    return payload;
    
  } catch {
    return null;
  }
};

describe('Core Security', () => {
  describe('isValidUUID', () => {
    it('should return true for valid UUID v4', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should return true for valid UUID v1', () => {
      expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('should return true for valid UUID v5', () => {
      expect(isValidUUID('886313e1-3b8a-5372-9b90-0c9aee199e5d')).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidUUID(null as any)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidUUID(undefined as any)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidUUID('')).toBe(false);
    });

    it('should return false for invalid format - missing dashes', () => {
      expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
    });

    it('should return false for invalid format - wrong length', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
    });

    it('should return false for invalid format - wrong characters', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
    });

    it('should return false for random string', () => {
      expect(isValidUUID('not-a-uuid-at-all')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
      expect(isValidUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
    });
  });

  describe('parseJWTPayload', () => {
    // Helper to create a valid JWT
    const createValidJWT = (payload: Record<string, any>) => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const body = btoa(JSON.stringify(payload));
      const signature = 'test-signature';
      return `${header}.${body}.${signature}`;
    };

    it('should parse valid JWT payload', () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createValidJWT({
        sub: 'user-123',
        iat: now - 100,
        exp: now + 3600,
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
      });

      const result = parseJWTPayload(jwt);
      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user-123');
      expect(result?.tenant_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should return null for invalid JWT - too few parts', () => {
      expect(parseJWTPayload('header.body')).toBeNull();
    });

    it('should return null for invalid JWT - too many parts', () => {
      expect(parseJWTPayload('a.b.c.d')).toBeNull();
    });

    it('should return null for invalid base64', () => {
      expect(parseJWTPayload('invalid.!!!.signature')).toBeNull();
    });

    it('should return null for expired token', () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createValidJWT({
        sub: 'user-123',
        iat: now - 7200,
        exp: now - 3600, // Expired 1 hour ago
      });

      const result = parseJWTPayload(jwt);
      expect(result).toBeNull();
    });

    it('should return null for JWT missing required claims - no exp', () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createValidJWT({
        sub: 'user-123',
        iat: now,
        // Missing exp
      });

      const result = parseJWTPayload(jwt);
      expect(result).toBeNull();
    });

    it('should return null for JWT missing required claims - no iat', () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createValidJWT({
        sub: 'user-123',
        exp: now + 3600,
        // Missing iat
      });

      const result = parseJWTPayload(jwt);
      expect(result).toBeNull();
    });

    it('should return null for JWT missing required claims - no sub', () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createValidJWT({
        iat: now,
        exp: now + 3600,
        // Missing sub
      });

      const result = parseJWTPayload(jwt);
      expect(result).toBeNull();
    });

    it('should handle JWT with app_metadata', () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createValidJWT({
        sub: 'user-123',
        iat: now,
        exp: now + 3600,
        app_metadata: {
          tenant_id: '550e8400-e29b-41d4-a716-446655440000',
          role: 'admin',
        },
      });

      const result = parseJWTPayload(jwt);
      expect(result?.app_metadata?.tenant_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should handle JWT with user_metadata', () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = createValidJWT({
        sub: 'user-123',
        iat: now,
        exp: now + 3600,
        user_metadata: {
          name: 'Test User',
          org_id: 'org-123',
        },
      });

      const result = parseJWTPayload(jwt);
      expect(result?.user_metadata?.name).toBe('Test User');
    });
  });
});
