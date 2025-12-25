/**
 * Manufacturing Order GetById Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('getManufacturingOrderById', () => {
  let mockSupabase: SupabaseClient;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;
  let mockSingle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSingle = vi.fn();
    mockEq = vi.fn(() => ({ single: mockSingle }));
    mockSelect = vi.fn(() => ({ eq: mockEq }));
    mockFrom = vi.fn(() => ({ select: mockSelect }));

    mockSupabase = {
      from: mockFrom,
    } as unknown as SupabaseClient;
  });

  const getClient = async () => mockSupabase;

  it('should get order by id successfully', async () => {
    const { getManufacturingOrderById } = await import('../getById');

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
      status: 'draft',
    };

    // Mock items table for loadRelatedItemData
    const itemMock = {
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
      if (table === 'items' || table === 'products') return itemMock;
      return { select: mockSelect };
    });

    mockSingle.mockResolvedValue({ data: orderData, error: null });

    const result = await getManufacturingOrderById(getClient, 'mo-1');

    expect(mockFrom).toHaveBeenCalledWith('manufacturing_orders');
    expect(mockEq).toHaveBeenCalledWith('id', 'mo-1');
    expect(result).toEqual(orderData);
  });

  it('should return null when table not found', async () => {
    const { getManufacturingOrderById } = await import('../getById');

    const tableNotFoundError = {
      code: 'PGRST204',
      message: 'Could not find the table',
    };

    mockSingle.mockResolvedValue({ data: null, error: tableNotFoundError });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getManufacturingOrderById(getClient, 'mo-1');

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith('manufacturing_orders table not found');

    consoleWarnSpy.mockRestore();
  });

  it('should handle relationship error and try simple query', async () => {
    const { getManufacturingOrderById } = await import('../getById');

    const relationshipError = {
      code: 'PGRST200',
      message: 'Could not find a relationship',
    };

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
      product_id: 'prod-1',
      quantity: 10,
    };

    mockSingle
      .mockResolvedValueOnce({ data: null, error: relationshipError })
      .mockResolvedValueOnce({ data: orderData, error: null });

    const result = await getManufacturingOrderById(getClient, 'mo-1');

    expect(result).toEqual(orderData);
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('should return null when order not found', async () => {
    const { getManufacturingOrderById } = await import('../getById');

    const notFoundError = {
      code: 'PGRST205',
      message: 'No rows found',
    };

    mockSingle.mockResolvedValue({ data: null, error: notFoundError });

    const result = await getManufacturingOrderById(getClient, 'non-existent');

    expect(result).toBeNull();
  });

  it('should load related item data after fetching order', async () => {
    const { getManufacturingOrderById } = await import('../getById');

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
      item_id: 'item-1',
      quantity: 10,
    };

    const productsMock = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null, // products table returns null, should fallback to items
            error: null,
          }),
        })),
      })),
    };

    const itemsMock = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'item-1', code: 'I001', name: 'Item 1' },
            error: null,
          }),
        })),
      })),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'products') return productsMock;
      if (table === 'items') return itemsMock;
      return { select: mockSelect };
    });

    mockSingle.mockResolvedValue({ data: orderData, error: null });

    const result = await getManufacturingOrderById(getClient, 'mo-1');

    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(mockFrom).toHaveBeenCalledWith('items');
    expect(result?.item).toEqual({ id: 'item-1', code: 'I001', name: 'Item 1' });
  });

  it('should handle errors in catch block', async () => {
    const { getManufacturingOrderById } = await import('../getById');

    const tableNotFoundError = {
      code: 'PGRST204',
      message: 'Could not find the table',
    };

    mockSingle.mockRejectedValue(tableNotFoundError);

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getManufacturingOrderById(getClient, 'mo-1');

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('should handle relationship error in catch block', async () => {
    const { getManufacturingOrderById } = await import('../getById');

    const relationshipError = {
      code: 'PGRST200',
      message: 'Could not find a relationship',
    };

    const orderData = {
      id: 'mo-1',
      order_number: 'MO-001',
    };

    mockSingle
      .mockRejectedValueOnce(relationshipError)
      .mockResolvedValueOnce({ data: orderData, error: null });

    const result = await getManufacturingOrderById(getClient, 'mo-1');

    expect(result).toEqual(orderData);
  });
});

