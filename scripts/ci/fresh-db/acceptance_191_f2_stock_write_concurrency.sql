-- Acceptance contract for Migration 191 (F2 stock write concurrency closure).
-- Runs on a Fresh DB immediately after 191 is applied, before the deterministic
-- GREEN harness. Fail-closed: every assertion raises, and the psql exit code
-- under ON_ERROR_STOP is the verdict. The closing notice is evidence, not the
-- verdict.
--
-- This file asserts the *final catalog contract*. The behavioural proof lives in
-- the deterministic GREEN harness under docs/db/m191-evidence/harness/, and the
-- body-shape proof lives in docs/db/m191-slices/12_acceptance_static_gates.sql
-- (with its own selftest). Nothing is duplicated between them.

\set ON_ERROR_STOP on

DO $m191_objects$
DECLARE
  v_sig text;
  v_missing text[] := '{}'::text[];
  c_signatures CONSTANT text[] := ARRAY[
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)',
    'public.rpc_cancel_stock_adjustment(uuid,text)',
    'public.rpc_manual_stock_movement_v2(jsonb)',
    'public.rpc_post_goods_receipt(jsonb)',
    'public.rpc_post_delivery_note(jsonb)',
    'public.rpc_submit_stock_adjustment(uuid)',
    'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)',
    'public.release_expired_reservations(uuid)',
    'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)',
    'public.wardah_lock_products_for_stock_write(uuid,uuid[])'
  ];
BEGIN
  FOREACH v_sig IN ARRAY c_signatures LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      v_missing := array_append(v_missing, v_sig);
    END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'M191_ACCEPT_OBJECT_MISSING: %', v_missing;
  END IF;
  RAISE NOTICE 'M191_ACCEPT_OBJECTS_OK: 13/13';
END
$m191_objects$;

-- The new shared helper. It is internal: SECURITY INVOKER (it must run with the
-- privileges of the SECURITY DEFINER caller, not its own), hardened search_path,
-- closed to every client role, and executable by service_role.
DO $m191_helper$
DECLARE
  c_helper CONSTANT text := 'public.wardah_lock_products_for_stock_write(uuid,uuid[])';
  v_oid oid := to_regprocedure(c_helper)::oid;
  v_secdef boolean;
  v_config text[];
