/**
 * Manufacturing Order Status Management
 * Handles status transitions, validations, and business logic
 */

export type ManufacturingOrderStatus = 
  | 'draft'           // مسودة - تم الإنشاء ولكن لم يتم التأكيد
  | 'pending'         // في الانتظار - تم التأكيد ولكن لم يبدأ التنفيذ
  | 'confirmed'       // مؤكد - جاهز للبدء (مرادف لـ pending)
  | 'in-progress'     // قيد التنفيذ - بدأ الإنتاج
  | 'completed'       // مكتمل - انتهى الإنتاج
  | 'cancelled'       // ملغي - تم إلغاء الأمر
  | 'on-hold'        // متوقف - مؤقتاً متوقف
  | 'quality-check'  // فحص الجودة - في مرحلة الفحص

/**
 * Status workflow definition
 * Each status can transition to specific other statuses
 */
export const STATUS_WORKFLOW: Record<ManufacturingOrderStatus, ManufacturingOrderStatus[]> = {
  'draft': ['confirmed', 'pending', 'cancelled'],
  'pending': ['in-progress', 'confirmed', 'cancelled', 'on-hold'],
  'confirmed': ['in-progress', 'pending', 'cancelled', 'on-hold'],
  'in-progress': ['completed', 'quality-check', 'on-hold', 'cancelled'],
  'quality-check': ['completed', 'in-progress', 'on-hold'],
  'on-hold': ['in-progress', 'pending', 'cancelled'],
  'completed': [], // لا يمكن الانتقال من completed
  'cancelled': [] // لا يمكن الانتقال من cancelled
}

/**
 * Get valid next statuses for a given status
 */
export function getValidNextStatuses(currentStatus: ManufacturingOrderStatus): ManufacturingOrderStatus[] {
  return STATUS_WORKFLOW[currentStatus] || []
}

/**
 * Check if status transition is valid
 */
export function isValidStatusTransition(
  from: ManufacturingOrderStatus,
  to: ManufacturingOrderStatus
): boolean {
  return STATUS_WORKFLOW[from]?.includes(to) ?? false
}

/**
 * Status display information
 */
export interface StatusInfo {
  label: string
  labelAr: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  icon?: string
  description: string
  descriptionAr: string
}

export const STATUS_INFO: Record<ManufacturingOrderStatus, StatusInfo> = {
  'draft': {
    label: 'Draft',
    labelAr: 'مسودة',
    variant: 'outline',
    description: 'Order created but not confirmed',
    descriptionAr: 'تم إنشاء الأمر ولكن لم يتم التأكيد'
  },
  'pending': {
    label: 'Pending',
    labelAr: 'في الانتظار',
    variant: 'secondary',
    description: 'Confirmed and waiting to start',
    descriptionAr: 'تم التأكيد وفي انتظار البدء'
  },
  'confirmed': {
    label: 'Confirmed',
    labelAr: 'مؤكد',
    variant: 'secondary',
    description: 'Order confirmed and ready to start',
    descriptionAr: 'تم تأكيد الأمر وجاهز للبدء'
  },
  'in-progress': {
    label: 'In Progress',
    labelAr: 'قيد التنفيذ',
    variant: 'default',
    description: 'Production has started',
    descriptionAr: 'بدأ الإنتاج'
  },
  'quality-check': {
    label: 'Quality Check',
    labelAr: 'فحص الجودة',
    variant: 'secondary',
    description: 'Under quality inspection',
    descriptionAr: 'قيد فحص الجودة'
  },
  'on-hold': {
    label: 'On Hold',
    labelAr: 'متوقف',
    variant: 'outline',
    description: 'Temporarily paused',
    descriptionAr: 'متوقف مؤقتاً'
  },
  'completed': {
    label: 'Completed',
    labelAr: 'مكتمل',
    variant: 'default',
    description: 'Production completed',
    descriptionAr: 'اكتمل الإنتاج'
  },
  'cancelled': {
    label: 'Cancelled',
    labelAr: 'ملغي',
    variant: 'destructive',
    description: 'Order has been cancelled',
    descriptionAr: 'تم إلغاء الأمر'
  }
}

