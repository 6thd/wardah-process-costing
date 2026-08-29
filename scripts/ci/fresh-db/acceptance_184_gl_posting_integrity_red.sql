-- Red proof: run through 183 with Migration 184 omitted.
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.organizations (id, name, code)
VALUES ('99184184-0000-0000-0000-000000000001', 'GL 184 Red', 'GL184-RED');

INSERT INTO public.gl_accounts
  (id, org_id, code, name, category, subtype, normal_balance,
   allow_posting, is_active)
VALUES
  ('99184184-1100-0000-0000-000000000001',
   '99184184-0000-0000-0000-000000000001',
   '184100', 'GL 184 Red Debit', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, true),
  ('99184184-2100-0000-0000-000000000001',
   '99184184-0000-0000-0000-000000000001',
   '184200', 'GL 184 Red Credit', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT',
   true, true);

-- Before 184, a posted INSERT with no lines commits its constraints cleanly.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  ('99184184-1000-0000-0000-000000000001',
   '99184184-0000-0000-0000-000000000001',
   'GL184-RED-NO-LINES', CURRENT_DATE, 'manual', 'red proof',
   100, 100, 'posted', 'system');

-- A balanced pair whose sums disagree with the header is also accepted.
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  ('99184184-1000-0000-0000-000000000002',
   '99184184-0000-0000-0000-000000000001',
   'GL184-RED-MISMATCH', CURRENT_DATE, 'manual', 'red proof',
   100, 100, 'posted', 'system');

INSERT INTO public.gl_entry_lines
  (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
VALUES
  ('99184184-0000-0000-0000-000000000001',
   '99184184-1000-0000-0000-000000000002', 1,
   '99184184-1100-0000-0000-000000000001', 80, 0, 'SAR'),
  ('99184184-0000-0000-0000-000000000001',
   '99184184-1000-0000-0000-000000000002', 2,
   '99184184-2100-0000-0000-000000000001', 0, 80, 'SAR');

SET CONSTRAINTS ALL IMMEDIATE;

\echo 'GL_POSTING_INTEGRITY_184_RED_PROOF_OK: posted no-lines and header mismatch accepted before 184'
ROLLBACK;
