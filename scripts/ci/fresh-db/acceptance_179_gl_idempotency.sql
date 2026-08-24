-- Acceptance for Migration 179 — generic GL idempotency hardening (#176).
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.j179_payload(
  p_key text,
  p_description text DEFAULT 'J179 strict request'
)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'org_id','17900000-aaaa-aaaa-aaaa-000000000001',
    'journal_id','17900000-2222-2222-2222-000000000001',
    'entry_date','2026-08-24',
    'description',p_description,
    'reference_type','J179_TEST',
    'reference_number',p_key,
    'idempotency_key',p_key,
    'auto_post',false,
    'lines',jsonb_build_array(
      jsonb_build_object(
        'line_number',1,
        'account_id','17900000-3333-3333-3333-000000000001',
        'debit',100,'credit',0,'currency_code','SAR','description','Debit'),
      jsonb_build_object(
        'line_number',2,
        'account_id','17900000-3333-3333-3333-000000000002',
        'debit',0,'credit',100,'currency_code','SAR','description','Credit')
    )
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'J179 expected [%], got [%] for [%]', p_needle, SQLERRM, p_sql;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'J179 expected error [%], succeeded: %', p_needle, p_sql;
  END IF;
END;
$$;

-- The generic primitive is internal after 178, but wardah_org_id(explicit)
-- still enforces active organization membership through auth.uid(). Model the
-- authenticated domain caller explicitly so the test reaches idempotency logic.
SELECT set_config(
  'request.jwt.claim.sub',
  '17900000-0000-0000-0000-000000000001',
  false
);

-- Schema and historical-row contract.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gl_entries' AND column_name='request_hash'
  ) THEN
    RAISE EXCEPTION 'J179 request_hash column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='gl_entries'
      AND indexname='uq_gl_entries_org_idem'
  ) THEN
    RAISE EXCEPTION 'J179 existing idempotency unique index missing';
  END IF;

  IF has_function_privilege('authenticated','public.rpc_create_journal_entry(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'J179 widened generic primitive execute surface';
  END IF;
END $$;

CREATE TEMP TABLE t179_legacy AS
SELECT public.rpc_create_journal_entry(
  pg_temp.j179_payload('J179:legacy:key','Payload intentionally cannot verify legacy row')
) AS result;

DO $$
DECLARE v jsonb;
BEGIN
  SELECT result INTO v FROM t179_legacy;
  IF (v->>'entry_id')::uuid <> '17900000-4444-4444-4444-000000000001'::uuid
     OR COALESCE((v->>'duplicate')::boolean,false) IS DISTINCT FROM true
     OR COALESCE((v->>'payload_verified')::boolean,true) IS DISTINCT FROM false
     OR COALESCE((v->>'legacy_replay')::boolean,false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'J179 legacy replay response mismatch: %', v;
  END IF;

  IF (SELECT request_hash FROM public.gl_entries
      WHERE id='17900000-4444-4444-4444-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'J179 legacy replay opportunistically backfilled request_hash';
  END IF;
END $$;

-- New keyed requests are strict and carry a SHA-256 request identity.
CREATE TEMP TABLE t179_first AS
SELECT public.rpc_create_journal_entry(pg_temp.j179_payload('J179:strict:key')) AS result;

CREATE TEMP TABLE t179_replay AS
SELECT public.rpc_create_journal_entry(pg_temp.j179_payload('J179:strict:key')) AS result;

DO $$
DECLARE v_first jsonb; v_replay jsonb; v_id uuid; v_hash text; v_expected text;
BEGIN
  SELECT result INTO v_first FROM t179_first;
  SELECT result INTO v_replay FROM t179_replay;
  v_id := (v_first->>'entry_id')::uuid;

  IF v_id IS NULL OR (v_replay->>'entry_id')::uuid IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION 'J179 strict replay did not return same entry: first=% replay=%',v_first,v_replay;
  END IF;
  IF COALESCE((v_first->>'duplicate')::boolean,true) IS DISTINCT FROM false
     OR COALESCE((v_replay->>'duplicate')::boolean,false) IS DISTINCT FROM true
     OR COALESCE((v_replay->>'payload_verified')::boolean,false) IS DISTINCT FROM true
     OR COALESCE((v_replay->>'legacy_replay')::boolean,true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'J179 strict response flags mismatch: first=% replay=%',v_first,v_replay;
  END IF;

  SELECT request_hash INTO v_hash FROM public.gl_entries WHERE id=v_id;
  v_expected := encode(
    extensions.digest(convert_to(pg_temp.j179_payload('J179:strict:key')::text,'UTF8'),'sha256'),
    'hex'
  );
  IF v_hash IS DISTINCT FROM v_expected OR length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'J179 stored request hash mismatch: got=% expected=%',v_hash,v_expected;
  END IF;
  IF (SELECT count(*) FROM public.gl_entries
      WHERE org_id='17900000-aaaa-aaaa-aaaa-000000000001'
        AND idempotency_key='J179:strict:key') <> 1 THEN
    RAISE EXCEPTION 'J179 strict key produced multiple headers';
  END IF;
  IF (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id=v_id) <> 2 THEN
    RAISE EXCEPTION 'J179 strict key produced wrong line count';
  END IF;
END $$;

SELECT pg_temp.expect_error(
  format('SELECT public.rpc_create_journal_entry(%L::jsonb)',
         pg_temp.j179_payload('J179:strict:key','Changed material payload')),
  'IDEMPOTENCY_KEY_CONFLICT'
);

-- An unrelated unique boundary must keep its original PostgreSQL violation.
-- Test-only trigger forces entry_number to collide with the legacy fixture.
CREATE OR REPLACE FUNCTION public.j179_force_unrelated_entry_number_collision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.description = 'J179 force unrelated unique' THEN
    NEW.entry_number := 'J179-LEGACY-001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER zzz_j179_force_unrelated_entry_number_collision
BEFORE INSERT ON public.gl_entries
FOR EACH ROW EXECUTE FUNCTION public.j179_force_unrelated_entry_number_collision();

SELECT pg_temp.expect_error(
  format('SELECT public.rpc_create_journal_entry(%L::jsonb)',
         pg_temp.j179_payload('J179:other-unique:key','J179 force unrelated unique')),
  'gl_entries_org_number_unique'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE org_id='17900000-aaaa-aaaa-aaaa-000000000001'
      AND idempotency_key='J179:other-unique:key'
  ) THEN
    RAISE EXCEPTION 'J179 unrelated unique violation was swallowed into a row';
  END IF;
END $$;

ROLLBACK;
SELECT 'GL_IDEMPOTENCY_179_ACCEPTANCE_PASS' AS result;
