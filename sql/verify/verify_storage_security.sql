-- ===================================
-- التحقق من أمان Multi-Tenant للشعارات
-- Verification Script
-- ===================================

-- 1. عرض جميع الملفات المرفوعة مع المجلدات
SELECT 
    name AS file_path,
    (storage.foldername(name))[1] AS org_id_folder,
    bucket_id,
    created_at,
    updated_at,
    metadata
FROM storage.objects
WHERE bucket_id = 'organization-logos'
ORDER BY created_at DESC;

-- 2. التحقق من السياسات المطبقة
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'objects'
  AND (
    policyname LIKE '%organization%' 
    OR policyname LIKE '%logo%'
  );

-- 3. عرض المؤسسات مع الشعارات
SELECT 
    o.id,
    o.code,
    o.name,
    o.name_ar,
    o.logo_url,
    CASE 
        WHEN o.logo_url IS NOT NULL THEN 'يوجد شعار'
        ELSE 'لا يوجد شعار'
    END AS status,
    o.updated_at
FROM organizations o
ORDER BY o.created_at DESC;

-- 4. عرض المستخدمين والمؤسسات المرتبطة بهم
SELECT 
    uo.user_id,
    uo.org_id,
    o.name AS org_name,
    o.logo_url,
    uo.role,
    uo.is_active,
    CASE 
        WHEN uo.role IN ('admin', 'manager') THEN 'يمكنه رفع الشعار'
        ELSE 'لا يمكنه رفع الشعار'
    END AS upload_permission
FROM user_organizations uo
JOIN organizations o ON o.id = uo.org_id
WHERE uo.is_active = TRUE
ORDER BY uo.created_at DESC;

-- 5. فحص صلاحية bucket
SELECT 
    id,
    name,
    public,
    file_size_limit / 1024 / 1024 AS max_size_mb,
    allowed_mime_types,
    created_at
FROM storage.buckets
WHERE id = 'organization-logos';

-- ===================================
-- اختبارات الأمان (للتشغيل يدوياً)
-- ===================================

-- Test 1: محاولة إدراج ملف في مجلد مؤسسة أخرى
-- (يجب أن يفشل)
-- INSERT INTO storage.objects (bucket_id, name, owner)
-- VALUES ('organization-logos', 'OTHER_ORG_ID/test.png', auth.uid());
-- Expected: Permission denied

-- Test 2: محاولة حذف ملف مؤسسة أخرى
-- (يجب أن يفشل)
-- DELETE FROM storage.objects 
-- WHERE bucket_id = 'organization-logos' 
--   AND name LIKE 'OTHER_ORG_ID/%';
-- Expected: 0 rows deleted (due to RLS)

-- Test 3: التحقق من عدد الملفات لكل مؤسسة
SELECT 
    (storage.foldername(name))[1] AS org_id,
    COUNT(*) AS file_count,
    MAX(created_at) AS last_upload
FROM storage.objects
WHERE bucket_id = 'organization-logos'
GROUP BY (storage.foldername(name))[1]
ORDER BY file_count DESC;
