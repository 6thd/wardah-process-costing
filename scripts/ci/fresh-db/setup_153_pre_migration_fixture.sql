\set ON_ERROR_STOP on

-- Pre-migration fixture deliberately contains both historical contracts:
-- * one posted legacy entry whose amounts must be backfilled;
-- * one draft modern entry that must remain byte-for-byte unchanged;
-- * one posted header without lines, an existing quality finding that 153 reports
--   but must not reconstruct or mutate.

INSERT INTO public.organizations (id, code, name) VALUES
  ('53111111-1111-1111-1111-111111111111', 'F153A', 'Finance 153 Org A'),
  ('53222222-2222-2222-2222-222222222222', 'F153B', 'Finance 153 Org B');

INSERT INTO public.gl_accounts
  (id, org_id, code, name, name_en, name_ar, category, subtype, normal_balance,
   allow_posting, is_active)
VALUES
  ('53a00000-0000-0000-0000-000000000001', '53111111-1111-1111-1111-111111111111',
   '110100', 'Cash A', 'Cash A', 'نقدية أ', 'ASSET', 'CASH', 'DEBIT', true, true),
  ('53a00000-0000-0000-0000-000000000002', '53111111-1111-1111-1111-111111111111',
   '410100', 'Revenue A', 'Revenue A', 'إيراد أ', 'REVENUE', 'REVENUE', 'CREDIT', true, true),
  ('53a00000-0000-0000-0000-000000000003', '53222222-2222-2222-2222-222222222222',
   '110100', 'Cash B', 'Cash B', 'نقدية ب', 'ASSET', 'CASH', 'DEBIT', true, true),
  ('53a00000-0000-0000-0000-000000000004', '53222222-2222-2222-2222-222222222222',
   '410100', 'Revenue B', 'Revenue B', 'إيراد ب', 'REVENUE', 'REVENUE', 'CREDIT', true, true);

INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   status, total_debit, total_credit, posted_at)
VALUES
  ('53e00000-0000-0000-0000-000000000001', '53111111-1111-1111-1111-111111111111',
   'F153-LEGACY-POSTED', '2026-07-30', 'manual', 'Legacy posted fixture',
   'posted', 125.50, 125.50, now()),
  ('53e00000-0000-0000-0000-000000000002', '53111111-1111-1111-1111-111111111111',
   'F153-MODERN-DRAFT', '2026-07-30', 'manual', 'Modern draft fixture',
   'draft', 55.25, 55.25, null),
  ('53e00000-0000-0000-0000-000000000003', '53111111-1111-1111-1111-111111111111',
   'F153-HEADER-ONLY', '2026-07-30', 'manual', 'Header-only quality finding',
   'posted', 25.00, 25.00, now());

INSERT INTO public.gl_entry_lines
  (id, org_id, tenant_id, entry_id, line_number,
   account_code, account_name, debit_amount, credit_amount,
   account_id, debit, credit, currency_code, description)
VALUES
  ('53b00000-0000-0000-0000-000000000001', '53111111-1111-1111-1111-111111111111',
   '53111111-1111-1111-1111-111111111111', '53e00000-0000-0000-0000-000000000001', 1,
   '1120', 'Historical cash', 125.50, 0, null, 0, 0, 'SAR', 'Legacy debit'),
  ('53b00000-0000-0000-0000-000000000002', '53111111-1111-1111-1111-111111111111',
   '53111111-1111-1111-1111-111111111111', '53e00000-0000-0000-0000-000000000001', 2,
   '4001', 'Historical revenue', 0, 125.50, null, 0, 0, 'SAR', 'Legacy credit'),
  ('53b00000-0000-0000-0000-000000000003', '53111111-1111-1111-1111-111111111111',
   '53111111-1111-1111-1111-111111111111', '53e00000-0000-0000-0000-000000000002', 1,
   null, null, 0, 0, '53a00000-0000-0000-0000-000000000001', 55.25, 0, 'SAR', 'Modern debit'),
  ('53b00000-0000-0000-0000-000000000004', '53111111-1111-1111-1111-111111111111',
   '53111111-1111-1111-1111-111111111111', '53e00000-0000-0000-0000-000000000002', 2,
   null, null, 0, 0, '53a00000-0000-0000-0000-000000000002', 0, 55.25, 'SAR', 'Modern credit');

SELECT 'SETUP_153_PRE_MIGRATION_PASS' AS result;
