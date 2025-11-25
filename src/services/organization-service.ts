// src/services/organization-service.ts
// إدارة المنظمات في نظام multi-tenant

import { getSupabase } from '@/lib/supabase';

export interface Organization {
  id: string;
  name: string;
  name_ar?: string;
  code: string;
  settings?: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserOrganization {
  id: string;
  user_id: string;
  org_id: string;
  role: 'user' | 'manager' | 'admin';
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  organization?: Organization;
}

/**
 * Get organization by code
 */
export async function getOrganizationByCode(code: string): Promise<Organization | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('is_active', true)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching organization:', error);
    return null;
  }
}

/**
 * Get user's organizations
 */
export async function getUserOrganizations(userId: string): Promise<UserOrganization[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_organizations')
      .select(`
        *,
        organization:organizations(*)
      `)
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching user organizations:', error);
    return [];
  }
}

/**
 * Create a new organization and assign the creator as admin
 */
export async function createOrganization(params: {
  name: string;
  name_ar?: string;
  code: string;
  userId: string;
}): Promise<{ success: boolean; organization?: Organization; error?: string }> {
  try {
    const supabase = getSupabase();

    // Check if code already exists
    const existing = await getOrganizationByCode(params.code);
    if (existing) {
      return { success: false, error: 'رمز المنظمة مستخدم بالفعل' };
    }

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: params.name,
        name_ar: params.name_ar,
        code: params.code.toUpperCase(),
        is_active: true,
      })
      .select()
      .single();

    if (orgError) throw orgError;

    // Assign user as admin
    const { error: userOrgError } = await supabase
      .from('user_organizations')
      .insert({
        user_id: params.userId,
        org_id: org.id,
        role: 'admin',
        is_active: true,
      });

    if (userOrgError) throw userOrgError;

    return { success: true, organization: org };
  } catch (error: any) {
    console.error('Error creating organization:', error);
    return { success: false, error: error.message || 'فشل إنشاء المنظمة' };
  }
}

/**
 * Add user to organization
 */
export async function addUserToOrganization(params: {
  userId: string;
  orgId: string;
  role: 'user' | 'manager' | 'admin';
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('user_organizations')
      .insert({
        user_id: params.userId,
        org_id: params.orgId,
        role: params.role,
        is_active: true,
      });

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error adding user to organization:', error);
    return { success: false, error: error.message || 'فشل إضافة المستخدم للمنظمة' };
  }
}

/**
 * Check if user belongs to organization
 */
export async function checkUserOrgAccess(
  userId: string,
  orgId: string
): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_organizations')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .single();

    if (error) return false;
    return !!data;
  } catch (error) {
    return false;
  }
}

/**
 * Store current org_id in localStorage
 */
export function setCurrentOrg(orgId: string) {
  localStorage.setItem('current_org_id', orgId);
}

/**
 * Get current org_id from localStorage
 */
export function getCurrentOrg(): string | null {
  return localStorage.getItem('current_org_id');
}

/**
 * Clear current org
 */
export function clearCurrentOrg() {
  localStorage.removeItem('current_org_id');
}

