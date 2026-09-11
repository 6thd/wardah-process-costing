-- Catalog-backed acceptance for the SECURITY DEFINER guard contract.
--
-- Runs on a Fresh DB after the whole migration chain is applied. It is the
-- companion to scripts/ci/check_definer_guards.py and deliberately NOT a copy
-- of it: the static scanner proves STRUCTURE in one file's bytes, this file
-- proves the SEMANTICS and the FINAL STATE that only PostgreSQL can answer.
--
-- The division of labour, stated once so neither side drifts into the other:
--
--   static scanner   one migration at a time; call shape, statement level,
--                    reachability, identity, which REVOKE names which function.
--                    It cannot see the database, so it cannot know what the
--                    chain finally produced.
--   this file        the catalog after every migration has run: which
--                    functions actually ARE security definer, who can actually
--                    execute them, whether the recognized guards are still the
--                    reviewed functions, and whether the PL/pgSQL exception
--                    semantics the scanner's rules rest on are still true.
--
-- Fail-closed: every assertion raises, and the psql exit code under
-- ON_ERROR_STOP is the verdict. The closing notice is evidence, not the verdict.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. The exception semantics the scanner's swallow analysis depends on
-- ---------------------------------------------------------------------------
-- The scanner treats a handler as swallowing an authorization failure when its
-- condition resolves to P0001 (raise_exception) or to that code's CLASS, P0000
-- (plpgsql_error) - because PostgreSQL matches a handler either exactly or by
-- category. That category door is what `WHEN plpgsql_error` and
-- `WHEN SQLSTATE 'P0000'` walk through, and it is asserted here against the
-- running server rather than assumed from documentation. `unique_violation` is
-- the negative control: if it ever started catching, the scanner's refusal to
-- flag it would become a false green.
DO $definer_exception_semantics$
DECLARE
  v_caught text[] := '{}'::text[];
BEGIN
  BEGIN
    RAISE EXCEPTION 'AUTHZ_PROBE';
  EXCEPTION WHEN plpgsql_error THEN
    v_caught := array_append(v_caught, 'plpgsql_error');
  END;

  BEGIN
    RAISE EXCEPTION 'AUTHZ_PROBE';
  EXCEPTION WHEN SQLSTATE 'P0000' THEN
    v_caught := array_append(v_caught, 'sqlstate_P0000');
  END;

  BEGIN
    RAISE EXCEPTION 'AUTHZ_PROBE';
  EXCEPTION WHEN raise_exception THEN
    v_caught := array_append(v_caught, 'raise_exception');
  END;

  BEGIN
    RAISE EXCEPTION 'AUTHZ_PROBE';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_caught := array_append(v_caught, 'sqlstate_P0001');
  END;

  IF NOT (v_caught @> ARRAY['plpgsql_error', 'sqlstate_P0000',
                            'raise_exception', 'sqlstate_P0001']) THEN
    RAISE EXCEPTION
      'DEFINER_CONTRACT_CATEGORY_SEMANTICS_CHANGED: caught only %', v_caught;
  END IF;

  -- Negative control: an unrelated condition must NOT catch a bare
  -- RAISE EXCEPTION, or the scanner's "no false red" rule would be wrong.
  BEGIN
    BEGIN
      RAISE EXCEPTION 'AUTHZ_PROBE';
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'DEFINER_CONTRACT_UNRELATED_CONDITION_NOW_CATCHES_P0001';
    END;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'DEFINER_CONTRACT_UNRELATED_CONDITION_NOW_CATCHES_P0001' THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'DEFINER_CONTRACT_EXCEPTION_SEMANTICS_OK: P0001 is caught by its own code and by class P0000; unrelated conditions do not catch it';
END
$definer_exception_semantics$;

