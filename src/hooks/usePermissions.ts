// src/hooks/usePermissions.ts
// بسم الله الرحمن الرحيم
// Hook للتحقق من صلاحيات المستخدم

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabase } from '@/lib/supabase';

// =====================================
// Types
// =====================================

export interface Permission {
  module_code: string;
  action: string;
}

export interface UserPermissions {
  permissions: Permission[];
  isOrgAdmin: boolean;
  isSuperAdmin: boolean;
  loading: boolean;
  error: string | null;
}

interface PermissionCache {
  orgId: string;
  userId: string;
  permissions: Permission[];
  isOrgAdmin: boolean;
  isSuperAdmin: boolean;
  timestamp: number;
}

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;
let permissionCache: PermissionCache | null = null;

// =====================================
// usePermissions Hook
// =====================================

export function usePermissions(): UserPermissions & {
  hasPermission: (moduleCode: string, action: string) => boolean;
  hasAnyPermission: (checks: Array<{ module: string; action: string }>) => boolean;
  hasAllPermissions: (checks: Array<{ module: string; action: string }>) => boolean;
  refreshPermissions: () => Promise<void>;
} {
  const { user, currentOrgId, isAuthenticated } = useAuth();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load permissions
  const loadPermissions = useCallback(async () => {
    if (!user?.id) {
      setPermissions([]);
      setIsOrgAdmin(false);
      setIsSuperAdmin(false);
      setLoading(false);
      return;
    }

    // إذا لم يكن هناك org_id محدد، نتحقق من صلاحيات Super Admin أولاً
    // ثم نتحقق إذا كان المستخدم org admin في أي منظمة
    const orgIdToCheck = currentOrgId || localStorage.getItem('current_org_id');

    // Check cache
    if (
      permissionCache &&
      permissionCache.orgId === orgIdToCheck &&
      permissionCache.userId === user.id &&
      Date.now() - permissionCache.timestamp < CACHE_DURATION
    ) {
      setPermissions(permissionCache.permissions);
      setIsOrgAdmin(permissionCache.isOrgAdmin);
      setIsSuperAdmin(permissionCache.isSuperAdmin);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();

      // Check if super admin (يتم التحقق منها حتى بدون org_id)
      const { data: superAdminData } = await supabase
        .from('super_admins')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle(); // استخدام maybeSingle بدلاً من single لتجنب الخطأ

      const isSA = !!superAdminData;
      setIsSuperAdmin(isSA);

      // If super admin, has all permissions
      if (isSA) {
        setIsOrgAdmin(true);
        setPermissions([]);
        setLoading(false);
        return;
      }

      // إذا لم يكن هناك org_id، نتحقق من أي منظمة
      let orgQuery = supabase
        .from('user_organizations')
        .select('is_org_admin, org_id')
        .eq('user_id', user.id)
        .eq('is_active', true);
      
      if (orgIdToCheck) {
        orgQuery = orgQuery.eq('org_id', orgIdToCheck);
      }

      const { data: orgData } = await orgQuery.maybeSingle();

      const isOA = orgData?.is_org_admin || false;
      setIsOrgAdmin(isOA);

      // إذا كان Org Admin - له جميع الصلاحيات
      if (isOA) {
        setPermissions([]);
        setLoading(false);
        // تحديث الكاش
        permissionCache = {
          orgId: orgIdToCheck || '',
          userId: user.id,
          permissions: [],
          isOrgAdmin: isOA,
          isSuperAdmin: isSA,
          timestamp: Date.now(),
        };
        return;
      }

      // إذا لم يكن هناك org_id، لا يمكن جلب الصلاحيات
      if (!orgIdToCheck) {
        setPermissions([]);
        setLoading(false);
        return;
      }

      // Get user permissions through roles
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select(`
          role:roles(
            id,
            is_active,
            role_permissions(
              permission:permissions(
                action,
                module:modules(name)
              )
            )
          )
        `)
        .eq('user_id', user.id)
        .eq('org_id', orgIdToCheck);

      // Extract permissions
      const perms: Permission[] = [];
      (userRoles || []).forEach((ur: any) => {
        if (ur.role?.is_active) {
          (ur.role.role_permissions || []).forEach((rp: any) => {
            if (rp.permission?.module?.name) {
              perms.push({
                module_code: rp.permission.module.name,
                action: rp.permission.action,
              });
            }
          });
        }
      });

      // Remove duplicates
      const uniquePerms = perms.filter((perm, index, self) =>
        index === self.findIndex(p =>
          p.module_code === perm.module_code && p.action === perm.action
        )
      );

      setPermissions(uniquePerms);

      // Update cache
      permissionCache = {
        orgId: orgIdToCheck || '',
        userId: user.id,
        permissions: uniquePerms,
        isOrgAdmin: isOA,
        isSuperAdmin: isSA,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      console.error('Error loading permissions:', err);
      setError(err.message || 'فشل تحميل الصلاحيات');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrgId]);

  useEffect(() => {
    if (isAuthenticated) {
      loadPermissions();
    } else {
      setPermissions([]);
      setIsOrgAdmin(false);
      setIsSuperAdmin(false);
      setLoading(false);
    }
  }, [isAuthenticated, loadPermissions]);

  // Permission check functions
  const hasPermission = useCallback(
    (moduleCode: string, action: string): boolean => {
      // Super admins have all permissions
      if (isSuperAdmin) return true;

      // Org admins have all permissions within their org
      if (isOrgAdmin) return true;

      // Check specific permission
      return permissions.some(
        p => p.module_code === moduleCode && p.action === action
      );
    },
    [permissions, isOrgAdmin, isSuperAdmin]
  );

  const hasAnyPermission = useCallback(
    (checks: Array<{ module: string; action: string }>): boolean => {
      if (isSuperAdmin || isOrgAdmin) return true;
      return checks.some(check => hasPermission(check.module, check.action));
    },
    [hasPermission, isOrgAdmin, isSuperAdmin]
  );

  const hasAllPermissions = useCallback(
    (checks: Array<{ module: string; action: string }>): boolean => {
      if (isSuperAdmin || isOrgAdmin) return true;
      return checks.every(check => hasPermission(check.module, check.action));
    },
    [hasPermission, isOrgAdmin, isSuperAdmin]
  );

  const refreshPermissions = useCallback(async () => {
    permissionCache = null;
    await loadPermissions();
  }, [loadPermissions]);

  return {
    permissions,
    isOrgAdmin,
    isSuperAdmin,
    loading,
    error,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refreshPermissions,
  };
}

// =====================================
// Utility function for direct permission check
// =====================================

export async function checkPermission(
  userId: string,
  orgId: string,
  moduleCode: string,
  action: string
): Promise<boolean> {
  try {
    const supabase = getSupabase();

    // Check super admin
    const { data: superAdmin } = await supabase
      .from('super_admins')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (superAdmin) return true;

    // Check org admin
    const { data: orgUser } = await supabase
      .from('user_organizations')
      .select('is_org_admin')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .single();

    if (orgUser?.is_org_admin) return true;

    // Check specific permission via database function
    const { data, error } = await supabase.rpc('has_permission', {
      p_user_id: userId,
      p_org_id: orgId,
      p_module_code: moduleCode,
      p_action: action,
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

