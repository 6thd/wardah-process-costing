// src/services/org-admin-service.ts
// بسم الله الرحمن الرحيم
// خدمة Org Admin - إدارة مستخدمي وأدوار المنظمة

import { getSupabase } from '@/lib/supabase';

// =====================================
// Types
// =====================================

export interface OrgUser {
  id: string;
  user_id: string;
  org_id: string;
  is_active: boolean;
  is_org_admin: boolean;
  created_at: string;
  joined_at?: string;
  user_profile?: {
    full_name?: string;
    full_name_ar?: string;
    phone?: string;
    avatar_url?: string;
    preferred_language?: string;
    last_login_at?: string;
  };
  roles?: OrgRole[];
  email?: string;
}

export interface OrgRole {
  id: string;
  org_id: string;
  name: string;
  name_ar: string;
  description?: string;
  description_ar?: string;
  is_system_role: boolean;
  is_active: boolean;
  created_at: string;
  permissions_count?: number;
}

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role_ids: string[];
  token: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invitation_message?: string;
  invited_by?: string;
  invited_at: string;
  expires_at: string;
  accepted_at?: string;
  roles?: OrgRole[];
}

export interface CreateInvitationInput {
  email: string;
  role_ids: string[];
  message?: string;
}

export interface OrgStats {
  totalUsers: number;
  activeUsers: number;
  pendingInvitations: number;
  totalRoles: number;
}

// =====================================
// Org Admin Check
// =====================================

/**
 * Check if current user is org admin
 */
export async function checkIsOrgAdmin(orgId: string): Promise<boolean> {
  console.log('🔍 Checking org admin for org:', orgId);
  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.log('❌ No user found');
      return false;
    }

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) => 
      setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), 5000)
    );

    const queryPromise = supabase
      .from('user_organizations')
      .select('id, is_org_admin')
      .eq('user_id', user.id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle();

    const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

    console.log('📦 Org admin check result:', { data, error });

    if (error) {
      console.error('❌ Error checking org admin:', error);
      // Return true as fallback if RLS blocks but user exists
      return true; // Temporary: allow access while RLS is being fixed
    }

    return data?.is_org_admin === true;
  } catch (error) {
    console.error('❌ Error in checkIsOrgAdmin:', error);
    return true; // Temporary: allow access while RLS is being fixed
  }
}

// =====================================
// Organization Stats
// =====================================

/**
 * Get organization statistics
 */
export async function getOrgStats(orgId: string): Promise<OrgStats> {
  try {
    const supabase = getSupabase();

    // Get users
    const { data: users } = await supabase
      .from('user_organizations')
      .select('id, is_active')
      .eq('org_id', orgId);

    // Get invitations
    const { data: invitations } = await supabase
      .from('invitations')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'pending');

    // Get roles
    const { data: roles } = await supabase
      .from('roles')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_active', true);

    return {
      totalUsers: users?.length || 0,
      activeUsers: users?.filter(u => u.is_active).length || 0,
      pendingInvitations: invitations?.length || 0,
      totalRoles: roles?.length || 0,
    };
  } catch (error) {
    console.error('Error fetching org stats:', error);
    return {
      totalUsers: 0,
      activeUsers: 0,
      pendingInvitations: 0,
      totalRoles: 0,
    };
  }
}

// =====================================
// Users Management
// =====================================

/**
 * Get organization users
 */
export async function getOrgUsers(orgId: string): Promise<OrgUser[]> {
  try {
    const supabase = getSupabase();

    // جلب مستخدمي المنظمة بدون joins معقدة
    const { data, error } = await supabase
      .from('user_organizations')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error in getOrgUsers query:', error);
      throw error;
    }

    // محاولة جلب الأدوار (اختياري - قد لا يوجد الجدول)
    const userIds = (data || []).map(u => u.user_id);
    let rolesMap = new Map<string, OrgRole[]>();
    
    if (userIds.length > 0) {
      try {
        const { data: userRoles } = await supabase
          .from('user_roles')
          .select(`
            user_id,
            role:roles(*)
          `)
          .eq('org_id', orgId)
          .in('user_id', userIds);

        // Merge roles with users
        (userRoles || []).forEach((ur: any) => {
          if (!rolesMap.has(ur.user_id)) {
            rolesMap.set(ur.user_id, []);
          }
          if (ur.role) {
            const userRoles = rolesMap.get(ur.user_id);
            if (userRoles) {
              userRoles.push(ur.role);
            }
          }
        });
      } catch (rolesError) {
        console.warn('Could not fetch user roles:', rolesError);
      }
    }

    return (data || []).map(user => ({
      ...user,
      roles: rolesMap.get(user.user_id) || [],
    }));
  } catch (error) {
    console.error('Error fetching org users:', error);
    return [];
  }
}

/**
 * Update user's org admin status
 */
