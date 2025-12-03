/**
 * Cross-Tenant Access Security Tests
 * 
 * These tests verify that users from one tenant cannot access
 * data belonging to another tenant.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Test configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

// Test tenants (should be created in test database)
const TENANT_1_ID = '00000000-0000-0000-0000-000000000001';
const TENANT_2_ID = '00000000-0000-0000-0000-000000000002';

// Test users (should be created in test database)
let tenant1Client: SupabaseClient;
let tenant2Client: SupabaseClient;

describe('Cross-Tenant Access Prevention', () => {
  beforeAll(async () => {
    // Initialize clients for different tenants
    // In real tests, these would use actual authenticated users
    tenant1Client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          'x-tenant-id': TENANT_1_ID,
        },
      },
    });

    tenant2Client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          'x-tenant-id': TENANT_2_ID,
        },
      },
    });
  });

  describe('Manufacturing Orders Isolation', () => {
    it('should not allow tenant 1 to see tenant 2 manufacturing orders', async () => {
      // Create a manufacturing order as tenant 2
      const { data: mo2, error: createError } = await tenant2Client
        .from('manufacturing_orders')
        .insert({
          org_id: TENANT_2_ID,
          mo_number: 'MO-TEST-002',
          product_id: 'test-product-id',
          qty_planned: 100,
          status: 'draft',
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(mo2).toBeTruthy();

      // Try to access it as tenant 1
      const { data: accessedData, error: accessError } = await tenant1Client
        .from('manufacturing_orders')
        .select('*')
        .eq('id', mo2.id)
        .single();

      // Should not be able to access
      expect(accessError).toBeTruthy();
      expect(accessedData).toBeNull();
    });

    it('should not allow tenant 1 to update tenant 2 manufacturing orders', async () => {
      // Get tenant 2's order
      const { data: orders } = await tenant2Client
        .from('manufacturing_orders')
        .select('id')
        .eq('org_id', TENANT_2_ID)
        .limit(1);

      if (orders && orders.length > 0) {
        const orderId = orders[0].id;

        // Try to update as tenant 1
        const { error } = await tenant1Client
          .from('manufacturing_orders')
          .update({ status: 'cancelled' })
          .eq('id', orderId);

        // Should fail
        expect(error).toBeTruthy();
      }
    });

    it('should not allow tenant 1 to delete tenant 2 manufacturing orders', async () => {
      // Get tenant 2's order
      const { data: orders } = await tenant2Client
        .from('manufacturing_orders')
        .select('id')
        .eq('org_id', TENANT_2_ID)
        .limit(1);

      if (orders && orders.length > 0) {
        const orderId = orders[0].id;

        // Try to delete as tenant 1
        const { error } = await tenant1Client
          .from('manufacturing_orders')
          .delete()
          .eq('id', orderId);

        // Should fail
        expect(error).toBeTruthy();
      }
    });
  });

  describe('Inventory Items Isolation', () => {
    it('should not allow tenant 1 to see tenant 2 inventory items', async () => {
      // Create an inventory item as tenant 2
      const { data: item2, error: createError } = await tenant2Client
        .from('inventory_items')
        .insert({
          org_id: TENANT_2_ID,
          code: 'ITEM-TEST-002',
          name: 'Test Item 2',
          cost_price: 100,
        })
        .select()
        .single();

      if (!createError && item2) {
        // Try to access it as tenant 1
        const { data: accessedData, error: accessError } = await tenant1Client
          .from('inventory_items')
          .select('*')
          .eq('id', item2.id)
          .single();

        // Should not be able to access
        expect(accessError).toBeTruthy();
        expect(accessedData).toBeNull();
      }
    });
  });

  describe('GL Accounts Isolation', () => {
    it('should not allow tenant 1 to see tenant 2 GL accounts', async () => {
      // Create a GL account as tenant 2
      const { data: account2, error: createError } = await tenant2Client
        .from('gl_accounts')
        .insert({
          org_id: TENANT_2_ID,
          code: '9999',
          name: 'Test Account 2',
          account_type: 'ASSET',
        })
        .select()
        .single();

      if (!createError && account2) {
        // Try to access it as tenant 1
        const { data: accessedData, error: accessError } = await tenant1Client
          .from('gl_accounts')
          .select('*')
          .eq('id', account2.id)
          .single();

        // Should not be able to access
        expect(accessError).toBeTruthy();
        expect(accessedData).toBeNull();
      }
    });
  });

  describe('Journal Entries Isolation', () => {
    it('should not allow tenant 1 to see tenant 2 journal entries', async () => {
      // Create a journal entry as tenant 2
      const { data: journal2, error: createError } = await tenant2Client
        .from('journal_entries')
        .insert({
          org_id: TENANT_2_ID,
          entry_date: new Date().toISOString(),
          description: 'Test Entry 2',
        })
        .select()
        .single();

      if (!createError && journal2) {
        // Try to access it as tenant 1
        const { data: accessedData, error: accessError } = await tenant1Client
          .from('journal_entries')
          .select('*')
          .eq('id', journal2.id)
          .single();

        // Should not be able to access
        expect(accessError).toBeTruthy();
        expect(accessedData).toBeNull();
      }
    });
  });

  describe('Sales Orders Isolation', () => {
    it('should not allow tenant 1 to see tenant 2 sales orders', async () => {
      // Create a sales order as tenant 2
      const { data: so2, error: createError } = await tenant2Client
        .from('sales_orders')
        .insert({
          tenant_id: TENANT_2_ID,
          so_number: 'SO-TEST-002',
          customer_id: 'test-customer-id',
          so_date: new Date().toISOString(),
          total_amount: 1000,
        })
        .select()
        .single();

      if (!createError && so2) {
        // Try to access it as tenant 1
        const { data: accessedData, error: accessError } = await tenant1Client
          .from('sales_orders')
          .select('*')
          .eq('id', so2.id)
          .single();

        // Should not be able to access
        expect(accessError).toBeTruthy();
        expect(accessedData).toBeNull();
      }
    });
  });

  afterAll(async () => {
    // Cleanup test data if needed
    // Note: In production tests, use a separate test database
  });
});

