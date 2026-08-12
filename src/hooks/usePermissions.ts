// src/hooks/usePermissions.ts
// بسم الله الرحمن الرحيم
// Hook للتحقق من صلاحيات المستخدم

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabase } from '@/lib/supabase';
import { safeLocalStorage } from '@/lib/safe-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

// =====================================
// Types
// =====================================

export interface Permission {
  module_code: string;
  action: string;
}

export interface UserPermissions {
  permissions: Permission[];
  /** Exact permission keys the BACKEND says this user holds (Migration 174). */
  permissionKeys: string[];
  /** Keys the backend classifies as sensitive — for badging, never for deciding. */
  sensitivePermissionKeys: string[];
  isOrgAdmin: boolean;
  isSuperAdmin: boolean;
  loading: boolean;
  error: string | null;
}

interface PermissionCache {
  orgId: string;
  userId: string;
  permissions: Permission[];
  permissionKeys: string[];
  sensitivePermissionKeys: string[];
  isOrgAdmin: boolean;
  isSuperAdmin: boolean;
  timestamp: number;
}

// Cache duration: 60 seconds.
//
// Was 5 minutes. A permission cache is a window during which the UI acts on a
// decision the backend may have already revoked; five minutes of that is a long
// time for a sensitive accounting control. The window is also closed actively —
// see clearPermissionCache(), the org-change effect and the focus listener — so
// this TTL is the backstop, not the mechanism.
const CACHE_DURATION = 60 * 1000;
let permissionCache: PermissionCache | null = null;

/**
 * Drop the cached snapshot. Call after any grant or revocation so the next read
 * goes to the backend instead of serving a decision that is already wrong.
 */
export function clearPermissionCache(): void {
  permissionCache = null;
}

// =====================================
// usePermissions Hook
// =====================================

