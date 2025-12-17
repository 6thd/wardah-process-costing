-- ===================================
-- تحسين جدول المؤسسات - ملف الشركة المتكامل
-- التاريخ: 13 ديسمبر 2025
-- Multi-tenant Support
-- ===================================

BEGIN;

-- ===================================
-- 1. إضافة الحقول الجديدة لجدول المؤسسات
-- ===================================

-- إضافة حقول المعلومات الأساسية
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS name_ar VARCHAR(255),
ADD COLUMN IF NOT EXISTS name_en VARCHAR(255),
ADD COLUMN IF NOT EXISTS tax_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS commercial_registration VARCHAR(50),
ADD COLUMN IF NOT EXISTS license_number VARCHAR(50);

-- إضافة حقول التواصل
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS mobile VARCHAR(20),
ADD COLUMN IF NOT EXISTS email VARCHAR(255),
ADD COLUMN IF NOT EXISTS website VARCHAR(255),
ADD COLUMN IF NOT EXISTS fax VARCHAR(20);

-- إضافة حقول العنوان
DO $$
DECLARE
    default_country CONSTANT VARCHAR := 'Saudi Arabia';
BEGIN
    ALTER TABLE organizations 
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS state VARCHAR(100),
    ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT default_country,
    ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
END $$;

-- إضافة حقول الشعار والهوية
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS favicon_url TEXT,
ADD COLUMN IF NOT EXISTS primary_color VARCHAR(10) DEFAULT '#1e40af',
ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(10) DEFAULT '#3b82f6';

-- إضافة حقول إضافية
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'SAR',
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Asia/Riyadh',
ADD COLUMN IF NOT EXISTS fiscal_year_start INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS date_format VARCHAR(20) DEFAULT 'DD/MM/YYYY';

-- ===================================
-- 2. إنشاء فهارس للبحث السريع
-- ===================================

CREATE INDEX IF NOT EXISTS idx_organizations_tax_number ON organizations(tax_number) WHERE tax_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_commercial_registration ON organizations(commercial_registration) WHERE commercial_registration IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_name_ar ON organizations(name_ar) WHERE name_ar IS NOT NULL;

-- ===================================
-- 3. إنشاء Storage Bucket للشعارات
-- ===================================

-- ملاحظة: يجب تنفيذ هذا من Supabase Dashboard أو عبر API
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--     'organization-logos',
--     'organization-logos',
--     true,
--     5242880, -- 5MB
--     ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
-- ) ON CONFLICT (id) DO NOTHING;

-- ===================================
-- 4. دالة تحديث المؤسسة مع الصلاحيات
-- ===================================

