# Migration 181 — Supplier Invoice Candidate Read Runbook

**Migration:** `181_supplier_invoice_candidate_read.sql`  
**Scope:** read contract only  
**Parent design:** `docs/db/SUPPLIER_INVOICE_ATOMIC_LIFECYCLE_PLAN.md` / PR #185  
**Production application:** **not authorized by this PR**

## 1. Purpose

Migration 181 adds one client-facing read RPC:

```text
rpc_list_supplier_invoice_candidates(
  p_org_id uuid,
  p_vendor_id uuid default null,
  p_purchase_order_id uuid default null
) returns jsonb
```

Its only job is to expose legal PO ↔ accepted-GRN lines that still have
uninvoiced quantity for the later supplier-invoice UI migration.

It does **not** create, approve, post, update or reserve any business document.
The canonical write contract remains Migrations 149–152 via
`rpc_create_matched_supplier_invoice(jsonb)`.

## 2. Repository / Production state used to allocate 181

Before implementation the following were independently rechecked:

- repository `main` = `ad98a17ba88292e6fbc16957c1cc132b3447545f`;
- repository max migration = 180;
- Production project `uutfztmqvajmsxnrqeiv` is `ACTIVE_HEALTHY` on PostgreSQL 17;
- Production ledger ends at `180_retire_legacy_journal_approval_surface`;
- no `181_%` migration is registered in Production;
- `skipped_migration_numbers.yml` does not reserve 181.

Therefore 181 was the next legal repository migration number at branch creation.
If `main` or Production advances before merge/application, re-run the numbering
and ledger checks. Never rename an already-applied migration to resolve drift.

## 3. Security contract

The RPC is `SECURITY DEFINER` because it reads across tables whose RLS policies
are not the API contract. It therefore applies explicit server-side guards:

1. resolve the explicit organization via `wardah_org_id(p_org_id)`;
2. require active organization membership via `wardah_assert_org_member`;
3. require **both** reviewed D4 keys through `has_permission`:

```text
purchasing.purchase_orders.read
purchasing.purchase_invoices.read
```

There is no `purchasing.goods_receipts.*` / `purchasing.receipts.*` permission in
the current catalog. Migration 181 does not invent one.

Execution surface:

- `authenticated`: EXECUTE;
- `PUBLIC`: revoked;
- `anon`: revoked;
- `service_role`: revoked for this client read API.

The `service_role` revoke is deliberate, not accidental. This function exists as
a permission-aware browser/API read boundary and its authorization semantics are
defined in terms of `auth.uid()` + active membership + the two D4 permissions.
There is no approved background/service workflow that requires candidate listing.
If one is introduced later, it must use a separately reviewed service contract
rather than silently bypassing the D4 caller model on this client RPC.

`search_path` is pinned to `public, pg_temp` and every business-table predicate is
explicitly scoped to the resolved organization.

## 4. Candidate eligibility

A row is returned only when all conditions are true:

- caller passes membership + both D4 read permissions;
- purchase order, order line, goods receipt and receipt line belong to the same
  organization;
- optional vendor and PO filters resolve inside that organization;
- GRN line is linked to a PO line;
- `goods_receipt_lines.quality_status = 'accepted'`;
- GRN header is `confirmed` or `posted`;
- PO state is one of the states already accepted by the matched-invoice chain:
  `approved`, `partially_received`, `fully_received`, `received`, `closed`;
- GRN vendor matches PO vendor;
- GRN-line product matches PO-line product;
- both PO and GRN carry complete immutable UoM snapshot evidence;
- PO and GRN snapshots agree;
- remaining accepted uninvoiced base quantity is greater than zero.

The equality check between PO and GRN UoM snapshots is intentionally defensive.
For legal PO-linked receipts created by Migration 148+ the GRN snapshot is copied
from the PO line, so equality should always hold. The predicate protects the new
read contract from legacy/corrupt rows; it is not a new operational matching rule.

Legacy/base-unit rows without complete snapshots are deliberately excluded from
this first UI slice rather than guessed or reinterpreted.

## 5. Remaining-quantity derivation

The read RPC does **not** trust any client `alreadyInvoiced` value.

For each accepted GRN line:

```text
accepted base quantity
  = goods_receipt_lines.received_quantity
    when quality_status = accepted

allocated base quantity
  = SUM(original allocation quantity)
    - SUM(reversal allocation quantity)
    within the same org + GRN line

remaining base quantity
  = accepted base quantity - allocated base quantity
```

This is the same allocation-ledger model established in 149/151. Migration 181
spells the aggregate inline in its candidate query instead of invoking
`wardah_receipt_line_uninvoiced_base(uuid)` once per candidate row. The duplication
is intentional in this slice: the read RPC remains one auditable tenant-scoped
query, avoids repeated privileged helper calls, and the Fresh DB acceptance now
asserts that the inline aggregate and the 149/151 helper agree under both normal
allocation and an actual append-only reversal row.