export function usePermissions(): UserPermissions & {
  hasPermission: (moduleCode: string, action: string) => boolean;
  hasPermissionKey: (permissionKey: string) => boolean;
  hasModuleAccess: (moduleCode: string) => boolean;
  hasAnyPermission: (checks: Array<{ module: string; action: string }>) => boolean;
  hasAllPermissions: (checks: Array<{ module: string; action: string }>) => boolean;
  isSensitivePermission: (permissionKey: string) => boolean;
  refreshPermissions: () => Promise<void>;
} {
  const { user, currentOrgId, isAuthenticated } = useAuth();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [sensitivePermissionKeys, setSensitivePermissionKeys] = useState<string[]>([]);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPermissions([]);
    setPermissionKeys([]);
    setSensitivePermissionKeys([]);
    setIsOrgAdmin(false);
    setIsSuperAdmin(false);
  }, []);

  /**
   * Load the effective permission set from the backend.
   *
   * Migration 174: this asks `rpc_permission_snapshot` and stores whatever it
   * says. It deliberately does NOT re-derive an org-admin or super-admin
   * override locally — the previous implementation short-circuited with
   * `setPermissions([])` for admins and had `hasPermission` return `true`
   * unconditionally, which after 174 disagrees with the database for sensitive
   * keys and would render controls that fail on click.
   */
  const loadPermissions = useCallback(async () => {
    if (!user?.id) {
      reset();
      setLoading(false);
      return;
    }

    const orgIdToCheck = currentOrgId || safeLocalStorage.getItem('current_org_id');

    if (!orgIdToCheck) {
      // No organization resolved: the backend cannot answer, so neither can we.
      reset();
      setLoading(false);
      return;
    }

    if (
      permissionCache?.orgId === orgIdToCheck &&
      permissionCache?.userId === user.id &&
      Date.now() - (permissionCache?.timestamp || 0) < CACHE_DURATION
    ) {
      setPermissions(permissionCache.permissions);
      setPermissionKeys(permissionCache.permissionKeys);
      setSensitivePermissionKeys(permissionCache.sensitivePermissionKeys);
      setIsOrgAdmin(permissionCache.isOrgAdmin);
      setIsSuperAdmin(permissionCache.isSuperAdmin);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase() as SupabaseClient;
      const { data, error: rpcError } = await supabase.rpc('rpc_permission_snapshot', {
        p_org_id: orgIdToCheck,
      });

      if (rpcError) throw rpcError;

      const snapshot = (data ?? null) as {
        is_super_admin?: boolean;
        is_org_admin?: boolean;
        permission_keys?: string[];
        sensitive_permission_keys?: string[];
      } | null;

      const keys = snapshot?.permission_keys ?? [];
      const sensitive = snapshot?.sensitive_permission_keys ?? [];

      // module_code/action kept for the existing (module, action) call sites.
      // A key is `<module>.<resource>.<action>`.
      const derived: Permission[] = keys.map(key => {
        const parts = key.split('.');
        return { module_code: parts[0] ?? '', action: parts[parts.length - 1] ?? '' };
      });

      setPermissions(derived);
      setPermissionKeys(keys);
      setSensitivePermissionKeys(sensitive);
      setIsOrgAdmin(!!snapshot?.is_org_admin);
      setIsSuperAdmin(!!snapshot?.is_super_admin);

      permissionCache = {
        orgId: orgIdToCheck,
        userId: user.id,
        permissions: derived,
        permissionKeys: keys,
        sensitivePermissionKeys: sensitive,
        isOrgAdmin: !!snapshot?.is_org_admin,
        isSuperAdmin: !!snapshot?.is_super_admin,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      console.error('Error loading permissions:', err);
      setError(err.message || 'فشل تحميل الصلاحيات');
      // Fail closed: an unreadable snapshot must not leave stale grants in place.
      reset();
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrgId, reset]);

  useEffect(() => {
    if (isAuthenticated) {
      loadPermissions();
    } else {
      reset();
      setLoading(false);
    }
  }, [isAuthenticated, loadPermissions, reset]);

  // Switching organization invalidates the snapshot outright — it is scoped to
  // one org, so serving the previous org's answer would be simply wrong.
  useEffect(() => {
    permissionCache = null;
  }, [currentOrgId]);

  // Returning to the tab re-reads the snapshot: a grant or revocation made
  // elsewhere (another tab, another admin) must not be acted on with stale
  // state.
  //
  // visibilitychange, not window 'focus': 'focus' also fires when focus moves
  // within the page, so it would invalidate the cache and re-query on ordinary
  // interactions rather than on the staleness signal we actually care about.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      permissionCache = null;
      void loadPermissions();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isAuthenticated, loadPermissions]);

  // Permission check functions.
  //
  // No local override lives here any more. The snapshot already contains
  // whatever the org-admin override grants — and, since Migration 174,
  // deliberately excludes the sensitive keys it no longer covers. Re-adding an
  // `if (isOrgAdmin) return true` short-circuit would silently reinstate the
  // very bypass that migration removed, for the two accounting controls that
  // exist precisely to be exceptional.
  const hasPermissionKey = useCallback(
    (permissionKey: string): boolean => permissionKeys.includes(permissionKey),
    [permissionKeys]
  );

  /**
   * A module is reachable when the backend snapshot contains at least one
   * exact key in that module. The live catalogue is intentionally mixed:
   * most modules use `read`, while General Ledger uses `view`. Requiring one
   * hard-coded action at the route or navigation layer therefore rejects
   * legitimate grants. The prefix is only grouping already-authorized exact
   * keys; it never broadens a backend permission decision.
   */
  const hasModuleAccess = useCallback(
    (moduleCode: string): boolean =>
      moduleCode.length > 0 && permissionKeys.some(key => key.startsWith(`${moduleCode}.`)),
    [permissionKeys]
  );

  const hasPermission = useCallback(
    (moduleCode: string, action: string): boolean =>
      permissions.some(p => p.module_code === moduleCode && p.action === action),
    [permissions]
  );

  const hasAnyPermission = useCallback(
    (checks: Array<{ module: string; action: string }>): boolean =>
      checks.some(check => hasPermission(check.module, check.action)),
    [hasPermission]
  );

  const hasAllPermissions = useCallback(
    (checks: Array<{ module: string; action: string }>): boolean =>
      checks.every(check => hasPermission(check.module, check.action)),
    [hasPermission]
  );

  /** Backend classification, for badging and warnings — never for deciding. */
  const isSensitivePermission = useCallback(
    (permissionKey: string): boolean => sensitivePermissionKeys.includes(permissionKey),
    [sensitivePermissionKeys]
  );

  const refreshPermissions = useCallback(async () => {
    permissionCache = null;
    await loadPermissions();
  }, [loadPermissions]);

  return {
    permissions,
    permissionKeys,
    sensitivePermissionKeys,
    isOrgAdmin,
    isSuperAdmin,
    loading,
    error,
    hasPermission,
    hasPermissionKey,
    hasModuleAccess,
    hasAnyPermission,
    hasAllPermissions,
    isSensitivePermission,
    refreshPermissions,
  };
}

// =====================================
// Utility function for direct permission check
// =====================================

/**
 * One-off permission check against the backend, for code outside React.
 *
 * Two bugs are fixed here at once:
 *
 * 1. It re-implemented the super-admin and org-admin overrides client-side and
 *    returned `true` before ever asking the database. After Migration 174 the
 *    org-admin override no longer covers sensitive keys, so that shortcut would
 *    answer `true` where `has_permission` answers `false`.
 * 2. It built the key as `${moduleCode}.${action}` — a two-segment key — while
 *    real permission keys are `<module>.<resource>.<action>`. Migration 172
 *    removed the same-module `LIKE` fallback that used to make such a key match
 *    by accident, so this could only ever return `false` for a real key.
 *
 * It now takes the exact permission key and returns whatever the backend says.
 * `has_permission` applies its own caller-identity guard (Migration 170), so it
 * only ever answers about the signed-in user.
 */
export async function checkPermission(
  userId: string,
  orgId: string,
  permissionKey: string
): Promise<boolean> {
  try {
    const supabase = getSupabase() as SupabaseClient;
    const { data, error } = await supabase.rpc('has_permission', {
      p_user_id: userId,
      p_org_id: orgId,
      p_permission_key: permissionKey,
    });

    if (error) {
      console.error('Error checking permission:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in checkPermission:', error);
    return false;
  }
}

export default usePermissions;
