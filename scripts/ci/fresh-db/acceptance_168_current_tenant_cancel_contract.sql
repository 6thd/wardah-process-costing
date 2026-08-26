-- Current-schema companion for the historical Migration 168 gate.
-- After Migration 174, cancellation permission is sensitive and must be granted
-- explicitly. This fixture proves both the permission-first contract and the
-- tenant lookup barrier without letting one short-circuit the other.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION
        'CURRENT_168_FAIL: expected [%] for [%], got [%]',
        p_needle, p_sql, SQLERRM;
    END IF;
  END;

  IF v_succeeded THEN
    RAISE EXCEPTION
      'CURRENT_168_FAIL: expected error [%] for [%], but it succeeded',
      p_needle, p_sql;
  END IF;
END;
$$;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('68aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'voucher168-current-owner@example.test'),
  ('68bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'voucher168-current-orgb-admin@example.test'),
  ('68cccccc-cccc-cccc-cccc-cccccccccccc', 'voucher168-current-orgb-canceller@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('68111111-1111-1111-1111-111111111111', 'V168CA', 'Voucher 168 Current Org A'),
  ('68222222-2222-2222-2222-222222222222', 'V168CB', 'Voucher 168 Current Org B');

INSERT INTO public.user_organizations
  (id, user_id, org_id, role, is_active, is_org_admin) VALUES
  ('68000000-0000-0000-0000-000000000001',
   '68aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '68111111-1111-1111-1111-111111111111', 'admin', true, true),
  ('68000000-0000-0000-0000-000000000002',
   '68bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '68222222-2222-2222-2222-222222222222', 'admin', true, true),
  ('68000000-0000-0000-0000-000000000003',
   '68cccccc-cccc-cccc-cccc-cccccccccccc',
   '68222222-2222-2222-2222-222222222222', 'user', true, false);

INSERT INTO public.roles
  (id, org_id, name, name_ar, is_system_role, is_active) VALUES
  ('68700000-0000-0000-0000-000000000001',
   '68222222-2222-2222-2222-222222222222',
   'Voucher 168 current canceller', 'ملغي 168 الحالي', false, true);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '68700000-0000-0000-0000-000000000001'::uuid, p.id
FROM public.permissions p
WHERE p.permission_key = 'accounting.vouchers.cancel';

INSERT INTO public.user_roles (id, user_id, role_id, org_id) VALUES
  ('68800000-0000-0000-0000-000000000001',
   '68cccccc-cccc-cccc-cccc-cccccccccccc',
   '68700000-0000-0000-0000-000000000001',
   '68222222-2222-2222-2222-222222222222');

-- A real Org A receipt exists. The Org B actor will be authorized to cancel in
-- Org B, so the lookup must be the barrier that hides this specific foreign row.
INSERT INTO public.customers (id, org_id, code, name, is_active) VALUES
  ('68d00000-0000-0000-0000-000000000001',
   '68111111-1111-1111-1111-111111111111',
   'V168C-CUST-A', 'Voucher 168 Current Customer A', true);

INSERT INTO public.gl_accounts
  (id, org_id, code, name, category, subtype, normal_balance, allow_posting, is_active)
VALUES
  ('68a10000-0000-0000-0000-000000000001',
   '68111111-1111-1111-1111-111111111111',
   '168101', 'Voucher 168 Current Cash A',
   'ASSET', 'CASH', 'DEBIT', true, true);

INSERT INTO public.customer_collections
  (id, org_id, collection_number, customer_id, collection_date,
   amount, payment_method, payment_account_id, status, created_by)
VALUES
  ('68c10000-0000-0000-0000-000000000001',
   '68111111-1111-1111-1111-111111111111', 'V168C-CR-A1',
   '68d00000-0000-0000-0000-000000000001', DATE '2026-08-26',
   10, 'cash', '68a10000-0000-0000-0000-000000000001', 'draft',
   '68aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Org B admin has no explicit sensitive grant. Permission must stop the call
-- before object lookup, exactly as the current Production function does.
SELECT set_config('request.jwt.claim.sub',
                  '68bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"68222222-2222-2222-2222-222222222222"}', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_cancel_customer_receipt(
      '68c10000-0000-0000-0000-000000000001', 'cross org probe')$$,
  'VOUCHER_CANCEL_PERMISSION_REQUIRED');
RESET ROLE;

-- A different Org B member has the exact cancel grant. It clears the permission
-- gate, so the tenant-scoped row lookup must now reject the real Org A receipt.
SELECT set_config('request.jwt.claim.sub',
                  '68cccccc-cccc-cccc-cccc-cccccccccccc', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"68222222-2222-2222-2222-222222222222"}', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_cancel_customer_receipt(
      '68c10000-0000-0000-0000-000000000001', 'cross org probe')$$,
  'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG');
RESET ROLE;

-- The foreign voucher must remain untouched by both rejected calls.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections
    WHERE id='68c10000-0000-0000-0000-000000000001'
      AND org_id='68111111-1111-1111-1111-111111111111'
      AND status='draft'
  ) THEN
    RAISE EXCEPTION 'CURRENT_168_FAIL: cross-org probe changed foreign voucher';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'VOUCHER_ATOMIC_168_CURRENT_TENANT_CANCEL_CONTRACT_PASS' AS result;
