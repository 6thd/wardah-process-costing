-- ===================================================================
-- Migration 116: دمج سياسات user_roles — سياسة واحدة لكل عملية (P4/RLS)
-- ===================================================================
-- المشكلة (Performance Advisor — أسوأ جدول في Multiple Permissive Policies):
--   user_roles_org_admin (ALL) + user_roles_super_admin (ALL) + user_roles_own (SELECT)
--   ⇒ كل SELECT يقيّم 3 سياسات بـ OR، وauth.uid() يُقيَّم لكل صف (InitPlan).
-- الحل:
--   دمجها OR-merge حرفياً (نفس الدلالة تماماً) في سياسة واحدة لكل عملية،
--   مع (SELECT auth.uid()) و(SELECT is_super_admin()) ليُقيَّما مرة واحدة
--   لكل استعلام بدل كل صف. is_org_admin(org_id) تبقى لكل صف (تعتمد العمود).
--   TO authenticated بدل public (anon بلا منح على الجدول أصلاً منذ 104).
-- هذا نموذج الدمج المعتمد لبقية الجداول الـ461 تحذيراً — تُطبَّق دفعات لاحقة.
-- ===================================================================

BEGIN;

DROP POLICY IF EXISTS "user_roles_org_admin"   ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_super_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_own"         ON public.user_roles;

CREATE POLICY "user_roles_select" ON public.user_roles
FOR SELECT TO authenticated
USING (
    user_id = (SELECT auth.uid())
    OR is_org_admin(org_id)
    OR (SELECT is_super_admin())
);

CREATE POLICY "user_roles_insert" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (is_org_admin(org_id) OR (SELECT is_super_admin()));

CREATE POLICY "user_roles_update" ON public.user_roles
FOR UPDATE TO authenticated
USING (is_org_admin(org_id) OR (SELECT is_super_admin()))
WITH CHECK (is_org_admin(org_id) OR (SELECT is_super_admin()));

CREATE POLICY "user_roles_delete" ON public.user_roles
FOR DELETE TO authenticated
USING (is_org_admin(org_id) OR (SELECT is_super_admin()));

-- تحقق: سياسة واحدة لكل عملية، صفر تداخل
DO $$
DECLARE
    v_cnt INT;
    v_multi INT;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM pg_policies
    WHERE tablename = 'user_roles' AND schemaname = 'public';
    IF v_cnt != 4 THEN
        RAISE EXCEPTION 'FAIL[116-1] — المتوقع 4 سياسات، وُجد %', v_cnt;
    END IF;

    SELECT COUNT(*) INTO v_multi
    FROM (
        SELECT cmd FROM pg_policies
        WHERE tablename = 'user_roles' AND schemaname = 'public' AND permissive = 'PERMISSIVE'
        GROUP BY cmd HAVING COUNT(*) > 1
    ) t;
    IF v_multi > 0 THEN
        RAISE EXCEPTION 'FAIL[116-2] — % عملية عليها سياسات متعددة', v_multi;
    END IF;

    RAISE NOTICE 'VERIFY[116] ✓ — user_roles: سياسة واحدة لكل عملية (4 سياسات) بلا تداخل';
END;
$$;

COMMIT;
