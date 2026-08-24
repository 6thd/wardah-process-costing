\set ON_ERROR_STOP on

-- Pre-179 fixture: model a historical keyed GL entry after Migration 178 but
-- before request_hash exists. Migration 179 must preserve it as an explicitly
-- unverified legacy replay and must never invent/backfill a request hash.

INSERT INTO auth.users (id, email) VALUES
  ('17900000-0000-0000-0000-000000000001', 'j179-member@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('17900000-aaaa-aaaa-aaaa-000000000001', 'J179-A', 'Journal 179 Org A');

INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin) VALUES
  ('17900000-0000-0000-0000-000000000001',
   '17900000-aaaa-aaaa-aaaa-000000000001', true, false);

INSERT INTO public.journals
  (id, org_id, code, name, journal_type, sequence_prefix, is_active)
VALUES
  ('17900000-2222-2222-2222-000000000001',
   '17900000-aaaa-aaaa-aaaa-000000000001',
   'J179', 'Journal 179', 'general', 'J179', true);

-- generate_entry_number(uuid) executes CREATE SEQUENCE IF NOT EXISTS inside
-- the caller transaction. Pre-create this test journal sequence so that the
-- concurrency test is not serialized by unrelated transactional DDL before
-- both calls reach the idempotency INSERT barrier.
CREATE SEQUENCE IF NOT EXISTS public.seq_j179 START WITH 1;

INSERT INTO public.gl_accounts
  (id, org_id, code, name, category, subtype, normal_balance, allow_posting, is_active)
VALUES
  ('17900000-3333-3333-3333-000000000001',
   '17900000-aaaa-aaaa-aaaa-000000000001',
   '179101', 'J179 Debit', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, true),
  ('17900000-3333-3333-3333-000000000002',
   '17900000-aaaa-aaaa-aaaa-000000000001',
   '179201', 'J179 Credit', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true, true);

INSERT INTO public.gl_entries
  (id, org_id, journal_id, entry_number, entry_date, entry_type,
   description, reference_type, reference_number, status,
   total_debit, total_credit, idempotency_key, journal_origin)
VALUES
  ('17900000-4444-4444-4444-000000000001',
   '17900000-aaaa-aaaa-aaaa-000000000001',
   '17900000-2222-2222-2222-000000000001',
   'J179-LEGACY-001', '2026-08-24', 'manual',
   'Pre-179 keyed system entry', 'J179_FIXTURE', 'legacy', 'draft',
   100, 100, 'J179:legacy:key', 'system');

INSERT INTO public.gl_entry_lines
  (id, org_id, tenant_id, entry_id, line_number, account_id,
   debit, credit, currency_code, description)
VALUES
  ('17900000-5555-5555-5555-000000000001',
   '17900000-aaaa-aaaa-aaaa-000000000001',
   '17900000-aaaa-aaaa-aaaa-000000000001',
   '17900000-4444-4444-4444-000000000001', 1,
   '17900000-3333-3333-3333-000000000001', 100, 0, 'SAR', 'Legacy debit'),
  ('17900000-5555-5555-5555-000000000002',
   '17900000-aaaa-aaaa-aaaa-000000000001',
   '17900000-aaaa-aaaa-aaaa-000000000001',
   '17900000-4444-4444-4444-000000000001', 2,
   '17900000-3333-3333-3333-000000000002', 0, 100, 'SAR', 'Legacy credit');

SELECT 'SETUP_179_PRE_MIGRATION_PASS' AS result;
