// src/services/rbac-service.ts
// بسم الله الرحمن الرحيم
// خدمة نظام الصلاحيات RBAC

import { getSupabase } from '@/lib/supabase';

// =====================================
// Types
// =====================================

export interface Module {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
  description_ar?: string;
  icon?: string;
  display_order: number;
  is_active: boolean;
}

export interface Permission {
  id: string;
  module_id: string;
  resource: string;
  resource_ar: string;
  action: string;
  action_ar: string;
  permission_key: string;
  description?: string;
  description_ar?: string;
  module?: Module;
}

export interface Role {
  id: string;
  org_id: string;
  name: string;
  name_ar: string;
  description?: string;
  description_ar?: string;
  is_system_role: boolean;
  is_active: boolean;
  created_at: string;
  created_by?: string;
  permissions?: Permission[];
}

export interface RoleTemplate {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
  description_ar?: string;
  permission_keys: string[];
  category?: string;
  available_for_plans: string[];
  is_active: boolean;
}

export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
  org_id: string;
  assigned_at: string;
  assigned_by?: string;
  expires_at?: string;
  role?: Role;
}

// =====================================
// Cache للصلاحيات
// =====================================

let permissionsCache: Map<string, Set<string>> = new Map();
let cacheExpiry: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 دقائق

function getCacheKey(userId: string, orgId: string): string {
  return `${userId}:${orgId}`;
}

function clearPermissionsCache() {
  permissionsCache.clear();
  cacheExpiry = 0;
}

// =====================================
// Modules & Permissions
// =====================================

/**
 * Get all active modules
 */
export async function getModules(): Promise<Module[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('modules')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching modules:', error);
    return [];
  }
}

/**
 * Get all permissions grouped by module
 */
export async function getPermissionsGrouped(): Promise<Map<string, Permission[]>> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('permissions')
      .select(`
        *,
        module:modules(*)
      `)
      .order('permission_key');

    if (error) throw error;

    const grouped = new Map<string, Permission[]>();
    (data || []).forEach((perm: Permission) => {
      const moduleId = perm.module_id;
      if (!grouped.has(moduleId)) {
        grouped.set(moduleId, []);
      }
      const modulePerms = grouped.get(moduleId);
      if (modulePerms) {
        modulePerms.push(perm);
      }
    });

    return grouped;
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return new Map();
  }
}

/**
 * Get all permissions
 */
export async function getAllPermissions(): Promise<Permission[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('permissions')
      .select(`
        *,
        module:modules(*)
      `)
      .order('permission_key');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return [];
  }
}

// =====================================
// Roles
// =====================================

/**
 * Get organization roles
 */
export async function getOrgRoles(orgId: string): Promise<Role[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching roles:', error);
    return [];
  }
}

/**
 * Get role with permissions
 */
export async function getRoleWithPermissions(roleId: string): Promise<Role | null> {
  try {
    const supabase = getSupabase();
    
    // Get role
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .single();

    if (roleError) throw roleError;
    if (!role) return null;

    // Get role permissions
    const { data: rolePerms, error: permsError } = await supabase
      .from('role_permissions')
      .select(`
        permission:permissions(
          *,
          module:modules(*)
        )
      `)
      .eq('role_id', roleId);

    if (permsError) throw permsError;

    role.permissions = (rolePerms || []).map((rp: any) => rp.permission);
    return role;
  } catch (error) {
    console.error('Error fetching role with permissions:', error);
    return null;
  }
}

/**
 * Create a new role
 */
export async function createRole(params: {
  orgId: string;
  name: string;
  name_ar: string;
  description?: string;
  description_ar?: string;
  permissionIds?: string[];
}): Promise<{ success: boolean; role?: Role; error?: string }> {
  try {
    const supabase = getSupabase();

    // Create role
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .insert({
        org_id: params.orgId,
        name: params.name,
        name_ar: params.name_ar,
        description: params.description,
        description_ar: params.description_ar,
        is_system_role: false,
        is_active: true,
      })
      .select()
      .single();

    if (roleError) throw roleError;

    // Add permissions if provided
    if (params.permissionIds && params.permissionIds.length > 0) {
      const rolePerms = params.permissionIds.map(permId => ({
        role_id: role.id,
        permission_id: permId,
      }));

      const { error: permsError } = await supabase
        .from('role_permissions')
        .insert(rolePerms);

      if (permsError) throw permsError;
    }

    clearPermissionsCache();
    return { success: true, role };
  } catch (error: any) {
    console.error('Error creating role:', error);
    return { success: false, error: error.message || 'Failed to create role' };
  }
}

/**
 * Update role permissions
 */
export async function updateRolePermissions(
  roleId: string,
  permissionIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    // Delete existing permissions
    const { error: deleteError } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId);

    if (deleteError) throw deleteError;

    // Add new permissions
    if (permissionIds.length > 0) {
      const rolePerms = permissionIds.map(permId => ({
        role_id: roleId,
        permission_id: permId,
      }));

      const { error: insertError } = await supabase
        .from('role_permissions')
        .insert(rolePerms);

      if (insertError) throw insertError;
    }

    clearPermissionsCache();
    return { success: true };
  } catch (error: any) {
    console.error('Error updating role permissions:', error);
    return { success: false, error: error.message || 'Failed to update permissions' };
  }
}

/**
 * Delete role
 */
