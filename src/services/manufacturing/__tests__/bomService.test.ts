/**
 * BOM Service Tests
 * 
 * Tests for Bill of Materials management functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseQuery),
  },
}));

import { bomService, type BOMHeader, type BOMLine } from '../bomService';

describe('BOM Service', () => {
  const testOrgId = 'test-org-123';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all mock implementations
    Object.keys(mockSupabaseQuery).forEach(key => {
      (mockSupabaseQuery as any)[key].mockReturnThis();
    });
  });

  describe('getAllBOMs', () => {
    it('should return empty array when orgId is empty', async () => {
      const result = await bomService.getAllBOMs('');
      expect(result).toEqual([]);
    });

    it('should return BOMs successfully', async () => {
      const mockBOMs: Partial<BOMHeader>[] = [
        {
          id: 'bom-1',
          bom_number: 'BOM-001',
          item_id: 'item-1',
          bom_version: 1,
          is_active: true,
          status: 'APPROVED',
          org_id: testOrgId,
        },
        {
          id: 'bom-2',
          bom_number: 'BOM-002',
          item_id: 'item-2',
          bom_version: 1,
          is_active: true,
          status: 'DRAFT',
          org_id: testOrgId,
        },
      ];

      mockSupabaseQuery.order.mockResolvedValue({ data: mockBOMs, error: null });

      const result = await bomService.getAllBOMs(testOrgId);
      
      expect(result).toHaveLength(2);
      expect(result[0].bom_number).toBe('BOM-001');
    });

    it('should return empty array when table does not exist', async () => {
      mockSupabaseQuery.order.mockResolvedValue({
        data: null,
        error: { code: 'PGRST205', message: 'Could not find the table' },
      });

      const result = await bomService.getAllBOMs(testOrgId);
      expect(result).toEqual([]);
    });

    it('should enrich BOMs with product information', async () => {
      const mockBOMs = [
        { id: 'bom-1', bom_number: 'BOM-001', item_id: 'item-1', org_id: testOrgId },
      ];

      const mockProducts = [
        { id: 'item-1', code: 'P001', name: 'Product 1' },
      ];

      // First call returns BOMs, subsequent calls return products
      mockSupabaseQuery.order.mockResolvedValueOnce({ data: mockBOMs, error: null });
      mockSupabaseQuery.in.mockResolvedValueOnce({ data: mockProducts, error: null });

      const result = await bomService.getAllBOMs(testOrgId);
      
      expect(result[0].item_code).toBe('P001');
      expect(result[0].item_name).toBe('Product 1');
    });

    it('should throw error on database failure', async () => {
      mockSupabaseQuery.order.mockResolvedValue({
        data: null,
        error: { code: 'PGRST500', message: 'Database connection failed' },
      });

      await expect(bomService.getAllBOMs(testOrgId)).rejects.toThrow();
    });
  });

  describe('getBOMById', () => {
    it('should return BOM with header and lines', async () => {
      const mockHeader: Partial<BOMHeader> = {
        id: 'bom-1',
        bom_number: 'BOM-001',
        item_id: 'item-1',
        bom_version: 1,
        is_active: true,
        status: 'APPROVED',
        org_id: testOrgId,
      };

      const mockLines: Partial<BOMLine>[] = [
        { id: 'line-1', bom_id: 'bom-1', line_number: 1, item_id: 'comp-1', quantity: 5 },
        { id: 'line-2', bom_id: 'bom-1', line_number: 2, item_id: 'comp-2', quantity: 10 },
      ];

      // Mock header query
      mockSupabaseQuery.single.mockResolvedValueOnce({ data: mockHeader, error: null });
      // Mock product lookup (returns null)
      mockSupabaseQuery.single.mockResolvedValueOnce({ data: null, error: null });
      // Mock item lookup (returns null)
      mockSupabaseQuery.single.mockResolvedValueOnce({ data: null, error: null });
      // Mock lines query
      mockSupabaseQuery.order.mockResolvedValueOnce({ data: mockLines, error: null });

      const result = await bomService.getBOMById('bom-1');
      
      expect(result.header.id).toBe('bom-1');
      expect(result.lines).toHaveLength(2);
    });

    it('should throw error when BOM not found', async () => {
      mockSupabaseQuery.single.mockResolvedValue({ data: null, error: null });

      await expect(bomService.getBOMById('non-existent')).rejects.toThrow('BOM not found');
    });

    it('should throw error on database failure', async () => {
      mockSupabaseQuery.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST500', message: 'Database error' },
      });

      await expect(bomService.getBOMById('bom-1')).rejects.toThrow();
    });
  });

  describe('BOM Types', () => {
    it('should accept valid BOM header structure', () => {
      const header: BOMHeader = {
        id: 'bom-1',
        bom_number: 'BOM-001',
        item_id: 'item-1',
        bom_version: 1,
        is_active: true,
        effective_date: '2025-01-01',
        unit_cost: 100,
        status: 'APPROVED',
        org_id: testOrgId,
      };

      expect(header.status).toBe('APPROVED');
      expect(header.is_active).toBe(true);
    });

    it('should accept valid BOM line structure', () => {
      const line: BOMLine = {
        id: 'line-1',
        bom_id: 'bom-1',
        line_number: 1,
        item_id: 'comp-1',
        quantity: 5,
        unit_of_measure: 'PC',
        line_type: 'COMPONENT',
        scrap_factor: 0.02,
        is_critical: true,
        yield_percentage: 98,
        effective_from: '2025-01-01',
        org_id: testOrgId,
      };

      expect(line.line_type).toBe('COMPONENT');
      expect(line.is_critical).toBe(true);
    });

    it('should support all BOM status values', () => {
      const statuses: BOMHeader['status'][] = ['DRAFT', 'APPROVED', 'OBSOLETE'];
      
      statuses.forEach(status => {
        const header: Partial<BOMHeader> = { status };
        expect(header.status).toBe(status);
      });
    });

    it('should support all line types', () => {
      const lineTypes: BOMLine['line_type'][] = ['COMPONENT', 'PHANTOM', 'REFERENCE'];
      
      lineTypes.forEach(lineType => {
        const line: Partial<BOMLine> = { line_type: lineType };
        expect(line.line_type).toBe(lineType);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      mockSupabaseQuery.order.mockRejectedValue(new Error('Network error'));

      await expect(bomService.getAllBOMs(testOrgId)).rejects.toThrow('Network error');
    });

    it('should handle PGRST205 table not found error', async () => {
      mockSupabaseQuery.order.mockRejectedValue({
        code: 'PGRST205',
        message: 'Could not find the table',
      });

      const result = await bomService.getAllBOMs(testOrgId);
      expect(result).toEqual([]);
    });
  });
});
