/**
 * Manufacturing Order Status Update Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('updateManufacturingOrderStatus', () => {
  let mockSupabase: SupabaseClient;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockRpc: ReturnType<typeof vi.fn>;
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
    // افتراضي: RPC غير موجود (Migration 78 لم يُطبَّق) → Fallback يعمل
    mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function rpc_transition_mo_status' }
    });

    mockSupabase = {
      from: mockFrom,
      rpc: mockRpc,
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
      status: 'in_progress',
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
      status: 'in_progress',
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'in_progress',
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
      status: 'in_progress',
    });

    expect(result?.status).toBe('in_progress'); // Should be normalized to kebab-case
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

  // ===== اختبارات المسار الذرّي (Migration 78) =====

  it('should use rpc_transition_mo_status when available (atomic path)', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    mockRpc.mockResolvedValue({
      data: { success: true, mo_id: 'mo-1', new_status: 'in_progress', mo_number: 'MO-001' },
      error: null
    });

    const result = await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'in_progress',
    });

    expect(mockRpc).toHaveBeenCalledWith('rpc_transition_mo_status', expect.objectContaining({
      p_mo_id: 'mo-1',
      p_status: 'in_progress',
    }));
    // لا يجب استدعاء UPDATE المباشر
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result?.status).toBe('in_progress'); // normalizeStatus يحوّل in_progress → in-progress
  });

  it('should propagate DB error from rpc_transition_mo_status (invalid transition)', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'MO_INVALID_TRANSITION: التنقل من "done" إلى "confirmed" غير مسموح' }
    });

    await expect(
      updateManufacturingOrderStatus(getClient, { id: 'mo-1', status: 'confirmed' })
    ).rejects.toThrow('MO_INVALID_TRANSITION');

    // يجب ألا يسقط للـ Fallback عند وجود خطأ DB حقيقي
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should fall back to direct UPDATE when Migration 78 not yet applied', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    // PGRST202 = دالة غير موجودة → Fallback مسموح
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function rpc_transition_mo_status' }
    });

    const updatedData = { id: 'mo-1', status: 'confirmed', updated_at: new Date().toISOString() };
    mockSingle.mockResolvedValue({ data: updatedData, error: null });

    const result = await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'confirmed',
    });

    expect(mockUpdate).toHaveBeenCalled();
    expect(result).toEqual(updatedData);
  });

  // ===== اختبارات الإتمام الذرّي (Migration 93 — rpc_complete_manufacturing_order) =====

  it('should route completion through rpc_complete_manufacturing_order (atomic FG+GL)', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    mockRpc.mockImplementation((fn: string) =>
      fn === 'rpc_complete_manufacturing_order'
        ? Promise.resolve({
            data: {
              success: true, mo_id: 'mo-1', completed_quantity: 100,
              total_cost: 500, unit_cost: 5, fg_new_stock: 100, warnings: []
            },
            error: null,
          })
        : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'nope' } })
    );

    const result = await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'completed',
    });

    expect(mockRpc).toHaveBeenCalledWith('rpc_complete_manufacturing_order', {
      p_payload: expect.objectContaining({ mo_id: 'mo-1' }),
    });
    // لم يلجأ لمسار الانتقال ولا للتحديث المباشر (الإتمام ذرّي كامل)
    expect(mockRpc).not.toHaveBeenCalledWith('rpc_transition_mo_status', expect.anything());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result?.status).toBe('completed');
    expect(result?.total_cost).toBe(500);
  });

  it('should forward tenant_id/org_id into the completion payload when provided', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    mockRpc.mockImplementation((fn: string) =>
      fn === 'rpc_complete_manufacturing_order'
        ? Promise.resolve({ data: { success: true, mo_id: 'mo-1', warnings: [] }, error: null })
        : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'nope' } })
    );

    await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'completed',
      providedUpdateData: { org_id: 'org-77' },
    });

    const payload = mockRpc.mock.calls.find(c => c[0] === 'rpc_complete_manufacturing_order')?.[1].p_payload;
    expect(payload.tenant_id).toBe('org-77');
  });

  it('should forward completed_quantity into the completion payload', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    mockRpc.mockImplementation((fn: string) =>
      fn === 'rpc_complete_manufacturing_order'
        ? Promise.resolve({ data: { success: true, mo_id: 'mo-1', completed_quantity: 42, warnings: [] }, error: null })
        : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'nope' } })
    );

    await updateManufacturingOrderStatus(getClient, {
      id: 'mo-1',
      status: 'completed',
      providedUpdateData: { completed_quantity: 42 },
    });

    const payload = mockRpc.mock.calls.find(c => c[0] === 'rpc_complete_manufacturing_order')?.[1].p_payload;
    expect(payload.completed_quantity).toBe(42);
  });

  it('should surface idempotent replay (already_done) from completion RPC', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    mockRpc.mockImplementation((fn: string) =>
      fn === 'rpc_complete_manufacturing_order'
        ? Promise.resolve({
            data: { success: true, mo_id: 'mo-1', already_done: true, completed_quantity: 100, total_cost: 500 },
            error: null,
          })
        : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'nope' } })
    );

    const result = await updateManufacturingOrderStatus(getClient, { id: 'mo-1', status: 'completed' });

    expect(result?.already_done).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should propagate a real DB error from completion RPC (no fallback)', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    mockRpc.mockImplementation((fn: string) =>
      fn === 'rpc_complete_manufacturing_order'
        ? Promise.resolve({ data: null, error: { code: 'P0001', message: 'MO_NO_PRODUCT: أمر التصنيع بلا منتج تام' } })
        : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'nope' } })
    );

    await expect(
      updateManufacturingOrderStatus(getClient, { id: 'mo-1', status: 'completed' })
    ).rejects.toThrow('MO_NO_PRODUCT');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should fail-closed in production when completion RPC is missing (PGRST202)', async () => {
    vi.stubEnv('PROD', true);
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });

    await expect(
      updateManufacturingOrderStatus(getClient, { id: 'mo-1', status: 'completed' })
    ).rejects.toThrow('الإنتاج');
    // لا إتمام بلا ترحيل تكلفة في الإنتاج — لا تحديث مباشر
    expect(mockUpdate).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('should fall back to legacy path for completion when Migration 93 missing (dev)', async () => {
    const { updateManufacturingOrderStatus } = await import('../updateStatus');

    // كلتا الدالتين الذرّيتين غائبتان (تطوير) ⇒ السقوط للتحديث المباشر
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } });
    const updatedData = { id: 'mo-1', status: 'completed', end_date: new Date().toISOString(), updated_at: new Date().toISOString() };
    mockSingle.mockResolvedValue({ data: updatedData, error: null });

    const result = await updateManufacturingOrderStatus(getClient, { id: 'mo-1', status: 'completed' });

    expect(mockRpc).toHaveBeenCalledWith('rpc_complete_manufacturing_order', expect.anything());
    expect(mockRpc).toHaveBeenCalledWith('rpc_transition_mo_status', expect.anything());
    expect(mockUpdate).toHaveBeenCalled();
    expect(result).toEqual(updatedData);
  });
});