export async function deleteRole(roleId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    // Check if it's a system role
    const { data: role, error: checkError } = await supabase
      .from('roles')
      .select('is_system_role')
      .eq('id', roleId)
      .single();

    if (checkError) throw checkError;
    if (role?.is_system_role) {
      return { success: false, error: 'لا يمكن حذف دور النظام' };
    }

    // Delete role (cascade will delete role_permissions and user_roles)
    const { error: deleteError } = await supabase
      .from('roles')
      .delete()
      .eq('id', roleId);

    if (deleteError) throw deleteError;

    clearPermissionsCache();
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting role:', error);
    return { success: false, error: error.message || 'Failed to delete role' };
  }
}

// =====================================
// Role Templates
// =====================================

/**
 * Get role templates
 */
export async function getRoleTemplates(): Promise<RoleTemplate[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('role_templates')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching role templates:', error);
    return [];
  }
}

/**
 * Create role from template
 */
export async function createRoleFromTemplate(
  orgId: string,
  templateId: string,
  customName?: string
): Promise<{ success: boolean; roleId?: string; error?: string }> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .rpc('create_role_from_template', {
        p_org_id: orgId,
        p_template_id: templateId,
        p_custom_name: customName || null,
      });

    if (error) throw error;

    clearPermissionsCache();
    return { success: true, roleId: data };
  } catch (error: any) {
    console.error('Error creating role from template:', error);
    return { success: false, error: error.message || 'Failed to create role' };
  }
}

// =====================================
// User Roles
// =====================================

/**
 * Get user's roles in an organization
 */
export async function getUserRoles(userId: string, orgId: string): Promise<UserRole[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_roles')
      .select(`
        *,
        role:roles(*)
      `)
      .eq('user_id', userId)
      .eq('org_id', orgId);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching user roles:', error);
    return [];
  }
}

/**
 * Assign role to user
 */
export async function assignRoleToUser(params: {
  userId: string;
  roleId: string;
  orgId: string;
  expiresAt?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('user_roles')
      .upsert({
        user_id: params.userId,
        role_id: params.roleId,
        org_id: params.orgId,
        expires_at: params.expiresAt || null,
        assigned_at: new Date().toISOString(),
      });

    if (error) throw error;

    clearPermissionsCache();
    return { success: true };
  } catch (error: any) {
    console.error('Error assigning role:', error);
    return { success: false, error: error.message || 'Failed to assign role' };
  }
}

/**
 * Remove role from user
 */
export async function removeRoleFromUser(
  userId: string,
  roleId: string,
  orgId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId)
      .eq('org_id', orgId);

    if (error) throw error;

    clearPermissionsCache();
    return { success: true };
  } catch (error: any) {
    console.error('Error removing role:', error);
    return { success: false, error: error.message || 'Failed to remove role' };
  }
}

// =====================================
// Permission Checking
// =====================================

/**
 * Get user's permissions (cached)
 */
export async function getUserPermissions(
  userId: string,
  orgId: string
): Promise<Set<string>> {
  const cacheKey = getCacheKey(userId, orgId);
  
  // Check cache
  if (Date.now() < cacheExpiry && permissionsCache.has(cacheKey)) {
    const cached = permissionsCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  try {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .rpc('get_user_permissions', {
        p_user_id: userId,
        p_org_id: orgId,
      });

    if (error) throw error;

    const permissions = new Set<string>(
      (data || []).map((p: any) => p.permission_key)
    );

    // Update cache
    permissionsCache.set(cacheKey, permissions);
    cacheExpiry = Date.now() + CACHE_DURATION;

    return permissions;
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    return new Set();
  }
}

/**
 * Check if user has specific permission
 */
export async function hasPermission(
  userId: string,
  orgId: string,
  permissionKey: string
): Promise<boolean> {
  try {
    const permissions = await getUserPermissions(userId, orgId);
    
    // Check exact match
    if (permissions.has(permissionKey)) return true;
    
    // Check wildcard (e.g., accounting.* matches accounting.journals.create)
    const parts = permissionKey.split('.');
    for (let i = 1; i < parts.length; i++) {
      const wildcardKey = parts.slice(0, i).join('.') + '.*';
      if (permissions.has(wildcardKey)) return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking permission:', error);
    return false;
  }
}

/**
 * Check if user has any of the permissions
 */
export async function hasAnyPermission(
  userId: string,
  orgId: string,
  permissionKeys: string[]
): Promise<boolean> {
  for (const key of permissionKeys) {
    if (await hasPermission(userId, orgId, key)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if user has all permissions
 */
export async function hasAllPermissions(
  userId: string,
  orgId: string,
  permissionKeys: string[]
): Promise<boolean> {
  for (const key of permissionKeys) {
    if (!(await hasPermission(userId, orgId, key))) {
      return false;
    }
  }
  return true;
}

// =====================================
// Super Admin Check
// =====================================

/**
 * Check if user is super admin
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('super_admins')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  } catch (error) {
    console.error('Error checking super admin:', error);
    return false;
  }
}

/**
 * Check if user is org admin
 */
export async function isOrgAdmin(userId: string, orgId: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_organizations')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .eq('is_org_admin', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  } catch (error) {
    console.error('Error checking org admin:', error);
    return false;
  }
}

// =====================================
// Exports
// =====================================

export const rbacService = {
  // Modules & Permissions
  getModules,
  getPermissionsGrouped,
  getAllPermissions,
  
  // Roles
  getOrgRoles,
  getRoleWithPermissions,
  createRole,
  updateRolePermissions,
  deleteRole,
  
  // Templates
  getRoleTemplates,
  createRoleFromTemplate,
  
  // User Roles
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  
  // Permission Checking
  getUserPermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  
  // Admin Checks
  isSuperAdmin,
  isOrgAdmin,
  
  // Cache
  clearPermissionsCache,
};

export default rbacService;

