\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: expected [%] for [%], got [%]', p_needle, p_sql, SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: expected error [%] for [%], but it succeeded', p_needle, p_sql;
  END IF;
END $$;

DO $$
DECLARE
  v_count bigint;
  v_precision integer;
  v_scale integer;
  v_state "char";
BEGIN
  -- The posted legacy fixture is copied exactly into the legal amount columns.
  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines
  WHERE id IN (
    '53b00000-0000-0000-0000-000000000001',
    '53b00000-0000-0000-0000-000000000002'
  )
    AND (
      (id = '53b00000-0000-0000-0000-000000000001'
       AND debit = 125.50 AND credit = 0
       AND debit_amount = 125.50 AND credit_amount = 0)
      OR
      (id = '53b00000-0000-0000-0000-000000000002'
       AND debit = 0 AND credit = 125.50
       AND debit_amount = 0 AND credit_amount = 125.50)
    );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: legacy backfill values are incorrect; matched=%', v_count;
  END IF;

  -- Migration 153 must not map account identity.
  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines
  WHERE id IN (
    '53b00000-0000-0000-0000-000000000001',
    '53b00000-0000-0000-0000-000000000002'
  )
    AND account_id IS NULL
    AND account_code IN ('1120','4001');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: migration changed historical account identity';
  END IF;

  -- Existing modern rows are non-targets and remain untouched, including zeroed
  -- legacy compatibility columns. The trigger applies only to future writes.
  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines
  WHERE id IN (
    '53b00000-0000-0000-0000-000000000003',
    '53b00000-0000-0000-0000-000000000004'
  )
    AND account_code IS NULL
    AND debit_amount = 0 AND credit_amount = 0
    AND (
      (id = '53b00000-0000-0000-0000-000000000003' AND debit = 55.25 AND credit = 0)
      OR
      (id = '53b00000-0000-0000-0000-000000000004' AND debit = 0 AND credit = 55.25)
    );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: modern non-target rows changed';
  END IF;

  -- Existing header-only quality finding is reported but never reconstructed.
  SELECT count(*) INTO v_count
  FROM public.gl_entries e
  WHERE e.id = '53e00000-0000-0000-0000-000000000003'
    AND e.total_debit = 25 AND e.total_credit = 25
    AND NOT EXISTS (SELECT 1 FROM public.gl_entry_lines l WHERE l.entry_id = e.id);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: header-only quality finding was mutated';
  END IF;

  SELECT numeric_precision, numeric_scale
  INTO v_precision, v_scale
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='gl_entries' AND column_name='total_debit';
  IF v_precision <> 18 OR v_scale <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: total_debit precision is %,% not 18,2', v_precision, v_scale;
  END IF;

  SELECT numeric_precision, numeric_scale
  INTO v_precision, v_scale
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='gl_entries' AND column_name='total_credit';
  IF v_precision <> 18 OR v_scale <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: total_credit precision is %,% not 18,2', v_precision, v_scale;
  END IF;

  SELECT t.tgenabled INTO v_state
  FROM pg_trigger t
  WHERE t.tgrelid='public.gl_entry_lines'::regclass
    AND t.tgname='trg_protect_posted_gl_entry_lines'
    AND NOT t.tgisinternal;
  IF v_state <> 'O' THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: posted trigger state is %', v_state;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid='public.gl_entry_lines'::regclass
    AND conname IN (
      'gl_entry_lines_legal_debit_nonnegative',
      'gl_entry_lines_legal_credit_nonnegative',
      'gl_entry_lines_legal_one_sided'
    );
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: expected three legal amount constraints, found %', v_count;
  END IF;

  IF has_function_privilege('anon', 'public.wardah_sync_gl_line_legal_to_legacy()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wardah_sync_gl_line_legal_to_legacy()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_sync_gl_line_legal_to_legacy()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: internal compatibility trigger function is executable by a client role';
  END IF;
END $$;

-- Future legal writes mirror one-way into the transitional legacy read columns.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   status, total_debit, total_credit)
VALUES
  ('53e00000-0000-0000-0000-000000000010', '53111111-1111-1111-1111-111111111111',
   'F153-NEW-LEGAL', '2026-07-30', 'manual', 'Post-153 legal write',
   'draft', 77.75, 77.75);

INSERT INTO public.gl_entry_lines
  (id, org_id, entry_id, line_number, account_id, debit, credit,
   currency_code, description)
VALUES
  ('53b00000-0000-0000-0000-000000000010', '53111111-1111-1111-1111-111111111111',
   '53e00000-0000-0000-0000-000000000010', 1,
   '53a00000-0000-0000-0000-000000000001', 77.75, 0, 'SAR', 'New debit'),
  ('53b00000-0000-0000-0000-000000000011', '53111111-1111-1111-1111-111111111111',
   '53e00000-0000-0000-0000-000000000010', 2,
   '53a00000-0000-0000-0000-000000000002', 0, 77.75, 'SAR', 'New credit');

