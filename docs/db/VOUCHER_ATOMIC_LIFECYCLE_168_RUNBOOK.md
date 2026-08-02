# Migration 168 — Atomic Voucher Lifecycle Runbook

**Migration:** `168_voucher_atomic_lifecycle_rpcs.sql`
**Scope:** Atomic create, edit and cancel for customer receipts and supplier payments
**State:** Repository implementation. Do not apply to Production before the dedicated Fresh DB gate is green, and do not apply it alone — see §8.

## 1. Purpose

Migration 167 closed every direct write path on allocation lines and left the `corrected` step of the Migration 166 cycle without a client path. Migration 168 restores it and completes the lifecycle:

```text
create → (edit)* → post → reset → (edit)* → post
                                 └→ cancel
```

Three RPC families, all `SECURITY DEFINER`, all owning their whole operation in one transaction:

| RPC | Purpose |
|---|---|
| `rpc_create_customer_receipt(jsonb)` · `rpc_create_supplier_payment(jsonb)` | Header and lines in one transaction |
| `rpc_update_customer_receipt_draft(uuid,jsonb)` · `rpc_update_supplier_payment_draft(uuid,jsonb)` | Complete allocation replacement on a draft |
| `rpc_cancel_customer_receipt(uuid,text)` · `rpc_cancel_supplier_payment(uuid,text)` | End a voucher's cycle without deleting history |

Direct client `INSERT` on allocation lines stays open here on purpose. It is withdrawn in Migration 169, after the UI moves onto these RPCs.

## 2. What atomic creation fixes

The browser flow inserted the header, then the lines, and on a line failure issued a compensating `DELETE` on the header. That delete checked neither its error nor its row count, and `customer_collections` exposes no client `DELETE` policy — so it matched zero rows, silently, and left an orphan header behind. Creation now succeeds or leaves nothing.

Voucher numbers are also allocated server-side. The client read the current maximum and added one, which two concurrent creations resolve to the same number. `wardah_next_voucher_number` serializes allocation per organization, kind and period with a transaction-scoped advisory lock, and the unique constraint remains the final arbiter.

## 3. Security contract

| Role | Access |
|---|---|
| `anon` | none — `EXECUTE` revoked on every RPC |
| `authenticated` | `EXECUTE` on all six RPCs; every call still re-checks active membership and the active tenant |
| `service_role` | `EXECUTE` revoked; it bypasses RLS, so it is never given a shortcut into these paths |

