-- Ledger Truth contract for trial-balance reporting.
--
-- Contract: every trial-balance reporting surface must reconcile against
-- gl_entry_lines — the legal ledger — for posted entries. Nothing else is a
-- source of truth.
--
-- Why this file exists: the Production audit of 2026-08-28 found six
-- trial-balance implementations, one of which (rpc_get_trial_balance) reads the
-- retired journal_lines/journal_entries tables. On Production that source held
-- 2 posted lines / 500.00 while the legal ledger held 22 / 30,805.00. No test
-- caught it, because the only test covering that path replaced the database
-- with mocks and asserted toBeDefined().
--
-- Modes (psql variable :rpc_contract):
--   pending   — default. Asserts the RPC *still diverges*, pinning the known
--               gap so the fixing migration visibly flips it. If the RPC is
--               repaired while this stays 'pending', the script fails and tells
--               you to flip the flag: the gap cannot be closed silently.
--   enforced  — set by the migration PR that rewrites the RPC onto the legal
--               ledger. Asserts alignment. From then on, moving the RPC back to
--               journal_lines fails this gate.
--
-- Usage:
--   psql -v ON_ERROR_STOP=1 -f acceptance_trial_balance_ledger_truth.sql
--   psql -v ON_ERROR_STOP=1 -v rpc_contract=enforced -f ...
--
-- The whole run is wrapped in a transaction and rolled back: no residue.

\set ON_ERROR_STOP on
\if :{?rpc_contract}
\else
  \set rpc_contract pending
\endif

BEGIN;

\echo '--- Ledger Truth: rpc_contract mode =' :rpc_contract

-- ---------------------------------------------------------------------------
-- Fixture: one organization, one member, two postable accounts, two posted
-- entries written through the legal columns (debit/credit + account_id).
-- ---------------------------------------------------------------------------
\set org_id   '''7b1a0000-0000-4000-8000-000000000001'''
\set user_id  '''7b1a0000-1111-4000-8000-000000000001'''
\set acct_dr  '''7b1a0000-2222-4000-8000-000000000001'''
\set acct_cr  '''7b1a0000-2222-4000-8000-000000000002'''
\set entry_a  '''7b1a0000-3333-4000-8000-000000000001'''
\set entry_b  '''7b1a0000-3333-4000-8000-000000000002'''

INSERT INTO auth.users (id, email)
VALUES (:user_id, 'ledger-truth@example.test');

INSERT INTO public.organizations (id, name, code)
VALUES (:org_id, 'Ledger Truth Org', 'LTRUTH');

INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin)
VALUES (:user_id, :org_id, true, true);

INSERT INTO public.gl_accounts
  (id, org_id, code, name, name_ar, category, subtype, normal_balance,
   allow_posting, is_active)
VALUES
  (:acct_dr, :org_id, '1101', 'Cash', 'النقدية', 'ASSET', 'CURRENT_ASSET',
   'DEBIT', true, true),
  (:acct_cr, :org_id, '4101', 'Revenue', 'الإيرادات', 'REVENUE', 'OPERATING',
   'CREDIT', true, true);

-- Two posted entries: 1,200.00 and 800.00 → legal ledger total 2,000.00.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  (:entry_a, :org_id, 'LT-0001', DATE '2026-03-10', 'sale',
   'Ledger truth entry A', 1200.00, 1200.00, 'posted', 'system'),
  (:entry_b, :org_id, 'LT-0002', DATE '2026-03-11', 'sale',
   'Ledger truth entry B', 800.00, 800.00, 'posted', 'system');

