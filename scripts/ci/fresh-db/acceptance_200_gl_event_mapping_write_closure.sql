-- Acceptance for Migration 200 / gl_event_mappings write closure (MS-01).
-- Runs on a database built through 200. Proves:
--   1. The grant/EXECUTE shape matches the migration's postflight.
--   2. An ordinary member still reads the mappings (the profitability
--      report's fetchCogsAccounts path) but every direct write is rejected
--      by the grant itself (SQLSTATE 42501) even though the permissive
--      FOR ALL policy is still in place.
--   3. rpc_set_gl_event_mapping admits only an active org admin of the
--      target organization, validates its inputs, upserts on the existing
--      unique key and writes one audit row per call.
--
-- Fixture ids are fixed literals so they can be referenced after
-- SET LOCAL ROLE authenticated.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Grant/EXECUTE shape.
-- ---------------------------------------------------------------------
DO $grants$
DECLARE
  v_priv text;
  v_sig text := 'public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)';
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.gl_event_mappings', 'SELECT') THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_AUTHENTICATED_SELECT_MISSING';
  END IF;
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF has_table_privilege('authenticated', 'public.gl_event_mappings', v_priv) THEN
      RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_AUTHENTICATED_WRITE_REMAINS: %', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF has_table_privilege('anon', 'public.gl_event_mappings', v_priv) THEN
      RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_ANON_PRIVILEGE_REMAINS: %', v_priv;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE')
     OR has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_RPC_ACL_WRONG';
  END IF;
  RAISE NOTICE 'GL_EVENT_200_GRANTS_OK';
END
$grants$;

-- ---------------------------------------------------------------------
-- Fixtures: org A (admin + ordinary member), org B (one member).
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code) VALUES
  ('52000200-0000-0000-0000-0000000000a1', 'GL Event 200 A', 'GLE200-A'),
  ('52000200-0000-0000-0000-0000000000b1', 'GL Event 200 B', 'GLE200-B');

INSERT INTO auth.users (id, email) VALUES
  ('52000200-0000-0000-0000-0000000000a2', 'gle200-admin@example.test'),
  ('52000200-0000-0000-0000-0000000000a3', 'gle200-member@example.test'),
  ('52000200-0000-0000-0000-0000000000b2', 'gle200-other@example.test');

INSERT INTO public.user_organizations (user_id, org_id, role, is_active) VALUES
  ('52000200-0000-0000-0000-0000000000a2', '52000200-0000-0000-0000-0000000000a1', 'admin', true),
  ('52000200-0000-0000-0000-0000000000a3', '52000200-0000-0000-0000-0000000000a1', 'user', true),
  ('52000200-0000-0000-0000-0000000000b2', '52000200-0000-0000-0000-0000000000b1', 'admin', true);

INSERT INTO public.gl_accounts (org_id, code, name, category, subtype, normal_balance, is_active) VALUES
  ('52000200-0000-0000-0000-0000000000a1', '131100', 'Raw materials', 'ASSET', 'inventory', 'DEBIT', true),
  ('52000200-0000-0000-0000-0000000000a1', '134100', 'WIP', 'ASSET', 'inventory', 'DEBIT', true),
  ('52000200-0000-0000-0000-0000000000a1', '135100', 'Finished goods', 'ASSET', 'inventory', 'DEBIT', true),
  ('52000200-0000-0000-0000-0000000000a1', '514000', 'Overhead applied', 'EXPENSE', 'overhead', 'CREDIT', true),
  ('52000200-0000-0000-0000-0000000000a1', '999900', 'Closed account', 'ASSET', 'inventory', 'DEBIT', false),
  ('52000200-0000-0000-0000-0000000000b1', '777700', 'Org B only', 'ASSET', 'inventory', 'DEBIT', true);

INSERT INTO public.work_centers (org_id, code, name) VALUES
  ('52000200-0000-0000-0000-0000000000a1', 'MIXING', 'Mixing');

INSERT INTO public.gl_event_mappings (org_id, event_code, work_center_code, debit_account_code, credit_account_code, description)
VALUES ('52000200-0000-0000-0000-0000000000a1', 'FG_RECEIPT', NULL, '135100', '134100', 'seed');