CREATE OR REPLACE FUNCTION update_organization_profile(
    p_org_id UUID,
    p_name VARCHAR(255) DEFAULT NULL,
    p_name_ar VARCHAR(255) DEFAULT NULL,
    p_name_en VARCHAR(255) DEFAULT NULL,
    p_tax_number VARCHAR(50) DEFAULT NULL,
    p_commercial_registration VARCHAR(50) DEFAULT NULL,
    p_license_number VARCHAR(50) DEFAULT NULL,
    p_phone VARCHAR(20) DEFAULT NULL,
    p_mobile VARCHAR(20) DEFAULT NULL,
    p_email VARCHAR(255) DEFAULT NULL,
    p_website VARCHAR(255) DEFAULT NULL,
    p_fax VARCHAR(20) DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_city VARCHAR(100) DEFAULT NULL,
    p_state VARCHAR(100) DEFAULT NULL,
    p_country VARCHAR(100) DEFAULT NULL,
    p_postal_code VARCHAR(20) DEFAULT NULL,
    p_logo_url TEXT DEFAULT NULL,
    p_primary_color VARCHAR(10) DEFAULT NULL,
    p_secondary_color VARCHAR(10) DEFAULT NULL,
    p_currency VARCHAR(3) DEFAULT NULL,
    p_timezone VARCHAR(50) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_user_role VARCHAR(50);
    v_result JSONB;
    v_is_authorized BOOLEAN;
BEGIN
    -- الحصول على المستخدم الحالي
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'غير مصرح');
    END IF;
    
    -- التحقق من صلاحية المستخدم
    SELECT role INTO v_user_role
    FROM user_organizations
    WHERE user_id = v_user_id 
      AND org_id = p_org_id 
      AND is_active;
    
    v_is_authorized := v_user_role IS NOT NULL AND v_user_role IN ('admin', 'manager');
    
    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'ليس لديك صلاحية لتعديل بيانات المؤسسة');
    END IF;
    
    -- تحديث البيانات
    UPDATE organizations SET
        name = COALESCE(p_name, name),
        name_ar = COALESCE(p_name_ar, name_ar),
        name_en = COALESCE(p_name_en, name_en),
        tax_number = COALESCE(p_tax_number, tax_number),
        commercial_registration = COALESCE(p_commercial_registration, commercial_registration),
        license_number = COALESCE(p_license_number, license_number),
        phone = COALESCE(p_phone, phone),
        mobile = COALESCE(p_mobile, mobile),
        email = COALESCE(p_email, email),
        website = COALESCE(p_website, website),
        fax = COALESCE(p_fax, fax),
        address = COALESCE(p_address, address),
        city = COALESCE(p_city, city),
        state = COALESCE(p_state, state),
        country = COALESCE(p_country, country),
        postal_code = COALESCE(p_postal_code, postal_code),
        logo_url = COALESCE(p_logo_url, logo_url),
        primary_color = COALESCE(p_primary_color, primary_color),
        secondary_color = COALESCE(p_secondary_color, secondary_color),
        currency = COALESCE(p_currency, currency),
        timezone = COALESCE(p_timezone, timezone),
        updated_at = NOW()
    WHERE id = p_org_id;
    
    -- إرجاع البيانات المحدثة
    SELECT jsonb_build_object(
        'success', TRUE,
        'data', row_to_json(o.*)
    ) INTO v_result
    FROM organizations o
    WHERE o.id = p_org_id;
    
    RETURN v_result;
END;
$$;

-- ===================================
-- 5. دالة الحصول على بيانات المؤسسة
-- ===================================

CREATE OR REPLACE FUNCTION get_organization_profile(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_result JSONB;
    v_has_access INTEGER;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'غير مصرح');
    END IF;
    
    -- التحقق من أن المستخدم ينتمي للمؤسسة باستخدام COUNT بدلاً من EXISTS
    SELECT COUNT(*) INTO v_has_access
    FROM user_organizations 
    WHERE user_id = v_user_id 
      AND org_id = p_org_id 
      AND is_active
    LIMIT 1;
    
    IF v_has_access = 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'ليس لديك صلاحية للوصول لهذه المؤسسة');
    END IF;
    
    SELECT jsonb_build_object(
        'success', TRUE,
        'data', jsonb_build_object(
            'id', o.id,
            'code', o.code,
            'name', o.name,
            'name_ar', o.name_ar,
            'name_en', o.name_en,
            'tax_number', o.tax_number,
            'commercial_registration', o.commercial_registration,
            'license_number', o.license_number,
            'phone', o.phone,
            'mobile', o.mobile,
            'email', o.email,
            'website', o.website,
            'fax', o.fax,
            'address', o.address,
            'city', o.city,
            'state', o.state,
            'country', o.country,
            'postal_code', o.postal_code,
            'logo_url', o.logo_url,
            'favicon_url', o.favicon_url,
            'primary_color', o.primary_color,
            'secondary_color', o.secondary_color,
            'currency', o.currency,
            'timezone', o.timezone,
            'fiscal_year_start', o.fiscal_year_start,
            'date_format', o.date_format,
            'is_active', o.is_active,
            'created_at', o.created_at,
            'updated_at', o.updated_at
        )
    ) INTO v_result
    FROM organizations o
    WHERE o.id = p_org_id;
    
    IF v_result IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'المؤسسة غير موجودة');
    END IF;
    
    RETURN v_result;
END;
$$;

-- ===================================
-- 6. منح الصلاحيات
-- ===================================

GRANT EXECUTE ON FUNCTION update_organization_profile TO authenticated;
GRANT EXECUTE ON FUNCTION get_organization_profile TO authenticated;

COMMIT;

-- ===================================
-- تعليمات إضافية:
-- ===================================
-- 1. أنشئ Storage Bucket من Supabase Dashboard باسم "organization-logos"
-- 2. اجعله public
-- 3. أضف السياسات التالية:
--    - SELECT: للجميع (public)
--    - INSERT/UPDATE/DELETE: للمستخدمين المصرح لهم فقط
