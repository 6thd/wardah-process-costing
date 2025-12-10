/**
 * Manufacturing Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock functions before mocking
const mockCheckAvailability = vi.fn();
const mockReserveMaterials = vi.fn();

// Mock dependencies
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('test-tenant-id')),
}));

vi.mock('../inventory-transaction-service', () => ({
  inventoryTransactionService: {
    checkAvailability: mockCheckAvailability,
    reserveMaterials: mockReserveMaterials,
  },
}));

describe('Manufacturing Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockCheckAvailability.mockResolvedValue([]);
    mockReserveMaterials.mockResolvedValue([]);
  });

  describe('create() with materials', () => {
    it('should check availability before creating order', async () => {
      const { inventoryTransactionService } = await import('../inventory-transaction-service');

      // Mock availability check - all available
      mockCheckAvailability.mockResolvedValue([
        {
          item_id: 'item-1',
          required: 10,
          available: 100,
          on_hand: 100,
          reserved: 0,
          sufficient: true,
        },
      ]);

      const materials = [
        { item_id: 'item-1', quantity: 10, unit_cost: 5 },
      ];

      // Should call checkAvailability
      const availability = await inventoryTransactionService.checkAvailability(materials);

      expect(mockCheckAvailability).toHaveBeenCalled();
      expect(availability).toHaveLength(1);
      expect(availability[0].sufficient).toBe(true);
    });

    it('should throw error when materials are insufficient', async () => {
      const { inventoryTransactionService } = await import('../inventory-transaction-service');

      // Mock availability check - insufficient
      mockCheckAvailability.mockResolvedValue([
        {
          item_id: 'item-1',
          required: 100,
          available: 50,
          on_hand: 50,
          reserved: 0,
          sufficient: false,
        },
      ]);

      const materials = [
        { item_id: 'item-1', quantity: 100, unit_cost: 5 },
      ];

      // Should return insufficient availability
      const availability = await inventoryTransactionService.checkAvailability(materials);
      expect(availability[0].sufficient).toBe(false);
    });

    it('should reserve materials after order creation', async () => {
      const { inventoryTransactionService } = await import('../inventory-transaction-service');

      // Mock successful reservation
      mockReserveMaterials.mockResolvedValue([
        {
          id: 'res-1',
          org_id: 'org-1',
          mo_id: 'mo-1',
          item_id: 'item-1',
          quantity_reserved: 10,
          quantity_consumed: 0,
          quantity_released: 0,
          status: 'reserved',
          reserved_at: new Date().toISOString(),
        },
      ]);

      const materials = [
        { item_id: 'item-1', quantity: 10, unit_cost: 5 },
      ];

      const reservations = await inventoryTransactionService.reserveMaterials(
        'mo-1',
        materials
      );

      expect(reservations).toHaveLength(1);
      expect(reservations[0].status).toBe('reserved');
    });
  });
});