-- ---------------------------------------------------------------------
-- 2. Ordinary member: reads allowed, direct writes rejected by the grant.
-- ---------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '52000200-0000-0000-0000-0000000000a3', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"52000200-0000-0000-0000-0000000000a3","role":"authenticated","org_id":"52000200-0000-0000-0000-0000000000a1"}', true);

DO $member$
DECLARE
  v_count integer;
  v_caught integer := 0;
BEGIN
  SELECT count(*) INTO v_count FROM public.gl_event_mappings WHERE event_code = 'FG_RECEIPT';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_MEMBER_READ_BROKEN: %', v_count;
  END IF;

  BEGIN
    UPDATE public.gl_event_mappings SET debit_account_code = '131100' WHERE event_code = 'FG_RECEIPT';
  EXCEPTION WHEN insufficient_privilege THEN v_caught := v_caught + 1;
  END;
  BEGIN
    INSERT INTO public.gl_event_mappings (org_id, event_code, debit_account_code, credit_account_code)
    VALUES ('52000200-0000-0000-0000-0000000000a1', 'MATERIAL_ISSUE', '134100', '131100');
  EXCEPTION WHEN insufficient_privilege THEN v_caught := v_caught + 1;
  END;
  BEGIN
    DELETE FROM public.gl_event_mappings WHERE event_code = 'FG_RECEIPT';
  EXCEPTION WHEN insufficient_privilege THEN v_caught := v_caught + 1;
  END;

  IF v_caught <> 3 THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_DIRECT_WRITE_NOT_REJECTED: caught=%', v_caught;
  END IF;

  -- The ordinary member cannot use the RPC either. The refusal is
  -- NOT_ORG_ADMIN on a chain ending at 200, and MANUFACTURING_SETTINGS_UPDATE_DENIED
  -- once 201 widens the guard to key holders (this member holds no key).
  BEGIN
    PERFORM public.rpc_set_gl_event_mapping('52000200-0000-0000-0000-0000000000a1',
      'FG_RECEIPT', '131100', '134100');
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_MEMBER_RPC_ADMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_ORG_ADMIN%'
       AND SQLERRM NOT LIKE '%MANUFACTURING_SETTINGS_UPDATE_DENIED%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'GL_EVENT_200_MEMBER_PROBE_OK: member reads, direct writes and RPC rejected';
END
$member$;

RESET ROLE;

DO $unchanged$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.gl_event_mappings
    WHERE org_id = '52000200-0000-0000-0000-0000000000a1' AND event_code = 'FG_RECEIPT'
      AND debit_account_code = '135100' AND credit_account_code = '134100'
  ) OR EXISTS (
    SELECT 1 FROM public.gl_event_mappings
    WHERE org_id = '52000200-0000-0000-0000-0000000000a1' AND event_code = 'MATERIAL_ISSUE'
  ) THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_MEMBER_CHANGED_MAPPINGS';
  END IF;
END
$unchanged$;

-- ---------------------------------------------------------------------
-- 3. Org admin through the RPC.
-- ---------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '52000200-0000-0000-0000-0000000000a2', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"52000200-0000-0000-0000-0000000000a2","role":"authenticated","org_id":"52000200-0000-0000-0000-0000000000a1"}', true);

DO $admin$
DECLARE
  v_org uuid := '52000200-0000-0000-0000-0000000000a1';
  v_result jsonb;
  v_rejected integer := 0;
  v_expected integer := 0;
  r record;
