import i18next from 'i18next';
import type { ManufacturingOrder } from '@/lib/supabase';
import {
  getStatusInfo,
  getValidNextStatuses,
  isValidStatusTransition,
  prepareStatusChange,
  type ManufacturingOrderStatus
} from '@/utils/manufacturing-order-status';

export function getStatusLabel(status: ManufacturingOrder['status'], isRTL: boolean): string {
  const info = getStatusInfo(status as ManufacturingOrderStatus);
  return isRTL ? info.labelAr : info.label;
}

export function getStatusBadgeVariant(status: ManufacturingOrder['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  const info = getStatusInfo(status as ManufacturingOrderStatus);
  return info.variant;
}

export function getStatusOptions(currentStatus: ManufacturingOrder['status']): ManufacturingOrder['status'][] {
  const validNext = getValidNextStatuses(currentStatus as ManufacturingOrderStatus);
  return [currentStatus, ...validNext];
}

export function validateStatusTransition(
  currentStatus: ManufacturingOrderStatus,
  targetStatus: ManufacturingOrderStatus
): { valid: boolean; message?: string } {
  if (targetStatus === currentStatus) {
    return { valid: true };
  }

  if (!isValidStatusTransition(currentStatus, targetStatus)) {
    const currentInfo = getStatusInfo(currentStatus);
    const targetInfo = getStatusInfo(targetStatus);
    const isAr = i18next.language === 'ar';
    return {
      valid: false,
      message: i18next.t('manufacturing.manufacturingOrders.invalidTransition', {
        from: isAr ? currentInfo.labelAr : currentInfo.label,
        to:   isAr ? targetInfo.labelAr  : targetInfo.label
      })
    };
  }

  return { valid: true };
}

export function prepareStatusUpdate(
  orderId: string,
  currentStatus: ManufacturingOrderStatus,
  targetStatus: ManufacturingOrderStatus,
  orderData: any
): { success: boolean; updateData?: any; message?: string; messageAr?: string } {
  const changeResult = prepareStatusChange({
    orderId,
    fromStatus: currentStatus,
    toStatus: targetStatus,
    orderData
  });

  if (!changeResult.success) {
    return changeResult;
  }

  const updateData: any = { status: targetStatus };
  if (changeResult.shouldUpdateDates) {
    if (changeResult.startDate) {
      updateData.start_date = changeResult.startDate;
    }
    if (changeResult.endDate) {
      updateData.end_date = changeResult.endDate;
    }
  }

  return {
    success: true,
    updateData,
    message: changeResult.message,
    messageAr: changeResult.messageAr
  };
}

