-- ===================================================================
-- Migration 113: تصنيف دوال SECURITY DEFINER وسحب EXECUTE عن غير الواجهة
-- ===================================================================
-- المنهجية (مراجعة كودكس — تصنيف الدوال الـ75 المتاحة لـ authenticated):
--   1. المُبقاة: دوال RLS (wardah_org_id وأخواتها) + كل RPC يستدعيها العميل
--      فعلاً (مُثبَت بـ grep على src/**.rpc('name')) — لها بوابات عضوية داخلية.
--   2. المسحوبة (هذا الملف):
--      أ. دوال Triggers (7) — الـ trigger يعمل بصلاحية مالكه ولا يحتاج
--         EXECUTE من المستخدم المنفِّذ للـ DML.
--      ب. دوال مساعدة داخلية (12) — لا يستدعيها العميل (صفر call sites خارج
--         الأنواع المولَّدة)، تُستدعى فقط من داخل دوال DEFINER أخرى
--         (تعمل بصلاحية المالك فلا تتأثر بالسحب).
--      ج. rpc_upsert_event_mapping (1) — **بلا بوابة admin** (تتحقق من
--         العضوية فقط عبر wardah_org_id) ⇒ أي عضو كان يستطيع إعادة توجيه
--         خرائط الأحداث المحاسبية (أي تغيير حسابات المدين/الدائن للقيود
--         الآلية). العميل لا يستدعيها إطلاقاً. سحبها إغلاق ثغرة فعلي.
--   التحقق المسبق: صفر Views تستدعي أياً من العشرين (invoker views كانت
--   ستتطلب EXECUTE من القارئ).
-- إعادة المنح عند الحاجة:
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;
--   (مثلاً get/update_organization_profile إذا رُبطت بشاشة الملف لاحقاً —
--    ويُشترط إضافة بوابة wardah_is_org_admin لـ update قبل إعادة فتحها)
-- ===================================================================

BEGIN;

DO $$
DECLARE
    v_fn   RECORD;
    v_done INT := 0;
    -- القائمة المسحوبة — بالاسم؛ نلتقط كل الـ overloads عبر pg_proc
    v_targets TEXT[] := ARRAY[
        -- أ. دوال Triggers
        'auto_backflush_materials',
        'auto_generate_work_orders',
        'calculate_bom_total_cost',
        'calculate_risk_score',
        'handle_new_user',
        'log_activity',
        'update_mo_status_from_work_orders',
        -- ب. مساعدة داخلية بلا مستهلك في الواجهة
        'assert_period_open',
        'generate_entry_number_enhanced',
        'generate_voucher_number',
        'get_account_statement_by_code',
        'get_exchange_rate',
        'get_organization_profile',
        'get_segment_report',
        'is_org_admin_for',
        'log_custom_activity',
        'reconcile_account',
        'translate_amount',
        'update_organization_profile',
        -- ج. RPC حساسة بلا بوابة admin وبلا مستهلك
        'rpc_upsert_event_mapping'
    ];
BEGIN
    FOR v_fn IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname = ANY (v_targets)
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
            v_fn.sig
        );
        v_done := v_done + 1;
    END LOOP;

    RAISE NOTICE 'VERIFY[113-0] — سُحب EXECUTE عن % دالة/overload', v_done;
    IF v_done < 20 THEN
        RAISE EXCEPTION 'FAIL[113-0] — المتوقع ≥20 دالة، وُجد % فقط', v_done;
    END IF;
END;
$$;

-- تحقق: لا شيء من القائمة بقي متاحاً لـ authenticated أو anon
DO $$
DECLARE
    v_leak INT;
BEGIN
    SELECT COUNT(*) INTO v_leak
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY[
        'auto_backflush_materials','auto_generate_work_orders','calculate_bom_total_cost',
        'calculate_risk_score','handle_new_user','log_activity','update_mo_status_from_work_orders',
        'assert_period_open','generate_entry_number_enhanced','generate_voucher_number',
        'get_account_statement_by_code','get_exchange_rate','get_organization_profile',
        'get_segment_report','is_org_admin_for','log_custom_activity','reconcile_account',
        'translate_amount','update_organization_profile','rpc_upsert_event_mapping'
      ])
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE'));

    IF v_leak > 0 THEN
        RAISE EXCEPTION 'FAIL[113-1] — % دالة لا تزال متاحة لـ authenticated/anon', v_leak;
    END IF;
    RAISE NOTICE 'VERIFY[113-1] ✓ — صفر تسريب: القائمة كاملة مسحوبة من authenticated/anon';
END;
$$;

-- تحقق: دوال RLS الحرجة ما زالت متاحة لـ authenticated (لم نكسر السياسات)
DO $$
DECLARE
    v_ok INT;
BEGIN
    SELECT COUNT(*) INTO v_ok
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY[
        'wardah_org_id','wardah_is_org_admin','get_user_org_ids',
        'is_org_admin','is_super_admin','auth_org_id','get_current_tenant_id'
      ])
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

    IF v_ok < 7 THEN
        RAISE EXCEPTION 'FAIL[113-2] — دالة RLS فقدت EXECUTE! (% من 7 فقط متاحة)', v_ok;
    END IF;
    RAISE NOTICE 'VERIFY[113-2] ✓ — دوال RLS السبع ما زالت متاحة لـ authenticated';
END;
$$;

COMMIT;
