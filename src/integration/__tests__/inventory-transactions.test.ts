/**
 * Inventory Transactions Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inventoryTransactionService } from '@/services/inventory-transaction-service';
import { supabase } from '@/lib/supabase';

describe('Inventory Transactions Integration', () => {
  const testOrgId = '00000000-0000-0000-0000-000000000001';
  let testItemId: string;
  let testMoId: string;

  beforeAll(async () => {
    // Create test item
    const { data: item } = await supabase
      .from('inventory_items')
      .insert({
        org_id: testOrgId,
        code: 'TEST-ITEM-TX',
        name: 'Test Item for Transactions',
        cost_price: 10,
      })
      .select()
      .single();

    testItemId = item?.id || '';

    // Create initial stock
    await supabase.from('stock_quants').insert({
      org_id: testOrgId,
      item_id: testItemId,
      quantity: 200,
    });

    // Create test MO
    const { data: mo } = await supabase
      .from('manufacturing_orders')
      .insert({
        org_id: testOrgId,
        order_number: 'MO-TX-TEST',
        product_id: testItemId,
        quantity: 100,
        status: 'draft',
      } as any)
      .select()
      .single();

    testMoId = mo?.id || '';
  });

  afterAll(async () => {
    // Cleanup
    if (testMoId) {
      await supabase.from('manufacturing_orders').delete().eq('id', testMoId);
    }
    if (testItemId) {
      await supabase.from('inventory_items').delete().eq('id', testItemId);
    }
  });

  describe('Material Reservation Flow', () => {
    it('should check availability correctly', async () => {
      const requirements = [
        { item_id: testItemId, quantity: 50, unit_cost: 10 },
      ];

      const availability = await inventoryTransactionService.checkAvailability(requirements);

      expect(availability).toHaveLength(1);
      expect(availability[0].sufficient).toBe(true);
      expect(availability[0].available).toBeGreaterThanOrEqual(50);
    });

    it('should reserve materials', async () => {
      if (!testMoId || !testItemId) return;

      const materials = [
        { item_id: testItemId, quantity: 50, unit_cost: 10 },
      ];

      const reservations = await inventoryTransactionService.reserveMaterials(
        testMoId,
        materials
      );

      expect(reservations).toHaveLength(1);
      expect(reservations[0].status).toBe('reserved');
      expect(reservations[0].quantity_reserved).toBe(50);
    });

    it('should show reduced available quantity after reservation', async () => {
      if (!testItemId) return;

      const requirements = [
        { item_id: testItemId, quantity: 100, unit_cost: 10 },
      ];

      const availability = await inventoryTransactionService.checkAvailability(requirements);

      // Available should be less than on_hand due to reservation
      expect(availability[0].available).toBeLessThan(availability[0].on_hand);
    });

    it('should consume reserved materials', async () => {
      if (!testMoId || !testItemId) return;

      const reservations = await inventoryTransactionService.getReservations(testMoId);
      const consumptions = reservations.map(r => ({
        item_id: r.item_id,
        quantity: r.quantity_reserved,
        quantity_reserved: r.quantity_reserved,
        unit_cost: 10,
      }));

      await inventoryTransactionService.consumeReservedMaterials(testMoId, consumptions);

      const updatedReservations = await inventoryTransactionService.getReservations(testMoId);
      expect(updatedReservations.every(r => r.status === 'consumed')).toBe(true);
    });
  });
});