INSERT INTO public.gl_entry_lines
  (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
VALUES
  (:org_id, :entry_a, 1, :acct_dr, 1200.00, 0, 'SAR'),
  (:org_id, :entry_a, 2, :acct_cr, 0, 1200.00, 'SAR'),
  (:org_id, :entry_b, 1, :acct_dr,  800.00, 0, 'SAR'),
  (:org_id, :entry_b, 2, :acct_cr, 0,  800.00, 'SAR');

-- Authenticated caller identity for the SECURITY DEFINER reporting RPC.
SELECT set_config('request.jwt.claim.sub', :user_id, false);

-- psql does not interpolate variables inside dollar-quoted bodies, so the mode
-- is handed to the DO blocks through a GUC rather than textual substitution.
SELECT set_config('ledger_truth.rpc_contract', :'rpc_contract', false);

-- Shared helper: the legal ledger total for this organization.
CREATE OR REPLACE FUNCTION pg_temp.legal_ledger_total()
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(l.debit), 0)
  FROM public.gl_entry_lines l
  JOIN public.gl_entries e ON e.id = l.entry_id
  WHERE e.org_id = '7b1a0000-0000-4000-8000-000000000001'
    AND e.status = 'posted';
$$;

CREATE OR REPLACE FUNCTION pg_temp.view_total()
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(total_debit), 0)
  FROM public.v_trial_balance
  WHERE org_id = '7b1a0000-0000-4000-8000-000000000001';
$$;

CREATE OR REPLACE FUNCTION pg_temp.rpc_total()
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(period_debit), 0)
  FROM public.rpc_get_trial_balance(
         '7b1a0000-0000-4000-8000-000000000001'::uuid, DATE '2026-12-31');
$$;

-- ---------------------------------------------------------------------------
-- LT-1 — the view path reconciles against the legal ledger.
-- Must pass today and forever.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_ledger numeric; v_view numeric;
BEGIN
  v_ledger := pg_temp.legal_ledger_total();
  v_view   := pg_temp.view_total();

  IF v_ledger <> 2000.00 THEN
    RAISE EXCEPTION 'LEDGER_TRUTH_LT1_FIXTURE_BROKEN: legal ledger = %, expected 2000.00',
      v_ledger;
  END IF;

  IF abs(v_view - v_ledger) >= 0.01 THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_LT1_FAIL: v_trial_balance = % but legal ledger = % (drift %)',
      v_view, v_ledger, v_view - v_ledger;
  END IF;

  RAISE NOTICE 'LT-1 view=% ledger=% aligned', v_view, v_ledger;
END;
$$;

-- ---------------------------------------------------------------------------
-- LT-2 — the RPC path, gated on :rpc_contract.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_ledger numeric := pg_temp.legal_ledger_total();
  v_rpc    numeric := pg_temp.rpc_total();
  v_mode   text    := current_setting('ledger_truth.rpc_contract', true);
BEGIN
  IF v_mode = 'enforced' THEN
    IF abs(v_rpc - v_ledger) >= 0.01 THEN
      RAISE EXCEPTION
        'LEDGER_TRUTH_LT2_FAIL: rpc_get_trial_balance = % but legal ledger = % '
        '(drift %). The reporting RPC must read gl_entries/gl_entry_lines, not '
        'journal_entries/journal_lines.',
        v_rpc, v_ledger, v_rpc - v_ledger;
    END IF;
    RAISE NOTICE 'LT-2 rpc=% ledger=% aligned (enforced)', v_rpc, v_ledger;

  ELSIF v_mode = 'pending' THEN
    IF abs(v_rpc - v_ledger) < 0.01 THEN
      RAISE EXCEPTION
        'LEDGER_TRUTH_LT2_CONTRACT_STALE: rpc_get_trial_balance now agrees with '
        'the legal ledger (% = %). The gap is closed — re-run this gate with '
        '-v rpc_contract=enforced and update the workflow so it can never '
        'reopen silently.',
        v_rpc, v_ledger;
    END IF;
    RAISE NOTICE
      'LT-2 KNOWN GAP CONFIRMED: rpc=% ledger=% drift=% (pending)',
      v_rpc, v_ledger, v_rpc - v_ledger;

  ELSE
    RAISE EXCEPTION 'LEDGER_TRUTH_LT2_BAD_MODE: rpc_contract must be pending or enforced, got [%]', v_mode;
  END IF;
