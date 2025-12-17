import { manufacturingService } from '@/services/supabase-service';
import { getEffectiveTenantId, type ManufacturingOrder } from '@/lib/supabase';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { ManufacturingOrderStatus } from '@/utils/manufacturing-order-status';

interface CreateOrderData {
  orderNumber: string;
  productId: string;
  quantity: string;
  status: ManufacturingOrder['status'];
  startDate: string;
  dueDate: string;
  notes: string;
}

export async function createManufacturingOrder(data: CreateOrderData, t: any): Promise<boolean> {
  try {
    if (!data.productId) {
      toast.error(t('manufacturing.ordersPage.form.productRequired'));
      return false;
    }

    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      toast.error(t('manufacturing.ordersPage.form.missingOrg'));
      return false;
    }

    await manufacturingService.create({
      org_id: orgId,
      order_number: data.orderNumber.trim() || `MO-${Date.now()}`,
      product_id: data.productId,
      item_id: data.productId,
      quantity: Number(data.quantity) || 0,
      status: data.status,
      start_date: data.startDate || null,
      due_date: data.dueDate || null,
      notes: data.notes || null
    } as any);

    toast.success(t('manufacturing.ordersPage.form.createSuccess'));
    return true;
  } catch (error) {
    console.error(error);
    toast.error(t('manufacturing.ordersPage.form.createError'));
    return false;
  }
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: ManufacturingOrder['status'],
  currentStatus: ManufacturingOrderStatus,
  targetStatus: ManufacturingOrderStatus,
  updateData: any,
  isRTL: boolean
): Promise<boolean> {
  try {
    if (targetStatus === currentStatus) {
      return true;
    }

    await manufacturingService.updateStatus(orderId, newStatus, updateData);
    return true;
  } catch (error: any) {
    console.error('Error changing status:', error);
    toast.error(error.message || (isRTL ? 'فشل تحديث الحالة' : 'Failed to update status'));
    return false;
  }
}

export async function getOrderDetails(orderId: string): Promise<ManufacturingOrder | null> {
  try {
    const order = await manufacturingService.getById(orderId);
    return order as ManufacturingOrder | null;
  } catch (error: any) {
    console.error('Error loading order details:', error);
    throw error;
  }
}

