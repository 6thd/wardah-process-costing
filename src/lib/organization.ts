/**
 * Organization Profile Management
 * إدارة ملف الشركة / المؤسسة
 * Multi-tenant Support
 */

import { supabase, getEffectiveTenantId } from './supabase';

// ===================================
// Types - أنواع البيانات
// ===================================

export interface OrganizationProfile {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  name_en: string | null;
  // البيانات الضريبية والتجارية
  tax_number: string | null;
  commercial_registration: string | null;
  license_number: string | null;
  // بيانات التواصل
  phone: string | null;
  mobile: string | null;
  email: string | null;
  website: string | null;
  fax: string | null;
  // العنوان
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  // الشعار والهوية البصرية
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  // إعدادات إضافية
  currency: string | null;
  timezone: string | null;
  fiscal_year_start: number | null;
  date_format: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  name_ar?: string;
  name_en?: string;
  tax_number?: string;
  commercial_registration?: string;
  license_number?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  website?: string;
  fax?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  secondary_color?: string;
  currency?: string;
  timezone?: string;
  fiscal_year_start?: number;
  date_format?: string;
}

export interface OrganizationResult {
  success: boolean;
  data?: OrganizationProfile;
  error?: string;
}

// ===================================
// Functions - الدوال
// ===================================

/**
 * Get current user's organization profile
 * الحصول على ملف المؤسسة الحالية
 */
export async function getOrganizationProfile(): Promise<OrganizationResult> {
  try {
    const orgId = await getEffectiveTenantId();
    
    if (!orgId) {
      return { success: false, error: 'لم يتم العثور على معرف المؤسسة' };
    }

    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (error) {
      console.error('Error fetching organization:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as OrganizationProfile };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
    console.error('Unexpected error in getOrganizationProfile:', err);
    return { success: false, error: errorMessage };
  }
}

/**
 * Update organization profile
 * تحديث ملف المؤسسة
 */
export async function updateOrganizationProfile(
  updates: UpdateOrganizationInput
): Promise<OrganizationResult> {
  try {
    const orgId = await getEffectiveTenantId();
    
    if (!orgId) {
      return { success: false, error: 'لم يتم العثور على معرف المؤسسة' };
    }

    // تنظيف البيانات من القيم الفارغة
    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== '') {
        cleanUpdates[key] = value;
      }
    }

    cleanUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('organizations')
      .update(cleanUpdates)
      .eq('id', orgId)
      .select()
      .single();

    if (error) {
      console.error('Error updating organization:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as OrganizationProfile };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
    console.error('Unexpected error in updateOrganizationProfile:', err);
    return { success: false, error: errorMessage };
  }
}

/**
 * Upload organization logo
 * رفع شعار المؤسسة
 */
export async function uploadOrganizationLogo(
  file: File
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const orgId = await getEffectiveTenantId();
    
    if (!orgId) {
      return { success: false, error: 'لم يتم العثور على معرف المؤسسة' };
    }

    // التحقق من نوع الملف
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
      return { success: false, error: 'نوع الملف غير مدعوم. الأنواع المدعومة: JPG, PNG, WebP, SVG' };
    }

    // التحقق من حجم الملف (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return { success: false, error: 'حجم الملف يتجاوز 5 ميجابايت' };
    }

    // إنشاء اسم فريد للملف
    // ⚠️ IMPORTANT: The path contains org_id to isolate files for each organization
    // This prevents cross-tenant file access in Multi-tenant architecture
    // SECURITY: RLS Policies in Storage Bucket verify user permissions before any operation
    const fileExt = file.name.split('.').pop();
    const fileName = `${orgId}/logo-${Date.now()}.${fileExt}`;

    // رفع الملف
    // Note: RLS Policies in Storage Bucket verify user permissions
    const { error: uploadError } = await supabase.storage
      .from('organization-logos')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      console.error('Error uploading logo:', uploadError);
      return { success: false, error: uploadError.message };
    }

    // الحصول على الرابط العام
    const { data: urlData } = supabase.storage
      .from('organization-logos')
      .getPublicUrl(fileName);

    const logoUrl = urlData.publicUrl;

    // تحديث المؤسسة بالشعار الجديد
    const updateResult = await updateOrganizationProfile({ logo_url: logoUrl });
    
    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    return { success: true, url: logoUrl };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
    console.error('Unexpected error in uploadOrganizationLogo:', err);
    return { success: false, error: errorMessage };
  }
}

/**
 * Delete organization logo
 * حذف شعار المؤسسة
 */
export async function deleteOrganizationLogo(): Promise<{ success: boolean; error?: string }> {
  try {
    const orgId = await getEffectiveTenantId();
    
    if (!orgId) {
      return { success: false, error: 'لم يتم العثور على معرف المؤسسة' };
    }

    // الحصول على الشعار الحالي
    const profileResult = await getOrganizationProfile();
    if (!profileResult.success || !profileResult.data?.logo_url) {
      return { success: true }; // لا يوجد شعار للحذف
    }

    // استخراج مسار الملف من الرابط
    const logoUrl = profileResult.data.logo_url;
    const pathMatch = logoUrl.match(/organization-logos\/(.+)$/);
    
    if (pathMatch) {
      const filePath = pathMatch[1];
      await supabase.storage
        .from('organization-logos')
        .remove([filePath]);
    }

    // تحديث المؤسسة بإزالة الشعار
    const updateResult = await updateOrganizationProfile({ logo_url: '' });
    
    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
    console.error('Unexpected error in deleteOrganizationLogo:', err);
    return { success: false, error: errorMessage };
  }
}

/**
 * Get organization by ID (for admin purposes)
 * الحصول على مؤسسة بواسطة المعرف
 */
export async function getOrganizationById(
  orgId: string
): Promise<OrganizationResult> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (error) {
      console.error('Error fetching organization by ID:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as OrganizationProfile };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
    console.error('Unexpected error in getOrganizationById:', err);
    return { success: false, error: errorMessage };
  }
}

