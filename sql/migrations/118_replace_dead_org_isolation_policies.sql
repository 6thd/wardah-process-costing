BEGIN;

-- Migration 118: استبدال سياسات app.current_org_id الميتة (جذر «الداشبوردات لا تنبض»)
-- 38 جدولاً سياستها الوحيدة تعتمد app.current_org_id الذي لا يضبطه عميل Supabase
-- ⇒ القراءة المباشرة من الواجهة ترجع صفر صف منذ 83. نستبدلها بسياسة SELECT
-- لأعضاء المؤسسة (نمط wardah_org_id العامل من 99/products) ونبقي الكتابة
-- مقفلة عمداً — الكتابة الشرعية عبر RPCs الذرّية (SECURITY DEFINER) حصراً.
-- استثناء: items/journal_entries/journal_lines (جداول ميتة) تبقى مقفلة كلياً.

DO $$
DECLARE r RECORD; v_dropped INT := 0; v_created INT := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT p.tablename, p.policyname FROM pg_policies p
    WHERE p.schemaname='public'
      AND (p.qual LIKE '%app.current_org_id%' OR p.with_check LIKE '%app.current_org_id%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    v_dropped := v_dropped + 1;
  END LOOP;
  RAISE NOTICE '[118] حُذفت % سياسة ميتة', v_dropped;
  IF v_dropped < 60 THEN RAISE EXCEPTION 'FAIL[118-1] المتوقع ≥60، حُذف %', v_dropped; END IF;

  -- سياسة قراءة عاملة لكل جدول أصبح بلا سياسات (عدا الجداول الميتة عمداً)
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=true
      AND c.relname NOT IN ('items','journal_entries','journal_lines')
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='org_id')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (org_id = wardah_org_id(NULL::uuid))',
      r.tablename || '_org_read', r.tablename);
    v_created := v_created + 1;
  END LOOP;
  RAISE NOTICE '[118] أُنشئت % سياسة قراءة عاملة', v_created;
  IF v_created < 30 THEN RAISE EXCEPTION 'FAIL[118-2] المتوقع ≥30 سياسة قراءة، أُنشئ %', v_created; END IF;
END $$;

-- ب) tenant_* على manufacturing_orders (مكررة + دالتها تسقط للمؤسسة الافتراضية)
DROP POLICY IF EXISTS "tenant_select_manufacturing_orders" ON public.manufacturing_orders;
DROP POLICY IF EXISTS "tenant_insert_manufacturing_orders" ON public.manufacturing_orders;
DROP POLICY IF EXISTS "tenant_update_manufacturing_orders" ON public.manufacturing_orders;
DROP POLICY IF EXISTS "tenant_delete_manufacturing_orders" ON public.manufacturing_orders;

-- ج) مكررات user_organizations الحرفية
DROP POLICY IF EXISTS "user_orgs_super_admin_all"    ON public.user_organizations;
DROP POLICY IF EXISTS "user_orgs_super_admin_select" ON public.user_organizations;
DROP POLICY IF EXISTS "Users can view their organization associations" ON public.user_organizations;
DROP POLICY IF EXISTS "user_orgs_select_own"         ON public.user_organizations;

-- تحقق نهائي: الجداول المالية الأساسية لها سياسة قراءة حية، والميتة مقفلة
DO $$
DECLARE v_ok INT; v_dead INT;
BEGIN
  SELECT COUNT(DISTINCT tablename) INTO v_ok FROM pg_policies
  WHERE schemaname='public' AND tablename IN
    ('gl_entries','gl_entry_lines','sales_invoices','purchase_orders','customers','warehouses');
  IF v_ok < 6 THEN RAISE EXCEPTION 'FAIL[118-3] جدول مالي بلا سياسة قراءة (% من 6)', v_ok; END IF;

  SELECT COUNT(*) INTO v_dead FROM pg_policies
  WHERE schemaname='public'
    AND (qual LIKE '%app.current_org_id%' OR with_check LIKE '%app.current_org_id%');
  IF v_dead > 0 THEN RAISE EXCEPTION 'FAIL[118-4] % سياسة ميتة متبقية', v_dead; END IF;

  RAISE NOTICE 'VERIFY[118] ✓ — صفر سياسات ميتة، الجداول المالية قابلة للقراءة لأعضاء المؤسسة';
END $$;

COMMIT;
