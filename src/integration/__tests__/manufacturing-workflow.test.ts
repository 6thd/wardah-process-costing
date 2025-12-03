/**
 * Manufacturing Workflow Integration Tests
 * 
 * Tests the complete manufacturing workflow from order creation to completion
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '@/lib/supabase';
import { inventoryTransactionService } from '@/services/inventory-transaction-service';
import { manufacturingService } from '@/services/supabase-service';

describe('Manufacturing Workflow Integration', () => {
  const testOrgId = '00000000-0000-0000-0000-000000000001';
  let testMoId: string;
  let testItemId: string;

  beforeAll(async () => {
    // Setup test data
    // Create test item
    const { data: item } = await supabase
      .from('inventory_items')
      .insert({
        org_id: testOrgId,
        code: 'TEST-ITEM-001',
        name: 'Test Item',
        cost_price: 10,
      })
      .select()
      .single();

    testItemId = item?.id || '';

    // Create initial stock
    await supabase.from('stock_quants').insert({
      org_id: testOrgId,
      item_id: testItemId,
      quantity: 100,
    });
  });

  afterAll(async () => {
    // Cleanup test data
    if (testMoId) {
      await supabase.from('manufacturing_orders').delete().eq('id', testMoId);
    }
    if (testItemId) {
      await supabase.from('inventory_items').delete().eq('id', testItemId);
    }
  });

  describe('Complete Manufacturing Flow', () => {
    it('should create order with material reservation', async () => {
      const materials = [
        { item_id: testItemId, quantity: 50, unit_cost: 10 },
      ];

      // Check availability
      const availability = await inventoryTransactionService.checkAvailability(materials);
      expect(availability[0].sufficient).toBe(true);

      // Create order with materials
      const order = await manufacturingService.create(
        {
          org_id: testOrgId,
          order_number: 'MO-TEST-001',
          product_id: testItemId,
          quantity: 100,
          status: 'draft',
        } as any,
        materials
      );

      expect(order).toBeDefined();
      testMoId = order?.id || '';

      // Verify reservations were created
      const reservations = await inventoryTransactionService.getReservations(testMoId);
      expect(reservations.length).toBeGreaterThan(0);
    });

    it('should consume materials when order starts', async () => {
      if (!testMoId) return;

      const reservations = await inventoryTransactionService.getReservations(testMoId);
      const consumptions = reservations.map(r => ({
        item_id: r.item_id,
        quantity: r.quantity_reserved,
        quantity_reserved: r.quantity_reserved,
        unit_cost: 10,
      }));

      // Consume materials
      await inventoryTransactionService.consumeReservedMaterials(testMoId, consumptions);

      // Verify reservations are consumed
      const updatedReservations = await inventoryTransactionService.getReservations(testMoId);
      expect(updatedReservations.every(r => r.status === 'consumed')).toBe(true);
    });

    it('should release reservations when order is cancelled', async () => {
      if (!testMoId) return;

      // Release all reservations
      await inventoryTransactionService.releaseAllReservations(testMoId);

      // Verify reservations are released
      const reservations = await inventoryTransactionService.getReservations(testMoId);
      expect(reservations.every(r => r.status === 'released')).toBe(true);
    });
  });
});

