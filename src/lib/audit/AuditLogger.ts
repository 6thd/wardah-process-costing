/**
 * Audit Logger Service
 * 
 * Centralized service for logging all audit events in the system.
 * Ensures all critical operations are logged for compliance and security.
 */

import { supabase, getEffectiveTenantId } from '../supabase';
import type {
  AuditLogEntry,
  AuditLogFilter,
  AuditLogResult,
  CreateAuditLogInput,
  AuditEntityType,
} from './audit-types';

/**
 * Audit Logger class
 */
class AuditLogger {
  /**
   * Get current user context
   */
  private async getContext(): Promise<{
    user_id: string;
    org_id: string;
    ip_address?: string;
    user_agent?: string;
    session_id?: string;
  }> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('User not authenticated');
    }

    const org_id = await getEffectiveTenantId();
    if (!org_id) {
      throw new Error('Organization ID not found');
    }

    // Get IP address, user agent, and session ID
    const ip_address = typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined'
      ? await this.getClientIP()
      : undefined;
    
    const user_agent = this.getUserAgent();
    const session_id = this.getSessionId();

    return {
      user_id: user.id,
      org_id,
      ip_address,
      user_agent,
      session_id,
    };
  }

  /**
   * Get client IP address (if available)
   */
  private async getClientIP(): Promise<string | undefined> {
    try {
      // In browser context, try to get from request headers if available
      if (typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined') {
        // For client-side, we can use a service or get from request context
        // In production with server-side rendering, this should come from request headers
        try {
          const response = await fetch('https://api.ipify.org?format=json');
          const data = await response.json();
          return data.ip;
        } catch {
          // Fallback: return undefined if service unavailable
          return undefined;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get user agent from browser
   */
  private getUserAgent(): string | undefined {
    if (typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined') {
      return globalThis.window.navigator.userAgent;
    }
    return undefined;
  }

  /**
   * Get session ID (if available)
   */
  private getSessionId(): string | undefined {
    // In a real implementation, this would come from session storage or cookies
    // For now, we'll use a simple approach
    if (typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined') {
      try {
        // Try to get from sessionStorage or generate a session ID
        let sessionId = globalThis.window.sessionStorage.getItem('session_id');
        if (!sessionId) {
          // Use crypto API for secure session ID
          if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            sessionId = `session_${crypto.randomUUID()}`;
          } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const array = new Uint8Array(9);
            crypto.getRandomValues(array);
            const random = Array.from(array, byte => byte.toString(36)).join('').slice(0, 9);
            sessionId = `session_${Date.now()}_${random}`;
          } else {
            // Fallback - Use timestamp only (not secure, but better than Math.random)
            sessionId = `session_${Date.now()}_${performance.now()}`;
          }
            globalThis.window.sessionStorage.setItem('session_id', sessionId);
        }
        return sessionId;
      } catch {
        // If storage is not available, return undefined
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Create audit log entry
   */
  async log(input: CreateAuditLogInput): Promise<AuditLogEntry> {
    try {
      const context = await this.getContext();
      
      // Merge context with input context
      const finalContext = {
        ...context,
        ...input.context,
      };

      const auditEntry: Omit<AuditLogEntry, 'id' | 'created_at'> = {
        org_id: finalContext.org_id,
        user_id: finalContext.user_id,
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id || null,
        old_data: input.old_data || null,
        new_data: input.new_data || null,
        changes: input.changes || null,
        metadata: {
          ...input.metadata,
          ip_address: finalContext.ip_address,
          user_agent: finalContext.user_agent,
          session_id: finalContext.session_id,
        },
      };

      const { data, error } = await supabase
        .from('audit_logs')
        .insert(auditEntry)
        .select()
        .single();

      if (error) {
        console.error('Failed to create audit log:', error);
        throw error;
      }

      return data as AuditLogEntry;
    } catch (error) {
      // Don't fail the operation if audit logging fails
      console.error('Audit logging error:', error);
      
      // In production, you might want to send this to an error tracking service
      // but don't throw - audit logging should never break the main operation
      
      // Return a minimal entry for error cases
      return {
        org_id: '',
        user_id: '',
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id || null,
      } as AuditLogEntry;
    }
  }

  /**
   * Log user login
   */
  async logLogin(metadata?: Record<string, any>): Promise<void> {
    const context = await this.getContext();
    
    await this.log({
      action: 'login',
      entity_type: 'user',
      entity_id: context.user_id,
      metadata: {
        ...metadata,
        login_time: new Date().toISOString(),
      },
    });
  }

  /**
   * Log user logout
   */
  async logLogout(metadata?: Record<string, any>): Promise<void> {
    try {
      const context = await this.getContext();
      
      await this.log({
        action: 'logout',
        entity_type: 'user',
        entity_id: context.user_id,
        metadata: {
          ...metadata,
          logout_time: new Date().toISOString(),
        },
      });
    } catch (error) {
      // Don't fail logout if audit logging fails
      console.error('Failed to log logout:', error);
    }
  }

  /**
   * Log data creation
   */
  async logCreate(
    entity_type: AuditEntityType,
    entity_id: string,
    new_data: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'create',
      entity_type,
      entity_id,
      new_data,
      metadata,
    });
  }

  /**
   * Log data update
   */
  async logUpdate(
    entity_type: AuditEntityType,
    entity_id: string,
    old_data: Record<string, any>,
    new_data: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Calculate changes
    const changes = this.calculateChanges(old_data, new_data);

    await this.log({
      action: 'update',
      entity_type,
      entity_id,
      old_data,
      new_data,
      changes,
      metadata,
    });
  }

  /**
   * Log data deletion
   */
  async logDelete(
    entity_type: AuditEntityType,
    entity_id: string,
    old_data: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'delete',
      entity_type,
      entity_id,
      old_data,
      metadata,
    });
  }

  /**
   * Log data view (for sensitive data)
   */
  async logView(
    entity_type: AuditEntityType,
    entity_id: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'view',
      entity_type,
      entity_id,
      metadata,
    });
  }

  /**
   * Log data export
   */
  async logExport(
    entity_type: AuditEntityType,
    filters?: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'export',
      entity_type,
      entity_id: null,
      metadata: {
        ...metadata,
        export_filters: filters,
        export_time: new Date().toISOString(),
      },
    });
  }

  /**
   * Calculate changes between old and new data
   */
  private calculateChanges(
    old_data: Record<string, any>,
    new_data: Record<string, any>
  ): Record<string, { old: any; new: any }> {
    const changes: Record<string, { old: any; new: any }> = {};
    const allKeys = new Set([...Object.keys(old_data), ...Object.keys(new_data)]);

    for (const key of allKeys) {
      const oldValue = old_data[key];
      const newValue = new_data[key];

      // Only include if values are different
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes[key] = {
          old: oldValue,
          new: newValue,
        };
      }
    }

    return changes;
  }

  /**
   * Query audit logs
   */
  async query(filter: AuditLogFilter): Promise<AuditLogResult> {
    const org_id = await getEffectiveTenantId();
    if (!org_id) {
      throw new Error('Organization ID not found');
    }

    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .eq('org_id', org_id)
      .order('created_at', { ascending: false });

    // Apply filters
    if (filter.user_id) {
      query = query.eq('user_id', filter.user_id);
    }

    if (filter.action) {
      if (Array.isArray(filter.action)) {
        query = query.in('action', filter.action);
      } else {
        query = query.eq('action', filter.action);
      }
    }

    if (filter.entity_type) {
      if (Array.isArray(filter.entity_type)) {
        query = query.in('entity_type', filter.entity_type);
      } else {
        query = query.eq('entity_type', filter.entity_type);
      }
    }

    if (filter.entity_id) {
      query = query.eq('entity_id', filter.entity_id);
    }

    if (filter.start_date) {
      query = query.gte('created_at', filter.start_date);
    }

    if (filter.end_date) {
      query = query.lte('created_at', filter.end_date);
    }

    // Apply pagination
    const limit = filter.limit || 50;
    const offset = filter.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    return {
      data: (data || []) as AuditLogEntry[],
      count: count || 0,
      has_more: (count || 0) > offset + limit,
    };
  }
}

// Export singleton instance
export const auditLogger = new AuditLogger();

export default auditLogger;

