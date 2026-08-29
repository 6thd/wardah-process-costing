-- Acceptance for Migration 184 / Round 2 posting integrity.
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.organizations (id, name, code)
VALUES ('99184184-0000-0000-0000-000000000002', 'GL 184 Green', 'GL184-GREEN');

INSERT INTO public.gl_accounts
  (id, org_id, code, name, category, subtype, normal_balance,
   allow_posting, is_active)
VALUES
  ('99184184-1100-0000-0000-000000000002',
   '99184184-0000-0000-0000-000000000002',
   '184101', 'GL 184 Green Debit', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, true),
  ('99184184-2100-0000-0000-000000000002',
   '99184184-0000-0000-0000-000000000002',
   '184201', 'GL 184 Green Credit', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT',
   true, true);

CREATE OR REPLACE FUNCTION pg_temp.expect_184_error(
  p_sql text, p_fragment text, p_label text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_fragment || '%' THEN
      RAISE EXCEPTION
        'GL_184_UNEXPECTED_ERROR[%]: expected [%], got [%]',
        p_label, p_fragment, SQLERRM;
    END IF;
    v_caught := true;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'GL_184_EXPECTED_FAILURE_MISSING[%]', p_label;
  END IF;
END;
$$;

-- Header trigger now covers both INSERT and UPDATE.
DO $$
DECLARE
  v_type integer;
BEGIN
  SELECT tgtype INTO v_type
  FROM pg_trigger
  WHERE tgrelid = 'public.gl_entries'::regclass
    AND tgname = 'check_balance_before_post_trigger'
    AND NOT tgisinternal;

  IF v_type IS NULL OR (v_type & 2) = 0
     OR (v_type & 4) = 0 OR (v_type & 16) = 0 THEN
    RAISE EXCEPTION 'GL_184_HEADER_TRIGGER_EVENTS_INVALID: %', v_type;
  END IF;
END;
$$;

-- Drafts may be incomplete while edited.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  ('99184184-2000-0000-0000-000000000001',
   '99184184-0000-0000-0000-000000000002',
   'GL184-DRAFT-VALID', CURRENT_DATE, 'manual', 'valid fixture',
   100, 100, 'draft', 'system');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.gl_entry_lines
  (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
VALUES
  ('99184184-0000-0000-0000-000000000002',
   '99184184-2000-0000-0000-000000000001', 1,
   '99184184-1100-0000-0000-000000000002', 100, 0, 'SAR'),
  ('99184184-0000-0000-0000-000000000002',
   '99184184-2000-0000-0000-000000000001', 2,
   '99184184-2100-0000-0000-000000000002', 0, 100, 'SAR');

UPDATE public.gl_entries
SET status = 'posted'
WHERE id = '99184184-2000-0000-0000-000000000001';
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Header-first posted INSERT is allowed within one transaction when its valid
-- lines arrive before deferred constraint evaluation.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  ('99184184-2000-0000-0000-000000000002',
   '99184184-0000-0000-0000-000000000002',
   'GL184-INSERT-VALID', CURRENT_DATE, 'manual', 'valid fixture',
   50, 50, 'posted', 'system');

INSERT INTO public.gl_entry_lines
  (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
VALUES
  ('99184184-0000-0000-0000-000000000002',
   '99184184-2000-0000-0000-000000000002', 1,
   '99184184-1100-0000-0000-000000000002', 50, 0, 'SAR'),
  ('99184184-0000-0000-0000-000000000002',
   '99184184-2000-0000-0000-000000000002', 2,
   '99184184-2100-0000-0000-000000000002', 0, 50, 'SAR');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- No-lines posting is rejected.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  ('99184184-2000-0000-0000-000000000003',
   '99184184-0000-0000-0000-000000000002',
   'GL184-NO-LINES', CURRENT_DATE, 'manual', 'invalid fixture',
   20, 20, 'draft', 'system');
SELECT pg_temp.expect_184_error(
  $$UPDATE public.gl_entries SET status='posted'
    WHERE id='99184184-2000-0000-0000-000000000003'$$,
  'POSTED_ENTRY_LINES_MISSING', 'no lines');

-- Balanced lines that disagree with the header are rejected.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  ('99184184-2000-0000-0000-000000000004',
   '99184184-0000-0000-0000-000000000002',
   'GL184-MISMATCH', CURRENT_DATE, 'manual', 'invalid fixture',
   100, 100, 'draft', 'system');
INSERT INTO public.gl_entry_lines
  (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
VALUES
  ('99184184-0000-0000-0000-000000000002',
   '99184184-2000-0000-0000-000000000004', 1,
   '99184184-1100-0000-0000-000000000002', 80, 0, 'SAR'),
  ('99184184-0000-0000-0000-000000000002',
   '99184184-2000-0000-0000-000000000004', 2,
   '99184184-2100-0000-0000-000000000002', 0, 80, 'SAR');
SELECT pg_temp.expect_184_error(
  $$UPDATE public.gl_entries SET status='posted'
    WHERE id='99184184-2000-0000-0000-000000000004'$$,
  'POSTED_ENTRY_HEADER_LINES_MISMATCH', 'header mismatch');

-- Line sums must balance each other as well as match the header.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  ('99184184-2000-0000-0000-000000000005',
   '99184184-0000-0000-0000-000000000002',
   'GL184-LINES-UNBALANCED', CURRENT_DATE, 'manual', 'invalid fixture',
   100, 100, 'draft', 'system');
INSERT INTO public.gl_entry_lines
  (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
VALUES
  ('99184184-0000-0000-0000-000000000002',
   '99184184-2000-0000-0000-000000000005', 1,
   '99184184-1100-0000-0000-000000000002', 100, 0, 'SAR'),
  ('99184184-0000-0000-0000-000000000002',
   '99184184-2000-0000-0000-000000000005', 2,
   '99184184-2100-0000-0000-000000000002', 0, 90, 'SAR');
SELECT pg_temp.expect_184_error(
  $$UPDATE public.gl_entries SET status='posted'
    WHERE id='99184184-2000-0000-0000-000000000005'$$,
  'POSTED_ENTRY_LINES_UNBALANCED', 'line imbalance');

DO $$
BEGIN
  IF has_function_privilege(
       'authenticated',
       'public.wardah_184_assert_posted_entry_integrity()', 'EXECUTE')
     OR has_function_privilege(
       'anon', 'public.check_balance_before_post()', 'EXECUTE') THEN
    RAISE EXCEPTION 'GL_184_TRIGGER_HELPER_EXECUTE_LEAK';
  END IF;
END;
$$;

\echo 'GL_POSTING_INTEGRITY_184_ACCEPTANCE_PASS'
ROLLBACK;
