-- ===================================
-- إنشاء Storage Bucket لشعارات المؤسسات
-- التاريخ: 13 ديسمبر 2025
-- ===================================

-- ملاحظة مهمة:
-- هذا السكريبت يجب تنفيذه في Supabase SQL Editor
-- أو يمكنك إنشاء الـ Bucket من لوحة التحكم مباشرة

-- ===================================
-- Constants
-- ===================================
DO $$
DECLARE
    BUCKET_NAME CONSTANT TEXT := 'organization-logos';
BEGIN
    -- Create bucket if not exists
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
        BUCKET_NAME,
        BUCKET_NAME,
        TRUE,
        5242880, -- 5MB
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif']
    )
    ON CONFLICT (id) DO UPDATE SET
        public = TRUE,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'];
END $$;

-- ===================================
-- Helper function to check bucket
-- ===================================
CREATE OR REPLACE FUNCTION storage.is_org_logos_bucket(p_bucket_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_bucket_id = 'organization-logos';
$$;

-- Helper function to check user organization access for logos
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

-- ===================================
-- 2. سياسات الوصول للـ Bucket
-- ===================================

-- حذف السياسات القديمة إن وجدت
DROP POLICY IF EXISTS "Public read access for organization logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload organization logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their organization logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their organization logos" ON storage.objects;

-- سياسة القراءة العامة (الجميع يمكنه رؤية الشعارات)
CREATE POLICY "Public read access for organization logos"
ON storage.objects
FOR SELECT
USING (storage.is_org_logos_bucket(bucket_id));

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
-- ⚠️ SECURITY: WITH CHECK clause prevents cross-tenant logo moves
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
    AND (storage.foldername(name))[1] = ANY(storage.check_org_logo_access())
);

-- ===================================
-- تحقق من الإنشاء
-- ===================================
-- Run this separately to verify:
-- SELECT * FROM storage.buckets WHERE id = 'organization-logos';