-- ---------------------------------------------------------------------------
-- 2. The recognized guards are still the reviewed functions
-- ---------------------------------------------------------------------------
-- The static scanner accepts a call by NAME and arity. Overload resolution is
-- the database's job, so only the database can prove that the name it accepted
-- still resolves to the reviewed body: a second `wardah_assert_org_member(text)`
-- that returns without raising would satisfy any per-file scan while
-- authorizing nothing. Each recognized helper must therefore exist with exactly
-- its reviewed signature, carry no extra overload, be SECURITY DEFINER, run
-- with a hardened search_path, and - for the raising helpers - actually contain
-- a RAISE.
DO $definer_guard_identity$
DECLARE
  r record;
  v_overloads int;
  v_problems text[] := '{}'::text[];
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      ('wardah_assert_org_member', 'public.wardah_assert_org_member(uuid)', true),
      ('wardah_assert_org_admin', 'public.wardah_assert_org_admin(uuid)', true),
      ('wardah_178_assert_permission',
       'public.wardah_178_assert_permission(uuid,text)', true),
      ('wardah_is_org_member', 'public.wardah_is_org_member(uuid)', false)
    ) AS t(proname, sig, must_raise)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      v_problems := array_append(v_problems, r.sig || ' :missing');
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.proname;

    IF v_overloads <> 1 THEN
      v_problems := array_append(
        v_problems, r.sig || ' :' || v_overloads || '_overloads');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure(r.sig)::oid
        AND p.prosecdef
        AND p.proconfig IS NOT NULL
        AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
    ) THEN
      v_problems := array_append(v_problems, r.sig || ' :not_definer_or_unhardened');
    END IF;

    IF r.must_raise AND NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure(r.sig)::oid AND p.prosrc ~* '\mRAISE\s+EXCEPTION\M'
    ) THEN
      v_problems := array_append(v_problems, r.sig || ' :never_raises');
    END IF;
  END LOOP;

  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'DEFINER_CONTRACT_GUARD_IDENTITY_BROKEN: %', v_problems;
  END IF;
  RAISE NOTICE 'DEFINER_CONTRACT_GUARD_IDENTITY_OK: 4/4 recognized helpers, one signature each, definer + hardened, raising helpers raise';
END
$definer_guard_identity$;

-- ---------------------------------------------------------------------------
-- 3. No quoted mixed-case identity can impersonate an exempted name
-- ---------------------------------------------------------------------------
-- PostgreSQL folds an unquoted identifier to lower case and preserves a quoted
-- one, so `CREATE FUNCTION public."HAS_PERMISSION"(...)` is a DIFFERENT function
-- from `has_permission` while folding to the same string in any case-insensitive
-- comparison - which is how a name-keyed exemption list gets impersonated. The
-- scanner now compares identities case-sensitively; the catalog proves no such
-- twin reached the database.
DO $definer_case_twins$
DECLARE
  v_twins text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text), '{}')
  INTO v_twins
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname <> lower(p.proname);

  IF cardinality(v_twins) > 0 THEN
    RAISE EXCEPTION 'DEFINER_CONTRACT_MIXED_CASE_FUNCTION_NAME: %', v_twins;
  END IF;
  RAISE NOTICE 'DEFINER_CONTRACT_NO_CASE_TWINS_OK';
END
$definer_case_twins$;

