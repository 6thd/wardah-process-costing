/**
 * Tenant Validator Tests
 * Tests for tenant validation utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantValidationError } from '../tenant-validator';

// Create mocked functions
const mockGetEffectiveTenantId = vi.fn();
const mockGetTenantClient = vi.fn();

// Mock the dependencies
vi.mock('../supabase', () => ({
  getEffectiveTenantId: () => mockGetEffectiveTenantId(),
}));

vi.mock('../tenant-client', () => ({
  getTenantClient: () => mockGetTenantClient(),
}));

// Import after mocking
import {
  validateTenantId,
  validateTenantAccess,
  validateTenantMatch,
  validateTenantData,
} from '../tenant-validator';

describe('Tenant Validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TenantValidationError', () => {
    it('should create error with correct name', () => {
      const error = new TenantValidationError('Test error');
      expect(error.name).toBe('TenantValidationError');
      expect(error.message).toBe('Test error');
    });

    it('should be instance of Error', () => {
      const error = new TenantValidationError('Test');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('validateTenantId', () => {
    it('should return tenant ID when valid', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const result = await validateTenantId();
      expect(result).toBe('tenant-123');
    });

    it('should throw when tenant ID is null', async () => {
      mockGetEffectiveTenantId.mockResolvedValue(null);
      
      await expect(validateTenantId()).rejects.toThrow(TenantValidationError);
      await expect(validateTenantId()).rejects.toThrow('Tenant ID not found');
    });

    it('should throw when tenant ID is undefined', async () => {
      mockGetEffectiveTenantId.mockResolvedValue(undefined);
      
      await expect(validateTenantId()).rejects.toThrow(TenantValidationError);
    });

    it('should throw when tenant ID is empty string', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('');
      
      await expect(validateTenantId()).rejects.toThrow(TenantValidationError);
    });
  });

  describe('validateTenantAccess', () => {
    it('should return true when resource belongs to tenant', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'resource-1' }, error: null }),
      });
      
      mockGetTenantClient.mockReturnValue({
        from: mockFrom,
      });
      
      const result = await validateTenantAccess('test_table', 'resource-1');
      expect(result).toBe(true);
    });

    it('should throw when resource not found', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      
      mockGetTenantClient.mockReturnValue({
        from: mockFrom,
      });
      
      await expect(validateTenantAccess('test_table', 'resource-1'))
        .rejects.toThrow('Resource not found or access denied');
    });

    it('should throw when database error occurs', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });
      
      mockGetTenantClient.mockReturnValue({
        from: mockFrom,
      });
      
      await expect(validateTenantAccess('test_table', 'resource-1'))
        .rejects.toThrow('Failed to validate tenant access');
    });

    it('should use custom tenant column', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const mockEq = vi.fn().mockReturnThis();
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: mockEq,
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'resource-1' }, error: null }),
      });
      
      mockGetTenantClient.mockReturnValue({
        from: mockFrom,
      });
      
      await validateTenantAccess('test_table', 'resource-1', 'tenant_id');
      
      // Verify custom column was used
      expect(mockEq).toHaveBeenCalledWith('tenant_id', 'tenant-123');
    });
  });

  describe('validateTenantMatch', () => {
    it('should return true when tenant IDs match', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const result = await validateTenantMatch('tenant-123');
      expect(result).toBe(true);
    });

    it('should throw when tenant IDs do not match', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      await expect(validateTenantMatch('different-tenant'))
        .rejects.toThrow('Tenant ID mismatch');
    });

    it('should throw when current tenant ID is not available', async () => {
      mockGetEffectiveTenantId.mockResolvedValue(null);
      
      await expect(validateTenantMatch('tenant-123'))
        .rejects.toThrow(TenantValidationError);
    });
  });

  describe('validateTenantData', () => {
    it('should add tenant ID to data without it', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const data = { name: 'Test', value: 100 };
      const result = await validateTenantData(data);
      
      expect(result.org_id).toBe('tenant-123');
      expect(result.name).toBe('Test');
    });

    it('should return data unchanged when tenant ID matches', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const data = { name: 'Test', org_id: 'tenant-123' };
      const result = await validateTenantData(data);
      
      expect(result.org_id).toBe('tenant-123');
    });

    it('should throw when data has different tenant ID', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const data = { name: 'Test', org_id: 'different-tenant' };
      
      await expect(validateTenantData(data))
        .rejects.toThrow('Cannot create/update resource with different tenant ID');
    });

    it('should use custom tenant column', async () => {
      mockGetEffectiveTenantId.mockResolvedValue('tenant-123');
      
      const data = { name: 'Test' };
      const result = await validateTenantData(data, 'tenant_id');
      
      expect(result.tenant_id).toBe('tenant-123');
    });
  });
});