END;
$do$;

-- ---------------------------------------------------------------------------
-- Regression cases A–E. These describe what the repaired RPC must do, so they
-- only run once the contract is enforced; under 'pending' the RPC returns
-- nothing and the cases would report a defect already covered by LT-2.
-- ---------------------------------------------------------------------------
DO $cases$
DECLARE
  v_mode      text := current_setting('ledger_truth.rpc_contract', true);
  v_org       uuid := '7b1a0000-0000-4000-8000-000000000001';
  v_other_org uuid := '7b1a0000-0000-4000-8000-000000000009';
  v_dr        numeric;
  v_cr        numeric;
  v_open_dr   numeric;
  v_rows      integer;
  v_name_ar   text;
BEGIN
  IF v_mode <> 'enforced' THEN
    RAISE NOTICE 'Cases A-E skipped: rpc_contract=% (they describe the repaired RPC)', v_mode;
    RETURN;
  END IF;

  -- Cases run on the clean fixture, before LT-3 injects its deliberate
  -- corruption. That order is load-bearing: trg_protect_posted_gl_entry_lines
  -- makes posted lines immutable, so LT-3's injection cannot be cleaned up
  -- afterwards — and it should not be, since the guard is doing its job.

  -- ---- Case A: a balanced ledger yields a balanced trial balance ----------
  SELECT COALESCE(SUM(closing_debit), 0), COALESCE(SUM(closing_credit), 0)
  INTO v_dr, v_cr
  FROM public.rpc_get_trial_balance(v_org, DATE '2026-12-31');

  IF abs(v_dr - v_cr) >= 0.01 THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_A_FAIL: closing debit % <> closing credit % — a balanced '
      'ledger must produce a balanced trial balance', v_dr, v_cr;
  END IF;
  IF abs(v_dr - 2000.00) >= 0.01 THEN
    RAISE EXCEPTION 'LEDGER_TRUTH_CASE_A_FAIL: closing debit = %, expected 2000.00', v_dr;
  END IF;
  RAISE NOTICE 'Case A OK: closing dr=% cr=% balanced', v_dr, v_cr;

  -- ---- Case B: real opening balances --------------------------------------
  -- A posted entry before a configured, non-calendar fiscal year must land in
  -- opening, not period. This makes the accounting_periods dependency itself
  -- observable; a calendar-year-only implementation would fail this case.
  INSERT INTO public.accounting_periods
    (org_id, period_code, period_name, period_type, start_date, end_date,
     fiscal_year, status)
  VALUES
    (v_org, 'LT-FY26', 'Ledger Truth FY 2026', 'year', DATE '2026-02-01',
     DATE '2027-01-31', 2026, 'open');

  INSERT INTO public.gl_entries
    (id, org_id, entry_number, entry_date, entry_type, description,
     total_debit, total_credit, status, journal_origin)
  VALUES
    ('7b1a0000-3333-4000-8000-000000000003', v_org, 'LT-PRIOR', DATE '2025-11-30',
     'sale', 'Prior fiscal year', 300.00, 300.00, 'posted', 'system');

  INSERT INTO public.gl_entry_lines
    (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
  VALUES
    (v_org, '7b1a0000-3333-4000-8000-000000000003', 1,
     '7b1a0000-2222-4000-8000-000000000001', 300.00, 0, 'SAR'),
    (v_org, '7b1a0000-3333-4000-8000-000000000003', 2,
     '7b1a0000-2222-4000-8000-000000000002', 0, 300.00, 'SAR');

  SELECT COALESCE(SUM(opening_debit), 0), COALESCE(SUM(period_debit), 0)
  INTO v_open_dr, v_dr
  FROM public.rpc_get_trial_balance(v_org, DATE '2026-12-31');

  IF abs(v_open_dr - 300.00) >= 0.01 THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_B_FAIL: opening debit = %, expected 300.00 from the '
      'prior fiscal year. Opening balances must be derived, not hardcoded to 0.',
      v_open_dr;
  END IF;
  IF abs(v_dr - 2000.00) >= 0.01 THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_B_FAIL: period debit = %, expected 2000.00 — prior-year '
      'movement must not leak into the current period', v_dr;
  END IF;
  RAISE NOTICE 'Case B periods OK: opening dr=% period dr=%', v_open_dr, v_dr;

  -- With no covering accounting_period, the organization setting remains the
  -- source of truth. June 2026 belongs to the fiscal year that began 2025-07-01,
  -- so the November 2025 entry is period movement, not opening. A January-only
  -- fallback would report opening=300 and period=2000 and fail this assertion.
  DELETE FROM public.accounting_periods WHERE org_id = v_org;
  UPDATE public.organizations SET fiscal_year_start = 7 WHERE id = v_org;

  SELECT COALESCE(SUM(opening_debit), 0), COALESCE(SUM(period_debit), 0)
  INTO v_open_dr, v_dr
  FROM public.rpc_get_trial_balance(v_org, DATE '2026-06-30');

  IF abs(v_open_dr) >= 0.01 OR abs(v_dr - 2300.00) >= 0.01 THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_B_FAIL: configured July fallback produced opening=% '
      'period=%, expected opening=0.00 period=2300.00 from 2025-07-01',
      v_open_dr, v_dr;
  END IF;

  UPDATE public.organizations SET fiscal_year_start = 1 WHERE id = v_org;
  RAISE NOTICE
    'Case B OK: accounting periods and configured July fallback both respected';

  -- ---- Case C: tenant isolation -------------------------------------------
  -- A second organization with its own posted entry must be invisible here,
  -- and asking for it as a non-member must be refused outright.
  INSERT INTO public.organizations (id, name, code)
  VALUES (v_other_org, 'Other Org', 'LTOTHER');

  INSERT INTO public.gl_accounts
    (id, org_id, code, name, name_ar, category, subtype, normal_balance,
     allow_posting, is_active)
  VALUES
    ('7b1a0000-2222-4000-8000-000000000009', v_other_org, '1101', 'Cash',
     'النقدية', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, true),
    ('7b1a0000-2222-4000-8000-000000000010', v_other_org, '4101', 'Revenue',
     'الإيرادات', 'REVENUE', 'OPERATING', 'CREDIT', true, true);

  INSERT INTO public.gl_entries
    (id, org_id, entry_number, entry_date, entry_type, description,
     total_debit, total_credit, status, journal_origin)
  VALUES
    ('7b1a0000-3333-4000-8000-000000000009', v_other_org, 'LT-OTHER',
     DATE '2026-03-12', 'sale', 'Other org entry', 9999.00, 9999.00,
     'posted', 'system');

  INSERT INTO public.gl_entry_lines
    (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
  VALUES
    (v_other_org, '7b1a0000-3333-4000-8000-000000000009', 1,
     '7b1a0000-2222-4000-8000-000000000009', 9999.00, 0, 'SAR'),
    (v_other_org, '7b1a0000-3333-4000-8000-000000000009', 2,
     '7b1a0000-2222-4000-8000-000000000010', 0, 9999.00, 'SAR');

  SELECT COALESCE(SUM(closing_debit), 0)
  INTO v_dr
  FROM public.rpc_get_trial_balance(v_org, DATE '2026-12-31');

  IF v_dr >= 9999.00 THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_C_FAIL: another organization''s 9999.00 leaked into '
      'this trial balance (closing debit = %)', v_dr;
  END IF;

  BEGIN
    PERFORM public.rpc_get_trial_balance(v_other_org, DATE '2026-12-31');
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_C_FAIL: reading another organization''s trial balance '
      'was permitted — wardah_assert_org_member did not refuse';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%LEDGER_TRUTH_CASE_C_FAIL%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%NOT_ORG_MEMBER%' THEN
      RAISE EXCEPTION
        'LEDGER_TRUTH_CASE_C_FAIL: expected NOT_ORG_MEMBER for a foreign '
        'organization, got [%]', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'Case C OK: foreign org invisible and refused';

  -- ---- Case D: the retired ledger has no influence ------------------------
  -- This is the original defect. Rows in journal_lines/journal_entries must not
  -- move the trial balance by a single unit.
  SELECT COALESCE(SUM(closing_debit), 0) INTO v_dr
  FROM public.rpc_get_trial_balance(v_org, DATE '2026-12-31');

  INSERT INTO public.journals
    (id, org_id, code, name, journal_type)
  VALUES
    ('7b1a0000-5555-4000-8000-000000000001', v_org, 'LTJ', 'Ledger truth journal', 'general');

  INSERT INTO public.journal_entries
    (id, org_id, journal_id, entry_number, entry_date, description, status,
     total_debit, total_credit)
  VALUES
    ('7b1a0000-4444-4000-8000-000000000001', v_org,
     '7b1a0000-5555-4000-8000-000000000001', 'LT-LEGACY', DATE '2026-03-15',
     'Retired ledger row', 'posted', 7777.00, 7777.00);

  INSERT INTO public.journal_lines
    (org_id, entry_id, line_number, account_id, debit, credit)
  VALUES
    (v_org, '7b1a0000-4444-4000-8000-000000000001', 1,
     '7b1a0000-2222-4000-8000-000000000001', 7777.00, 0);

  SELECT COALESCE(SUM(closing_debit), 0) INTO v_cr
  FROM public.rpc_get_trial_balance(v_org, DATE '2026-12-31');

  IF abs(v_cr - v_dr) >= 0.01 THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_D_FAIL: a journal_lines row changed the trial balance '
      '(% -> %). The RPC is reading the retired ledger again.', v_dr, v_cr;
  END IF;

  SELECT count(*) INTO v_rows FROM public.journal_lines
  WHERE entry_id = '7b1a0000-4444-4000-8000-000000000001';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'LEDGER_TRUTH_CASE_D_FIXTURE_BROKEN: legacy row not seeded (%)', v_rows;
  END IF;

  RAISE NOTICE 'Case D OK: legacy journal row present but inert (% unchanged)', v_cr;

  -- ---- Case E: completeness and localized account metadata ----------------
  -- Historical legal lines may predate account_id, and accounts may be
  -- deactivated after carrying movement. Neither condition may erase their
  -- balances. The Arabic return column must also use name_ar, not name_en.
  UPDATE public.gl_accounts
  SET allow_posting = false,
      is_active = false
  WHERE id = '7b1a0000-2222-4000-8000-000000000001';

  INSERT INTO public.gl_entries
    (id, org_id, entry_number, entry_date, entry_type, description,
     total_debit, total_credit, status, journal_origin)
  VALUES
    ('7b1a0000-3333-4000-8000-000000000004', v_org, 'LT-NULL-ACCOUNT-ID',
     DATE '2026-03-20', 'sale', 'Historical account-code fallback',
     125.00, 125.00, 'posted', 'system');

  -- Migration 153 correctly rejects *new* lines without account_id. Reproduce
  -- a pre-153 historical row by bypassing only the compatibility trigger inside
  -- this rollback-only fixture. Keep the legacy mirror columns synchronized so
  -- LT-3 below remains the sole deliberate view/ledger divergence.
  -- Migration 184 adds deferred integrity events; flush the already-valid
  -- fixtures before ALTER TABLE, which PostgreSQL otherwise rejects while a
  -- trigger event is pending.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  ALTER TABLE public.gl_entry_lines
    DISABLE TRIGGER trg_wardah_gl_line_legal_compat;

  INSERT INTO public.gl_entry_lines
    (org_id, entry_id, line_number, account_id, account_code, account_name,
     debit, credit, debit_amount, credit_amount, currency_code)
  VALUES
    (v_org, '7b1a0000-3333-4000-8000-000000000004', 1, NULL, '1101',
     'Cash fallback', 125.00, 0, 125.00, 0, 'SAR'),
    (v_org, '7b1a0000-3333-4000-8000-000000000004', 2, NULL, '4101',
     'Revenue fallback', 0, 125.00, 0, 125.00, 'SAR');

  -- The historical fixture still satisfies 184's header/line invariant, so its
  -- deferred events can be evaluated before restoring the compatibility guard.
  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.gl_entry_lines
    ENABLE TRIGGER trg_wardah_gl_line_legal_compat;
  SET CONSTRAINTS ALL DEFERRED;

  v_dr := NULL;
  v_name_ar := NULL;
  SELECT closing_debit, account_name_ar
  INTO v_dr, v_name_ar
  FROM public.rpc_get_trial_balance(v_org, DATE '2026-12-31')
  WHERE account_code = '1101';

  IF v_dr IS NULL OR abs(v_dr - 2425.00) >= 0.01 THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_E_FAIL: deactivated-account closing debit = %, expected '
      '2425.00 including the NULL-account_id line matched by account_code', v_dr;
  END IF;
  IF v_name_ar IS DISTINCT FROM 'النقدية' THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_CASE_E_FAIL: account_name_ar = [%], expected [النقدية]',
      v_name_ar;
  END IF;

  RAISE NOTICE
    'Case E OK: inactive account retained, NULL account_id matched, Arabic name=%',
    v_name_ar;
END;
$cases$;

-- ---------------------------------------------------------------------------
-- LT-3 — RED PROOF for LT-1.
--
-- A probe that never goes red proves nothing. v_trial_balance aggregates the
-- historical mirror columns (debit_amount/credit_amount), not the legal
-- debit/credit. Rows written before trg_wardah_gl_line_legal_compat existed can
-- carry a stale mirror — four such rows exist on Production today. Reproduce
-- one by disabling the sync trigger, and prove LT-1 detects the divergence.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ledger numeric;
  v_view   numeric;
  v_caught boolean := false;
BEGIN
  -- Flush all valid 184 events before changing trigger state.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  ALTER TABLE public.gl_entry_lines DISABLE TRIGGER trg_wardah_gl_line_legal_compat;

  -- Legal columns say 500; the historical mirror the view reads says 0.
  INSERT INTO public.gl_entry_lines
    (org_id, entry_id, line_number, account_id, account_code,
     debit, credit, debit_amount, credit_amount, currency_code)
  VALUES
    ('7b1a0000-0000-4000-8000-000000000001', '7b1a0000-3333-4000-8000-000000000001',
     3, '7b1a0000-2222-4000-8000-000000000001', '1101',
     500.00, 0, 0, 0, 'SAR');

  -- Do not re-enable inside this transaction: the deliberately divergent line
  -- also violates 184's header/line total invariant, so forcing its deferred
  -- event would correctly reject the red-proof fixture. The enclosing ROLLBACK
  -- restores the trigger state and discards the row atomically.

  v_ledger := pg_temp.legal_ledger_total();   -- 2925.00
  v_view   := pg_temp.view_total();           -- still 2425.00

  IF abs(v_view - v_ledger) >= 0.01 THEN
    v_caught := true;
  END IF;

  IF NOT v_caught THEN
    RAISE EXCEPTION
      'LEDGER_TRUTH_LT3_RED_PROOF_FAILED: injected a stale-mirror line but LT-1 '
      'still reconciles (view=% ledger=%). The LT-1 check is blind and must not '
      'be trusted.',
      v_view, v_ledger;
  END IF;

  RAISE NOTICE
    'LT-3 red proof OK: injected stale mirror → view=% ledger=% drift detected',
    v_view, v_ledger;
END;
$$;

\echo 'TRIAL_BALANCE_LEDGER_TRUTH_PASS'

ROLLBACK;
