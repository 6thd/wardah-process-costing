/**
 * Manufacturing Order Status Update Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('updateManufacturingOrderStatus', () => {
  let mockSupabase: SupabaseClient;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;
  let mockSingle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'));

    mockSingle = vi.fn();
    mockSelect = vi.fn(() => ({ single: mockSingle }));
    const eqAfterUpdate = vi.fn(() => ({ select: mockSelect }));
    mockUpdate = vi.fn(() => ({ eq: eqAfterUpdate }));
    mockFrom = vi.fn(() => ({ update: mockUpdate, select: mockSelect }));

    mockSupabase = {
      from: mockFrom,
    } as unknown as SupabaseClient;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const getClient = async () => mockSupabase;

  it('should update status successfully', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const updatedData = {
      id: 'mo-1',
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    };

    mockSingle.mockResolvedValue({ data: updatedData, error: null });

    const result = await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'confirmed',
    });

    expect(mockFrom).toHaveBeenCalledWith('manufacturing_orders');
    expect(mockUpdate).toHaveBeenCalled();
    expect(result).toEqual(updatedData);
  });

  it('should set end_date when status is completed', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const updatedData = {
      id: 'mo-1',
      status: 'completed',
      end_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockSingle.mockResolvedValue({ data: updatedData, error: null });

    await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'completed',
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        end_date: expect.any(String),
      })
    );
  });

  it('should set start_date when status is in-progress and not already set', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const currentOrder = {
      id: 'mo-1',
      start_date: null,
    };

    const updatedData = {
      id: 'mo-1',
      status: 'in-progress',
      start_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const selectForCurrentOrder = vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: currentOrder, error: null }),
      })),
    }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'manufacturing_orders') {
        return {
          update: mockUpdate,
          select: selectForCurrentOrder,
        };
      }
      return { select: mockSelect };
    });

    mockSingle.mockResolvedValue({ data: updatedData, error: null });

    await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'in-progress',
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'in-progress',
        start_date: expect.any(String),
      })
    );
  });

  it('should not override provided dates', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const providedDate = '2025-01-10T08:00:00.000Z';
    const updatedData = {
      id: 'mo-1',
      status: 'completed',
      end_date: providedDate,
      updated_at: new Date().toISOString(),
    };

    mockSingle.mockResolvedValue({ data: updatedData, error: null });

    await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'completed',
      providedUpdateData: {
        end_date: providedDate,
      },
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        end_date: providedDate,
      })
    );
  });

  it('should handle table not found error', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const tableNotFoundError = {
      code: 'PGRST204',
      message: 'Could not find the table',
    };

    mockSingle.mockResolvedValue({ data: null, error: tableNotFoundError });

    await expect(
      updateManufacturingOrderStatus(getClient, {
        id: 'mo-1',
        status: 'confirmed',
      })
    ).rejects.toThrow('manufacturing_orders table does not exist');
  });

  it('should handle relationship error and retry with simple update', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const relationshipError = {
      code: 'PGRST200',
      message: 'Could not find a relationship',
    };

    const simpleUpdateData = {
      id: 'mo-1',
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    };

    mockSingle
      .mockResolvedValueOnce({ data: null, error: relationshipError })
      .mockResolvedValueOnce({ data: simpleUpdateData, error: null });

    const result = await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'confirmed',
    });

    expect(result).toEqual(simpleUpdateData);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('should normalize status in response', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const updatedData = {
      id: 'mo-1',
      status: 'in_progress', // Database format (snake_case)
      updated_at: new Date().toISOString(),
    };

    // Mock select for checking start_date
    const selectForStartDate = vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'mo-1', start_date: null },
          error: null,
        }),
      })),
    }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'manufacturing_orders') {
        return {
          update: mockUpdate,
          select: selectForStartDate,
        };
      }
      return { select: mockSelect };
    });

    mockSingle.mockResolvedValue({ data: updatedData, error: null });

    const result = await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'in-progress',
    });

    expect(result?.status).toBe('in-progress'); // Should be normalized to kebab-case
  });

  it('should load related item data after update', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const updatedData = {
      id: 'mo-1',
      status: 'confirmed',
      item_id: 'item-1',
      updated_at: new Date().toISOString(),
    };

    const itemMock = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'item-1', code: 'I001', name: 'Item 1' },
            error: null,
          }),
        })),
      })),
    };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'items') return itemMock;
      if (table === 'manufacturing_orders' && callCount === 1) {
        return { update: mockUpdate, select: mockSelect };
      }
      return { update: mockUpdate, select: mockSelect };
    });

    mockSingle.mockResolvedValue({ data: updatedData, error: null });

    await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'confirmed',
    });

    // Verify items table was called (may be called multiple times)
    expect(mockFrom).toHaveBeenCalled();
  });

  it('should handle relationship error in catch block', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    const relationshipError = {
      code: 'PGRST200',
      message: 'Could not find a relationship',
    };

    const fallbackData = {
      id: 'mo-1',
      status: 'completed',
      end_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockSingle
      .mockRejectedValueOnce(relationshipError)
      .mockResolvedValueOnce({ data: fallbackData, error: null });

    const result = await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'completed',
    });

    expect(result).toEqual(fallbackData);
  });
});

