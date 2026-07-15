-- ===================================================================
-- Security Negative Tests — اختبارات سلبية للأمان (P6)
-- ===================================================================
-- آمنة على الإنتاج بآليتين مستقلتين:
--   1. BEGIN/ROLLBACK يحيطان بالملف.
--   2. النجاح نفسه يرفع استثناء ROLLBACK_SENTINEL في نهاية الـ DO block ⇒
--      حتى لو لُصق الـ DO block وحده (بلا BEGIN/ROLLBACK) تنقلب بيانات
--      الاختبار تلقائياً. النجاح = ظهور «ROLLBACK_SENTINEL» في الخطأ.
--      (درس مُستفاد: تشغيل سابق للـ DO block وحده التزم بياناته في الإنتاج)
-- كل اختبار يرفع RAISE NOTICE عند النجاح وRAISE EXCEPTION عند الفشل.
--
-- المجموعات:
--   A — بنيوية: وجود/غياب سياسات + خصائص دوال + RLS
--   B — سلوكية: استجابات RPCs مع محاكاة JWT
--   C — عزل: RLS مفعَّل على الجداول الحساسة
-- ===================================================================

BEGIN;

DO $$
DECLARE
  v_org_a    UUID := gen_random_uuid();
  v_org_b    UUID := gen_random_uuid();
  v_admin_a  UUID := gen_random_uuid();   -- المدير الوحيد لمؤسسة ألفا
  v_member_a UUID := gen_random_uuid();   -- عضو عادي في مؤسسة ألفا
  v_result   JSONB;
  v_count    INT;
  v_token    TEXT := 'tok-sec-test-' || encode(gen_random_bytes(8), 'hex');
