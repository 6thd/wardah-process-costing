-- ============================================================================
-- اختبارات سلبية حية لعزل المؤسسات (P0) — تُغلق T1 خطوة 4
-- المرجع: Migration 121 (fail-closed tenant resolver) + مراجعة كودكس 2026-07-16
--
-- كيفية التشغيل:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/security/test_definer_org_guards.sql
--   أو عبر Supabase MCP execute_sql (الملف كامله كاستعلام واحد).
--
-- الملف كله داخل معاملة واحدة تنتهي بـ ROLLBACK: لا يغيّر أي بيانات.
-- كل تأكيد فاشل يرفع EXCEPTION فيُفشل التشغيل بالكامل (ON_ERROR_STOP=1).
--
-- الهويات الوهمية:
--   • A = aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa  (بلا أي عضوية)
--   • تُنشأ داخل المعاملة Org B + عضو B مؤقتان لاختبار العبور بين المؤسسات.
-- ============================================================================

BEGIN;

DO $test$
DECLARE
    c_default   constant uuid := '00000000-0000-0000-0000-000000000001';
    v_no_member constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_org_b     uuid;
    v_user_b    uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    v_resolved  uuid;
    v_products  bigint;
    v_written   bigint;
    v_ok        boolean;
    v_err       text;
BEGIN
    -- إنشاء Org B + عضوية B مؤقتة (تُلغى بالـ ROLLBACK)
    INSERT INTO organizations (id, name, code)
    VALUES (gen_random_uuid(), 'TEST_ORG_B_ephemeral', 'TSTB_' || substr(gen_random_uuid()::text,1,8))
    RETURNING id INTO v_org_b;

    INSERT INTO user_organizations (user_id, org_id, is_active)
    VALUES (v_user_b, v_org_b, true);

    -- ==== محاكاة الهوية A (بلا عضوية) =====================================
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_no_member, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    -- (1) لا يُحلّ إلى أي مؤسسة
    v_resolved := wardah_org_id(NULL);
    IF v_resolved IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL[1] هوية بلا عضوية حُلّت إلى مؤسسة: %', v_resolved;
    END IF;

    -- (2) تمرير المؤسسة الافتراضية صراحةً يُرفض (NULL)
    IF wardah_org_id(c_default) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL[2] p_explicit=default_org قُبل لهوية بلا عضوية';
    END IF;

    -- (3) تمرير Org B صراحةً يُرفض (NULL)
    IF wardah_org_id(v_org_b) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL[3] p_explicit=OrgB قُبل لهوية بلا عضوية';
    END IF;

    -- (4) get_current_tenant_id لا يسقط لمؤسسة افتراضية
    IF get_current_tenant_id() IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL[4] get_current_tenant_id سقط لمؤسسة لهوية بلا عضوية';
    END IF;

    RESET ROLE;

    -- (5) القراءة عبر RLS: صفر صف
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_products FROM products;
    IF v_products <> 0 THEN
        RAISE EXCEPTION 'FAIL[5] هوية بلا عضوية رأت % منتجاً (توقّع 0)', v_products;
    END IF;

    -- (6) الكتابة عبر RLS: صفر صف متأثر
    WITH u AS (UPDATE products SET name = name RETURNING 1)
    SELECT count(*) INTO v_written FROM u;
    IF v_written <> 0 THEN
        RAISE EXCEPTION 'FAIL[6] هوية بلا عضوية حدّثت % صف (توقّع 0)', v_written;
    END IF;

    -- (7) دالة RPC حساسة ترفض الهوية بلا عضوية
    v_ok := false;
    BEGIN
        PERFORM rpc_create_journal_entry(jsonb_build_object(
            'org_id', c_default,
            'lines', jsonb_build_array(
                jsonb_build_object('line_number',1,'account_id',gen_random_uuid(),'debit',10,'credit',0),
                jsonb_build_object('line_number',2,'account_id',gen_random_uuid(),'debit',0,'credit',10))));
        v_ok := true;
    EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
    END;
    IF v_ok THEN
        RAISE EXCEPTION 'FAIL[7] rpc_create_journal_entry قبِل هوية بلا عضوية';
    END IF;

    RESET ROLE;

    -- ==== محاكاة العضو B ضد Org B (يجب أن ينجح) ثم ضد default (يجب أن يُرفض) =
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);

    -- (8) العضو B يُحلّ إلى Org B (عضويته الوحيدة)
    IF wardah_org_id(NULL) <> v_org_b THEN
        RAISE EXCEPTION 'FAIL[8] العضو B لم يُحلّ إلى Org B';
    END IF;

    -- (9) العضو B يُرفض عند تمرير default org صراحةً (ليس عضواً فيها)
    IF wardah_org_id(c_default) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL[9] العضو B قُبل عند تمرير مؤسسة ليس عضواً فيها';
    END IF;

    -- (10) JWT مزوّر يحمل org_id=default لكن المستخدم عضو Org B فقط ⇒ يُرفض claim
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_user_b, 'role', 'authenticated', 'org_id', c_default)::text, true);
    IF wardah_org_id(NULL) = c_default THEN
        RAISE EXCEPTION 'FAIL[10] claim مزوّر بـ default org قُبل للعضو B';
    END IF;

    RESET ROLE;
    RAISE NOTICE 'PASS: كل اختبارات عزل المؤسسات السلبية (10/10) نجحت';
END;
$test$;

ROLLBACK;
