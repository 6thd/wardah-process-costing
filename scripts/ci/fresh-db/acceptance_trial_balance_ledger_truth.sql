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
  ALTER TABLE public.gl_entry_lines DISABLE TRIGGER trg_wardah_gl_line_legal_compat;

  -- Legal columns say 500; the historical mirror the view reads says 0.
  INSERT INTO public.gl_entry_lines
    (org_id, entry_id, line_number, account_id, account_code,
     debit, credit, debit_amount, credit_amount, currency_code)
  VALUES
    ('7b1a0000-0000-4000-8000-000000000001', '7b1a0000-3333-4000-8000-000000000001',
     3, '7b1a0000-2222-4000-8000-000000000001', '1101',
     500.00, 0, 0, 0, 'SAR');

  ALTER TABLE public.gl_entry_lines ENABLE TRIGGER trg_wardah_gl_line_legal_compat;

  v_ledger := pg_temp.legal_ledger_total();   -- 2500.00
  v_view   := pg_temp.view_total();           -- still 2000.00

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