BEGIN
  -- Update the seeded row.
  v_result := public.rpc_set_gl_event_mapping(v_org, 'fg_receipt', '135100', '131100', NULL, 'admin change');
  IF (v_result ->> 'created')::boolean IS DISTINCT FROM false
     OR v_result ->> 'credit_account_code' <> '131100' THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_UPDATE_WRONG: %', v_result;
  END IF;

  -- Create a per-work-center OH_APPLIED override.
  v_result := public.rpc_set_gl_event_mapping(v_org, 'OH_APPLIED', '134100', '514000', 'MIXING');
  IF (v_result ->> 'created')::boolean IS DISTINCT FROM true
     OR v_result ->> 'work_center_code' <> 'MIXING' THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_CREATE_WRONG: %', v_result;
  END IF;

  -- Each invalid call must be rejected with its own error.
  FOR r IN SELECT * FROM (VALUES
    ('bad event code',        'fg receipt', '135100', '131100', NULL::text,  'GL_EVENT_MAPPING_INVALID_EVENT_CODE'),
    ('override not OH',       'FG_RECEIPT', '135100', '131100', 'MIXING',    'GL_EVENT_MAPPING_WORK_CENTER_OVERRIDE_NOT_SUPPORTED'),
    ('unknown work center',   'OH_APPLIED', '134100', '514000', 'NOPE',      'GL_EVENT_MAPPING_WORK_CENTER_NOT_FOUND'),
    ('same account',          'FG_RECEIPT', '135100', '135100', NULL,        'GL_EVENT_MAPPING_SAME_ACCOUNT'),
    ('inactive debit',        'FG_RECEIPT', '999900', '131100', NULL,        'GL_EVENT_MAPPING_DEBIT_ACCOUNT_INVALID'),
    ('other org credit',      'FG_RECEIPT', '135100', '777700', NULL,        'GL_EVENT_MAPPING_CREDIT_ACCOUNT_INVALID'),
    ('missing account',       'FG_RECEIPT', '',       '131100', NULL,        'GL_EVENT_MAPPING_ACCOUNT_REQUIRED')
  ) AS t(label, ev, dr, cr, wc, expected)
  LOOP
    v_expected := v_expected + 1;
    BEGIN
      PERFORM public.rpc_set_gl_event_mapping(v_org, r.ev, r.dr, r.cr, r.wc);
      RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_INVALID_ADMITTED: %', r.label;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%' || r.expected || '%' THEN
        RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_WRONG_ERROR: % -> %', r.label, SQLERRM;
      END IF;
      v_rejected := v_rejected + 1;
    END;
  END LOOP;
  IF v_rejected <> v_expected THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_VALIDATION_COUNT: %/%', v_rejected, v_expected;
  END IF;

  -- An admin of org A cannot write org B.
  BEGIN
    PERFORM public.rpc_set_gl_event_mapping('52000200-0000-0000-0000-0000000000b1',
      'FG_RECEIPT', '777700', '777700');
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_CROSS_ORG_ADMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'GL_EVENT_200_ACCEPTANCE%' OR SQLERRM LIKE 'GL_EVENT_MAPPING%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'GL_EVENT_200_ADMIN_RPC_OK: admin upsert, validation and org boundary hold';
END
$admin$;

RESET ROLE;

DO $audit$
DECLARE
  v_audit integer;
BEGIN
  SELECT count(*) INTO v_audit FROM public.audit_logs
  WHERE org_id = '52000200-0000-0000-0000-0000000000a1'
    AND action = 'accounting.gl_event_mapping.set';
  IF v_audit <> 2 THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_AUDIT_COUNT: %', v_audit;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE org_id = '52000200-0000-0000-0000-0000000000a1'
      AND action = 'accounting.gl_event_mapping.set'
      AND old_data ->> 'credit_account_code' = '134100'
      AND new_data ->> 'credit_account_code' = '131100'
      AND user_id = '52000200-0000-0000-0000-0000000000a2'
  ) THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_AUDIT_BEFORE_AFTER_MISSING';
  END IF;

  IF (SELECT count(*) FROM public.gl_event_mappings
      WHERE org_id = '52000200-0000-0000-0000-0000000000a1') <> 2
     OR EXISTS (SELECT 1 FROM public.gl_event_mappings
                WHERE org_id = '52000200-0000-0000-0000-0000000000b1') THEN
    RAISE EXCEPTION 'GL_EVENT_200_ACCEPTANCE_ROW_COUNT_WRONG';
  END IF;

  RAISE NOTICE 'GL_EVENT_200_AUDIT_OK';
END
$audit$;

\echo 'GL_EVENT_200_ACCEPTANCE_PASS'
ROLLBACK;