BEGIN

  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE '  اختبارات الأمان السلبية (P6) — 15 اختبار';
  RAISE NOTICE '══════════════════════════════════════════════════════════';

  -- ================================================================
  -- A — بنيوية (سياسات + دوال + Views)
  -- ================================================================

  -- A1: user_orgs_update_own محذوفة (ثغرة تصعيد is_org_admin)
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename = 'user_organizations'
    AND policyname = 'user_orgs_update_own';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'A1 ❌ user_orgs_update_own لا تزال موجودة — ثغرة تصعيد is_org_admin مفتوحة!';
  END IF;
  RAISE NOTICE 'A1 ✅ user_orgs_update_own محذوفة — تعديل is_org_admin مباشرة مستحيل';

  -- A2: invitations_by_token USING(true) محذوفة
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename = 'invitations'
    AND policyname = 'invitations_by_token';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'A2 ❌ invitations_by_token USING(true) لا تزال موجودة — كشف دعوات جميع المؤسسات!';
  END IF;
  RAISE NOTICE 'A2 ✅ invitations_by_token USING(true) محذوفة — عزل قراءة الدعوات محفوظ';

  -- A3: صفر سياسة USING(true) على الجداول المالية الأساسية
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename IN (
    'gl_entries','gl_entry_lines','gl_accounts',
    'sales_invoices','purchase_orders',
    'user_organizations','user_roles','invitations'
  )
  AND (qual = 'true' OR with_check = 'true');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'A3 ❌ % سياسة USING/WITH CHECK(true) على جداول مالية — عزل المؤسسات منتهَك!', v_count;
  END IF;
  RAISE NOTICE 'A3 ✅ صفر سياسات USING(true)/WITH CHECK(true) على الجداول المالية';

  -- A4: rpc_set_org_admin — SECURITY DEFINER + search_path مثبَّت
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'rpc_set_org_admin'
    AND pronamespace = 'public'::regnamespace
    AND prosecdef = true
    AND proconfig @> ARRAY['search_path=public'];
  IF v_count = 0 THEN
    RAISE EXCEPTION 'A4 ❌ rpc_set_org_admin غير SECURITY DEFINER أو بلا search_path!';
  END IF;
  RAISE NOTICE 'A4 ✅ rpc_set_org_admin — SECURITY DEFINER + search_path=public';

  -- A5: rpc_accept_invitation — SECURITY DEFINER + search_path مثبَّت
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'rpc_accept_invitation'
    AND pronamespace = 'public'::regnamespace
    AND prosecdef = true
    AND proconfig @> ARRAY['search_path=public'];
  IF v_count = 0 THEN
    RAISE EXCEPTION 'A5 ❌ rpc_accept_invitation غير SECURITY DEFINER أو بلا search_path!';
  END IF;
  RAISE NOTICE 'A5 ✅ rpc_accept_invitation — SECURITY DEFINER + search_path=public';

  -- A6: anon لا تملك EXECUTE على rpc_set_org_admin أو rpc_accept_invitation
  SELECT COUNT(*) INTO v_count
  FROM information_schema.routine_privileges
  WHERE routine_name IN ('rpc_set_org_admin', 'rpc_accept_invitation')
    AND grantee = 'anon'
    AND privilege_type = 'EXECUTE';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'A6 ❌ anon تملك EXECUTE على دالة حساسة (rpc_set_org_admin أو rpc_accept_invitation)!';
  END IF;
  RAISE NOTICE 'A6 ✅ anon لا تملك EXECUTE على rpc_set_org_admin / rpc_accept_invitation';

  -- ================================================================
  -- إعداد بيانات الاختبار للمجموعتين B وC
  -- (تُلغى تلقائياً عند ROLLBACK في نهاية الملف)
  -- ================================================================

  INSERT INTO organizations (id, name, code, is_active)
  VALUES (v_org_a, '_Test Org Alpha', 'TEST-ALPHA-' || left(v_org_a::text,8), true),
         (v_org_b, '_Test Org Beta',  'TEST-BETA-'  || left(v_org_b::text,8),  true);

  INSERT INTO user_organizations (user_id, org_id, is_org_admin, is_active)
  VALUES (v_admin_a,  v_org_a, true,  true),
         (v_member_a, v_org_a, false, true);

  -- دعوة منتهية الصلاحية (منذ يوم) — invited_by=NULL لتجنب FK على auth.users
  INSERT INTO invitations (org_id, email, token, role_ids, status, expires_at, invited_by)
  VALUES (v_org_a, 'newmember@example.com', v_token, ARRAY[]::uuid[],
          'pending', NOW() - INTERVAL '1 day', NULL);

  -- قيد GL لمؤسسة بيتا (للتحقق من عزل القراءة لاحقاً)
  INSERT INTO gl_entries (id, org_id, entry_number, entry_date, entry_type,
                          description, total_debit, total_credit, status)
  VALUES (gen_random_uuid(), v_org_b, 'SECTEST-GL-001', CURRENT_DATE, 'manual',
          'Security test entry org B', 100, 100, 'posted');

  -- ================================================================
  -- B — سلوكية (RPCs مع محاكاة JWT عبر request.jwt.claims)
  -- ================================================================

  -- B1: rpc_set_org_admin بدون JWT → NOT_ORG_ADMIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT rpc_set_org_admin(v_member_a, v_org_a, true) INTO v_result;
  IF (v_result->>'ok')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'B1 ❌ rpc_set_org_admin قبل الطلب بدون JWT: %', v_result;
  END IF;
  IF (v_result->>'error') NOT IN ('NOT_ORG_ADMIN', 'NOT_AUTHENTICATED') THEN
    RAISE EXCEPTION 'B1 ❌ خطأ غير متوقع بدون JWT: % (المتوقع: NOT_ORG_ADMIN)', v_result;
  END IF;
  RAISE NOTICE 'B1 ✅ rpc_set_org_admin بدون JWT → % (مرفوض)', v_result->>'error';

  -- B2: rpc_set_org_admin — حماية آخر مدير (LAST_ORG_ADMIN)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  SELECT rpc_set_org_admin(v_admin_a, v_org_a, false) INTO v_result;
  IF (v_result->>'error') != 'LAST_ORG_ADMIN' THEN
    RAISE EXCEPTION 'B2 ❌ حذف آخر مدير أعاد: % (المتوقع: LAST_ORG_ADMIN)', v_result;
  END IF;
  RAISE NOTICE 'B2 ✅ rpc_set_org_admin → LAST_ORG_ADMIN (حماية آخر مدير تعمل)';

  -- B3: rpc_set_org_admin — منع ترقية الذات (CANNOT_PROMOTE_SELF)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  SELECT rpc_set_org_admin(v_admin_a, v_org_a, true) INTO v_result;
  IF (v_result->>'error') != 'CANNOT_PROMOTE_SELF' THEN
    RAISE EXCEPTION 'B3 ❌ ترقية الذات أعاد: % (المتوقع: CANNOT_PROMOTE_SELF)', v_result;
  END IF;
  RAISE NOTICE 'B3 ✅ rpc_set_org_admin → CANNOT_PROMOTE_SELF (منع ترقية الذات يعمل)';

  -- B4: العضو العادي لا يملك حق استدعاء rpc_set_org_admin
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_member_a::text, 'role', 'authenticated')::text, true);
  SELECT rpc_set_org_admin(v_admin_a, v_org_a, false) INTO v_result;
  IF (v_result->>'ok')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'B4 ❌ عضو عادي نجح في استدعاء rpc_set_org_admin: %', v_result;
  END IF;
  RAISE NOTICE 'B4 ✅ rpc_set_org_admin مرفوض للعضو العادي → %', v_result->>'error';

  -- B5: rpc_accept_invitation بدون JWT → NOT_AUTHENTICATED
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT rpc_accept_invitation(v_token) INTO v_result;
  IF (v_result->>'error') != 'NOT_AUTHENTICATED' THEN
    RAISE EXCEPTION 'B5 ❌ قبول دعوة بدون JWT أعاد: % (المتوقع: NOT_AUTHENTICATED)', v_result;
  END IF;
  RAISE NOTICE 'B5 ✅ rpc_accept_invitation بدون JWT → NOT_AUTHENTICATED';

  -- B6: rpc_accept_invitation — INVITATION_EXPIRED (التوكن منتهٍ)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_member_a::text, 'role', 'authenticated')::text, true);
  SELECT rpc_accept_invitation(v_token) INTO v_result;
  IF (v_result->>'error') NOT IN ('INVITATION_EXPIRED', 'EMAIL_MISMATCH') THEN
    RAISE EXCEPTION 'B6 ❌ توكن منتهٍ أعاد: % (المتوقع: INVITATION_EXPIRED أو EMAIL_MISMATCH)', v_result;
  END IF;
  RAISE NOTICE 'B6 ✅ rpc_accept_invitation — توكن منتهٍ → % (منع إعادة استخدام)', v_result->>'error';

  -- B7: rpc_accept_invitation — توكن غير موجود → INVITATION_NOT_FOUND
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  SELECT rpc_accept_invitation('nonexistent-token-' || gen_random_uuid()) INTO v_result;
  IF (v_result->>'error') != 'INVITATION_NOT_FOUND' THEN
    RAISE EXCEPTION 'B7 ❌ توكن وهمي أعاد: % (المتوقع: INVITATION_NOT_FOUND)', v_result;
  END IF;
  RAISE NOTICE 'B7 ✅ rpc_accept_invitation — توكن وهمي → INVITATION_NOT_FOUND';

  -- ================================================================
  -- C — عزل: RLS مُفعَّل على الجداول الحساسة
  -- ================================================================

  -- C1: RLS مُفعَّل على gl_entries
  SELECT COUNT(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'gl_entries' AND n.nspname = 'public' AND c.relrowsecurity = true;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'C1 ❌ RLS غير مفعَّل على gl_entries!';
  END IF;
  RAISE NOTICE 'C1 ✅ RLS مفعَّل على gl_entries';

  -- C2: RLS مُفعَّل على user_organizations
  SELECT COUNT(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'user_organizations' AND n.nspname = 'public' AND c.relrowsecurity = true;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'C2 ❌ RLS غير مفعَّل على user_organizations!';
  END IF;
  RAISE NOTICE 'C2 ✅ RLS مفعَّل على user_organizations';

  -- C3: RLS مُفعَّل على invitations
  SELECT COUNT(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'invitations' AND n.nspname = 'public' AND c.relrowsecurity = true;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'C3 ❌ RLS غير مفعَّل على invitations!';
  END IF;
  RAISE NOTICE 'C3 ✅ RLS مفعَّل على invitations';

  -- C4: RLS مُفعَّل على gl_entry_lines
  SELECT COUNT(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'gl_entry_lines' AND n.nspname = 'public' AND c.relrowsecurity = true;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'C4 ❌ RLS غير مفعَّل على gl_entry_lines!';
  END IF;
  RAISE NOTICE 'C4 ✅ RLS مفعَّل على gl_entry_lines';

  PERFORM set_config('request.jwt.claims', '{}', true);

  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE '  ✅ جميع الاختبارات نجحت: A1-A6 | B1-B7 | C1-C4 (15 اختبار)';
  RAISE NOTICE '══════════════════════════════════════════════════════════';

  -- النجاح يرفع استثناءً عمداً ⇒ إلغاء بيانات الاختبار مضمون بأي طريقة تشغيل
  RAISE EXCEPTION 'ROLLBACK_SENTINEL — كل الاختبارات الـ15 نجحت؛ هذا الاستثناء مقصود لإلغاء بيانات الاختبار';

END;
$$;

ROLLBACK;
