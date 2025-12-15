-- ===================================
-- إنشاء Storage Bucket لشعارات المؤسسات
-- التاريخ: 13 ديسمبر 2025
-- ===================================
SET QUOTED_IDENTIFIER ON;

-- ملاحظة مهمة:
-- هذا السكريبت يجب تنفيذه في Supabase SQL Editor
-- أو يمكنك إنشاء الـ Bucket من لوحة التحكم مباشرة

-- ===================================
-- تعريف الثوابت (Constants)
-- ===================================
DO $$
DECLARE
    -- Bucket Configuration
    v_bucket_id CONSTANT TEXT := 'organization-logos';
    v_max_file_size CONSTANT INTEGER := 5242880; -- 5MB
    v_allowed_types CONSTANT TEXT[] := ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'];
BEGIN
    -- 1. إنشاء الـ Bucket
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (v_bucket_id, v_bucket_id, TRUE, v_max_file_size, v_allowed_types)
    ON CONFLICT (id) DO UPDATE SET
        public = TRUE,
        file_size_limit = v_max_file_size,
        allowed_mime_types = v_allowed_types;
END $$;

-- ===================================
-- 2. سياسات الوصول للـ Bucket
-- ===================================

-- حذف السياسات القديمة إن وجدت
DROP POLICY IF EXISTS "Public read access for organization logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload organization logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their organization logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their organization logos" ON storage.objects;

-- ثابت اسم الـ bucket (للتوثيق - السياسات تتطلب literal)
-- NOTE: Policy definitions require literal strings, but we document the constant here
-- BUCKET_ID = 'organization-logos'

-- Helper function to check if bucket is organization-logos
CREATE OR REPLACE FUNCTION storage.is_org_logos_bucket(p_bucket_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_bucket_id = 'organization-logos'
$$;

-- سياسة القراءة العامة (الجميع يمكنه رؤية الشعارات)
CREATE POLICY "Public read access for organization logos"
ON storage.objects
FOR SELECT
USING (storage.is_org_logos_bucket(bucket_id));

-- Helper function to check user organization access
CREATE OR REPLACE FUNCTION storage.check_org_logo_access()
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN ARRAY(
        SELECT org_id::TEXT 
        FROM user_organizations 
        WHERE user_id = auth.uid() 
          AND is_active
          AND role IN ('admin', 'manager')
    );
END;
$$;

-- سياسة الرفع (المستخدمون المسجلون فقط يمكنهم رفع الشعارات)
CREATE POLICY "Authenticated users can upload organization logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    storage.is_org_logos_bucket(bucket_id)
    AND (storage.foldername(name))[1] = ANY(storage.check_org_logo_access())
);

-- سياسة التحديث (المستخدمون المسجلون فقط يمكنهم تحديث الشعارات)
-- ⚠️ WITH CHECK clause added to prevent cross-tenant logo moves
CREATE POLICY "Users can update their organization logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    storage.is_org_logos_bucket(bucket_id)
    AND (storage.foldername(name))[1] = ANY(storage.check_org_logo_access())
)
WITH CHECK (
    storage.is_org_logos_bucket(bucket_id)
    AND (storage.foldername(name))[1] = ANY(storage.check_org_logo_access())
);

-- سياسة الحذف (المستخدمون المسجلون فقط يمكنهم حذف الشعارات)
CREATE POLICY "Users can delete their organization logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    storage.is_org_logos_bucket(bucket_id)