-- ---------------------------------------------------------------------------
-- 4. Final security mode of the Migration 191 object set
-- ---------------------------------------------------------------------------
-- `ALTER FUNCTION ... SECURITY DEFINER` changes what a function runs as without
-- restating a line of its body. A static scan of one migration cannot see an
-- ALTER that a later migration issues, so the FINAL prosecdef is pinned here,
-- object by object, for the whole thirteen-object set. The two SECURITY INVOKER
-- entries are the ones the F2 design requires to stay invoker; the rest are the
-- reviewed definer surface.
DO $definer_mode_matrix$
DECLARE
  r record;
  v_actual boolean;
  v_drift text[] := '{}'::text[];
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      ('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)', true),
      ('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)', true),
      ('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)', true),
      ('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)', true),
      ('public.rpc_cancel_stock_adjustment(uuid,text)', true),
      ('public.rpc_manual_stock_movement_v2(jsonb)', true),
      ('public.rpc_post_goods_receipt(jsonb)', true),
      ('public.rpc_post_delivery_note(jsonb)', true),
      ('public.rpc_submit_stock_adjustment(uuid)', true),
      ('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)', true),
      ('public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)', true),
      ('public.release_expired_reservations(uuid)', false),
      ('public.wardah_lock_products_for_stock_write(uuid,uuid[])', false)
    ) AS t(sig, expect_definer)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      v_drift := array_append(v_drift, r.sig || ' :missing');
      CONTINUE;
    END IF;
    SELECT prosecdef INTO v_actual FROM pg_proc WHERE oid = to_regprocedure(r.sig)::oid;
    IF v_actual IS DISTINCT FROM r.expect_definer THEN
      v_drift := array_append(
        v_drift,
        r.sig || ' :expected_definer=' || r.expect_definer || ' actual=' || coalesce(v_actual::text, 'null'));
    END IF;
  END LOOP;

  IF cardinality(v_drift) > 0 THEN
    RAISE EXCEPTION 'DEFINER_CONTRACT_SECURITY_MODE_DRIFT: %', v_drift;
  END IF;
  RAISE NOTICE 'DEFINER_CONTRACT_SECURITY_MODE_OK: 13/13 objects at their reviewed security mode';
END
$definer_mode_matrix$;

-- ---------------------------------------------------------------------------
-- 5. The privilege ledger the static REVOKE rule stands in for
-- ---------------------------------------------------------------------------
-- The scanner credits a REVOKE only when the statement NAMES the function and
-- no later GRANT re-opens it - but the authority on "who can execute this" is
-- the ACL itself, after every migration in the chain has had its turn. The four
-- canonical stock helpers are the ones the scanner accepted on closure rather
-- than on a guard, so their closure is exactly what must be true in the
-- catalog. PUBLIC is checked twice on purpose: through has_function_privilege,
-- which resolves the PUBLIC pseudo-role, and through aclexplode's grantee = 0,
-- which reads the stored ACL directly. A default ACL (proacl IS NULL) means
-- PUBLIC still holds the inherited EXECUTE grant and is a failure.
DO $definer_privilege_ledger$
DECLARE
  r record;
  v_open text[] := '{}'::text[];
  v_role text;
BEGIN
  FOR r IN
    SELECT sig
    FROM unnest(ARRAY[
      'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)',
      'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
      'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)',
      'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)',
      'public.wardah_lock_products_for_stock_write(uuid,uuid[])'
    ]) AS t(sig)
  LOOP
    FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, r.sig, 'EXECUTE') THEN
        v_open := array_append(v_open, r.sig || ' :' || v_role);
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.oid = to_regprocedure(r.sig)::oid
        AND a.grantee = 0
        AND a.privilege_type = 'EXECUTE'
    ) THEN
      v_open := array_append(v_open, r.sig || ' :acl_grantee_public');
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure(r.sig)::oid AND p.proacl IS NULL
    ) THEN
      v_open := array_append(v_open, r.sig || ' :default_acl_public_execute');
    END IF;
  END LOOP;

  IF cardinality(v_open) > 0 THEN
    RAISE EXCEPTION 'DEFINER_CONTRACT_CLIENT_SURFACE_OPEN: %', v_open;
  END IF;
  RAISE NOTICE 'DEFINER_CONTRACT_PRIVILEGE_LEDGER_OK: 5/5 closure-exempt helpers hold no PUBLIC/anon/authenticated EXECUTE, by privilege test and by stored ACL';
END
$definer_privilege_ledger$;

DO $definer_contract_pass$
BEGIN
  RAISE NOTICE 'DEFINER_GUARD_CONTRACT_PASS: exception_semantics=live guard_identity=4/4 case_twins=none security_mode=13/13 privilege_ledger=5/5';
END
$definer_contract_pass$;
