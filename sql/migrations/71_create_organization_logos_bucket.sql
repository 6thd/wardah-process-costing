-- ===================================
-- إنشاء Storage Bucket لشعارات المؤسسات
-- التاريخ: 13 ديسمبر 2025
-- ===================================

-- ملاحظة مهمة:
-- هذا السكريبت يجب تنفيذه في Supabase SQL Editor
-- أو يمكنك إنشاء الـ Bucket من لوحة التحكم مباشرة

-- ===================================
-- 1. إنشاء الـ Bucket
-- ===================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'organization-logos',
    'organization-logos',
    TRUE,
    5242880, -- 5MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
    public = TRUE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'];

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
USING (bucket_id = 'organization-logos');

-- سياسة الرفع (المستخدمون المسجلون فقط يمكنهم رفع الشعارات)
CREATE POLICY "Authenticated users can upload organization logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'organization-logos'
    AND (storage.foldername(name))[1] IN (
        SELECT org_id::TEXT 
        FROM user_organizations 
        WHERE user_id = auth.uid() 
          AND is_active = TRUE
          AND role IN ('admin', 'manager')
    )
);

-- سياسة التحديث (المستخدمون المسجلون فقط يمكنهم تحديث الشعارات)
CREATE POLICY "Users can update their organization logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'organization-logos'
    AND (storage.foldername(name))[1] IN (
        SELECT org_id::TEXT 
        FROM user_organizations 
        WHERE user_id = auth.uid() 
          AND is_active = TRUE
          AND role IN ('admin', 'manager')
    )
);

-- سياسة الحذف (المستخدمون المسجلون فقط يمكنهم حذف الشعارات)
CREATE POLICY "Users can delete their organization logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'organization-logos'
    AND (storage.foldername(name))[1] IN (
        SELECT org_id::TEXT 
        FROM user_organizations 
        WHERE user_id = auth.uid() 
          AND is_active = TRUE
          AND role IN ('admin', 'manager')
    )
);

-- ===================================
-- تحقق من الإنشاء
-- ===================================
-- SELECT * FROM storage.buckets WHERE id = 'organization-logos';
