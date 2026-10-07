-- Explicitly invoked BEFORE unmodified migration 202.
-- This file is not a numbered migration and does not write
-- supabase_migrations.schema_migrations.
--
-- Approved bodies, byte for byte:
--   LF   md5 22789ca9c175eb3476b5c33648b92d1a  1648 bytes
--   CRLF md5 4169a0696bbcc28b39a922dcf1df23fe  1683 bytes
-- The CRLF variant is the canonical body with each LF expanded to CRLF.
-- The live prosrc is compared to those two strings. It is never normalized.
--
-- The original attributes are validated before any DDL. The race lock is
-- owner DDL, ALTER FUNCTION ... COST 100, and it does not write proconfig.
-- Identity, body, and attributes are read again under that lock. An
-- unexpected search_path is refused before that ALTER, and a search_path
-- committed by another session stays visible after it. The LF no-op and
-- every refusal roll back. Only the approved CRLF replacement commits.
\set ON_ERROR_STOP on
BEGIN;
\if :{?pre_m202_lock_timeout}
SET LOCAL lock_timeout = :'pre_m202_lock_timeout';
\else
SET LOCAL lock_timeout = '5s';
\endif
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;
CREATE TEMP TABLE pre_m202_crlf_decision(action text);

DO $pre_m202_crlf$
DECLARE
  v_oid pg_catalog.oid;
  v_proc pg_catalog.pg_proc%ROWTYPE;
  v_lf pg_catalog.text := $canonical$
-- جدول التنقّلات المسموحة:
--
--  draft        → confirmed, cancelled
--  pending      → confirmed, cancelled
--  confirmed    → in_progress, on_hold, cancelled
--  in_progress  → done, on_hold, quality_check, cancelled
--  on_hold      → in_progress, cancelled
--  quality_check→ in_progress, done, cancelled
--  done         → (terminal)
--  cancelled    → (terminal)
DECLARE
    v_from TEXT := normalize_mo_status(p_from);
    v_to   TEXT := normalize_mo_status(p_to);
BEGIN
    -- لا تغيير = لا تحقق
    IF v_from = v_to THEN RETURN; END IF;

    -- حالات نهائية لا تقبل التنقل
    IF v_from IN ('done', 'cancelled') THEN
        RAISE EXCEPTION 'MO_TERMINAL_STATE: لا يمكن تغيير حالة أمر التصنيع من "%" — الحالة نهائية', v_from;
    END IF;

    -- جدول التنقّلات
    IF NOT (
        (v_from = 'draft'         AND v_to IN ('confirmed', 'cancelled'))                          OR
        (v_from = 'pending'       AND v_to IN ('confirmed', 'cancelled'))                          OR
        (v_from = 'confirmed'     AND v_to IN ('in_progress', 'on_hold', 'cancelled'))             OR
        (v_from = 'in_progress'   AND v_to IN ('done', 'on_hold', 'quality_check', 'cancelled'))   OR
        (v_from = 'on_hold'       AND v_to IN ('in_progress', 'cancelled'))                        OR
        (v_from = 'quality_check' AND v_to IN ('in_progress', 'done', 'cancelled'))
    ) THEN
        RAISE EXCEPTION 'MO_INVALID_TRANSITION: التنقل من "%" إلى "%" غير مسموح', v_from, v_to;
    END IF;
END;
$canonical$;
  v_crlf pg_catalog.text;
  v_acl pg_catalog.text;
  v_action pg_catalog.text;
  v_phase pg_catalog.text;
  v_attempt pg_catalog.int4;