DO $$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines
  WHERE id IN (
    '53b00000-0000-0000-0000-000000000010',
    '53b00000-0000-0000-0000-000000000011'
  )
    AND tenant_id = org_id
    AND account_code IN ('110100','410100')
    AND account_name IS NOT NULL
    AND account_name_ar IS NOT NULL
    AND debit_amount = debit
    AND credit_amount = credit;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: legal-to-legacy mirror matched % rows', v_count;
  END IF;
END $$;

-- Posted immutability is active after the maintenance window.
SELECT pg_temp.expect_error(
  $$UPDATE public.gl_entry_lines SET description='forbidden'
    WHERE id='53b00000-0000-0000-0000-000000000001'$$,
  'POSTED_ENTRY_IMMUTABLE'
);

-- New legacy-only, conflicting and cross-org writes fail visibly.
SELECT pg_temp.expect_error(
  $$INSERT INTO public.gl_entry_lines
      (org_id, entry_id, line_number, account_code, debit_amount, credit_amount, debit, credit)
    VALUES
      ('53111111-1111-1111-1111-111111111111',
       '53e00000-0000-0000-0000-000000000010', 3, '1120', 1, 0, 0, 0)$$,
  'GL_LEGAL_ACCOUNT_REQUIRED'
);

SELECT pg_temp.expect_error(
  $$INSERT INTO public.gl_entry_lines
      (org_id, entry_id, line_number, account_id, debit, credit, debit_amount, credit_amount)
    VALUES
      ('53111111-1111-1111-1111-111111111111',
       '53e00000-0000-0000-0000-000000000010', 3,
       '53a00000-0000-0000-0000-000000000001', 10, 0, 9, 0)$$,
  'GL_LEGACY_AMOUNT_WRITE_REJECTED'
);

SELECT pg_temp.expect_error(
  $$INSERT INTO public.gl_entry_lines
      (org_id, entry_id, line_number, account_id, debit, credit)
    VALUES
      ('53111111-1111-1111-1111-111111111111',
       '53e00000-0000-0000-0000-000000000010', 3,
       '53a00000-0000-0000-0000-000000000003', 1, 0)$$,
  'GL_ACCOUNT_NOT_FOUND_OR_CROSS_ORG'
);

-- Prove the database constraints themselves, independently of the BEFORE trigger.
ALTER TABLE public.gl_entry_lines DISABLE TRIGGER trg_wardah_gl_line_legal_compat;

SELECT pg_temp.expect_error(
  $$INSERT INTO public.gl_entry_lines
      (org_id, entry_id, line_number, account_id, debit, credit,
       debit_amount, credit_amount)
    VALUES
      ('53111111-1111-1111-1111-111111111111',
       '53e00000-0000-0000-0000-000000000010', 3,
       '53a00000-0000-0000-0000-000000000001', -1, 0, 0, 0)$$,
  'gl_entry_lines_legal_debit_nonnegative'
);

SELECT pg_temp.expect_error(
  $$INSERT INTO public.gl_entry_lines
      (org_id, entry_id, line_number, account_id, debit, credit,
       debit_amount, credit_amount)
    VALUES
      ('53111111-1111-1111-1111-111111111111',
       '53e00000-0000-0000-0000-000000000010', 3,
       '53a00000-0000-0000-0000-000000000001', 1, 1, 0, 0)$$,
  'gl_entry_lines_legal_one_sided'
);

SELECT pg_temp.expect_error(
  $$INSERT INTO public.gl_entry_lines
      (org_id, entry_id, line_number, account_id, debit, credit,
       debit_amount, credit_amount)
    VALUES
      ('53111111-1111-1111-1111-111111111111',
       '53e00000-0000-0000-0000-000000000010', 3,
       '53a00000-0000-0000-0000-000000000001', 0, 0, 0, 0)$$,
  'gl_entry_lines_legal_one_sided'
);

ALTER TABLE public.gl_entry_lines ENABLE TRIGGER trg_wardah_gl_line_legal_compat;

DO $$
DECLARE v_state "char";
BEGIN
  SELECT t.tgenabled INTO v_state
  FROM pg_trigger t
  WHERE t.tgrelid='public.gl_entry_lines'::regclass
    AND t.tgname='trg_wardah_gl_line_legal_compat'
    AND NOT t.tgisinternal;
  IF v_state <> 'O' THEN
    RAISE EXCEPTION 'ACCEPTANCE_153_FAIL: compatibility trigger was not restored';
  END IF;
END $$;

SELECT 'ACCEPTANCE_153_FINANCIAL_GL_CONTRACT_PASS' AS result;