`wardah_next_voucher_number` is internal: `EXECUTE` is revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`.

Cancellation additionally requires the exact permission:

```text
accounting.vouchers.cancel
```

This is a **new key**, not derived from `accounting.vouchers.unpost`:

- `unpost` returns a voucher for correction and leaves it repostable;
- `cancel` ends the cycle.

Migration 168 inserts the key into the permission catalogue and grants it to nobody; the migration's own verification fails if any role holds it at apply time. Grant it explicitly:

```sql
INSERT INTO public.role_permissions (role_id, permission_id, created_by)
SELECT '<ROLE_ID>'::uuid, p.id, '<ADMIN_USER_ID>'::uuid
FROM public.permissions p
WHERE p.permission_key = 'accounting.vouchers.cancel';
```

Do not grant it to every role that already holds `unpost`. The acceptance gate proves a member holding only `unpost` is refused.

## 4. The two cancel paths

**A — never posted.** The voucher carries no `gl_entry_id` and no reset record. It becomes `cancelled`; no GL entry is created, touched or looked for. Allocation lines are kept as history.

**B — posted, then reset for correction.** The voucher keeps `gl_entry_id`; only the linked entry's `status` moves to `cancelled`. `entry_number` and every GL line are retained — nothing is deleted, zeroed or recreated, so the entry sequence has no unexplained gap and no draft entry is left dangling. The audit record names the reset it closes through `metadata.reset_audit_id`.

**Refused outright:** cancelling a `posted` voucher. It must go through `rpc_reset_*_to_draft` first, so the paid amounts and invoice states are unwound by the Migration 166 RPC rather than by a second implementation of the same reversal.

A second cancel of an already-cancelled voucher returns the same result with `duplicate: true` and writes no second audit record.

## 5. The GL cancel guard

`protect_posted_gl_entries` refused `posted → draft` but said nothing about `posted → cancelled`, so cancelling was an unguarded way around `POSTED_ENTRY_IMMUTABLE` the moment any `UPDATE` path opened — which is exactly what this migration does. Every transition into `cancelled` on a voucher-linked entry now requires **all** of:

1. the transaction-local GUC `wardah.voucher_gl_cancel = 'on'`;
2. a voucher that exists in the same organization;
3. a voucher whose `gl_entry_id` still points at that exact entry;
4. a voucher still in `draft`, i.e. inside the correction cycle;
5. a trusted Migration 166 reset record for that voucher.

Condition 5 is why `gl_entry_id` alone is never taken as proof that a voucher went through reset; both the cancel and the edit RPC verify the reset record independently. Condition 4 is why `posted → cancelled` stays closed in practice: a posted voucher cannot satisfy it, with or without the GUC.

Cancelling a posted entry that belongs to any other subsystem is refused outright.

The GUC is opened immediately before the single `UPDATE` and closed immediately after `GET DIAGNOSTICS`, before any deliberate `RAISE`. The same discipline applies to `wardah.voucher_lines_write` in the edit RPCs. Both are `set_config(..., true)`, so they cannot outlive the transaction even if a path is missed.

Note the honest limit: a GUC is a proxy for "called from the approved RPC", not a proof of it. It is not reachable from PostgREST clients, which cannot run arbitrary SQL, but anyone holding a direct connection with table privileges could set it. Conditions 2–5 are what make that insufficient on its own.

## 6. Rejected states

The gate proves each of these is refused:

- a cross-organization invoice, customer or vendor;
- the same invoice allocated twice in one voucher;
- an allocation of zero or less, or any non-zero discount;
- an allocation total that does not match the header amount;
- an allocation above the invoice's open balance;
- a supplier invoice that is not payable;
- editing anything that is not a `draft`;
- editing or cancelling a voucher that carries a GL identity without a trusted reset record;
- changing the customer or vendor of an existing voucher;
- an update payload with no `lines` key — replacement must be explicit, never inferred;
- `anon`, an inactive member, and a member of another organization, on every RPC.

## 7. Acceptance gate

```text
Voucher Atomic Lifecycle 168 Acceptance
```

Markers, all required:

```text
VOUCHER_ATOMIC_168_ACCEPTANCE_PASS
VOUCHER_ATOMIC_168_CONCURRENCY_PASS
VOUCHER_RESET_166_ACCEPTANCE_PASS
VOUCHER_RESET_166_ISOLATION_IDEMPOTENCY_PASS
VOUCHER_ALLOCATION_167_ACCEPTANCE_PASS
```

The chain is built `166 → 167 → 168` on PostgreSQL 17. The 166 and 167 suites are re-run on a separate database in the same job because Migration 168 replaces `protect_posted_gl_entries`, which both already depend on.

The concurrency suite runs two real sessions against the same voucher and proves:

- a concurrent cancel writes exactly one audit record and the loser returns the idempotent duplicate;
- concurrent edits do not lose an update or interleave a partial replacement — the later writer's complete set survives, with exactly two audit records;
- no internal GUC leaks into a fresh session.

## 8. Deployment order

Do **not** apply Migration 167 to Production on its own. Between 167 and 168 the correction step of the Migration 166 cycle has no client path, so a voucher reset in that window can be reset but not edited.

The approved order:

```text
167 → 168 applied in one Production window
    → deploy the UI that calls these RPCs
    → 169 withdraws the direct INSERT
```

Test the full chain on Fresh DB first, then apply `167` and `168` in a single window, in that order, and run the smoke checks in §9. Migration 169 must not be prepared before this migration is applied and verified.

## 9. Production smoke verification

After applying both migrations, in an organization with an open period:

```sql
-- 1. The RPCs exist and only authenticated may call them.
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('rpc_create_customer_receipt','rpc_create_supplier_payment',
                    'rpc_update_customer_receipt_draft','rpc_update_supplier_payment_draft',
                    'rpc_cancel_customer_receipt','rpc_cancel_supplier_payment')
ORDER BY 1;

-- 2. The cancel key exists and is granted to nobody yet.
SELECT p.permission_key, count(rp.role_id) AS granted_roles
FROM public.permissions p
LEFT JOIN public.role_permissions rp ON rp.permission_id = p.id
WHERE p.permission_key = 'accounting.vouchers.cancel'
GROUP BY 1;

-- 3. The GL cancel guard is live.
SELECT pg_get_functiondef('public.protect_posted_gl_entries()'::regprocedure)
       LIKE '%wardah.voucher_gl_cancel%' AS cancel_guard_present;

