-- =====================================================================
-- 163_payment_voucher_guarded_draft_inserts
-- =====================================================================
-- Restores browser creation of draft customer receipts and supplier payments
-- after fail-closed RLS hardening. The policies are intentionally narrow:
-- authenticated users may only INSERT draft vouchers into their active org,
-- with same-org business partners and same-org active posting accounts.
-- UPDATE and DELETE remain unavailable to browser clients; posting still goes
-- through the guarded atomic RPCs introduced by Migration 153.
-- Migrations 154-162 remain reserved for the reporting-engine programme.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.customer_collections') IS NULL
     OR to_regclass('public.supplier_payments') IS NULL
     OR to_regprocedure('public.wardah_org_id(uuid)') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_CREATE_163_PREREQUISITE_MISSING';
  END IF;
END
$preflight$;

DROP POLICY IF EXISTS customer_collections_org_insert_draft
  ON public.customer_collections;
CREATE POLICY customer_collections_org_insert_draft
ON public.customer_collections
FOR INSERT
TO authenticated
WITH CHECK (
  org_id = public.wardah_org_id(NULL::uuid)
  AND status = 'draft'
  AND gl_entry_id IS NULL
  AND posted_at IS NULL
  AND posted_by IS NULL
  AND (created_by IS NULL OR created_by = auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = customer_collections.customer_id
      AND c.org_id = customer_collections.org_id
  )
  AND (
    payment_account_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.gl_accounts a
      WHERE a.id = customer_collections.payment_account_id
        AND a.org_id = customer_collections.org_id
        AND coalesce(a.is_active, true)
        AND coalesce(a.allow_posting, true)
    )
  )
);

COMMENT ON POLICY customer_collections_org_insert_draft
ON public.customer_collections IS
  'Migration 163: authenticated users may create draft customer receipts only inside their current organization; posting remains RPC-only.';

DROP POLICY IF EXISTS supplier_payments_org_insert_draft
  ON public.supplier_payments;
CREATE POLICY supplier_payments_org_insert_draft
ON public.supplier_payments
FOR INSERT
TO authenticated
WITH CHECK (
  org_id = public.wardah_org_id(NULL::uuid)
  AND status = 'draft'
  AND gl_entry_id IS NULL
  AND posted_at IS NULL
  AND posted_by IS NULL
  AND (created_by IS NULL OR created_by = auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.vendors v
    WHERE v.id = supplier_payments.vendor_id
      AND v.org_id = supplier_payments.org_id
  )
  AND (
    payment_account_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.gl_accounts a
      WHERE a.id = supplier_payments.payment_account_id
        AND a.org_id = supplier_payments.org_id
        AND coalesce(a.is_active, true)
        AND coalesce(a.allow_posting, true)
    )
  )
);

COMMENT ON POLICY supplier_payments_org_insert_draft
ON public.supplier_payments IS
  'Migration 163: authenticated users may create draft supplier payments only inside their current organization; posting remains RPC-only.';

-- Guard the intended privilege boundary explicitly. RLS policies do not grant
-- table privileges, so authenticated must have INSERT while anon must not.
GRANT INSERT ON public.customer_collections TO authenticated;
GRANT INSERT ON public.supplier_payments TO authenticated;
REVOKE INSERT ON public.customer_collections FROM anon;
REVOKE INSERT ON public.supplier_payments FROM anon;

DO $verify$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('customer_collections', 'supplier_payments')
    AND cmd = 'INSERT'
    AND policyname IN (
      'customer_collections_org_insert_draft',
      'supplier_payments_org_insert_draft'
    );

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VOUCHER_CREATE_163_POLICY_VERIFY_FAILED: expected 2 policies, found %', v_count;
  END IF;

  IF has_table_privilege('anon', 'public.customer_collections', 'INSERT')
     OR has_table_privilege('anon', 'public.supplier_payments', 'INSERT') THEN
    RAISE EXCEPTION 'VOUCHER_CREATE_163_ANON_INSERT_NOT_REVOKED';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.customer_collections', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.supplier_payments', 'INSERT') THEN
    RAISE EXCEPTION 'VOUCHER_CREATE_163_AUTH_INSERT_MISSING';
  END IF;
END
$verify$;

COMMIT;