BEGIN
  SELECT prosecdef, proconfig INTO v_secdef, v_config FROM pg_proc WHERE oid = v_oid;

  IF v_secdef THEN
    RAISE EXCEPTION 'M191_ACCEPT_HELPER_MUST_BE_SECURITY_INVOKER';
  END IF;
  IF v_config IS NULL
     OR NOT EXISTS (SELECT 1 FROM unnest(v_config) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'M191_ACCEPT_HELPER_SEARCH_PATH_NOT_HARDENED: %', v_config;
  END IF;

  IF has_function_privilege('public', c_helper, 'EXECUTE')
     OR has_function_privilege('anon', c_helper, 'EXECUTE')
     OR has_function_privilege('authenticated', c_helper, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_ACCEPT_HELPER_NOT_CLIENT_CLOSED';
  END IF;
  IF NOT has_function_privilege('service_role', c_helper, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_ACCEPT_HELPER_SERVICE_ROLE_MISSING';
  END IF;

  RAISE NOTICE 'M191_ACCEPT_HELPER_OK: security invoker, hardened search_path, client-closed, service_role only';
END
$m191_helper$;

-- The four canonical stock helpers stay closed to clients: they are reached only
-- through the SECURITY DEFINER RPC surface. Migration 191 must not widen them.
DO $m191_canonical$
DECLARE
  v_sig text;
  c_canonical CONSTANT text[] := ARRAY[
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)'
  ];
BEGIN
  FOREACH v_sig IN ARRAY c_canonical LOOP
    IF has_function_privilege('public', v_sig, 'EXECUTE')
       OR has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'M191_ACCEPT_CANONICAL_HELPER_EXPOSED: %', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'M191_ACCEPT_CANONICAL_HELPER_SERVICE_ROLE_MISSING: %', v_sig;
    END IF;
  END LOOP;
  RAISE NOTICE 'M191_ACCEPT_CANONICAL_HELPERS_OK: 4/4 client-closed, service_role only';
END
$m191_canonical$;

-- Client-facing surfaces keep exactly the reach they had before 191.
DO $m191_client_surface$
DECLARE
  c_fix_c CONSTANT text := 'public.rpc_cancel_stock_adjustment(uuid,text)';
  c_fix_g CONSTANT text := 'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)';
BEGIN
  -- Fix C: authenticated + service_role, and explicitly not anon, not PUBLIC.
  IF NOT has_function_privilege('authenticated', c_fix_c, 'EXECUTE')
     OR NOT has_function_privilege('service_role', c_fix_c, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_ACCEPT_FIX_C_LOST_CLIENT_ACCESS';
  END IF;
  IF has_function_privilege('anon', c_fix_c, 'EXECUTE')
     OR has_function_privilege('public', c_fix_c, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_ACCEPT_FIX_C_WIDENED_TO_ANON_OR_PUBLIC';
  END IF;

  -- Fix G stays client-facing.
  IF NOT has_function_privilege('authenticated', c_fix_g, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_ACCEPT_FIX_G_LOST_CLIENT_ACCESS';
  END IF;

  RAISE NOTICE 'M191_ACCEPT_CLIENT_SURFACE_OK: fix C authenticated+service_role (not anon/PUBLIC), fix G client-facing';
END
$m191_client_surface$;

-- Fix F carry-forward. release_expired_reservations keeps the broad historical
-- EXECUTE surface it already had and stays SECURITY INVOKER. This is an explicit
-- carry-forward, NOT an endorsement of anon exposure: 191 deliberately does not
-- change that surface, and this assertion exists so a future change to it is a
-- deliberate decision rather than an accident. Its own separate debt is tracked
-- outside this migration.
DO $m191_fix_f$
DECLARE
  c_fix_f CONSTANT text := 'public.release_expired_reservations(uuid)';
  v_secdef boolean;
BEGIN
  SELECT prosecdef INTO v_secdef FROM pg_proc WHERE oid = to_regprocedure(c_fix_f)::oid;
  IF v_secdef THEN
    RAISE EXCEPTION 'M191_ACCEPT_FIX_F_UNEXPECTEDLY_SECURITY_DEFINER';
  END IF;
  IF NOT has_function_privilege('authenticated', c_fix_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_ACCEPT_FIX_F_SURFACE_CHANGED';
  END IF;
  RAISE NOTICE 'M191_ACCEPT_FIX_F_OK: security invoker, historical execute surface carried forward unchanged';
END
$m191_fix_f$;

-- Every SECURITY DEFINER object among the thirteen must carry a hardened
-- search_path, and none of the thirteen may contain a production advisory gate
-- (test-only gates belong to the rehearsal harness, never to the migration).
DO $m191_hardening$
DECLARE
  v_bad text[] := '{}'::text[];
  v_gate text[] := '{}'::text[];
  r record;
  c_signatures CONSTANT text[] := ARRAY[
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)',
    'public.rpc_cancel_stock_adjustment(uuid,text)',
    'public.rpc_manual_stock_movement_v2(jsonb)',
    'public.rpc_post_goods_receipt(jsonb)',
    'public.rpc_post_delivery_note(jsonb)',
    'public.rpc_submit_stock_adjustment(uuid)',
    'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)',
    'public.release_expired_reservations(uuid)',
    'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)',
    'public.wardah_lock_products_for_stock_write(uuid,uuid[])'
  ];
BEGIN
  FOR r IN
    SELECT s.sig, p.prosecdef, p.proconfig, p.prosrc
    FROM unnest(c_signatures) AS s(sig)
    JOIN pg_proc p ON p.oid = to_regprocedure(s.sig)::oid
  LOOP
    IF r.prosecdef AND (
         r.proconfig IS NULL
         OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%')
       ) THEN
      v_bad := array_append(v_bad, r.sig);
    END IF;
    -- Advisory locks are not banned outright: rpc_post_goods_receipt and
    -- rpc_post_delivery_note inherit a legitimate production idempotency
    -- serializer, pg_advisory_xact_lock(hashtext('<document>:'||org)), from
    -- their predecessors. What must never appear is a *test-only* gate, which is
    -- what the rehearsal harness injects into a copy of a body. So the inherited
    -- shape is pinned exactly and anything else is rejected.
    IF r.prosrc ~ 'pg_advisory' THEN
      IF r.sig = 'public.rpc_post_goods_receipt(jsonb)' THEN
        IF r.prosrc !~ 'pg_advisory_xact_lock\(hashtext\(''goods_receipts:''\s*\|\|\s*v_org::text\)\)'
           OR (length(r.prosrc) - length(replace(r.prosrc, 'pg_advisory', ''))) / length('pg_advisory') <> 1 THEN
          v_gate := array_append(v_gate, r.sig);
        END IF;
      ELSIF r.sig = 'public.rpc_post_delivery_note(jsonb)' THEN
        IF r.prosrc !~ 'pg_advisory_xact_lock\(hashtext\(''delivery_notes:''\s*\|\|\s*v_org::text\)\)'
           OR (length(r.prosrc) - length(replace(r.prosrc, 'pg_advisory', ''))) / length('pg_advisory') <> 1 THEN
          v_gate := array_append(v_gate, r.sig);
        END IF;
      ELSE
        v_gate := array_append(v_gate, r.sig);
      END IF;
    END IF;
  END LOOP;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'M191_ACCEPT_DEFINER_SEARCH_PATH_NOT_HARDENED: %', v_bad;
  END IF;
  IF cardinality(v_gate) > 0 THEN
    RAISE EXCEPTION 'M191_ACCEPT_UNEXPECTED_ADVISORY_GATE: %', v_gate;
  END IF;

  RAISE NOTICE 'M191_ACCEPT_HARDENING_OK: every definer has a hardened search_path, only the two inherited document idempotency serializers use pg_advisory';
END
$m191_hardening$;

-- No test-only instrumentation may reach a database that ran this migration.
DO $m191_no_testonly$
DECLARE
  v_leaked text[];
BEGIN
  SELECT coalesce(array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text), '{}')
  INTO v_leaked
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'zz\_%';

  IF cardinality(v_leaked) > 0 THEN
    RAISE EXCEPTION 'M191_ACCEPT_TESTONLY_OBJECT_PRESENT: %', v_leaked;
  END IF;
  RAISE NOTICE 'M191_ACCEPT_NO_TESTONLY_OK';
END
$m191_no_testonly$;

DO $m191_pass$
BEGIN
  RAISE NOTICE 'M191_ACCEPTANCE_CONTRACT_PASS: objects=13/13 helper=invoker/hardened/closed canonical=4/4_closed fix_c=scoped fix_g=client_facing fix_f=carried_forward advisory=inherited_idempotency_only testonly=absent';
END
$m191_pass$;
