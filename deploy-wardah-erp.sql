-- =======================================
-- Wardah ERP Deployment Script
-- تنفيذ شامل لنظام وردة البيان ERP
-- =======================================

-- المتغيرات المطلوبة:
-- TENANT_ID: 00000000-0000-0000-0000-000000000001 (Wardah Factory)

-- ضبط سياق الجلسة للمستأجر
SET LOCAL "request.jwt.claims" = json_build_object(
  'role','service_role',
  'tenant_id','00000000-0000-0000-0000-000000000001'
)::text;

BEGIN;

-- =======================================
-- 1. التحقق من وجود المؤسسة
-- =======================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001') THEN
    INSERT INTO organizations (id, name, code, is_active)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Wardah Factory', 'WARDAH', true);
    RAISE NOTICE 'تم إنشاء مؤسسة Wardah Factory';
  ELSE
    RAISE NOTICE 'مؤسسة Wardah موجودة مسبقاً';
  END IF;
END $$;

-- =======================================
-- 2. إنشاء جدول مرحلي لشجرة الحسابات
-- =======================================
DROP TABLE IF EXISTS temp_coa_import;
CREATE TEMP TABLE temp_coa_import (
  code TEXT,
  name TEXT,
  category TEXT,
  subtype TEXT,
  parent_code TEXT,
  normal_balance TEXT,
  allow_posting TEXT,
  is_active TEXT,
  currency TEXT,
  notes TEXT
);

RAISE NOTICE 'تم إنشاء الجدول المرحلي temp_coa_import';
RAISE NOTICE 'استخدم الأمر التالي لاستيراد الـ CSV:';
RAISE NOTICE '\copy temp_coa_import FROM ''wardah_enhanced_coa.csv'' WITH (FORMAT CSV, HEADER true, ENCODING ''UTF8'');';

COMMIT;