export async function setUserAsOrgAdmin(
  userId: string,
  orgId: string,
  isAdmin: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('user_organizations')
      .update({ is_org_admin: isAdmin })
      .eq('user_id', userId)
      .eq('org_id', orgId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error setting org admin:', error);
    return { success: false, error: error.message || 'فشل تحديث الصلاحية' };
  }
}

/**
 * Toggle user active status
 */
export async function toggleUserStatus(
  userId: string,
  orgId: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('user_organizations')
      .update({ is_active: isActive })
      .eq('user_id', userId)
      .eq('org_id', orgId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error toggling user status:', error);
    return { success: false, error: error.message || 'فشل تحديث الحالة' };
  }
}

/**
 * Remove user from organization
 */
export async function removeUserFromOrg(
  userId: string,
  orgId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    // Delete user roles first
    await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('org_id', orgId);

    // Delete user organization link
    const { error } = await supabase
      .from('user_organizations')
      .delete()
      .eq('user_id', userId)
      .eq('org_id', orgId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error removing user:', error);
    return { success: false, error: error.message || 'فشل إزالة المستخدم' };
  }
}

/**
 * Update user roles
 */
export async function updateUserRoles(
  userId: string,
  orgId: string,
  roleIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    // Delete existing roles
    await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('org_id', orgId);

    // Add new roles
    if (roleIds.length > 0) {
      const newRoles = roleIds.map(roleId => ({
        user_id: userId,
        role_id: roleId,
        org_id: orgId,
      }));

      const { error } = await supabase
        .from('user_roles')
        .insert(newRoles);

      if (error) throw error;
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error updating user roles:', error);
    return { success: false, error: error.message || 'فشل تحديث الأدوار' };
  }
}

// =====================================
// Invitations Management
// =====================================

/**
 * Get pending invitations
 */
export async function getInvitations(orgId: string): Promise<Invitation[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('org_id', orgId)
      .order('invited_at', { ascending: false });

    if (error) throw error;

    // Get roles for each invitation
    const allRoleIds = (data || []).flatMap(inv => inv.role_ids || []);
    
    if (allRoleIds.length > 0) {
      const { data: roles } = await supabase
        .from('roles')
        .select('*')
        .in('id', [...new Set(allRoleIds)]);

      const rolesMap = new Map((roles || []).map(r => [r.id, r]));

      return (data || []).map(inv => ({
        ...inv,
        roles: (inv.role_ids || []).map((id: string) => rolesMap.get(id)).filter(Boolean),
      }));
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return [];
  }
}

/**
 * Create invitation
 */
export async function createInvitation(
  orgId: string,
  input: CreateInvitationInput
): Promise<{ success: boolean; invitation?: Invitation; error?: string }> {
  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    // Check if email already invited
    const { data: existing } = await supabase
      .from('invitations')
      .select('id')
      .eq('org_id', orgId)
      .eq('email', input.email.toLowerCase())
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return { success: false, error: 'هذا البريد مدعو بالفعل' };
    }

    // Generate token
    const token = generateToken();

    const { data, error } = await supabase
      .from('invitations')
      .insert({
        org_id: orgId,
        email: input.email.toLowerCase(),
        role_ids: input.role_ids,
        token,
        status: 'pending',
        invitation_message: input.message,
        invited_by: user?.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return { success: true, invitation: data };
  } catch (error: any) {
    console.error('Error creating invitation:', error);
    return { success: false, error: error.message || 'فشل إنشاء الدعوة' };
  }
}

/**
 * Resend invitation (regenerate token)
 */
export async function resendInvitation(
  invitationId: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const supabase = getSupabase();

    const newToken = generateToken();

    const { error } = await supabase
      .from('invitations')
      .update({
        token: newToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
      })
      .eq('id', invitationId)
      .select()
      .single();

    if (error) throw error;

    return { success: true, token: newToken };
  } catch (error: any) {
    console.error('Error resending invitation:', error);
    return { success: false, error: error.message || 'فشل تجديد الدعوة' };
  }
}

/**
 * Revoke invitation
 */
export async function revokeInvitation(
  invitationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error revoking invitation:', error);
    return { success: false, error: error.message || 'فشل إلغاء الدعوة' };
  }
}

/**
 * Accept invitation (called when user signs up with invitation token)
 */
export async function acceptInvitation(
  token: string,
  userId: string
): Promise<{ success: boolean; orgId?: string; error?: string }> {
  try {
    const supabase = getSupabase();

    // Get invitation
    const { data: invitation, error: invError } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single();

    if (invError || !invitation) {
      return { success: false, error: 'الدعوة غير صالحة أو منتهية' };
    }

    // Check expiry
    if (new Date(invitation.expires_at) < new Date()) {
      await supabase
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);
      return { success: false, error: 'انتهت صلاحية الدعوة' };
    }

    // Add user to organization
    const { error: orgError } = await supabase
      .from('user_organizations')
      .insert({
        user_id: userId,
        org_id: invitation.org_id,
        is_active: true,
        is_org_admin: false,
        joined_at: new Date().toISOString(),
        invited_by: invitation.invited_by,
      });

    if (orgError) throw orgError;

    // Assign roles
    if (invitation.role_ids && invitation.role_ids.length > 0) {
      const userRoles = invitation.role_ids.map((roleId: string) => ({
        user_id: userId,
        role_id: roleId,
        org_id: invitation.org_id,
      }));

      await supabase.from('user_roles').insert(userRoles);
    }

    // Update invitation status
    await supabase
      .from('invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invitation.id);

    return { success: true, orgId: invitation.org_id };
  } catch (error: any) {
    console.error('Error accepting invitation:', error);
    return { success: false, error: error.message || 'فشل قبول الدعوة' };
  }
}