BEGIN
  v_crlf := pg_catalog.replace(v_lf, E'\n', E'\r\n');
  IF pg_catalog.octet_length(v_lf) <> 1648
     OR pg_catalog.md5(v_lf) <> '22789ca9c175eb3476b5c33648b92d1a'
     OR pg_catalog.strpos(v_lf, E'\r') <> 0 THEN
    RAISE EXCEPTION 'PRE_M202_CRLF_CANONICAL_PIN_BROKEN';
  END IF;
  IF pg_catalog.octet_length(v_crlf) <> 1683
     OR pg_catalog.md5(v_crlf) <> '4169a0696bbcc28b39a922dcf1df23fe'
     OR pg_catalog.replace(v_crlf, E'\r\n', E'\n') IS DISTINCT FROM v_lf
     OR pg_catalog.octet_length(v_crlf) - pg_catalog.octet_length(pg_catalog.replace(v_crlf, E'\r', '')) <> 35 THEN
    RAISE EXCEPTION 'PRE_M202_CRLF_VARIANT_PIN_BROKEN';
  END IF;

  v_oid := pg_catalog.to_regprocedure('public.validate_mo_transition(text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'PRE_M202_CRLF_FUNCTION_MISSING';
  END IF;
  -- Read the original row before any DDL. search_path is part of that
  -- pre-image. The lock below must not be ALTER ... SET search_path, or a
  -- different pre-existing setting would be overwritten before it could be
  -- refused.
  v_attempt := 0;
  <<pre_m202_lock>>
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 5 THEN
      RAISE EXCEPTION 'PRE_M202_CRLF_LOCK_FAILED';
    END IF;
  FOREACH v_phase IN ARRAY ARRAY['before_lock', 'after_lock']::pg_catalog.text[] LOOP
    IF v_phase = 'after_lock' THEN
      -- Owner DDL. It locks the pg_proc tuple against concurrent ALTER and
      -- CREATE OR REPLACE, and it does not write proconfig, prosrc, proowner,
      -- or proacl. Cost is the value this statement writes; every other
      -- attribute below is the row this lock observed. A committed concurrent
      -- update makes this statement fail; the loop reads that new row before
      -- trying again, so a changed search_path is refused instead of overwritten.
      BEGIN
        ALTER FUNCTION public.validate_mo_transition(text, text) COST 100;
      EXCEPTION
        WHEN lock_not_available THEN
          RAISE;
        WHEN OTHERS THEN
          IF SQLERRM ILIKE '%tuple concurrently updated%' THEN
            CONTINUE pre_m202_lock;
          END IF;
          RAISE;
      END;
    END IF;
    SELECT * INTO v_proc FROM pg_catalog.pg_proc WHERE oid = v_oid;
    SELECT COALESCE(pg_catalog.string_agg(
             pg_catalog.format('%s=%s/%s', gr.rolname, a.privilege_type, gtor.rolname),
             ',' ORDER BY gr.rolname, a.privilege_type), '')
      INTO v_acl
    FROM pg_catalog.aclexplode(v_proc.proacl) a
    JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
    JOIN pg_catalog.pg_roles gtor ON gtor.oid = a.grantor;
    IF EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) a WHERE a.grantee = 0
       )
       OR v_acl IS DISTINCT FROM 'authenticated=EXECUTE/postgres,postgres=EXECUTE/postgres,service_role=EXECUTE/postgres'
       OR pg_catalog.pg_get_userbyid(v_proc.proowner) IS DISTINCT FROM 'postgres'
       OR v_proc.prosecdef
       OR v_proc.prolang IS DISTINCT FROM (SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname = 'plpgsql')
       OR v_proc.provolatile IS DISTINCT FROM 'v'
       OR v_proc.proparallel IS DISTINCT FROM 'u'
       OR v_proc.proisstrict
       OR v_proc.proleakproof
       OR v_proc.procost IS DISTINCT FROM 100
       OR v_proc.prorows IS DISTINCT FROM 0
       OR v_proc.prokind IS DISTINCT FROM 'f'
       OR pg_catalog.pg_get_function_identity_arguments(v_oid) IS DISTINCT FROM 'p_from text, p_to text'
       OR pg_catalog.pg_get_function_result(v_oid) IS DISTINCT FROM 'void'
       OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=public']::pg_catalog.text[] THEN
      RAISE EXCEPTION 'PRE_M202_CRLF_ATTRIBUTE_REFUSED';
    END IF;
    IF v_proc.prosrc = v_lf THEN
      v_action := 'noop';
    ELSIF v_proc.prosrc = v_crlf THEN
      v_action := 'replace';
    ELSE
      RAISE EXCEPTION 'PRE_M202_CRLF_BODY_REFUSED';
    END IF;
  END LOOP;
    EXIT;
  END LOOP;

  IF v_action = 'replace' THEN
    EXECUTE 'CREATE OR REPLACE FUNCTION public.validate_mo_transition(p_from text, p_to text) '
         || 'RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $canonical$'
         || v_lf || '$canonical$';
    ALTER FUNCTION public.validate_mo_transition(text, text) OWNER TO postgres;
    ALTER FUNCTION public.validate_mo_transition(text, text) SECURITY INVOKER;
    ALTER FUNCTION public.validate_mo_transition(text, text) SET search_path = public;
    ALTER FUNCTION public.validate_mo_transition(text, text)
      VOLATILE NOT LEAKPROOF PARALLEL UNSAFE COST 100;
    SELECT * INTO v_proc FROM pg_catalog.pg_proc WHERE oid = v_oid;
    SELECT COALESCE(pg_catalog.string_agg(
             pg_catalog.format('%s=%s/%s', gr.rolname, a.privilege_type, gtor.rolname),
             ',' ORDER BY gr.rolname, a.privilege_type), '')
      INTO v_acl
    FROM pg_catalog.aclexplode(v_proc.proacl) a
    JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
    JOIN pg_catalog.pg_roles gtor ON gtor.oid = a.grantor;
    IF v_proc.prosrc IS DISTINCT FROM v_lf
       OR pg_catalog.md5(v_proc.prosrc) IS DISTINCT FROM '22789ca9c175eb3476b5c33648b92d1a'
       OR v_proc.prosecdef
       OR pg_catalog.pg_get_userbyid(v_proc.proowner) IS DISTINCT FROM 'postgres'
       OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=public']::pg_catalog.text[]
       OR v_acl IS DISTINCT FROM 'authenticated=EXECUTE/postgres,postgres=EXECUTE/postgres,service_role=EXECUTE/postgres'
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) a WHERE a.grantee = 0)
       OR v_proc.provolatile IS DISTINCT FROM 'v'
       OR v_proc.proparallel IS DISTINCT FROM 'u'
       OR v_proc.proisstrict
       OR v_proc.proleakproof
       OR v_proc.procost IS DISTINCT FROM 100
       OR v_proc.prorows IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'PRE_M202_CRLF_POSTIMAGE_REFUSED';
    END IF;
    INSERT INTO pg_temp.pre_m202_crlf_decision(action) VALUES ('replace');
    RAISE NOTICE 'PRE_M202_CRLF_REPLACED';
  ELSE
    INSERT INTO pg_temp.pre_m202_crlf_decision(action) VALUES ('noop');
    RAISE NOTICE 'PRE_M202_CRLF_NOOP';
  END IF;
END
$pre_m202_crlf$;
SELECT CASE WHEN action = 'replace' THEN 'yes' ELSE 'no' END AS pre_m202_crlf_commit
FROM pg_temp.pre_m202_crlf_decision \gset
\if :pre_m202_crlf_commit
COMMIT
\else
ROLLBACK
\endif
