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
  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return false;

    const { data, error } = await supabase
      .from('user_organizations')
      .select('id')
      .eq('user_id', user.id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .eq('is_org_admin', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking org admin:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in checkIsOrgAdmin:', error);
    return false;
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

    const { data, error } = await supabase
      .from('user_organizations')
      .select(`
        *,
        user_profile:user_profiles(*)
      `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get user roles
    const userIds = (data || []).map(u => u.user_id);
    
    if (userIds.length > 0) {
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          role:roles(*)
        `)
        .eq('org_id', orgId)
        .in('user_id', userIds);

      // Merge roles with users
      const rolesMap = new Map<string, OrgRole[]>();
      (userRoles || []).forEach((ur: any) => {
        if (!rolesMap.has(ur.user_id)) {
          rolesMap.set(ur.user_id, []);
        }
        if (ur.role) {
          rolesMap.get(ur.user_id)!.push(ur.role);
        }
      });

      return (data || []).map(user => ({
        ...user,
        roles: rolesMap.get(user.user_id) || [],
      }));
    }

    return data || [];
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
      .single();

    if (existing) {
      return { success: false, error: 'هذا البريد مدعو بالفعل' };
    }

    // Check if user already in org
    const { data: existingUser } = await supabase
      .from('user_profiles')
      .select('user_id')
      .ilike('user_id', `%${input.email}%`) // This won't work, need to check auth.users
      .single();

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
 * Resend invitation
 */
export async function resendInvitation(
  invitationId: string
): Promise<{ success: boolean; error?: string }> {
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
      .eq('id', invitationId);

    if (error) throw error;

    // TODO: Send email with new token

    return { success: true };
  } catch (error: any) {
    console.error('Error resending invitation:', error);
    return { success: false, error: error.message || 'فشل إعادة إرسال الدعوة' };
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
};

export default orgAdminService;

