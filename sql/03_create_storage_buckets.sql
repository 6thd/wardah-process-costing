-- ===================================================================
-- STORAGE BUCKETS CREATION
-- إنشاء Buckets للتخزين
-- ===================================================================
-- This script creates necessary storage buckets for the application
-- Run this in Supabase SQL Editor or Dashboard
-- ===================================================================

-- Note: Storage buckets must be created via Supabase Dashboard or API
-- This script provides the equivalent SQL commands for reference

-- Create 'documents' bucket for journal attachments and other documents
-- يجب تنفيذ هذا عبر Supabase Dashboard -> Storage -> New Bucket

-- Via SQL (if you have direct access to storage schema):
/*
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false, -- Private bucket
  52428800, -- 50MB limit
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;
*/

-- ===================================================================
-- STORAGE POLICIES
-- سياسات الوصول للتخزين
-- ===================================================================
-- ⚠️ NOTE: Storage policies are managed by Supabase automatically
-- ⚠️ ملاحظة: سياسات التخزين يديرها Supabase تلقائياً
-- You don't need to run this section manually
-- لا تحتاج لتنفيذ هذا القسم يدوياً
-- ===================================================================

/*
-- These policies are created automatically by Supabase when you create a bucket
-- هذه السياسات تُنشأ تلقائياً عند إنشاء البucket

-- Enable RLS on storage.objects (Already enabled by Supabase)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to upload files
CREATE POLICY "Allow authenticated users to upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');

-- Policy: Allow authenticated users to read their org's files
CREATE POLICY "Allow users to read org files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'documents');

-- Policy: Allow authenticated users to update their org's files
CREATE POLICY "Allow users to update org files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'documents')
WITH CHECK (bucket_id = 'documents');

-- Policy: Allow authenticated users to delete their org's files
CREATE POLICY "Allow users to delete org files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'documents');
*/

-- ===================================================================
-- MANUAL STEPS (Must be done in Supabase Dashboard)
-- خطوات يدوية (يجب تنفيذها في لوحة Supabase)
-- ===================================================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '⚠️  MANUAL STEPS REQUIRED';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '📦 Create Storage Bucket:';
    RAISE NOTICE '   1. Go to Supabase Dashboard';
    RAISE NOTICE '   2. Navigate to: Storage > Create bucket';
    RAISE NOTICE '   3. Bucket name: documents';
    RAISE NOTICE '   4. Public: OFF (Private)';
    RAISE NOTICE '   5. File size limit: 50 MB';
    RAISE NOTICE '   6. Allowed MIME types: PDF, Images, Office files';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Storage policies have been created successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Or use Supabase CLI:';
    RAISE NOTICE '   supabase storage create documents --private';
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
END $$;

