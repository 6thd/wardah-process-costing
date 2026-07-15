-- ===================================================================
-- Migration 106: P1 — سحب EXECUTE من PUBLIC على دوال SECURITY DEFINER
-- ===================================================================
-- المشكلة: migration 105 سحب EXECUTE من anon مباشرة، لكن كل دالة
--   لها منحة PUBLIC (=X/postgres) — وanon عضو في PUBLIC → لا يزال
--   يستطيع الاستدعاء عبر هذه المنحة.
--
-- الحل: سحب EXECUTE من PUBLIC على كل دوال SECURITY DEFINER
--   (ما عدا rpc_get_invitation_preview).
--   authenticated وservice_role لهما منح صريحة مستقلة → لا تتأثر.
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
          -- has PUBLIC grant: acl contains entry starting with '=' (grantee = PUBLIC)
          AND p.proacl IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM unnest(p.proacl) AS ace
              WHERE ace::text LIKE '=X/%'
          )
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC',
            r.proname, r.args
        );
        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE 'Revoked PUBLIC EXECUTE from % SECURITY DEFINER functions', v_count;
END;
$$;

COMMIT;
