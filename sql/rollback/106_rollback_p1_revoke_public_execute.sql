-- ===================================================================
-- تراجع Migration 106: استعادة منح PUBLIC على دوال SECURITY DEFINER
-- ===================================================================
-- ⚠️ للطوارئ فقط — يُعيد anon قادرًا على استدعاء كل الدوال المالية
--    والإدارية عبر /rest/v1/rpc/ — خطر أمني عالٍ.
--
-- ما يُعيده هذا الملف:
--   إعادة EXECUTE لـ PUBLIC على دوال SECURITY DEFINER في public
--   (هذه كانت المنحة الافتراضية قبل migration 106)
--
-- بعد الطوارئ: أصلح سبب الفشل وأعد تطبيق 106.
-- ===================================================================

BEGIN;

DO $$
DECLARE
    r       RECORD;
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
    LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION public.%I(%s) TO PUBLIC',
            r.proname, r.args
        );
        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE 'Restored PUBLIC EXECUTE on % SECURITY DEFINER functions', v_count;
END;
$$;

COMMIT;
