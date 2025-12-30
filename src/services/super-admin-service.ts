// src/services/super-admin-service.ts
// بسم الله الرحمن الرحيم
// خدمة Super Admin

import { getSupabase } from '@/lib/supabase';

// =====================================
// Types
// =====================================

export type PlanType = 'trial' | 'basic' | 'pro' | 'enterprise';

export interface Organization {
  id: string;
  name: string;
  name_ar?: string;
  code: string; // NOSONAR - string is a primitive type, not a union type
  slug?: string;
  plan_type: PlanType;
  max_users: number;
  current_users_count: number;
  subscription_start?: string;
  subscription_end?: string;
  logo_url?: string;
  primary_color?: string;
  industry?: string;
  country: string;
  currency: string;
  timezone: string;
  tax_id?: string;
  settings?: Record<string, unknown>;
  feature_flags?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  created_by?: string;
  updated_at: string;
}

export interface OrganizationWithAdmin extends Organization {
  admin?: {
    id: string;
    email: string;
    full_name?: string;
  };
}

export interface CreateOrganizationInput {
  name: string;
  name_ar?: string;
  code: string;
  plan_type?: PlanType;
  max_users?: number;
  industry?: string;
  country?: string;
  currency?: string;
  admin_email: string;
  admin_name: string;
  admin_password: string;
}

export interface UpdateOrganizationInput {
  id: string;
  name?: string;
  name_ar?: string;
  plan_type?: PlanType;
  max_users?: number;
  subscription_start?: string;
  subscription_end?: string;
  logo_url?: string;
  primary_color?: string;
  industry?: string;
  country?: string;
  currency?: string;
  timezone?: string;
  tax_id?: string;
  is_active?: boolean;
  settings?: Record<string, unknown>;
  feature_flags?: Record<string, unknown>;
}

export interface DashboardStats {
  totalOrganizations: number;
  activeOrganizations: number;
  totalUsers: number;
  trialOrgs: number;
  basicOrgs: number;
  proOrgs: number;
  enterpriseOrgs: number;
  recentOrganizations: Organization[];
  expiringSoon: Organization[];
}

// =====================================
// Super Admin Check
// =====================================

/**
 * Check if current user is super admin
 */
export async function checkIsSuperAdmin(): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return false;

    const { data, error } = await supabase
      .from('super_admins')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking super admin:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in checkIsSuperAdmin:', error);
    return false;
  }
}

// =====================================
// Dashboard Stats
// =====================================

/**
 * Get dashboard statistics
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const supabase = getSupabase();

    // Get all organizations
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });

    if (orgsError) throw orgsError;

    const organizations = orgs || [];

    // Calculate stats
    const stats: DashboardStats = {
      totalOrganizations: organizations.length,
      activeOrganizations: organizations.filter(o => o.is_active).length,
      totalUsers: organizations.reduce((sum, o) => sum + (o.current_users_count || 0), 0),
      trialOrgs: organizations.filter(o => o.plan_type === 'trial').length,
      basicOrgs: organizations.filter(o => o.plan_type === 'basic').length,
      proOrgs: organizations.filter(o => o.plan_type === 'pro').length,
      enterpriseOrgs: organizations.filter(o => o.plan_type === 'enterprise').length,
      recentOrganizations: organizations.slice(0, 5),
      expiringSoon: organizations.filter(o => {
        if (!o.subscription_end) return false;
        const endDate = new Date(o.subscription_end);
        const now = new Date();
        const daysUntilExpiry = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
      }),
    };

    return stats;
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return {
      totalOrganizations: 0,
      activeOrganizations: 0,
      totalUsers: 0,
      trialOrgs: 0,
      basicOrgs: 0,
      proOrgs: 0,
      enterpriseOrgs: 0,
      recentOrganizations: [],
      expiringSoon: [],
    };
  }
}

// =====================================
// Organizations CRUD
// =====================================

/**
 * Get all organizations
 */
export async function getOrganizations(): Promise<Organization[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return [];
  }
}

/**
 * Get organization by ID with admin info
 */
export async function getOrganizationById(id: string): Promise<OrganizationWithAdmin | null> {
  try {
    const supabase = getSupabase();

    // Get organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (orgError) throw orgError;
    if (!org) return null;

    // Get org admin
    const { data: adminData, error: adminError } = await supabase
      .from('user_organizations')
      .select(`
        user_id,
        user_profiles(full_name)
      `)
      .eq('org_id', id)
      .eq('is_org_admin', true)
      .eq('is_active', true)
      .limit(1);

    if (adminError) {
      console.error('Error fetching admin:', adminError);
    }

    // Get admin email from auth
    let admin = undefined;
    if (adminData && adminData.length > 0) {
      const adminUserId = adminData[0].user_id;
      // Note: في Supabase لا يمكن جلب email المستخدم مباشرة من auth.users
      // سنستخدم user_profiles أو نخزن الـ email في جدول منفصل
      admin = {
        id: adminUserId,
        email: '', // سيتم جلبه من مكان آخر
        full_name: ((adminData[0] as Record<string, unknown>).user_profiles as Record<string, unknown> | undefined)?.full_name as string || '',
      };
    }

    return { ...org, admin };
  } catch (error) {
    console.error('Error fetching organization:', error);
    return null;
  }
}

