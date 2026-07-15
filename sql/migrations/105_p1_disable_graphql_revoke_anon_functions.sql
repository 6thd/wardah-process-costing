-- ===================================================================
-- Migration 105: P1 — تعطيل pg_graphql وسحب EXECUTE من anon على الدوال الداخلية
-- ===================================================================
-- ما يفعله هذا الـ migration:
--   1. تعطيل امتداد pg_graphql (التطبيق يستخدم REST فقط — لا GraphQL)
--      يُلغي: 144 تحذير pg_graphql_anon_table_exposed
--           + 151 تحذير pg_graphql_authenticated_table_exposed = 295 تحذير
--   2. سحب EXECUTE من anon على كل الدوال SECURITY DEFINER في public
--      باستثناء rpc_get_invitation_preview (تحتاجها قبل التسجيل)
-- ===================================================================

BEGIN;

-- ===================================================================
-- 1. تعطيل pg_graphql
--    التطبيق يستخدم Supabase REST (/rest/v1/) — GraphQL (/graphql/v1/) غير مستخدم
--    هذا يُغلق سطح الهجوم عبر Schema Introspection بدون تأثير على وظيفة التطبيق
-- ===================================================================
DROP EXTENSION IF EXISTS pg_graphql CASCADE;

-- ===================================================================
-- 2. سحب EXECUTE من anon على كل الدوال SECURITY DEFINER
--    ما عدا rpc_get_invitation_preview (معاينة الدعوة قبل التسجيل — مقصودة للـ anon)
-- ===================================================================
DO $$
DECLARE
    r RECORD;
    v_count INT := 0;
BEGIN
    FOR r IN
        SELECT p.oid,
               p.proname,
               pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef = true
          AND p.proname <> 'rpc_get_invitation_preview'
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon',
            r.proname, r.args
        );
        v_count := v_count + 1;
    END LOOP;
END;
$$;

COMMIT;
