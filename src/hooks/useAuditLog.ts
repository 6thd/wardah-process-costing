/**
 * useAuditLog Hook
 * 
 * React hook for audit logging in components
 */

import { useCallback } from 'react';
import { auditLogger } from '../lib/audit/AuditLogger';
import type {
  AuditAction,
  AuditEntityType,
  CreateAuditLogInput,
  AuditLogFilter,
  AuditLogResult,
} from '../lib/audit/audit-types';

/**
 * Hook for audit logging
 */
export function useAuditLog() {
  /**
   * Log an audit event
   */
  const log = useCallback(async (input: CreateAuditLogInput) => {
    try {
      return await auditLogger.log(input);
    } catch (error) {
      console.error('Audit logging failed:', error);
      // Don't throw - audit logging should not break the app
      return null;
    }
  }, []);

  /**
   * Log creation
   */
  const logCreate = useCallback(async (
    entity_type: AuditEntityType,
    entity_id: string,
    new_data: Record<string, any>,
    metadata?: Record<string, any>
  ) => {
    await auditLogger.logCreate(entity_type, entity_id, new_data, metadata);
  }, []);

  /**
   * Log update
   */
  const logUpdate = useCallback(async (
    entity_type: AuditEntityType,
    entity_id: string,
    old_data: Record<string, any>,
    new_data: Record<string, any>,
    metadata?: Record<string, any>
  ) => {
    await auditLogger.logUpdate(entity_type, entity_id, old_data, new_data, metadata);
  }, []);

  /**
   * Log deletion
   */
  const logDelete = useCallback(async (
    entity_type: AuditEntityType,
    entity_id: string,
    old_data: Record<string, any>,
    metadata?: Record<string, any>
  ) => {
    await auditLogger.logDelete(entity_type, entity_id, old_data, metadata);
  }, []);

  /**
   * Log view (for sensitive data)
   */
  const logView = useCallback(async (
    entity_type: AuditEntityType,
    entity_id: string,
    metadata?: Record<string, any>
  ) => {
    await auditLogger.logView(entity_type, entity_id, metadata);
  }, []);

  /**
   * Log export
   */
  const logExport = useCallback(async (
    entity_type: AuditEntityType,
    filters?: Record<string, any>,
    metadata?: Record<string, any>
  ) => {
    await auditLogger.logExport(entity_type, filters, metadata);
  }, []);

  /**
   * Query audit logs
   */
  const queryLogs = useCallback(async (filter: AuditLogFilter): Promise<AuditLogResult> => {
    return await auditLogger.query(filter);
  }, []);

  return {
    log,
    logCreate,
    logUpdate,
    logDelete,
    logView,
    logExport,
    queryLogs,
  };
}

export default useAuditLog;

