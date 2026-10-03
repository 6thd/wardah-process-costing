-- Red proof for Migration 200: run through 199 with 200 omitted.
--
-- Confirms MS-01 was exploitable, not latent: before 200 an ordinary
-- (non-admin) active member can re-point their organization's posting map
-- directly, because the existing FOR ALL policy only checks the org and
-- authenticated still holds the table write grants. No temporary policy is
-- needed for this proof.
\set ON_ERROR_STOP on

BEGIN;

DO $preconditions$
BEGIN
  IF NOT (has_table_privilege('authenticated', 'public.gl_event_mappings', 'UPDATE')
          AND has_table_privilege('authenticated', 'public.gl_event_mappings', 'INSERT')
          AND has_table_privilege('anon', 'public.gl_event_mappings', 'SELECT')) THEN
    RAISE EXCEPTION 'GL_EVENT_200_RED_PRECONDITION_FAILED: expected pre-200 grants';
  END IF;
  IF to_regprocedure('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'GL_EVENT_200_RED_PRECONDITION_FAILED: 200 already applied';
  END IF;
  RAISE NOTICE 'GL_EVENT_200_RED_PRECONDITION_OK: pre-200 grants present';
END
$preconditions$;

INSERT INTO public.organizations (id, name, code)
VALUES ('52000200-0000-0000-0000-0000000000c1', 'GL Event 200 Red', 'GLE200-RED');

INSERT INTO auth.users (id, email)
VALUES ('52000200-0000-0000-0000-0000000000c2', 'gle200-red-member@example.test');

INSERT INTO public.user_organizations (user_id, org_id, role, is_active)
VALUES ('52000200-0000-0000-0000-0000000000c2', '52000200-0000-0000-0000-0000000000c1', 'user', true);

INSERT INTO public.gl_event_mappings (org_id, event_code, work_center_code, debit_account_code, credit_account_code, description)
VALUES ('52000200-0000-0000-0000-0000000000c1', 'FG_RECEIPT', NULL, '135100', '134100', 'seed');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '52000200-0000-0000-0000-0000000000c2', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"52000200-0000-0000-0000-0000000000c2","role":"authenticated","org_id":"52000200-0000-0000-0000-0000000000c1"}', true);

DO $probe$
DECLARE
  v_rows integer;
BEGIN
  IF public.wardah_is_org_admin('52000200-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'GL_EVENT_200_RED_FIXTURE_IS_ADMIN';
  END IF;

  UPDATE public.gl_event_mappings
  SET debit_account_code = '999999'
  WHERE event_code = 'FG_RECEIPT';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'GL_EVENT_200_RED_PROBE_UPDATE_DID_NOT_APPLY: %', v_rows;
  END IF;

  RAISE NOTICE
    'GL_EVENT_200_RED_PROOF_OK: an ordinary member re-pointed FG_RECEIPT directly before 200';
END
$probe$;

RESET ROLE;

\echo 'GL_EVENT_200_RED_PROOF_PASS'
ROLLBACK;
