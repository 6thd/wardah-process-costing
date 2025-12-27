/**
 * BOM Tree Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseQuery),
    rpc: vi.fn(),
  },
  getEffectiveTenantId: vi.fn(),
}));

import { bomTreeService } from '../bomTreeService';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

describe('bomTreeService', () => {
  const testOrgId = 'test-org-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveTenantId).mockResolvedValue(testOrgId);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null, count: null, status: 200, statusText: 'OK' });
    
    // Reset all mock implementations
    Object.keys(mockSupabaseQuery).forEach(key => {
      (mockSupabaseQuery as any)[key].mockReturnThis();
    });
    
    // Setup chainable mocks for delete
    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
    };
    mockSupabaseQuery.delete = vi.fn(() => deleteChain);
    
    // Setup chainable mocks for select
    const selectChain = {
      eq: vi.fn().mockReturnThis(),
    };
    mockSupabaseQuery.select = vi.fn(() => selectChain);
  });

  describe('buildBOMTree', () => {
    it('should build BOM tree successfully', async () => {
      const mockNodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: true,
        },
        {
          id: 'node-2',
          parent_id: 'node-1',
          item_id: 'item-2',
          item_code: 'I002',
          item_name: 'Item 2',
          level_number: 1,
          quantity_required: 2,
          cumulative_quantity: 2,
          unit_cost: 50,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001/I002',
          has_children: false,
        },
      ];

      vi.mocked(supabase.rpc).mockResolvedValue({ data: mockNodes, error: null, count: null, status: 200, statusText: 'OK' });

      const result = await bomTreeService.buildBOMTree('bom-1', 1, false);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('node-1');
      expect(result[0].children).toBeDefined();
      expect(result[0].children?.length).toBe(1);
    });

    it('should use default quantity of 1', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null, count: null, status: 200, statusText: 'OK' });

      await bomTreeService.buildBOMTree('bom-1');

      expect(supabase.rpc).toHaveBeenCalledWith('build_bom_tree', expect.objectContaining({
        p_quantity: 1,
      }));
    });

    it('should use forceRebuild parameter', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null, count: null, status: 200, statusText: 'OK' });

      await bomTreeService.buildBOMTree('bom-1', 1, true);

      expect(supabase.rpc).toHaveBeenCalledWith('build_bom_tree', expect.objectContaining({
        p_force_rebuild: true,
      }));
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomTreeService.buildBOMTree('bom-1')).rejects.toThrow('Organization ID not found');
    });
  });

  describe('buildTreeStructure', () => {
    it('should build tree structure from flat nodes', () => {
      const flatNodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: true,
        },
        {
          id: 'node-2',
          parent_id: 'node-1',
          item_id: 'item-2',
          item_code: 'I002',
          item_name: 'Item 2',
          level_number: 1,
          quantity_required: 2,
          cumulative_quantity: 2,
          unit_cost: 50,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001/I002',
          has_children: false,
        },
      ];

      const result = bomTreeService.buildTreeStructure(flatNodes);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('node-1');
      expect(result[0].children).toBeDefined();
      expect(result[0].children?.length).toBe(1);
      expect(result[0].children?.[0].id).toBe('node-2');
    });

    it('should handle empty nodes array', () => {
      const result = bomTreeService.buildTreeStructure([]);

      expect(result).toEqual([]);
    });

    it('should handle nodes with missing parent', () => {
      const flatNodes = [
        {
          id: 'node-1',
          parent_id: 'non-existent',
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 1,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: false,
        },
      ];

      const result = bomTreeService.buildTreeStructure(flatNodes);

      expect(result).toHaveLength(0);
    });
  });

  describe('getNodePath', () => {
    it('should get node path successfully', () => {
      const nodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: true,
          children: [
            {
              id: 'node-2',
              parent_id: 'node-1',
              item_id: 'item-2',
              item_code: 'I002',
              item_name: 'Item 2',
              level_number: 1,
              quantity_required: 2,
              cumulative_quantity: 2,
              unit_cost: 50,
              total_cost: 100,
              is_critical: false,
              scrap_factor: 0,
              line_type: 'COMPONENT' as const,
              path: 'I001/I002',
              has_children: false,
            },
          ],
        },
      ];

      const path = bomTreeService.getNodePath(nodes, 'node-2');

      expect(path).toHaveLength(2);
      expect(path[0].id).toBe('node-1');
      expect(path[1].id).toBe('node-2');
    });

    it('should return empty array when node not found', () => {
      const nodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: false,
        },
      ];

      const path = bomTreeService.getNodePath(nodes, 'non-existent');

      expect(path).toEqual([]);
    });
  });

  describe('calculateTreeCost', () => {
    it('should calculate total tree cost', () => {
      const nodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: true,
          children: [
            {
              id: 'node-2',
              parent_id: 'node-1',
              item_id: 'item-2',
              item_code: 'I002',
              item_name: 'Item 2',
              level_number: 1,
              quantity_required: 2,
              cumulative_quantity: 2,
              unit_cost: 50,
              total_cost: 100,
              is_critical: false,
              scrap_factor: 0,
              line_type: 'COMPONENT' as const,
              path: 'I001/I002',
              has_children: false,
            },
          ],
        },
      ];

      const totalCost = bomTreeService.calculateTreeCost(nodes);

      expect(totalCost).toBe(200);
    });

    it('should exclude REFERENCE type nodes', () => {
      const nodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'REFERENCE' as const,
          path: 'I001',
          has_children: false,
        },
      ];

      const totalCost = bomTreeService.calculateTreeCost(nodes);

      expect(totalCost).toBe(0);
    });

    it('should return 0 for empty tree', () => {
      const totalCost = bomTreeService.calculateTreeCost([]);

      expect(totalCost).toBe(0);
    });
  });

  describe('searchInTree', () => {
    it('should search in tree by item code', () => {
      const nodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: true,
          children: [
            {
              id: 'node-2',
              parent_id: 'node-1',
              item_id: 'item-2',
              item_code: 'I002',
              item_name: 'Item 2',
              level_number: 1,
              quantity_required: 2,
              cumulative_quantity: 2,
              unit_cost: 50,
              total_cost: 100,
              is_critical: false,
              scrap_factor: 0,
              line_type: 'COMPONENT' as const,
              path: 'I001/I002',
              has_children: false,
            },
          ],
        },
      ];

      const results = bomTreeService.searchInTree(nodes, 'I002');

      expect(results).toHaveLength(1);
      expect(results[0].item_code).toBe('I002');
    });

    it('should search in tree by item name', () => {
      const nodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: false,
        },
      ];

      const results = bomTreeService.searchInTree(nodes, 'Item 1');

      expect(results).toHaveLength(1);
      expect(results[0].item_name).toBe('Item 1');
    });

    it('should be case insensitive', () => {
      const nodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: false,
        },
      ];

      const results = bomTreeService.searchInTree(nodes, 'item');

      expect(results).toHaveLength(1);
    });

    it('should return empty array when no matches', () => {
      const nodes = [
        {
          id: 'node-1',
          parent_id: null,
          item_id: 'item-1',
          item_code: 'I001',
          item_name: 'Item 1',
          level_number: 0,
          quantity_required: 1,
          cumulative_quantity: 1,
          unit_cost: 100,
          total_cost: 100,
          is_critical: false,
          scrap_factor: 0,
          line_type: 'COMPONENT' as const,
          path: 'I001',
          has_children: false,
        },
      ];

      const results = bomTreeService.searchInTree(nodes, 'non-existent');

      expect(results).toEqual([]);
    });
  });

  describe('getBOMSettings', () => {
    it('should get BOM settings successfully', async () => {
      const mockSettings = [
        {
          setting_key: 'bom_tree_cache_duration_hours',
          setting_value: '2',
          setting_type: 'number',
        },
        {
          setting_key: 'bom_max_levels',
          setting_value: '10',
          setting_type: 'number',
        },
        {
          setting_key: 'bom_auto_calculate_cost',
          setting_value: 'true',
          setting_type: 'boolean',
        },
      ];

      const selectChain = {
        eq: vi.fn().mockResolvedValue({ data: mockSettings, error: null, count: null, status: 200, statusText: 'OK' }),
      };
      mockSupabaseQuery.select = vi.fn(() => selectChain);

      const result = await bomTreeService.getBOMSettings();

      expect(result.bom_tree_cache_duration_hours).toBe(2);
      expect(result.bom_max_levels).toBe(10);
      expect(result.bom_auto_calculate_cost).toBe(true);
    });

    it('should use default values when settings not found', async () => {
      const selectChain = {
        eq: vi.fn().mockResolvedValue({ data: [], error: null, count: null, status: 200, statusText: 'OK' }),
      };
      mockSupabaseQuery.select = vi.fn(() => selectChain);

      const result = await bomTreeService.getBOMSettings();

      expect(result.bom_tree_cache_duration_hours).toBe(1);
      expect(result.bom_max_levels).toBe(20);
      expect(result.bom_auto_calculate_cost).toBe(true);
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomTreeService.getBOMSettings()).rejects.toThrow('Organization ID not found');
    });
  });

  describe('updateBOMSettings', () => {
    it('should update BOM settings successfully', async () => {
      const updates = {
        bom_tree_cache_duration_hours: 3,
        bom_max_levels: 15,
      };

      mockSupabaseQuery.upsert.mockResolvedValue({ data: null, error: null, count: null, status: 200, statusText: 'OK' });

      await bomTreeService.updateBOMSettings(updates, 'user-1');

      expect(mockSupabaseQuery.upsert).toHaveBeenCalled();
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(
        bomTreeService.updateBOMSettings({ bom_max_levels: 15 })
      ).rejects.toThrow('Organization ID not found');
    });
  });

  describe('clearBOMCache', () => {
    it('should clear all BOM cache', async () => {
      const deleteChain = {
        eq: vi.fn().mockResolvedValue({ count: 5, error: null }),
      };
      mockSupabaseQuery.delete = vi.fn(() => deleteChain);

      const result = await bomTreeService.clearBOMCache();

      expect(result).toBe(5);
      expect(mockSupabaseQuery.delete).toHaveBeenCalled();
    });

    it('should clear cache for specific BOM', async () => {
      const deleteChain = {
        eq: vi.fn().mockImplementation((field: string) => {
          if (field === 'org_id') {
            return {
              eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
            };
          }
          return deleteChain;
        }),
      };
      mockSupabaseQuery.delete = vi.fn(() => deleteChain);

      const result = await bomTreeService.clearBOMCache('bom-1');

      expect(result).toBe(1);
    });

    it('should return 0 when count is null', async () => {
      const deleteChain = {
        eq: vi.fn().mockResolvedValue({ count: null, error: null }),
      };
      mockSupabaseQuery.delete = vi.fn(() => deleteChain);

      const result = await bomTreeService.clearBOMCache();

      expect(result).toBe(0);
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomTreeService.clearBOMCache()).rejects.toThrow('Organization ID not found');
    });
  });
});

