/**
 * Audit Log Types
 * 
 * Type definitions for audit logging system
 */

/**
 * Audit action types
 */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'view'
  | 'export'
  | 'login'
  | 'logout'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'complete'
  | 'start'
  | 'stop'
  | 'import'
  | 'backup'
  | 'restore'
  | 'permission_change'
  | 'role_assignment'
  | 'role_removal'
  | 'settings_change';

/**
 * Entity types that can be audited
 */
export type AuditEntityType =
  | 'manufacturing_order'
  | 'manufacturing_stage'
  | 'inventory_item'
  | 'stock_move'
  | 'gl_account'
  | 'journal_entry'
  | 'sales_order'
  | 'purchase_order'
  | 'customer'
  | 'supplier'
  | 'user'
  | 'role'
  | 'permission'
  | 'organization'
  | 'work_center'
  | 'overhead_rate'
  | 'labor_entry'
  | 'cost_calculation'
  | 'report'
  | 'settings';

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id?: string;
  org_id: string;
  user_id: string;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  old_data?: Record<string, any> | null;
  new_data?: Record<string, any> | null;
  changes?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  ip_address?: string | null;
  user_agent?: string | null;
  session_id?: string | null;
  geolocation?: {
    country?: string;
    city?: string;
  } | null;
  changed_fields?: {
    before?: any;
    after?: any;
  } | null;
  created_at?: string;
}

/**
 * Audit log filter options
 */
export interface AuditLogFilter {
  org_id?: string;
  user_id?: string;
  action?: AuditAction | AuditAction[];
  entity_type?: AuditEntityType | AuditEntityType[];
  entity_id?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

/**
 * Audit log query result
 */
export interface AuditLogResult {
  data: AuditLogEntry[];
  count: number;
  has_more: boolean;
}

/**
 * Audit context for logging
 */
export interface AuditContext {
  user_id: string;
  org_id: string;
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  geolocation?: {
    country?: string;
    city?: string;
  };
  metadata?: Record<string, any>;
}

/**
 * Audit log creation input
 */
export interface CreateAuditLogInput {
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id?: string | null;
  old_data?: Record<string, any> | null;
  new_data?: Record<string, any> | null;
  changes?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  context?: Partial<AuditContext>;
}