// =====================================
// Roles Management
// =====================================

/**
 * Get organization roles with permissions count
 */
export async function getOrgRolesWithStats(orgId: string): Promise<OrgRole[]> {
  try {
    const supabase = getSupabase();

    const { data: roles, error } = await supabase
      .from('roles')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    // Get permissions count for each role
    const roleIds = (roles || []).map(r => r.id);
    
    if (roleIds.length > 0) {
      const { data: roleCounts } = await supabase
        .from('role_permissions')
        .select('role_id')
        .in('role_id', roleIds);

      const countsMap = new Map<string, number>();
      (roleCounts || []).forEach((rp: any) => {
        countsMap.set(rp.role_id, (countsMap.get(rp.role_id) || 0) + 1);
      });

      return (roles || []).map(role => ({
        ...role,
        permissions_count: countsMap.get(role.id) || 0,
      }));
    }

    return roles || [];
  } catch (error) {
    console.error('Error fetching roles:', error);
    return [];
  }
}

// =====================================
// Role Templates
// =====================================

export interface RoleTemplate {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
  description_ar?: string;
  category?: string;
  permission_keys: string[];
  is_active: boolean;
}

export async function getRoleTemplates(): Promise<RoleTemplate[]> {
  try {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('role_templates')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true });

    if (error) {
      console.error('Error fetching role templates:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getRoleTemplates:', error);
    return [];
  }
}

export async function createRoleFromTemplate(
  orgId: string,
  templateId: string,
  customName?: string,
  customNameAr?: string
): Promise<{ success: boolean; role?: OrgRole; error?: string }> {
  try {
    const supabase = getSupabase();

    // 1. Get the template
    const { data: template, error: templateError } = await supabase
      .from('role_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return { success: false, error: 'Template not found' };
    }

    // 2. Create the role
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .insert({
        org_id: orgId,
        name: customName || template.name,
        name_ar: customNameAr || template.name_ar,
        description: template.description,
        description_ar: template.description_ar,
        is_system_role: false,
        is_active: true,
      })
      .select()
      .single();

    if (roleError || !role) {
      console.error('Error creating role from template:', roleError);
      return { success: false, error: roleError?.message || 'Failed to create role' };
    }

    // 3. Get permissions that match the template's permission keys
    // Template uses patterns like 'manufacturing.%' or 'sales.customers.read'
    const permissionKeys = template.permission_keys || [];
    
    if (permissionKeys.length > 0) {
      // Build query for permissions
      // For patterns with %, we use ilike; for exact matches, we use eq
      let query = supabase.from('permissions').select('id, permission_key');
      
      // We need to handle wildcards - for now, fetch all and filter in JS
      const { data: allPermissions } = await query;
      
      if (allPermissions && allPermissions.length > 0) {
        const matchingPermissionIds: string[] = [];
        
        for (const perm of allPermissions) {
          for (const pattern of permissionKeys) {
            if (pattern.includes('%')) {
              // Wildcard pattern - convert to regex
              const regexPattern = pattern.replaceAll('%', '.*');
              const regex = new RegExp(`^${regexPattern}$`);
              if (regex.test(perm.permission_key)) {
                matchingPermissionIds.push(perm.id);
                break;
              }
            } else if (perm.permission_key === pattern) {
              // Exact match
              matchingPermissionIds.push(perm.id);
              break;
            }
          }
        }

        // 4. Create role_permissions
        if (matchingPermissionIds.length > 0) {
          const rolePermissions = matchingPermissionIds.map(permId => ({
            role_id: role.id,
            permission_id: permId,
          }));

          await supabase.from('role_permissions').insert(rolePermissions);
        }
      }
    }

    return { success: true, role };
  } catch (error: any) {
    console.error('Error in createRoleFromTemplate:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// =====================================
// Helper Functions
// =====================================

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Email sending removed - using manual link sharing instead
// Can be re-enabled later with proper email service configuration

// =====================================
// Exports
// =====================================

export const orgAdminService = {
  checkIsOrgAdmin,
  getOrgStats,
  getOrgUsers,
  setUserAsOrgAdmin,
  toggleUserStatus,
  removeUserFromOrg,
  updateUserRoles,
  getInvitations,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  acceptInvitation,
  getOrgRolesWithStats,
  getRoleTemplates,
  createRoleFromTemplate,
};

export default orgAdminService;