-- 4. No orphan headers and no orphan lines.
SELECT
  (SELECT count(*) FROM public.customer_collections c
    WHERE c.status='draft'
      AND NOT EXISTS (SELECT 1 FROM public.customer_collection_lines l
                       WHERE l.collection_id = c.id)) AS receipts_without_lines,
  (SELECT count(*) FROM public.supplier_payments p
    WHERE p.status='draft'
      AND NOT EXISTS (SELECT 1 FROM public.supplier_payment_lines l
                       WHERE l.payment_id = p.id)) AS payments_without_lines;

-- 5. Every cancelled voucher that kept a GL identity kept the entry too.
SELECT c.id, c.collection_number, e.entry_number, e.status AS gl_status,
       (SELECT count(*) FROM public.gl_entry_lines l WHERE l.entry_id = e.id) AS gl_lines
FROM public.customer_collections c
JOIN public.gl_entries e ON e.id = c.gl_entry_id
WHERE c.status = 'cancelled';
```

Expected: `auth_exec` true and `anon_exec` false on all six; `granted_roles` zero until an admin grants it; `cancel_guard_present` true; both orphan counts zero; every cancelled voucher in query 5 showing `gl_status = 'cancelled'` with its line count intact.

## 10. Rollback

The migration is additive apart from the `protect_posted_gl_entries` replacement, which only adds refusals. To disable the new client paths without reverting schema, revoke execution:

```sql
REVOKE EXECUTE ON FUNCTION public.rpc_create_customer_receipt(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_create_supplier_payment(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_update_customer_receipt_draft(uuid,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_update_supplier_payment_draft(uuid,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_cancel_customer_receipt(uuid,text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_cancel_supplier_payment(uuid,text) FROM authenticated;
```

Do not restore the previous `protect_posted_gl_entries` body: that reopens `posted → cancelled` on voucher entries. Removing an applied migration is not an option under the project's golden rule — correct forward with a new numbered migration.

## 11. Client integration (`payment-vouchers-service`)

The service layer calls the six RPCs and no longer writes to the voucher tables.

| Service function | RPC |
|---|---|
| `createCustomerReceipt` | `rpc_create_customer_receipt` |
| `createSupplierPayment` | `rpc_create_supplier_payment` |
| `updateCustomerReceiptDraft` | `rpc_update_customer_receipt_draft` |
| `updateSupplierPaymentDraft` | `rpc_update_supplier_payment_draft` |
| `cancelCustomerReceipt` | `rpc_cancel_customer_receipt` |
| `cancelSupplierPayment` | `rpc_cancel_supplier_payment` |

What the client stopped doing:

- **Client-side numbering.** `generateReceiptNumber` and `generatePaymentNumber`
  read the highest existing number and added one, so two concurrent creations
  produced the same number. Numbering is now server-side under an advisory lock.
- **The compensating delete.** The old create inserted the header, then the
  lines, and on line failure issued a delete that checked neither its error nor
  its row count — and the customer has no `DELETE` policy on
  `customer_collections`, so it passed over zero rows in silence.

Line replacement on edit is explicit: `lines` is always sent, including as an
empty array. The service never infers "no lines key" as "keep the current set",
matching `VOUCHER_UPDATE_LINES_REQUIRED`.

RPC error codes are mapped to Arabic sentences for the user while the raw code
is kept in the message for logs and support. Client-side amount checks remain as
convenience only — the RPC re-enforces every one of them.

### Direct-write audit

Remaining `.from('<voucher table>')` call sites, all read-only:

| Location | Kind |
|---|---|
| `payment-vouchers-service.ts` — `getAllCustomerReceipts`, `getAllSupplierPayments` | `select` |
| `sales-reports-service.ts` — collection totals | `select` |

Two legacy functions still hold direct writes and are **not** reached by any UI:
`recordCustomerCollection` in `enhanced-sales-service.ts` (inserts a
`customer_collections` header with swallowed errors, then mutates
`sales_invoices.paid_amount` directly) and `recordCustomerCollection` in
`sales-service.ts` (mutates `paid_amount` and `payment_status` directly). Both
are referenced only by their own unit tests. They must be resolved — converted or
removed — before Migration 169 revokes the direct write grants, since 169 would
otherwise turn them from dead code into runtime failures.

`payment-vouchers-rpc-contract.test.ts` gates the service against drift: it
asserts the six RPC call sites exist, that no `.from()` chain on a voucher table
terminates in a write, that numbering is not derived on the client, and that the
compensating delete is gone.
