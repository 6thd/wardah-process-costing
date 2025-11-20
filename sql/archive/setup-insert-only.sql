-- ======================================================
-- إعداد كامل لنظام وردة البيان ERP
-- يجب تشغيله في Supabase SQL Editor
-- ======================================================

-- 1. إنشاء مؤسسة وردة البيان
INSERT INTO organizations (id, name, code, is_active, settings)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'وردة البيان للصناعات البلاستيكية',
  'WARDAH',
  true,
  '{"currency": "SAR", "timezone": "Asia/Riyadh", "fiscal_year_start": "01-01"}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET 
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  is_active = EXCLUDED.is_active,
  settings = EXCLUDED.settings,
  updated_at = now();

-- التحقق من إنشاء المؤسسة
SELECT 'تم إنشاء المؤسسة' as status, * FROM organizations 
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 2. إنشاء وحدات القياس الأساسية (إذا كان الجدول موجود)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'uoms') THEN
    INSERT INTO uoms (org_id, code, name, factor, is_base)
    VALUES 
      ('00000000-0000-0000-0000-000000000001', 'KG', 'كيلوجرام', 1.0, true),
      ('00000000-0000-0000-0000-000000000001', 'PCS', 'قطعة', 1.0, false),
      ('00000000-0000-0000-0000-000000000001', 'M', 'متر', 1.0, false),
      ('00000000-0000-0000-0000-000000000001', 'TON', 'طن', 1000.0, false)
    ON CONFLICT (org_id, code) DO NOTHING;
    
    RAISE NOTICE 'تم إنشاء وحدات القياس';
  END IF;
END $$;

-- 3. إنشاء المستودع الرئيسي (إذا كان الجدول موجود)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'warehouses') THEN
    INSERT INTO warehouses (org_id, code, name)
    VALUES ('00000000-0000-0000-0000-000000000001', 'WH01', 'المستودع الرئيسي')
    ON CONFLICT (org_id, code) DO NOTHING;
    
    RAISE NOTICE 'تم إنشاء المستودع';
  END IF;
END $$;

-- 4. إنشاء المواقع (إذا كانت الجداول موجودة)
DO $$
DECLARE
  warehouse_uuid UUID;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'locations') THEN
    SELECT id INTO warehouse_uuid FROM warehouses 
    WHERE org_id = '00000000-0000-0000-0000-000000000001' 
    AND code = 'WH01';
    
    IF warehouse_uuid IS NOT NULL THEN
      INSERT INTO locations (org_id, warehouse_id, code, name, usage)
      VALUES 
        ('00000000-0000-0000-0000-000000000001', warehouse_uuid, 'RM-STOCK', 'مخزن المواد الخام', 'MATERIAL'),
        ('00000000-0000-0000-0000-000000000001', warehouse_uuid, 'WIP-MAIN', 'الإنتاج تحت التشغيل', 'WIP'),
        ('00000000-0000-0000-0000-000000000001', warehouse_uuid, 'FG-STOCK', 'مخزن المنتجات الجاهزة', 'PRODUCT'),
        ('00000000-0000-0000-0000-000000000001', warehouse_uuid, 'SCRAP', 'موقع الخردة', 'SCRAP')
      ON CONFLICT (org_id, code) DO NOTHING;
      
      RAISE NOTICE 'تم إنشاء المواقع';
    END IF;
  END IF;
END $$;

-- 5. إعدادات التكاليف (إذا كان الجدول موجود)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'cost_settings') THEN
    INSERT INTO cost_settings (
      org_id, 
      costing_method, 
      auto_post_journal,
      currency,
      fiscal_year_start,
      overhead_allocation_basis
    )
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      'AVCO',
      true,
      'SAR',
      '01-01',
      'LABOR_HOURS'
    )
    ON CONFLICT (org_id) DO UPDATE
    SET 
      costing_method = EXCLUDED.costing_method,
      auto_post_journal = EXCLUDED.auto_post_journal,
      currency = EXCLUDED.currency,
      fiscal_year_start = EXCLUDED.fiscal_year_start,
      overhead_allocation_basis = EXCLUDED.overhead_allocation_basis,
      updated_at = now();
    
    RAISE NOTICE 'تم إعداد إعدادات التكاليف';
  END IF;
END $$;

-- ✅ تم الإعداد الأساسي - التحقق من المؤسسة فقط
SELECT 
  '✅ تم إعداد البيانات الأساسية' as status,
  COUNT(*) as organizations_count
FROM organizations
WHERE id = '00000000-0000-0000-0000-000000000001';
