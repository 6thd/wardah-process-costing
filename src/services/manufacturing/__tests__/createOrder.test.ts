/**
 * Manufacturing Order Creation Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock dependencies
const mockCheckAvailability = vi.fn();
const mockReserveMaterials = vi.fn();

vi.mock('../../inventory-transaction-service', () => ({
  inventoryTransactionService: {
    checkAvailability: mockCheckAvailability,
    reserveMaterials: mockReserveMaterials,
  },
}));

describe('createManufacturingOrder', () => {
  let mockSupabase: SupabaseClient;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockInsert: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockSingle: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSingle = vi.fn();
    mockEq = vi.fn(() => ({ single: mockSingle }));
    mockSelect = vi.fn(() => ({ eq: mockEq, single: mockSingle }));
    mockInsert = vi.fn(() => ({ select: mockSelect }));
    mockFrom = vi.fn(() => ({ insert: mockInsert, select: mockSelect }));

    mockSupabase = {
      from: mockFrom,
    } as unknown as SupabaseClient;

    mockCheckAvailability.mockResolvedValue([]);
    mockReserveMaterials.mockResolvedValue([]);
  });

  const getClient = async () => mockSupabase;

  it('should create order without materials', async () => {
    const { createManufacturingOrder } = await import('../createOrder');

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
      status: 'draft',
    };

    mockSingle.mockResolvedValue({ data: orderData, error: null });

    const result = await createManufacturingOrder(getClient, {
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    });

    expect(mockFrom).toHaveBeenCalledWith('manufacturing_orders');
    expect(mockInsert).toHaveBeenCalled();
    expect(result).toEqual(orderData);
  });

  it('should check material availability before creating order', async () => {
    const { createManufacturingOrder } = await import('../createOrder');

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

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    };

    mockSingle.mockResolvedValue({ data: orderData, error: null });

    const materials = [
      { item_id: 'item-1', quantity: 10, unit_cost: 5 },
    ];

    await createManufacturingOrder(getClient, {
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    }, materials);

    expect(mockCheckAvailability).toHaveBeenCalled();
  });

  it('should throw error when materials are insufficient', async () => {
    const { createManufacturingOrder } = await import('../createOrder');

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

    await expect(
      createManufacturingOrder(getClient, {
        order_number: 'MO-001',
        product_id: 'prod-1',
        quantity: 10,
      }, materials)
    ).rejects.toThrow('المخزون غير كافٍ');
  });

  it('should reserve materials after successful order creation', async () => {
    const { createManufacturingOrder } = await import('../createOrder');

    mockCheckAvailability.mockResolvedValue([
      {
        item_id: 'item-1',
        required: 10,
        available: 100,
        sufficient: true,
      },
    ]);

    mockReserveMaterials.mockResolvedValue([
      {
        id: 'res-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 10,
        status: 'reserved',
      },
    ]);

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    };

    mockSingle.mockResolvedValue({ data: orderData, error: null });

    const materials = [
      { item_id: 'item-1', quantity: 10, unit_cost: 5 },
    ];

    await createManufacturingOrder(getClient, {
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    }, materials);

    expect(mockReserveMaterials).toHaveBeenCalledWith('mo-1', [
      { item_id: 'item-1', quantity: 10, unit_cost: 5 },
    ]);
  });

  it('should load related product data after creation', async () => {
    const { createManufacturingOrder } = await import('../createOrder');

    const productMock = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'prod-1', code: 'P001', name: 'Product 1' },
            error: null,
          }),
        })),
      })),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'products') return productMock;
      return { insert: mockInsert, select: mockSelect };
    });

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    };

    mockSingle.mockResolvedValue({ data: orderData, error: null });

    await createManufacturingOrder(getClient, {
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    });

    expect(mockFrom).toHaveBeenCalledWith('products');
  });

  it('should handle relationship error gracefully', async () => {
    const { createManufacturingOrder } = await import('../createOrder');

    const relationshipError = {
      code: 'PGRST200',
      message: 'Could not find a relationship',
    };

    // First call returns relationship error, second call succeeds
    mockSingle
      .mockResolvedValueOnce({ data: null, error: relationshipError })
      .mockResolvedValueOnce({
        data: { id: 'mo-1', order_number: 'MO-001' },
        error: null,
      });

    const result = await createManufacturingOrder(getClient, {
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    });

    expect(result).toBeDefined();
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('should handle reservation failure without throwing', async () => {
    const { createManufacturingOrder } = await import('../createOrder');

    mockCheckAvailability.mockResolvedValue([
      {
        item_id: 'item-1',
        required: 10,
        available: 100,
        sufficient: true,
      },
    ]);

    mockReserveMaterials.mockRejectedValue(new Error('Reservation failed'));

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    };

    mockSingle.mockResolvedValue({ data: orderData, error: null });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const materials = [
      { item_id: 'item-1', quantity: 10, unit_cost: 5 },
    ];

    const result = await createManufacturingOrder(getClient, {
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    }, materials);

    expect(result).toEqual(orderData);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

