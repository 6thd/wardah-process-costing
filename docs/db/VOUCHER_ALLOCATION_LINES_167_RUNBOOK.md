# Migration 167 — Voucher Allocation Lines Hardening Runbook

**Migration:** `167_voucher_allocation_lines_hardening.sql`  
**Scope:** Customer receipt and supplier payment allocation lines  
**State:** Repository implementation; do not apply to Production before the dedicated Fresh DB acceptance is green.

## Purpose

Migration 167 closes direct mutation paths on:

- `customer_collection_lines`
- `supplier_payment_lines`

while preserving the current two-step draft creation flow used by the application.

It does not add voucher edit or cancel RPCs. Those belong to Migration 168.

## Production preflight

Before applying, confirm:

```sql
SELECT count(*)
FROM public.customer_collection_lines
WHERE invoice_id IS NULL;

SELECT count(*)
FROM public.supplier_payment_lines
WHERE invoice_id IS NULL;

SELECT count(*)
FROM public.customer_collections c
WHERE c.status='draft'
  AND NOT EXISTS (
    SELECT 1 FROM public.customer_collection_lines l
    WHERE l.collection_id=c.id
  );

SELECT count(*)
FROM public.supplier_payments p
WHERE p.status='draft'
  AND NOT EXISTS (
    SELECT 1 FROM public.supplier_payment_lines l
    WHERE l.payment_id=p.id
  );
```

All four counts were zero at design time. The migration fails closed if NULL invoice allocation rows or cross-scope drift exists.

## Security contract

After 167:

- `anon` has no table privileges on either allocation-line table.
- `authenticated` has `SELECT` and temporary constrained `INSERT` only.
- direct `UPDATE` and `DELETE` are unavailable.
- read policies are explicitly `FOR SELECT TO authenticated`.
- insert policies require active membership, active tenant match, a brand-new draft parent, `gl_entry_id IS NULL`, a non-NULL invoice, same organization, and matching customer/vendor.
- reset vouchers keep `gl_entry_id`, so direct client inserts into their lines are rejected.

## service_role decision

`service_role` intentionally retains its server privileges and has `rolbypassrls=true`. RLS is therefore not a protection layer for that role.

The trigger `wardah_protect_voucher_allocation_lines()` is the database guard for service-role writes. It rejects direct `UPDATE` and `DELETE`, and constrains compatibility `INSERT` unless a trusted atomic RPC opens the transaction-local GUC:

```text
wardah.voucher_lines_write=on
```

Migration 168 must turn the GUC off immediately after its final line-write statement and before raising any later error.

## Schema changes

- `invoice_id` becomes `NOT NULL` in both allocation-line tables.
- invoice foreign keys change from `ON DELETE SET NULL` to `ON DELETE RESTRICT`.
- uniqueness on `(parent_id, invoice_id)` now remains meaningful because NULL allocations are impossible.

## Reset audit enrichment

Migration 167 replaces the two Migration 166 reset RPC definitions without changing their financial behavior.

Each new `voucher_reset_to_draft` audit event includes:

- original voucher status, `posted_at`, and `posted_by`;
- original GL status, `entry_number`, `posted_at`, and `posted_by`;
- `gl_entry_id` and reference number;
- complete allocation-line snapshots;
- reset reason and source metadata.

This evidence must remain available for Migration 168 cancellation logic and later audit review.

## Dedicated acceptance gate

Workflow:

```text
Voucher Allocation 167 Acceptance
```

Acceptance marker:

```text
VOUCHER_ALLOCATION_167_ACCEPTANCE_PASS
```

The gate must prove at minimum:

- legacy new-draft line insertion still succeeds;
- inactive membership is rejected;
- anon access is rejected;
- cross-organization and mismatched customer/vendor insertion is rejected;
- `invoice_id=NULL` is rejected;
- direct `UPDATE` and `DELETE` are rejected;
- service-role direct mutation is rejected by the trigger;
- reset-voucher direct line insertion is rejected because `gl_entry_id` remains populated;
- posting and reset RPCs still work;
- reset audit contains `entry_number`, original posting metadata, and allocation snapshots.

## Post-application verification

```sql
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('customer_collection_lines','supplier_payment_lines')
ORDER BY tablename, policyname;

SELECT grantee, table_name,
       string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('customer_collection_lines','supplier_payment_lines')
  AND grantee IN ('anon','authenticated','service_role')
GROUP BY grantee, table_name
ORDER BY table_name, grantee;

SELECT table_name, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('customer_collection_lines','supplier_payment_lines')
  AND column_name='invoice_id';

SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN (
  'customer_collection_lines_invoice_id_fkey',
  'supplier_payment_lines_invoice_id_fkey'
);

SELECT tgrelid::regclass, tgname, tgenabled
FROM pg_trigger
WHERE tgname IN (
  'trg_protect_customer_collection_lines',
  'trg_protect_supplier_payment_lines'
)
  AND NOT tgisinternal;
```

## Rollback and recovery

Do not roll back by restoring the old `FOR ALL TO public` policies.

If application creation fails after 167, diagnose the parent draft, active membership, tenant claim, invoice organization, and customer/vendor match. The correct forward fix is an atomic creation RPC in Migration 168.

Before replacing or removing 167, list any vouchers in correction state:

```sql
SELECT c.id, c.collection_number, c.status, c.gl_entry_id, e.status AS gl_status
FROM public.customer_collections c
JOIN public.gl_entries e ON e.id=c.gl_entry_id
WHERE c.status='draft' AND e.status='draft'
UNION ALL
SELECT p.id, p.payment_number, p.status, p.gl_entry_id, e.status
FROM public.supplier_payments p
JOIN public.gl_entries e ON e.id=p.gl_entry_id
WHERE p.status='draft' AND e.status='draft';
```

Do not remove the trigger or GUC contract while Migration 168 RPCs depend on it.