/**
 * Create new organization with admin
 */
export async function createOrganization(
  input: CreateOrganizationInput
): Promise<{ success: boolean; organization?: Organization; error?: string }> {
  try {
    const supabase = getSupabase();

    // 1. Check if code already exists
    const { data: existing } = await supabase
      .from('organizations')
      .select('id')
      .eq('code', input.code.toUpperCase())
      .single();

    if (existing) {
      return { success: false, error: 'رمز المنظمة مستخدم بالفعل' };
    }

    // 2. Create admin user in auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: input.admin_email,
      password: input.admin_password,
      email_confirm: true,
      user_metadata: {
        full_name: input.admin_name,
      },
    });

    if (authError) {
      // If admin API not available, try regular signup
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: input.admin_email,
        password: input.admin_password,
        options: {
          data: {
            full_name: input.admin_name,
          },
        },
      });

      if (signUpError) {
        return { success: false, error: `خطأ في إنشاء المستخدم: ${signUpError.message}` };
      }

      if (!signUpData.user) {
        return { success: false, error: 'فشل إنشاء المستخدم' };
      }

      // Continue with the created user
      return await createOrgWithUser(supabase, input, signUpData.user.id);
    }

    if (!authData.user) {
      return { success: false, error: 'فشل إنشاء المستخدم' };
    }

    return await createOrgWithUser(supabase, input, authData.user.id);
  } catch (error: any) {
    console.error('Error creating organization:', error);
    return { success: false, error: error.message || 'فشل إنشاء المنظمة' };
  }
}

async function createOrgWithUser(
  supabase: any,
  input: CreateOrganizationInput,
  userId: string
): Promise<{ success: boolean; organization?: Organization; error?: string }> {
  try {
    // 1. Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: input.name,
        name_ar: input.name_ar,
        code: input.code.toUpperCase(),
        slug: input.code.toLowerCase(),
        plan_type: input.plan_type || 'trial',
        max_users: input.max_users || 5,
        industry: input.industry,
        country: input.country || 'SA',
        currency: input.currency || 'SAR',
        is_active: true,
        subscription_start: new Date().toISOString().split('T')[0],
        subscription_end: input.plan_type === 'trial' 
          ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          : null,
      })
      .select()
      .single();

    if (orgError) throw orgError;

    // 2. Create user profile
    await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        full_name: input.admin_name,
        preferred_language: 'ar',
      });

    // 3. Link user to organization as admin
    const { error: linkError } = await supabase
      .from('user_organizations')
      .insert({
        user_id: userId,
        org_id: org.id,
        is_active: true,
        is_org_admin: true,
        joined_at: new Date().toISOString(),
      });

    if (linkError) throw linkError;

    // 4. Get org_admin role and assign it
    const { data: adminRole } = await supabase
      .from('roles')
      .select('id')
      .eq('org_id', org.id)
      .eq('name', 'org_admin')
      .single();

    if (adminRole) {
      await supabase
        .from('user_roles')
        .insert({
          user_id: userId,
          role_id: adminRole.id,
          org_id: org.id,
        });
    }

    return { success: true, organization: org };
  } catch (error: any) {
    console.error('Error in createOrgWithUser:', error);
    return { success: false, error: error.message || 'فشل إنشاء المنظمة' };
  }
}

/**
 * Update organization
 */
export async function updateOrganization(
  input: UpdateOrganizationInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    const { id, ...updateData } = input;

    const { error } = await supabase
      .from('organizations')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error updating organization:', error);
    return { success: false, error: error.message || 'فشل تحديث المنظمة' };
  }
}

/**
 * Toggle organization active status
 */
export async function toggleOrganizationStatus(
  id: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('organizations')
      .update({ 
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error toggling organization status:', error);
    return { success: false, error: error.message || 'فشل تحديث حالة المنظمة' };
  }
}

/**
 * Delete organization (soft delete by deactivating)
 */
export async function deleteOrganization(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    // Check if org has users
    const { data: org } = await supabase
      .from('organizations')
      .select('current_users_count')
      .eq('id', id)
      .single();

    if (org && org.current_users_count > 0) {
      // Soft delete - just deactivate
      return await toggleOrganizationStatus(id, false);
    }

    // Hard delete if no users
    const { error } = await supabase
      .from('organizations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error deleting organization:', error);
    return { success: false, error: error.message || 'فشل حذف المنظمة' };
  }
}

// =====================================
// Super Admin Management
// =====================================

/**
 * Add super admin
 */
export async function addSuperAdmin(
  email: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    // Find user by email (need to check user_profiles or similar)
    // This is a simplified version
    const { error } = await supabase
      .from('super_admins')
      .insert({
        email: email,
        user_id: '', // Would need to find user_id by email
        is_active: true,
      });

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error adding super admin:', error);
    return { success: false, error: error.message || 'فشل إضافة المشرف' };
  }
}

/**
 * Get all super admins
 */
export async function getSuperAdmins(): Promise<any[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('super_admins')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching super admins:', error);
    return [];
  }
}

// =====================================
// Exports
// =====================================

export const superAdminService = {
  checkIsSuperAdmin,
  getDashboardStats,
  getOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  toggleOrganizationStatus,
  deleteOrganization,
  addSuperAdmin,
  getSuperAdmins,
};

export default superAdminService;

