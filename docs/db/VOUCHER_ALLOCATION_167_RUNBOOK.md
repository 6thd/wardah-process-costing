# Migration 167 — Voucher Allocation Line Hardening Runbook

**Migration:** `167_voucher_allocation_lines_hardening.sql`  
**Scope:** `customer_collection_lines`, `supplier_payment_lines`, and enriched reset audit evidence.  
**Deployment rule:** DB-first. Do not change the UI creation path until this migration is applied and verified.

## Purpose

Migration 167 closes direct mutation paths on voucher allocation lines without breaking the current two-step UI creation flow:

1. Insert draft voucher header.
2. Insert allocation lines.
3. Post through the atomic voucher RPC.

Direct line `UPDATE` and `DELETE` are removed from client roles. Direct `INSERT` remains temporarily available only for a brand-new draft voucher with `gl_entry_id IS NULL`.

A voucher returned to draft by Migration 166 retains its `gl_entry_id`; therefore clients cannot add, update, or delete its allocation lines directly. Migration 168 will provide atomic SECURITY DEFINER edit RPCs.

## Security contract

### `anon`

No table privileges on either allocation-line table.

### `authenticated`

Temporary privileges:

```text
SELECT, INSERT
```

No `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` privileges.

Read and insert policies are explicitly `TO authenticated` and require an active `user_organizations` row and the active tenant resolved by:

```sql
public.wardah_org_id(NULL::uuid)
```

### `service_role`

`service_role` intentionally retains its existing server-side table privileges and has `rolbypassrls=true`. RLS is not a security boundary for it. The allocation-line trigger is the only database guard for direct service-role mutation when the internal GUC is off.

Never expose the service-role key to browsers, mobile clients, logs, or third-party integrations.

## Trigger contract

Trigger function:

```text
wardah_protect_voucher_allocation_lines()
```

Triggers:

```text
trg_protect_customer_collection_lines
trg_protect_supplier_payment_lines
```

Behavior:

- Direct `UPDATE` and `DELETE` are rejected.
- Direct `INSERT` is accepted only for a new draft whose `gl_entry_id IS NULL`, with active same-tenant membership and a matching same-tenant invoice/customer or invoice/vendor.
- Future atomic RPCs may use the transaction-local GUC:

```text
wardah.voucher_lines_write=on
```

They must turn it off immediately after the final controlled statement and before raising any later error.

## Data contract

`invoice_id` becomes `NOT NULL` on both allocation-line tables.

Invoice foreign keys become:

```text
ON DELETE RESTRICT
```

Migration 167 is fail-closed. It does not clean or rewrite invalid historical allocation data. It aborts if it finds:

- `invoice_id IS NULL`;
- missing parent or invoice;
- cross-organization allocation;
- customer/vendor mismatch.

## Reset audit enrichment

Migration 167 replaces the two Migration 166 reset RPC definitions without changing their financial behavior.

Each `voucher_reset_to_draft` audit event now preserves:

- voucher status, `posted_at`, and `posted_by`;
- `gl_entry_id`, `entry_number`, GL status, GL `posted_at`, and GL `posted_by`;
- reference number;
- complete original allocation array;
- reason and source contract version.

This evidence must remain available for Migration 168 cancellation decisions. A GL entry that was once posted must not later be deleted as though it had never existed.

## Pre-deployment checks

```sql
SELECT count(*) FROM public.customer_collection_lines WHERE invoice_id IS NULL;
SELECT count(*) FROM public.supplier_payment_lines WHERE invoice_id IS NULL;

SELECT c.id, c.collection_number
FROM public.customer_collections c
WHERE c.status='draft'
  AND NOT EXISTS (
    SELECT 1 FROM public.customer_collection_lines l WHERE l.collection_id=c.id
  );

SELECT p.id, p.payment_number
FROM public.supplier_payments p
WHERE p.status='draft'
  AND NOT EXISTS (
    SELECT 1 FROM public.supplier_payment_lines l WHERE l.payment_id=p.id
  );
```

All four checks were zero in Production before authoring Migration 167.

## Dedicated acceptance gate

Workflow:

```text
Voucher Allocation 167 Acceptance
```

Success marker:

```text
VOUCHER_ALLOCATION_167_ACCEPTANCE_PASS
```

The gate proves:

- current active-user draft line creation still works;
- inactive membership cannot read or insert;
- anon has no access;
- NULL and cross-org invoice links are rejected;
- client `UPDATE` and `DELETE` are rejected;
- service-role direct mutation is stopped by the trigger;
- post and reset RPCs still execute;
- reset audit contains entry identity and complete allocation evidence;
- corrected drafts reject direct line inserts;
- the future internal GUC contract works and returns to `off`.

The workflow includes Migration 166 in its path filter because 167 replaces and depends on the reset RPC contract established there.

## Production verification

After applying the migration, verify:

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('customer_collection_lines','supplier_payment_lines')
ORDER BY tablename, policyname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('customer_collection_lines','supplier_payment_lines')
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY table_name, grantee, privilege_type;

SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('customer_collection_lines','supplier_payment_lines')
  AND column_name='invoice_id';

SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN (
  'public.customer_collection_lines'::regclass,
  'public.supplier_payment_lines'::regclass
)
  AND conname LIKE '%invoice_id_fkey';
```

## Rollback and recovery

Do not restore the old `FOR ALL TO public` policies.

If the UI draft creation path fails after deployment:

1. Inspect the failing parent status, `gl_entry_id`, active tenant, membership, and invoice scope.
2. Do not grant `UPDATE` or `DELETE` to client roles.
3. Do not disable the trigger.
4. Correct the narrow insert policy or application payload in a new reviewed migration.

Migration 168 must use the local GUC and atomic RPCs for allocation replacement. It must not reopen direct table writes.
