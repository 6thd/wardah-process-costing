-- ===================================
-- إصلاح شامل لمشكلة Tenant ID
-- التاريخ: 28 أكتوبر 2025
-- الأولوية: حرجة جداً
-- ===================================

-- ملاحظات مهمة:
-- 1. نفذ 00_create_missing_tables.sql أولاً
-- 2. تأكد من عمل Backup قبل التنفيذ!
-- 3. نفذ هذا السكريبت في Supabase SQL Editor

BEGIN;

-- ===================================
-- الخطوة 1: إنشاء منظمة افتراضية
-- ===================================
INSERT INTO organizations (
  id,
  name,
  name_ar,
  code,
  is_active,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Wardah Factory',
  'مصنع وردة',
  'WF-001',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET 
  name = EXCLUDED.name,
  name_ar = EXCLUDED.name_ar,
  is_active = true,
  updated_at = NOW();

-- التحقق
SELECT 
  id,
  name,
  name_ar,
  code,
  is_active
FROM organizations
WHERE id = '00000000-0000-0000-0000-000000000001';

-- ===================================
-- الخطوة 2: تحديث org_id في gl_accounts
-- ===================================

-- عرض الوضع الحالي
SELECT 
  'Before Fix' as status,
  COUNT(*) FILTER (WHERE org_id IS NULL) as null_count,
  COUNT(*) FILTER (WHERE org_id IS NOT NULL) as not_null_count,
  COUNT(*) as total
FROM gl_accounts;

-- تحديث الحسابات التي org_id فيها NULL
UPDATE gl_accounts
SET 
  org_id = '00000000-0000-0000-0000-000000000001',
  updated_at = NOW()
WHERE org_id IS NULL;

-- عرض النتيجة بعد التحديث
SELECT 
  'After Fix' as status,
  COUNT(*) FILTER (WHERE org_id IS NULL) as null_count,
  COUNT(*) FILTER (WHERE org_id IS NOT NULL) as not_null_count,
  COUNT(*) as total
FROM gl_accounts;

-- ===================================
-- الخطوة 3: ربط المستخدمين بالمنظمة
-- ===================================

-- عرض المستخدمين الموجودين
SELECT 
  'Current Users' as info,
  COUNT(*) as user_count
FROM auth.users;

-- عرض الربط الحالي
SELECT 
  'Current Associations' as info,
  COUNT(*) as association_count
FROM user_organizations;

-- ربط جميع المستخدمين بالمنظمة الافتراضية
INSERT INTO user_organizations (user_id, org_id, role, created_at, updated_at)
SELECT 
  u.id,
  '00000000-0000-0000-0000-000000000001'::UUID,
  'admin',
  NOW(),
  NOW()
FROM auth.users u
ON CONFLICT (user_id, org_id) 
DO UPDATE SET 
  role = 'admin',
  updated_at = NOW();

-- عرض النتيجة
SELECT 
  u.email,
  uo.org_id,
  o.name as org_name,
  uo.role
FROM auth.users u
JOIN user_organizations uo ON u.id = uo.user_id
JOIN organizations o ON uo.org_id = o.id
ORDER BY u.email;

-- ===================================
-- الخطوة 4: إضافة قيود NOT NULL
-- ===================================

-- ملاحظة: gl_accounts يستخدم org_id وليس tenant_id
-- org_id محدد بالفعل كـ NOT NULL في schema

-- التحقق من constraint
SELECT 
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'gl_accounts' 
  AND column_name = 'org_id';

-- ===================================
-- الخطوة 5: تطبيق نفس الإصلاح على الجداول الأخرى
-- ===================================

-- التحقق من الجداول الموجودة
DO $$
DECLARE
    table_exists BOOLEAN;
BEGIN
    -- manufacturing_orders
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'manufacturing_orders'
    ) INTO table_exists;
    
    IF table_exists THEN
        UPDATE manufacturing_orders
        SET org_id = '00000000-0000-0000-0000-000000000001'
        WHERE org_id IS NULL;
        RAISE NOTICE '✅ تم تحديث manufacturing_orders';
    END IF;

    -- products
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'products'
    ) INTO table_exists;
    
    IF table_exists THEN
        UPDATE products
        SET org_id = '00000000-0000-0000-0000-000000000001'
        WHERE org_id IS NULL;
        RAISE NOTICE '✅ تم تحديث products';
    END IF;

    -- purchase_orders
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'purchase_orders'
    ) INTO table_exists;
    
    IF table_exists THEN
        UPDATE purchase_orders
        SET org_id = '00000000-0000-0000-0000-000000000001'
        WHERE org_id IS NULL;
        RAISE NOTICE '✅ تم تحديث purchase_orders';
    END IF;

    -- sales_orders
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'sales_orders'
    ) INTO table_exists;
    
    IF table_exists THEN
        UPDATE sales_orders
        SET org_id = '00000000-0000-0000-0000-000000000001'
        WHERE org_id IS NULL;
        RAISE NOTICE '✅ تم تحديث sales_orders';
    END IF;
END $$;

-- ===================================
-- الخطوة 6: التحقق النهائي
-- ===================================

-- عرض ملخص شامل
DO $$
DECLARE
    gl_count INTEGER;
    mo_count INTEGER := 0;
    prod_count INTEGER := 0;
    po_count INTEGER := 0;
    so_count INTEGER := 0;
    user_assoc_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO gl_count 
    FROM gl_accounts 
    WHERE org_id = '00000000-0000-0000-0000-000000000001';
    
    SELECT COUNT(*) INTO user_assoc_count
    FROM user_organizations 
    WHERE org_id = '00000000-0000-0000-0000-000000000001';

    -- عد الجداول الأخرى إن وجدت
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'manufacturing_orders') THEN
        SELECT COUNT(*) INTO mo_count FROM manufacturing_orders WHERE org_id = '00000000-0000-0000-0000-000000000001';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'products') THEN
        SELECT COUNT(*) INTO prod_count FROM products WHERE org_id = '00000000-0000-0000-0000-000000000001';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'purchase_orders') THEN
        SELECT COUNT(*) INTO po_count FROM purchase_orders WHERE org_id = '00000000-0000-0000-0000-000000000001';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sales_orders') THEN
        SELECT COUNT(*) INTO so_count FROM sales_orders WHERE org_id = '00000000-0000-0000-0000-000000000001';
    END IF;

    RAISE NOTICE '╔══════════════════════════════════════════╗';
    RAISE NOTICE '║     Summary Report - Wardah Factory     ║';
    RAISE NOTICE '╠══════════════════════════════════════════╣';
    RAISE NOTICE '║  GL Accounts: %                         ║', gl_count;
    RAISE NOTICE '║  Manufacturing Orders: %                ║', mo_count;
    RAISE NOTICE '║  Products: %                            ║', prod_count;
    RAISE NOTICE '║  Purchase Orders: %                     ║', po_count;
    RAISE NOTICE '║  Sales Orders: %                        ║', so_count;
    RAISE NOTICE '║  User Associations: %                   ║', user_assoc_count;
    RAISE NOTICE '╚══════════════════════════════════════════╝';
END $$;

COMMIT;

-- ===================================
-- رسالة النجاح
-- ===================================
DO $$
BEGIN
  RAISE NOTICE '✅ تم إصلاح مشكلة Tenant ID بنجاح!';
  RAISE NOTICE '✅ جميع البيانات مرتبطة بالمنظمة الافتراضية';
  RAISE NOTICE '✅ جميع المستخدمين مرتبطون بالمنظمة';
  RAISE NOTICE '📊 يمكنك الآن اختبار النظام';
END $$;
