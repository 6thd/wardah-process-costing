BEGIN;

-- Migration 119: الموحِّد الآلي للسياسات المتداخلة (إتمام دفعة RLS)
-- لكل جدول فيه >1 سياسة permissive لنفس العملية: إعادة بناء بسياسة واحدة
-- لكل عملية، شرطها OR حرفي لشروط السياسات القديمة (نفس الدلالة تماماً).
-- INSERT يستخدم with_check (أو qual للـ ALL)؛ UPDATE يجمع الاثنين.
-- استثناءات: جداول *_20250905_1900 (تشديد صريح أدناه، لا دمج).

-- أ) تشديد جدول النسخ الاحتياطي: super_admin فقط (السياسات القديمة أوسع خطأً)
DROP POLICY IF EXISTS "Admins and project managers can create BOM entries" ON public.bill_of_materials_20250905_1900;
DROP POLICY IF EXISTS "Admins and project managers can update BOM entries" ON public.bill_of_materials_20250905_1900;
DROP POLICY IF EXISTS "Authenticated users can view BOM"                   ON public.bill_of_materials_20250905_1900;

-- ب) الموحِّد الآلي
DO $$
DECLARE
  t RECORD; a TEXT; pol RECORD;
  v_using TEXT; v_check TEXT; v_n INT; v_tables INT := 0;
  actions TEXT[] := ARRAY['SELECT','INSERT','UPDATE','DELETE'];
BEGIN
  FOR t IN
    SELECT DISTINCT p.tablename FROM pg_policies p
    CROSS JOIN LATERAL unnest(
      CASE WHEN p.cmd='ALL' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE'] ELSE ARRAY[p.cmd] END) AS x(action)
    WHERE p.schemaname='public' AND p.permissive='PERMISSIVE'
      AND p.tablename NOT LIKE '%\_20250905\_1900'
    GROUP BY p.tablename, x.action HAVING COUNT(*) > 1
  LOOP
    v_tables := v_tables + 1;
    FOREACH a IN ARRAY actions LOOP
      v_using := NULL; v_check := NULL; v_n := 0;
      FOR pol IN
        SELECT qual, with_check FROM pg_policies
        WHERE schemaname='public' AND tablename=t.tablename AND permissive='PERMISSIVE'
          AND (cmd='ALL' OR cmd=a)
      LOOP
        v_n := v_n + 1;
        IF a != 'INSERT' AND pol.qual IS NOT NULL THEN
          v_using := COALESCE(v_using || ' OR ', '') || '(' || pol.qual || ')';
        END IF;
        IF a IN ('INSERT','UPDATE') THEN
          v_check := COALESCE(v_check || ' OR ', '') || '(' || COALESCE(pol.with_check, pol.qual, 'false') || ')';
        END IF;
      END LOOP;

      CONTINUE WHEN v_n = 0;

      IF a = 'SELECT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
          t.tablename || '_sel_m', t.tablename, v_using);
      ELSIF a = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
          t.tablename || '_ins_m', t.tablename, v_check);
      ELSIF a = 'UPDATE' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
          t.tablename || '_upd_m', t.tablename, v_using, v_check);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
          t.tablename || '_del_m', t.tablename, v_using);
      END IF;
    END LOOP;

    -- حذف السياسات القديمة (كل ما لا ينتهي بـ _m)
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename=t.tablename AND policyname NOT LIKE '%\_m'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t.tablename);
    END LOOP;
  END LOOP;
  RAISE NOTICE '[119] وُحِّد % جدولاً', v_tables;
  IF v_tables < 20 THEN RAISE EXCEPTION 'FAIL[119-1] المتوقع ≥20 جدولاً، وُجد %', v_tables; END IF;
END $$;

-- تحقق: صفر تداخل متبقٍ (خارج جداول backup)
DO $$
DECLARE v INT;
BEGIN
  SELECT COUNT(*) INTO v FROM (
    SELECT p.tablename, x.action FROM pg_policies p
    CROSS JOIN LATERAL unnest(
      CASE WHEN p.cmd='ALL' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE'] ELSE ARRAY[p.cmd] END) AS x(action)
    WHERE p.schemaname='public' AND p.permissive='PERMISSIVE'
      AND p.tablename NOT LIKE '%\_20250905\_1900'
    GROUP BY p.tablename, x.action HAVING COUNT(*) > 1) q;
  IF v > 0 THEN RAISE EXCEPTION 'FAIL[119-2] — % (جدول،عملية) لا يزال متداخلاً', v; END IF;

  -- الجداول الحساسة ما زالت محمية بسياسات
  SELECT COUNT(DISTINCT tablename) INTO v FROM pg_policies
  WHERE schemaname='public' AND tablename IN
    ('user_organizations','organizations','roles','role_permissions',
     'user_profiles','audit_logs','hr_settlements','stage_costs');
  IF v < 8 THEN RAISE EXCEPTION 'FAIL[119-3] — جدول حساس فقد سياساته (% من 8)', v; END IF;

  RAISE NOTICE 'VERIFY[119] ✓ — صفر تداخل، الجداول الحساسة محمية';
END $$;

COMMIT;