/**
 * Get status info
 */
export function getStatusInfo(status: ManufacturingOrderStatus): StatusInfo {
  return STATUS_INFO[status] || STATUS_INFO['draft']
}

/**
 * Business logic for status changes
 */
export interface StatusChangeContext {
  orderId: string
  fromStatus: ManufacturingOrderStatus
  toStatus: ManufacturingOrderStatus
  orderData?: {
    quantity?: number
    start_date?: string
    due_date?: string
  }
}

export interface StatusChangeResult {
  success: boolean
  shouldUpdateDates?: boolean
  startDate?: string
  endDate?: string
  message?: string
  messageAr?: string
}

/**
 * Validate and prepare status change
 */
export function prepareStatusChange(context: StatusChangeContext): StatusChangeResult {
  const { fromStatus, toStatus, orderData } = context

  // Check if transition is valid
  if (!isValidStatusTransition(fromStatus, toStatus)) {
    return {
      success: false,
      message: `Invalid status transition from ${fromStatus} to ${toStatus}`,
      messageAr: `انتقال غير صحيح من ${STATUS_INFO[fromStatus].labelAr} إلى ${STATUS_INFO[toStatus].labelAr}`
    }
  }

  const result: StatusChangeResult = {
    success: true,
    shouldUpdateDates: false
  }

  // Business logic for specific transitions
  switch (toStatus) {
    case 'in-progress':
      // When starting production, set start_date if not set
      if (!orderData?.start_date) {
        result.shouldUpdateDates = true
        result.startDate = new Date().toISOString()
      }
      result.message = 'Production started'
      result.messageAr = 'بدأ الإنتاج'
      break

    case 'completed':
      // When completing, set end_date
      result.shouldUpdateDates = true
      result.endDate = new Date().toISOString()
      result.message = 'Production completed'
      result.messageAr = 'اكتمل الإنتاج'
      break

    case 'cancelled':
      result.message = 'Order cancelled'
      result.messageAr = 'تم إلغاء الأمر'
      break

    case 'on-hold':
      result.message = 'Order put on hold'
      result.messageAr = 'تم إيقاف الأمر مؤقتاً'
      break

    case 'quality-check':
      result.message = 'Order sent for quality check'
      result.messageAr = 'تم إرسال الأمر لفحص الجودة'
      break

    default:
      result.message = 'Status updated'
      result.messageAr = 'تم تحديث الحالة'
  }

  return result
}

/**
 * Get status priority for sorting
 */
export function getStatusPriority(status: ManufacturingOrderStatus): number {
  const priorities: Record<ManufacturingOrderStatus, number> = {
    'in-progress': 1,
    'quality-check': 2,
    'pending': 3,
    'confirmed': 3,
    'on-hold': 4,
    'draft': 5,
    'completed': 6,
    'cancelled': 7
  }
  return priorities[status] || 99
}

/**
 * Check if order can be edited
 */
export function canEditOrder(status: ManufacturingOrderStatus): boolean {
  return ['draft', 'pending', 'confirmed', 'on-hold'].includes(status)
}

/**
 * Check if order can be cancelled
 */
export function canCancelOrder(status: ManufacturingOrderStatus): boolean {
  return !['completed', 'cancelled'].includes(status)
}

/**
 * Check if order is active (in production)
 * Includes: in-progress, confirmed (ready to start), and quality-check
 */
export function isActiveOrder(status: ManufacturingOrderStatus): boolean {
  return ['in-progress', 'confirmed', 'quality-check'].includes(status)
}

/**
 * Check if order is completed
 */
export function isCompletedOrder(status: ManufacturingOrderStatus): boolean {
  return status === 'completed'
}

/**
 * Check if order is pending (draft - not yet confirmed)
 * Note: 'pending' and 'confirmed' are considered active, not pending
 */
export function isPendingOrder(status: ManufacturingOrderStatus): boolean {
  return status === 'draft'
}

