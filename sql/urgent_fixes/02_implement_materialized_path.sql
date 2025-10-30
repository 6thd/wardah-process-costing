-- ===================================
-- تطبيق Materialized Path لحل Stack Depth
-- التاريخ: 28 أكتوبر 2025
-- الأولوية: حرجة جداً
-- ===================================

-- ملاحظة مهمة: نفذ هذا السكريبت بعد 01_fix_tenant_id.sql
-- تأكد من عمل Backup قبل التنفيذ!

BEGIN;

-- ===================================
-- الخطوة 1: تفعيل ltree extension
-- ===================================
CREATE EXTENSION IF NOT EXISTS ltree;

-- التحقق من تفعيل ltree
SELECT 
  'ltree extension' as extension_name,
  extversion as version,
  'installed' as status
FROM pg_extension
WHERE extname = 'ltree';

-- ===================================
-- الخطوة 2: إضافة عمود path
-- ===================================

-- إضافة العمود إن لم يكن موجوداً
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gl_accounts' 
    AND column_name = 'path'
  ) THEN
    ALTER TABLE gl_accounts ADD COLUMN path ltree;
    RAISE NOTICE '✅ تم إضافة عمود path';
  ELSE
    RAISE NOTICE '⚠️ عمود path موجود مسبقاً';
  END IF;
END $$;

-- ===================================
-- الخطوة 3: إنشاء Indexes للأداء
-- ===================================

-- Index رئيسي باستخدام GIST
DROP INDEX IF EXISTS idx_gl_accounts_path;
CREATE INDEX idx_gl_accounts_path 
ON gl_accounts USING GIST (path);

-- Index على parent_code للمساعدة في الحسابات
DROP INDEX IF EXISTS idx_gl_accounts_parent_code;
CREATE INDEX idx_gl_accounts_parent_code 
ON gl_accounts (parent_code) 
WHERE parent_code IS NOT NULL;

-- Index على code
DROP INDEX IF EXISTS idx_gl_accounts_code;
CREATE INDEX idx_gl_accounts_code 
ON gl_accounts (code);

DO $$
BEGIN
  RAISE NOTICE '✅ تم إنشاء Indexes';
END $$;

-- ===================================
-- الخطوة 4: دالة لحساب path
-- ===================================

CREATE OR REPLACE FUNCTION calculate_account_path(p_account_code TEXT)
RETURNS ltree
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_code TEXT;
  v_parent_path ltree;
  v_iteration INTEGER := 0;
  v_max_iterations INTEGER := 50; -- حماية من infinite loop
BEGIN
  -- الحصول على parent_code
  SELECT parent_code INTO v_parent_code
  FROM gl_accounts
  WHERE code = p_account_code;
  
  -- إذا لم يكن له parent، path = code نفسه
  IF v_parent_code IS NULL OR v_parent_code = '' THEN
    RETURN p_account_code::ltree;
  END IF;
  
  -- حساب path الـ parent
  SELECT path INTO v_parent_path
  FROM gl_accounts
  WHERE code = v_parent_code;
  
  -- إذا الـ parent ما عنده path، احسبه recursively مع حد أقصى
  IF v_parent_path IS NULL THEN
    WHILE v_parent_path IS NULL AND v_iteration < v_max_iterations LOOP
      v_parent_path := calculate_account_path(v_parent_code);
      v_iteration := v_iteration + 1;
    END LOOP;
    
    IF v_iteration >= v_max_iterations THEN
      RAISE EXCEPTION 'Max iterations reached for account %. Possible circular reference.', p_account_code;
    END IF;
    
    -- حفظ path الـ parent
    UPDATE gl_accounts 
    SET path = v_parent_path 
    WHERE code = v_parent_code;
  END IF;
  
  -- path = parent_path + current_code
  RETURN (v_parent_path::text || '.' || p_account_code)::ltree;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error calculating path for %: %', p_account_code, SQLERRM;
    RETURN p_account_code::ltree; -- fallback
END;
$$;

DO $$
BEGIN
  RAISE NOTICE '✅ تم إنشاء دالة calculate_account_path';
END $$;

-- ===================================
-- الخطوة 5: تعبئة path للحسابات الموجودة
-- ===================================

-- المرحلة 1: الحسابات الجذر (بدون parent)
UPDATE gl_accounts
SET path = code::ltree
WHERE (parent_code IS NULL OR parent_code = '')
AND path IS NULL;

-- عرض التقدم
SELECT 
  'Phase 1: Root Accounts' as phase,
  COUNT(*) as updated_count
FROM gl_accounts
WHERE path IS NOT NULL;

-- المرحلة 2: تعبئة الحسابات الفرعية (قد يحتاج عدة تكرارات)
DO $$
DECLARE
  v_updated_count INTEGER;
  v_iteration INTEGER := 0;
  v_max_iterations INTEGER := 10;
BEGIN
  LOOP
    -- تحديث الحسابات التي parent لها path
    UPDATE gl_accounts a
    SET path = (p.path::text || '.' || a.code)::ltree
    FROM gl_accounts p
    WHERE a.parent_code = p.code
    AND p.path IS NOT NULL
    AND a.path IS NULL;
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    v_iteration := v_iteration + 1;
    
    RAISE NOTICE 'Iteration %: Updated % accounts', v_iteration, v_updated_count;
    
    -- إيقاف إذا لم يتم تحديث أي شيء أو وصلنا للحد الأقصى
    EXIT WHEN v_updated_count = 0 OR v_iteration >= v_max_iterations;
  END LOOP;
  
  RAISE NOTICE '✅ Phase 2 completed after % iterations', v_iteration;
END $$;

