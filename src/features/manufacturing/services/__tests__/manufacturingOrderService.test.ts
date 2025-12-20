/**
 * Manufacturing Order Service Tests
 * 
 * Tests for createManufacturingOrder, updateOrderStatus, and getOrderDetails functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Define mock functions that will be used by vi.mock
vi.mock('@/services/supabase-service', () => ({
  manufacturingService: {
    create: vi.fn(),
    updateStatus: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks
import { createManufacturingOrder, updateOrderStatus, getOrderDetails } from '../manufacturingOrderService';
import { manufacturingService } from '@/services/supabase-service';
import { getEffectiveTenantId } from '@/lib/supabase';
import { toast } from 'sonner';

// Get typed mocks
const mockCreate = vi.mocked(manufacturingService.create);
const mockUpdateStatus = vi.mocked(manufacturingService.updateStatus);
const mockGetById = vi.mocked(manufacturingService.getById);
const mockGetEffectiveTenantId = vi.mocked(getEffectiveTenantId);
const mockToast = vi.mocked(toast);

describe('Manufacturing Order Service', () => {
  // Mock translation function
  const mockT = vi.fn((key: string) => key);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveTenantId.mockResolvedValue('org-123');
  });

  describe('createManufacturingOrder', () => {
    const validOrderData = {
      orderNumber: 'MO-001',
      productId: 'product-123',
      quantity: '100',
      status: 'draft' as const,
      startDate: '2025-01-01',
      dueDate: '2025-01-15',
      notes: 'Test order',
    };

    it('should create order successfully with valid data', async () => {
      mockCreate.mockResolvedValue({ id: 'new-order-id' });

      const result = await createManufacturingOrder(validOrderData, mockT);

      expect(result).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: 'org-123',
          order_number: 'MO-001',
          product_id: 'product-123',
          quantity: 100,
          status: 'draft',
        })
      );
      expect(mockToast.success).toHaveBeenCalledWith('manufacturing.ordersPage.form.createSuccess');
    });

    it('should fail when productId is missing', async () => {
      const dataWithoutProduct = { ...validOrderData, productId: '' };

      const result = await createManufacturingOrder(dataWithoutProduct, mockT);

      expect(result).toBe(false);
      expect(mockToast.error).toHaveBeenCalledWith('manufacturing.ordersPage.form.productRequired');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should fail when orgId is not available', async () => {
      mockGetEffectiveTenantId.mockResolvedValue(null);

      const result = await createManufacturingOrder(validOrderData, mockT);

      expect(result).toBe(false);
      expect(mockToast.error).toHaveBeenCalledWith('manufacturing.ordersPage.form.missingOrg');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should generate order number when not provided', async () => {
      const dataWithoutOrderNumber = { ...validOrderData, orderNumber: '' };
      mockCreate.mockResolvedValue({ id: 'new-order-id' });

      await createManufacturingOrder(dataWithoutOrderNumber, mockT);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          order_number: expect.stringMatching(/^MO-\d+$/),
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API Error'));

      const result = await createManufacturingOrder(validOrderData, mockT);

      expect(result).toBe(false);
      expect(mockToast.error).toHaveBeenCalledWith('manufacturing.ordersPage.form.createError');
    });

    it('should convert quantity string to number', async () => {
      const dataWithStringQty = { ...validOrderData, quantity: '500' };
      mockCreate.mockResolvedValue({ id: 'new-order-id' });

      await createManufacturingOrder(dataWithStringQty, mockT);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 500,
        })
      );
    });

    it('should handle empty quantity as 0', async () => {
      const dataWithEmptyQty = { ...validOrderData, quantity: '' };
      mockCreate.mockResolvedValue({ id: 'new-order-id' });

      await createManufacturingOrder(dataWithEmptyQty, mockT);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 0,
        })
      );
    });

    it('should handle null dates correctly', async () => {
      const dataWithNoDates = { ...validOrderData, startDate: '', dueDate: '' };
      mockCreate.mockResolvedValue({ id: 'new-order-id' });

      await createManufacturingOrder(dataWithNoDates, mockT);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          start_date: null,
          due_date: null,
        })
      );
    });

    it('should trim order number whitespace', async () => {
      const dataWithWhitespace = { ...validOrderData, orderNumber: '  MO-001  ' };
      mockCreate.mockResolvedValue({ id: 'new-order-id' });

      await createManufacturingOrder(dataWithWhitespace, mockT);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          order_number: 'MO-001',
        })
      );
    });
  });

  describe('updateOrderStatus', () => {
    const mockUpdateData = { completed_at: new Date().toISOString() };

    it('should update status successfully', async () => {
      mockUpdateStatus.mockResolvedValue({ id: 'order-1', status: 'in_progress' });

      const result = await updateOrderStatus(
        'order-1',
        'in_progress',
        { value: 'draft' } as any,
        { value: 'in_progress' } as any,
        mockUpdateData,
        false
      );

      expect(result).toBe(true);
      expect(mockUpdateStatus).toHaveBeenCalledWith('order-1', 'in_progress', mockUpdateData);
    });

    it('should return true when status is same (no change needed)', async () => {
      const sameStatus = { value: 'draft' } as any;

      const result = await updateOrderStatus(
        'order-1',
        'draft',
        sameStatus,
        sameStatus,
        mockUpdateData,
        false
      );

      expect(result).toBe(true);
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it('should handle API errors with English message', async () => {
      mockUpdateStatus.mockRejectedValue(new Error('Status transition not allowed'));

      const result = await updateOrderStatus(
        'order-1',
        'completed',
        { value: 'draft' } as any,
        { value: 'completed' } as any,
        mockUpdateData,
        false
      );

      expect(result).toBe(false);
      expect(mockToast.error).toHaveBeenCalledWith('Status transition not allowed');
    });

    it('should handle API errors with Arabic message when RTL', async () => {
      mockUpdateStatus.mockRejectedValue(new Error());

      const result = await updateOrderStatus(
        'order-1',
        'completed',
        { value: 'draft' } as any,
        { value: 'completed' } as any,
        mockUpdateData,
        true
      );

      expect(result).toBe(false);
      expect(mockToast.error).toHaveBeenCalledWith('فشل تحديث الحالة');
    });

    it('should handle API errors with English fallback when not RTL', async () => {
      mockUpdateStatus.mockRejectedValue(new Error());

      const result = await updateOrderStatus(
        'order-1',
        'completed',
        { value: 'draft' } as any,
        { value: 'completed' } as any,
        mockUpdateData,
        false
      );

      expect(result).toBe(false);
      expect(mockToast.error).toHaveBeenCalledWith('Failed to update status');
    });

    it('should pass update data to service', async () => {
      mockUpdateStatus.mockResolvedValue({ id: 'order-1' });
      const customData = { completed_at: '2025-01-01', notes: 'Completed' };

      await updateOrderStatus(
        'order-1',
        'completed',
        { value: 'in_progress' } as any,
        { value: 'completed' } as any,
        customData,
        false
      );

      expect(mockUpdateStatus).toHaveBeenCalledWith('order-1', 'completed', customData);
    });
  });

  describe('getOrderDetails', () => {
    const mockOrder = {
      id: 'order-1',
      order_number: 'MO-001',
      product_id: 'product-123',
      quantity: 100,
      status: 'draft',
      start_date: '2025-01-01',
      due_date: '2025-01-15',
    };

    it('should return order details successfully', async () => {
      mockGetById.mockResolvedValue(mockOrder);

      const result = await getOrderDetails('order-1');

      expect(result).toEqual(mockOrder);
      expect(mockGetById).toHaveBeenCalledWith('order-1');
    });

    it('should return null when order not found', async () => {
      mockGetById.mockResolvedValue(null);

      const result = await getOrderDetails('non-existent');

      expect(result).toBeNull();
    });

    it('should throw error on API failure', async () => {
      mockGetById.mockRejectedValue(new Error('Database error'));

      await expect(getOrderDetails('order-1')).rejects.toThrow('Database error');
    });

    it('should call getById with correct orderId', async () => {
      mockGetById.mockResolvedValue(mockOrder);

      await getOrderDetails('specific-order-id');

      expect(mockGetById).toHaveBeenCalledWith('specific-order-id');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined orgId gracefully', async () => {
      mockGetEffectiveTenantId.mockResolvedValue(undefined);

      const result = await createManufacturingOrder({
        orderNumber: 'MO-001',
        productId: 'product-123',
        quantity: '100',
        status: 'draft' as const,
        startDate: '',
        dueDate: '',
        notes: '',
      }, mockT);

      expect(result).toBe(false);
    });

    it('should handle non-numeric quantity', async () => {
      mockCreate.mockResolvedValue({ id: 'new-order-id' });

      await createManufacturingOrder({
        orderNumber: 'MO-001',
        productId: 'product-123',
        quantity: 'abc', // Invalid number
        status: 'draft' as const,
        startDate: '',
        dueDate: '',
        notes: '',
      }, mockT);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 0, // NaN becomes 0
        })
      );
    });

    it('should handle concurrent order creation', async () => {
      mockCreate.mockResolvedValue({ id: 'order-1' });

      const promises = [
        createManufacturingOrder({
          orderNumber: '',
          productId: 'product-1',
          quantity: '10',
          status: 'draft' as const,
          startDate: '',
          dueDate: '',
          notes: '',
        }, mockT),
        createManufacturingOrder({
          orderNumber: '',
          productId: 'product-2',
          quantity: '20',
          status: 'draft' as const,
          startDate: '',
          dueDate: '',
          notes: '',
        }, mockT),
      ];

      const results = await Promise.all(promises);
      expect(results).toEqual([true, true]);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });
});
