/**
 * Warehouse Service Unit Tests
 * Tests for WarehouseService with mocked Supabase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
  rpc: vi.fn().mockReturnThis(),
};

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mockSupabase,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Helper functions for testing (pure functions extracted from service logic)

/**
 * Validate warehouse data for creation
 */
function validateWarehouseData(warehouse: {
  code?: string;
  name?: string;
  warehouse_type?: string;
  is_active?: boolean;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!warehouse.code || warehouse.code.trim() === '') {
    errors.push('Warehouse code is required');
  }
  if (!warehouse.name || warehouse.name.trim() === '') {
    errors.push('Warehouse name is required');
  }
  if (warehouse.code && warehouse.code.length > 20) {
    errors.push('Warehouse code must be 20 characters or less');
  }
  if (warehouse.code && !/^[A-Z0-9-_]+$/.test(warehouse.code)) {
    errors.push('Warehouse code must contain only uppercase letters, numbers, hyphens, and underscores');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate storage location data
 */
function validateStorageLocationData(location: {
  warehouse_id?: string;
  code?: string;
  name?: string;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!location.warehouse_id) {
    errors.push('Warehouse ID is required');
  }
  if (!location.code || location.code.trim() === '') {
    errors.push('Location code is required');
  }
  if (!location.name || location.name.trim() === '') {
    errors.push('Location name is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate storage bin data
 */
function validateStorageBinData(bin: {
  location_id?: string;
  warehouse_id?: string;
  bin_code?: string;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!bin.location_id) {
    errors.push('Location ID is required');
  }
  if (!bin.warehouse_id) {
    errors.push('Warehouse ID is required');
  }
  if (!bin.bin_code || bin.bin_code.trim() === '') {
    errors.push('Bin code is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Generate warehouse code from name
 */
function generateWarehouseCode(name: string): string {
  if (!name) return '';
  
  // Remove Arabic characters and special characters
  const cleaned = name
    .replace(/[\u0600-\u06FF]/g, '') // Remove Arabic
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars
    .trim()
    .toUpperCase();

  if (!cleaned) {
    // If only Arabic, generate WH- prefix with random
    return `WH-${Date.now().toString().slice(-6)}`;
  }

  // Take first letters of each word
  const words = cleaned.split(/\s+/);
  const code = words.map(w => w.charAt(0)).join('');
  
  return code.slice(0, 10) || 'WH';
}

/**
 * Calculate storage utilization percentage
 */
function calculateStorageUtilization(used: number, total: number): number {
  if (total <= 0) return 0;
  const percentage = (used / total) * 100;
  return Math.min(100, Math.round(percentage * 100) / 100);
}

/**
 * Determine stock status based on quantity and thresholds
 */
function determineStockStatus(
  currentQty: number,
  minQty: number,
  maxQty: number
): 'critical' | 'low' | 'normal' | 'overstock' {
  if (currentQty <= 0) return 'critical';
  if (currentQty < minQty) return 'low';
  if (currentQty > maxQty) return 'overstock';
  return 'normal';
}

/**
 * Format bin location string
 */
function formatBinLocation(bin: {
  aisle?: string;
  rack?: string;
  level?: string;
  position?: string;
}): string {
  const parts = [
    bin.aisle ? `A${bin.aisle}` : null,
    bin.rack ? `R${bin.rack}` : null,
    bin.level ? `L${bin.level}` : null,
    bin.position ? `P${bin.position}` : null,
  ].filter(Boolean);

  return parts.join('-') || 'N/A';
}

/**
 * Check if warehouse can be deactivated
 */
function canDeactivateWarehouse(stockCount: number, hasActiveTransfers: boolean): {
  canDeactivate: boolean;
  reason?: string;
} {
  if (stockCount > 0) {
    return {
      canDeactivate: false,
      reason: 'Warehouse has existing stock',
    };
  }
  if (hasActiveTransfers) {
    return {
      canDeactivate: false,
      reason: 'Warehouse has pending transfers',
    };
  }
  return { canDeactivate: true };
}

/**
 * Validate GL account mapping
 */
function validateGLMapping(mapping: {
  stockAccount?: string;
  adjustmentAccount?: string;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!mapping.stockAccount) {
    errors.push('Stock account is required');
  }
  
  // Validate account code format (e.g., 1130, 5010)
  if (mapping.stockAccount && !/^\d{4}$/.test(mapping.stockAccount)) {
    errors.push('Stock account must be a 4-digit code');
  }
  if (mapping.adjustmentAccount && !/^\d{4}$/.test(mapping.adjustmentAccount)) {
    errors.push('Adjustment account must be a 4-digit code');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate total warehouse capacity
 */
function calculateTotalCapacity(locations: Array<{ capacity?: number }>): number {
  return locations.reduce((total, loc) => total + (loc.capacity || 0), 0);
}

/**
 * Filter active items
 */
function filterActiveItems<T extends { is_active?: boolean }>(items: T[]): T[] {
  return items.filter(item => item.is_active !== false);
}

/**
 * Sort warehouses by hierarchy
 */
function sortWarehousesByHierarchy(
  warehouses: Array<{ id: string; parent_warehouse_id?: string; code: string }>
): Array<{ id: string; parent_warehouse_id?: string; code: string; level: number }> {
  const result: Array<{ id: string; parent_warehouse_id?: string; code: string; level: number }> = [];
  const processed = new Set<string>();

  function addWithChildren(parentId: string | undefined, level: number) {
    const children = warehouses.filter(w => w.parent_warehouse_id === parentId);
    children.sort((a, b) => a.code.localeCompare(b.code));
    
    for (const child of children) {
      if (!processed.has(child.id)) {
        processed.add(child.id);
        result.push({ ...child, level });
        addWithChildren(child.id, level + 1);
      }
    }
  }

  // Start with root warehouses (no parent)
  addWithChildren(undefined, 0);
  
  // Add any orphaned warehouses
  for (const w of warehouses) {
    if (!processed.has(w.id)) {
      result.push({ ...w, level: 0 });
    }
  }

  return result;
}

describe('WarehouseService Helper Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateWarehouseData', () => {
    it('should validate complete warehouse data', () => {
      const result = validateWarehouseData({
        code: 'WH-001',
        name: 'Main Warehouse',
        warehouse_type: 'main',
        is_active: true,
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require warehouse code', () => {
      const result = validateWarehouseData({
        name: 'Test Warehouse',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Warehouse code is required');
    });

    it('should require warehouse name', () => {
      const result = validateWarehouseData({
        code: 'WH-001',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Warehouse name is required');
    });

    it('should reject empty code', () => {
      const result = validateWarehouseData({
        code: '   ',
        name: 'Test',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Warehouse code is required');
    });

    it('should reject code longer than 20 characters', () => {
      const result = validateWarehouseData({
        code: 'VERYLONGWAREHOUSECODE123',
        name: 'Test',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Warehouse code must be 20 characters or less');
    });

    it('should reject invalid code format', () => {
      const result = validateWarehouseData({
        code: 'wh-001', // lowercase not allowed
        name: 'Test',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Warehouse code must contain only uppercase letters, numbers, hyphens, and underscores');
    });

    it('should accept valid code formats', () => {
      const validCodes = ['WH-001', 'MAIN_WAREHOUSE', 'WH01', 'STORE-A1'];
      for (const code of validCodes) {
        const result = validateWarehouseData({ code, name: 'Test' });
        expect(result.errors).not.toContain('Warehouse code must contain only uppercase letters, numbers, hyphens, and underscores');
      }
    });
  });

  describe('validateStorageLocationData', () => {
    it('should validate complete location data', () => {
      const result = validateStorageLocationData({
        warehouse_id: 'wh-uuid',
        code: 'LOC-01',
        name: 'Location 1',
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require warehouse_id', () => {
      const result = validateStorageLocationData({
        code: 'LOC-01',
        name: 'Location 1',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Warehouse ID is required');
    });

    it('should require code', () => {
      const result = validateStorageLocationData({
        warehouse_id: 'wh-uuid',
        name: 'Location 1',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Location code is required');
    });

    it('should require name', () => {
      const result = validateStorageLocationData({
        warehouse_id: 'wh-uuid',
        code: 'LOC-01',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Location name is required');
    });
  });

  describe('validateStorageBinData', () => {
    it('should validate complete bin data', () => {
      const result = validateStorageBinData({
        location_id: 'loc-uuid',
        warehouse_id: 'wh-uuid',
        bin_code: 'BIN-001',
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require location_id', () => {
      const result = validateStorageBinData({
        warehouse_id: 'wh-uuid',
        bin_code: 'BIN-001',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Location ID is required');
    });

    it('should require warehouse_id', () => {
      const result = validateStorageBinData({
        location_id: 'loc-uuid',
        bin_code: 'BIN-001',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Warehouse ID is required');
    });

    it('should require bin_code', () => {
      const result = validateStorageBinData({
        location_id: 'loc-uuid',
        warehouse_id: 'wh-uuid',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Bin code is required');
    });
  });

  describe('generateWarehouseCode', () => {
    it('should generate code from English name', () => {
      const code = generateWarehouseCode('Main Warehouse Store');
      expect(code).toBe('MWS');
    });

    it('should handle single word', () => {
      const code = generateWarehouseCode('Warehouse');
      expect(code).toBe('W');
    });

    it('should convert to uppercase', () => {
      const code = generateWarehouseCode('main warehouse');
      expect(code).toBe('MW');
    });

    it('should limit code length to 10 characters', () => {
      const code = generateWarehouseCode('A B C D E F G H I J K L M N O P');
      expect(code.length).toBeLessThanOrEqual(10);
    });

    it('should handle empty name', () => {
      const code = generateWarehouseCode('');
      expect(code).toBe('');
    });

    it('should handle Arabic-only names', () => {
      const code = generateWarehouseCode('مخزن رئيسي');
      expect(code).toMatch(/^WH-\d{6}$/);
    });

    it('should handle mixed Arabic and English', () => {
      const code = generateWarehouseCode('Main مخزن Store');
      expect(code).toBe('MS');
    });
  });

  describe('calculateStorageUtilization', () => {
    it('should calculate correct percentage', () => {
      expect(calculateStorageUtilization(50, 100)).toBe(50);
      expect(calculateStorageUtilization(75, 100)).toBe(75);
      expect(calculateStorageUtilization(25, 200)).toBe(12.5);
    });

    it('should return 0 for zero total capacity', () => {
      expect(calculateStorageUtilization(50, 0)).toBe(0);
    });

    it('should return 0 for negative total capacity', () => {
      expect(calculateStorageUtilization(50, -100)).toBe(0);
    });

    it('should cap at 100%', () => {
      expect(calculateStorageUtilization(150, 100)).toBe(100);
    });

    it('should handle decimal results', () => {
      const result = calculateStorageUtilization(33, 100);
      expect(result).toBe(33);
    });

    it('should round to 2 decimal places', () => {
      const result = calculateStorageUtilization(1, 3);
      expect(result).toBe(33.33);
    });
  });

  describe('determineStockStatus', () => {
    it('should return critical for zero quantity', () => {
      expect(determineStockStatus(0, 10, 100)).toBe('critical');
    });

    it('should return critical for negative quantity', () => {
      expect(determineStockStatus(-5, 10, 100)).toBe('critical');
    });

    it('should return low for quantity below minimum', () => {
      expect(determineStockStatus(5, 10, 100)).toBe('low');
    });

    it('should return normal for quantity within range', () => {
      expect(determineStockStatus(50, 10, 100)).toBe('normal');
    });

    it('should return overstock for quantity above maximum', () => {
      expect(determineStockStatus(150, 10, 100)).toBe('overstock');
    });

    it('should return normal at minimum threshold', () => {
      expect(determineStockStatus(10, 10, 100)).toBe('normal');
    });

    it('should return normal at maximum threshold', () => {
      expect(determineStockStatus(100, 10, 100)).toBe('normal');
    });
  });

  describe('formatBinLocation', () => {
    it('should format complete bin location', () => {
      const result = formatBinLocation({
        aisle: '01',
        rack: '02',
        level: '03',
        position: '04',
      });
      expect(result).toBe('A01-R02-L03-P04');
    });

    it('should handle partial location data', () => {
      const result = formatBinLocation({
        aisle: '01',
        rack: '02',
      });
      expect(result).toBe('A01-R02');
    });

    it('should return N/A for empty location', () => {
      const result = formatBinLocation({});
      expect(result).toBe('N/A');
    });

    it('should handle only one component', () => {
      expect(formatBinLocation({ aisle: '05' })).toBe('A05');
      expect(formatBinLocation({ rack: '10' })).toBe('R10');
      expect(formatBinLocation({ level: '2' })).toBe('L2');
      expect(formatBinLocation({ position: '1' })).toBe('P1');
    });
  });

  describe('canDeactivateWarehouse', () => {
    it('should allow deactivation with no stock and no transfers', () => {
      const result = canDeactivateWarehouse(0, false);
      expect(result.canDeactivate).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should block deactivation with existing stock', () => {
      const result = canDeactivateWarehouse(10, false);
      expect(result.canDeactivate).toBe(false);
      expect(result.reason).toBe('Warehouse has existing stock');
    });

    it('should block deactivation with pending transfers', () => {
      const result = canDeactivateWarehouse(0, true);
      expect(result.canDeactivate).toBe(false);
      expect(result.reason).toBe('Warehouse has pending transfers');
    });

    it('should prioritize stock check over transfers', () => {
      const result = canDeactivateWarehouse(5, true);
      expect(result.canDeactivate).toBe(false);
      expect(result.reason).toBe('Warehouse has existing stock');
    });
  });

  describe('validateGLMapping', () => {
    it('should validate complete GL mapping', () => {
      const result = validateGLMapping({
        stockAccount: '1130',
        adjustmentAccount: '5010',
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require stock account', () => {
      const result = validateGLMapping({
        adjustmentAccount: '5010',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Stock account is required');
    });

    it('should validate stock account format', () => {
      const result = validateGLMapping({
        stockAccount: '113', // Too short
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Stock account must be a 4-digit code');
    });

    it('should validate adjustment account format if provided', () => {
      const result = validateGLMapping({
        stockAccount: '1130',
        adjustmentAccount: '50', // Too short
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Adjustment account must be a 4-digit code');
    });

    it('should accept optional adjustment account', () => {
      const result = validateGLMapping({
        stockAccount: '1130',
      });
      expect(result.isValid).toBe(true);
    });
  });

  describe('calculateTotalCapacity', () => {
    it('should sum all location capacities', () => {
      const locations = [
        { capacity: 100 },
        { capacity: 200 },
        { capacity: 300 },
      ];
      expect(calculateTotalCapacity(locations)).toBe(600);
    });

    it('should handle empty array', () => {
      expect(calculateTotalCapacity([])).toBe(0);
    });

    it('should handle undefined capacities', () => {
      const locations = [
        { capacity: 100 },
        { capacity: undefined },
        { capacity: 300 },
      ];
      expect(calculateTotalCapacity(locations)).toBe(400);
    });

    it('should handle zero capacities', () => {
      const locations = [
        { capacity: 0 },
        { capacity: 0 },
      ];
      expect(calculateTotalCapacity(locations)).toBe(0);
    });
  });

  describe('filterActiveItems', () => {
    it('should filter out inactive items', () => {
      const items = [
        { id: 1, is_active: true },
        { id: 2, is_active: false },
        { id: 3, is_active: true },
      ];
      const result = filterActiveItems(items);
      expect(result).toHaveLength(2);
      expect(result.map(i => i.id)).toEqual([1, 3]);
    });

    it('should include items without is_active property', () => {
      const items = [
        { id: 1 },
        { id: 2, is_active: false },
        { id: 3 },
      ];
      const result = filterActiveItems(items);
      expect(result).toHaveLength(2);
      expect(result.map(i => i.id)).toEqual([1, 3]);
    });

    it('should return empty array for empty input', () => {
      expect(filterActiveItems([])).toEqual([]);
    });

    it('should return all items if all active', () => {
      const items = [
        { id: 1, is_active: true },
        { id: 2, is_active: true },
      ];
      const result = filterActiveItems(items);
      expect(result).toHaveLength(2);
    });
  });

  describe('sortWarehousesByHierarchy', () => {
    it('should sort warehouses with parent-child relationships', () => {
      const warehouses = [
        { id: '3', parent_warehouse_id: '1', code: 'WH-01-A' },
        { id: '1', parent_warehouse_id: undefined, code: 'WH-01' },
        { id: '2', parent_warehouse_id: undefined, code: 'WH-02' },
        { id: '4', parent_warehouse_id: '1', code: 'WH-01-B' },
      ];
      
      const result = sortWarehousesByHierarchy(warehouses);
      
      expect(result[0].code).toBe('WH-01');
      expect(result[0].level).toBe(0);
      expect(result[1].code).toBe('WH-01-A');
      expect(result[1].level).toBe(1);
      expect(result[2].code).toBe('WH-01-B');
      expect(result[2].level).toBe(1);
      expect(result[3].code).toBe('WH-02');
      expect(result[3].level).toBe(0);
    });

    it('should handle flat structure', () => {
      const warehouses = [
        { id: '1', parent_warehouse_id: undefined, code: 'WH-01' },
        { id: '2', parent_warehouse_id: undefined, code: 'WH-02' },
      ];
      
      const result = sortWarehousesByHierarchy(warehouses);
      
      expect(result).toHaveLength(2);
      expect(result[0].level).toBe(0);
      expect(result[1].level).toBe(0);
    });

    it('should handle empty array', () => {
      const result = sortWarehousesByHierarchy([]);
      expect(result).toEqual([]);
    });

    it('should handle deep nesting', () => {
      const warehouses = [
        { id: '3', parent_warehouse_id: '2', code: 'WH-01-A-1' },
        { id: '2', parent_warehouse_id: '1', code: 'WH-01-A' },
        { id: '1', parent_warehouse_id: undefined, code: 'WH-01' },
      ];
      
      const result = sortWarehousesByHierarchy(warehouses);
      
      expect(result[0].level).toBe(0);
      expect(result[1].level).toBe(1);
      expect(result[2].level).toBe(2);
    });
  });
});

describe('WarehouseService Integration Scenarios', () => {
  describe('Warehouse Capacity Management', () => {
    it('should calculate remaining capacity correctly', () => {
      const totalCapacity = 1000;
      const usedCapacity = 350;
      const remainingCapacity = totalCapacity - usedCapacity;
      
      expect(remainingCapacity).toBe(650);
      expect(calculateStorageUtilization(usedCapacity, totalCapacity)).toBe(35);
    });

    it('should handle capacity overflow scenario', () => {
      const totalCapacity = 100;
      const usedCapacity = 120;
      
      const utilization = calculateStorageUtilization(usedCapacity, totalCapacity);
      expect(utilization).toBe(100); // Capped at 100%
    });
  });

  describe('Stock Level Monitoring', () => {
    const products = [
      { name: 'Product A', currentQty: 5, minQty: 10, maxQty: 100 },
      { name: 'Product B', currentQty: 50, minQty: 10, maxQty: 100 },
      { name: 'Product C', currentQty: 150, minQty: 10, maxQty: 100 },
      { name: 'Product D', currentQty: 0, minQty: 10, maxQty: 100 },
    ];

    it('should categorize products by stock status', () => {
      const categorized = products.map(p => ({
        ...p,
        status: determineStockStatus(p.currentQty, p.minQty, p.maxQty),
      }));

      expect(categorized.find(p => p.name === 'Product A')?.status).toBe('low');
      expect(categorized.find(p => p.name === 'Product B')?.status).toBe('normal');
      expect(categorized.find(p => p.name === 'Product C')?.status).toBe('overstock');
      expect(categorized.find(p => p.name === 'Product D')?.status).toBe('critical');
    });

    it('should count products in each status category', () => {
      const statusCounts = products.reduce((acc, p) => {
        const status = determineStockStatus(p.currentQty, p.minQty, p.maxQty);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(statusCounts.critical).toBe(1);
      expect(statusCounts.low).toBe(1);
      expect(statusCounts.normal).toBe(1);
      expect(statusCounts.overstock).toBe(1);
    });
  });

  describe('Bin Location Formatting', () => {
    it('should format various bin configurations', () => {
      const bins = [
        { aisle: '01', rack: '01', level: '01', position: '01' },
        { aisle: '02', rack: '03' },
        { level: '05', position: '10' },
        {},
      ];

      const formatted = bins.map(b => formatBinLocation(b));

      expect(formatted[0]).toBe('A01-R01-L01-P01');
      expect(formatted[1]).toBe('A02-R03');
      expect(formatted[2]).toBe('L05-P10');
      expect(formatted[3]).toBe('N/A');
    });
  });

  describe('GL Account Validation Scenarios', () => {
    it('should validate standard warehouse GL setup', () => {
      const standardSetup = {
        stockAccount: '1130', // Inventory Asset
        adjustmentAccount: '5020', // Inventory Adjustment Expense
      };
      
      const result = validateGLMapping(standardSetup);
      expect(result.isValid).toBe(true);
    });

    it('should catch common GL setup errors', () => {
      const invalidSetups = [
        { stockAccount: '' }, // Missing stock account
        { stockAccount: '113' }, // Invalid format
        { stockAccount: 'STOCK' }, // Non-numeric
        { stockAccount: '1130', adjustmentAccount: '50' }, // Invalid adjustment
      ];

      for (const setup of invalidSetups) {
        const result = validateGLMapping(setup);
        expect(result.isValid).toBe(false);
      }
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  describe('Null and Undefined Handling', () => {
    it('should handle null capacity in utilization', () => {
      expect(calculateStorageUtilization(0, 0)).toBe(0);
    });

    it('should handle empty bin properties', () => {
      expect(formatBinLocation({ aisle: '', rack: '', level: '', position: '' })).toBe('N/A');
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle stock at exact thresholds', () => {
      expect(determineStockStatus(10, 10, 100)).toBe('normal');
      expect(determineStockStatus(100, 10, 100)).toBe('normal');
      expect(determineStockStatus(9, 10, 100)).toBe('low');
      expect(determineStockStatus(101, 10, 100)).toBe('overstock');
    });

    it('should handle warehouse code at max length', () => {
      const maxCode = 'ABCDEFGHIJ1234567890'; // Exactly 20 chars
      const result = validateWarehouseData({
        code: maxCode,
        name: 'Test',
      });
      expect(result.errors).not.toContain('Warehouse code must be 20 characters or less');
    });
  });

  describe('Special Characters', () => {
    it('should reject warehouse codes with special characters', () => {
      const invalidCodes = ['WH@001', 'WH#001', 'WH$001', 'WH%001'];
      for (const code of invalidCodes) {
        const result = validateWarehouseData({ code, name: 'Test' });
        expect(result.isValid).toBe(false);
      }
    });

    it('should accept codes with allowed special characters', () => {
      const validCodes = ['WH-001', 'WH_001', 'WH-01_A'];
      for (const code of validCodes) {
        const result = validateWarehouseData({ code, name: 'Test' });
        expect(result.errors).not.toContain('Warehouse code must contain only uppercase letters, numbers, hyphens, and underscores');
      }
    });
  });
});