-- المرحلة 3: معالجة الحسابات المتبقية يدوياً
UPDATE gl_accounts
SET path = calculate_account_path(code)
WHERE path IS NULL;

-- ===================================
-- الخطوة 6: إنشاء Trigger للتحديث التلقائي
-- ===================================

CREATE OR REPLACE FUNCTION update_account_path_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- حساب path للحساب الجديد/المحدث
  NEW.path := calculate_account_path(NEW.code);
  
  -- إذا تغير code، تحديث path للأبناء
  IF TG_OP = 'UPDATE' AND OLD.code <> NEW.code THEN
    -- تحديث الأبناء المباشرين
    UPDATE gl_accounts
    SET path = calculate_account_path(code)
    WHERE parent_code = NEW.code;
  END IF;
  
  RETURN NEW;
END;
$$;

-- حذف trigger القديم إن وجد
DROP TRIGGER IF EXISTS trg_update_account_path ON gl_accounts;

-- إنشاء trigger جديد
CREATE TRIGGER trg_update_account_path
BEFORE INSERT OR UPDATE OF code, parent_code
ON gl_accounts
FOR EACH ROW
EXECUTE FUNCTION update_account_path_trigger();

DO $$
BEGIN
  RAISE NOTICE '✅ تم إنشاء Trigger للتحديث التلقائي';
END $$;

-- ===================================
-- الخطوة 7: التحقق النهائي
-- ===================================

-- عرض إحصائيات
SELECT 
  'Final Statistics' as report_title,
  COUNT(*) FILTER (WHERE path IS NOT NULL) as accounts_with_path,
  COUNT(*) FILTER (WHERE path IS NULL) as accounts_without_path,
  COUNT(*) as total_accounts,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE path IS NOT NULL) / COUNT(*), 
    2
  ) as completion_percentage
FROM gl_accounts;

-- عرض عينة من الحسابات
SELECT 
  code,
  name_ar,
  parent_code,
  path,
  nlevel(path) as depth_level
FROM gl_accounts
WHERE path IS NOT NULL
ORDER BY path
LIMIT 20;

-- عرض أي حسابات بدون path (للمراجعة)
SELECT 
  code,
  name_ar,
  parent_code,
  'Missing path' as issue
FROM gl_accounts
WHERE path IS NULL;

-- ===================================
-- الخطوة 8: إنشاء دوال مساعدة
-- ===================================

-- دالة للحصول على جميع الأبناء
CREATE OR REPLACE FUNCTION get_account_children(p_account_code TEXT)
RETURNS TABLE (
  code TEXT,
  name_ar TEXT,
  path ltree,
  depth_level INTEGER
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    a.code,
    a.name_ar,
    a.path,
    nlevel(a.path) as depth_level
  FROM gl_accounts a
  WHERE a.path <@ (
    SELECT path FROM gl_accounts WHERE code = p_account_code
  )
  AND a.code <> p_account_code
  ORDER BY a.path;
$$;

-- دالة للحصول على المسار الكامل
CREATE OR REPLACE FUNCTION get_account_full_path(p_account_code TEXT)
RETURNS TABLE (
  code TEXT,
  name_ar TEXT,
  level INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH path_elements AS (
    SELECT 
      unnest(string_to_array(path::text, '.')) as code,
      generate_series(1, nlevel(path)) as level
    FROM gl_accounts
    WHERE code = p_account_code
  )
  SELECT 
    pe.code,
    a.name_ar,
    pe.level
  FROM path_elements pe
  LEFT JOIN gl_accounts a ON a.code = pe.code
  ORDER BY pe.level;
$$;

DO $$
BEGIN
  RAISE NOTICE '✅ تم إنشاء دوال مساعدة';
END $$;

COMMIT;

-- ===================================
-- رسالة النجاح
-- ===================================
DO $$
DECLARE
  v_total INTEGER;
  v_with_path INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM gl_accounts;
  SELECT COUNT(*) INTO v_with_path FROM gl_accounts WHERE path IS NOT NULL;
  
  RAISE NOTICE '╔════════════════════════════════════════╗';
  RAISE NOTICE '║  ✅ تم تطبيق Materialized Path بنجاح  ║';
  RAISE NOTICE '╠════════════════════════════════════════╣';
  RAISE NOTICE '║  إجمالي الحسابات: %                  ║', v_total;
  RAISE NOTICE '║  الحسابات مع path: %                  ║', v_with_path;
  RAISE NOTICE '║  نسبة الاكتمال: %%                     ║', ROUND(100.0 * v_with_path / v_total, 1);
  RAISE NOTICE '╠════════════════════════════════════════╣';
  RAISE NOTICE '║  🚀 يمكنك الآن استخدام:               ║';
  RAISE NOTICE '║  - get_account_children()             ║';
  RAISE NOTICE '║  - get_account_full_path()            ║';
  RAISE NOTICE '║  - استعلامات path-based سريعة         ║';
  RAISE NOTICE '╚════════════════════════════════════════╝';
END $$;

-- مثال على الاستعلام الجديد (بدلاً من recursive)
/*
-- الطريقة القديمة (Recursive - بطيئة):
WITH RECURSIVE account_tree AS (
  SELECT * FROM gl_accounts WHERE code = '1000'
  UNION ALL
  SELECT child.* FROM gl_accounts child
  JOIN account_tree parent ON child.parent_code = parent.code
)
SELECT * FROM account_tree;

-- الطريقة الجديدة (Path-based - سريعة):
SELECT * FROM gl_accounts 
WHERE path <@ (SELECT path FROM gl_accounts WHERE code = '1000')
ORDER BY path;

-- أو استخدام الدالة:
SELECT * FROM get_account_children('1000');
*/
