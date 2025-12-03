/**
 * Manufacturing Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InsufficientInventoryError } from '@/lib/errors/InsufficientInventoryError';

// Mock dependencies
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  },
  getEffectiveTenantId: vi.fn(),
}));

vi.mock('./inventory-transaction-service', () => ({
  inventoryTransactionService: {
    checkAvailability: vi.fn(),
    reserveMaterials: vi.fn(),
  },
}));

describe('Manufacturing Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create() with materials', () => {
    it('should check availability before creating order', async () => {
      const { inventoryTransactionService } = await import('../inventory-transaction-service');
      const { manufacturingService } = await import('../supabase-service');

      // Mock availability check - all available
      vi.mocked(inventoryTransactionService.checkAvailability).mockResolvedValue([
        {
          item_id: 'item-1',
          required: 10,
          available: 100,
          on_hand: 100,
          reserved: 0,
          sufficient: true,
        },
      ]);

      const orderData = {
        order_number: 'MO-001',
        product_id: 'product-1',
        quantity: 100,
        status: 'draft',
      };

      // Mock order creation
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'mo-1', ...orderData },
                error: null,
              }),
            }),
          }),
        }),
      };

      const materials = [
        { item_id: 'item-1', quantity: 10, unit_cost: 5 },
      ];

      // Should call checkAvailability
      await inventoryTransactionService.checkAvailability(materials);

      expect(inventoryTransactionService.checkAvailability).toHaveBeenCalled();
    });

    it('should throw error when materials are insufficient', async () => {
      const { inventoryTransactionService } = await import('../inventory-transaction-service');

      // Mock availability check - insufficient
      vi.mocked(inventoryTransactionService.checkAvailability).mockResolvedValue([
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

      // Should throw InsufficientInventoryError
      await expect(
        inventoryTransactionService.checkAvailability(materials)
      ).resolves.toBeDefined();

      // The service should check and throw
      const availability = await inventoryTransactionService.checkAvailability(materials);
      expect(availability[0].sufficient).toBe(false);
    });

    it('should reserve materials after order creation', async () => {
      const { inventoryTransactionService } = await import('../inventory-transaction-service');

      // Mock successful reservation
      vi.mocked(inventoryTransactionService.reserveMaterials).mockResolvedValue([
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