The read RPC is advisory for UX only: the write RPC still locks rows and
recomputes remaining quantity under lock before any invoice write.

## 6. Returned evidence

Each candidate includes the identifiers and immutable facts required by the
future typed UI service:

- organization/vendor ids and vendor code/name;
- PO id/number/status and PO-line id;
- GRN id/number/status and GRN-line id;
- product id/code/name/name_ar;
- UoM id/code/name/name_ar/symbol/decimal places;
- conversion-factor snapshot;
- accepted / allocated / remaining quantity in base and entered units;
- PO unit price in base and entered units;
- discount and tax percentages.

No row returned by this RPC is a reservation. A later submit may still fail if a
concurrent invoice consumes the balance first; that is intentional and is closed
by the existing atomic matched-invoice RPC.

## 7. Fresh DB acceptance

Workflow:

```text
.github/workflows/ap-181-supplier-invoice-candidates.yml
```

Runner:

```text
scripts/ci/fresh-db/run_ap_181_candidate_gate.sh
```

Acceptance:

```text
scripts/ci/fresh-db/acceptance_181_supplier_invoice_candidates.sql
```

The gate uses PostgreSQL 17 and:

1. resolves the current baseline pair;
2. applies every legal migration after the baseline cutoff through 181;
3. runs migration syntax + SECURITY DEFINER guards;
4. runs Acceptance 148 to build legal PO/GRN fixtures through production RPCs;
5. runs Acceptance 149 to create a real matched allocation;
6. proves 181 returns the authoritative remaining balance for the targeted GRN
   line by deriving the expected allocation from the ledger and cross-checking the
   expected remainder with `wardah_receipt_line_uninvoiced_base`, without relying
   on fixture-specific allocation constants or candidate-list cardinality;
7. explicitly proves that the candidate PO state is `fully_received`, preserving
   direct regression coverage of Migration 152's terminal PO state;
8. proves membership/D4 denial paths;
9. proves draft GRN, rejected line and fully consumed line are excluded;
10. inserts an actual append-only allocation reversal row and proves both the 181
    candidate read and `wardah_receipt_line_uninvoiced_base` restore the same
    pre-probe remaining balance and candidate visibility;
11. proves vendor/PO filters fail closed;
12. re-runs the remaining 149 closure + concurrency suites as regression proof;
13. verifies the final function definition and EXECUTE surface.

Negative and reversal probes are transaction-scoped and rolled back so they do
not corrupt the shared 148/149 fixtures.

## 8. Repository merge gate

Do not merge this PR until the final head SHA has:

- Migration Governance green;
- CI/CD / TypeScript / repository tests green;
- SonarQube green;
- `AP 181 Supplier Invoice Candidate Read` green;
- existing AP 149 regression gates green where triggered;
- no unresolved review threads;
- final diff review confirming no app/runtime change and no historical migration
  rewrite.

This PR may be merged to the repository only after explicit merge authorization.
Repository merge still does **not** authorize Production application.

## 9. Production application gate — separate authorization required

After repository merge, and only with separate explicit authorization:

1. verify Production is still healthy;
2. verify Production ledger still ends at the expected prior migration and that
   181 is absent;
3. verify the exact merged migration SHA/file from `main`;
4. take the normal operational snapshot/preflight required by project policy;
5. apply only the additive 181 migration;
6. verify one ledger registration;
7. verify function definition, pinned `search_path`, membership/D4 guards and
   EXECUTE grants;
8. perform read-only candidate checks against existing Production data;
9. do **not** create commercial test invoices or apply PR B in the same step.

If the repository/Production migration state has diverged, stop and reconcile the
ledger before application.

## 10. Rollback / reversal

181 creates only a read RPC. If repository rollback is required before Production
application, revert the repository commit/PR normally.

If 181 has been applied to Production and an operational rollback is explicitly
authorized, the narrow reversal is:

```sql
DROP FUNCTION IF EXISTS public.rpc_list_supplier_invoice_candidates(uuid, uuid, uuid);
```

Record that reversal operationally; do not delete or rewrite the 181 migration
history row or historical migration file.

## 11. Explicit non-goals

Migration 181 does not:

- modify 149–152;
- add or change supplier-invoice write semantics;
- change `purchasing.purchase_invoices.approve`;
- add a persisted draft lifecycle;
- support pre-receipt invoices;
- support `without-po` invoices;
- configure `gl_event_mappings`;
- fix the old UI direct-write path;
- apply anything to Production.

Those belong to the later reviewed rollout sequence. In particular, PR B remains
blocked for any pilot organization until active `AP_MATCHED_INVOICE_GOODS` and
`AP_MATCHED_INVOICE_VAT` mappings and postable accounts are verified.
