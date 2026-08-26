# Supplier Invoice Atomic Lifecycle — Design Record

**Status:** accepted design record; PR A implemented and deployed  
**Original design base:** `main@ad98a17ba88292e6fbc16957c1cc132b3447545f`  
**Current repository milestone:** PR #186 merged; Migration 181 applied and verified in Production  
**Current baseline milestone:** PR #188 generated from Production cutoff 181 and pending normal review/merge  
**Application migration:** PR B not started  

> This document began as the planning gate for the supplier-invoice lifecycle
> remediation. D1–D7 were reviewed and accepted before implementation. It now
> records both those accepted decisions and the implementation state reached
> through Migration 181. It does not authorize a future application change,
> Production write, mapping mutation, or PR merge by itself.

## 1. Why this design exists

The database already had a hardened atomic matched-invoice contract from
Migrations 149–152, while the active `SupplierInvoiceForm` still performed
separate browser-side writes for supplier-invoice header/lines, purchase-order
status and GL entry/lines.

That created three concrete problems:

1. **Contract bypass:** the UI did not consume the concurrency, accepted-GRN,
   idempotency, allocation and accounting guarantees already implemented in
   `rpc_create_matched_supplier_invoice(jsonb)`.
2. **Permission/lifecycle mismatch:** the UI opened the create form under
   `purchasing.purchase_invoices.create`, while the matched RPC creates approved
   state and posts accounting and therefore requires
   `purchasing.purchase_invoices.approve`.
3. **Partial-success accounting risk:** the legacy client `createGLEntry()` path
   could catch/log a GL failure without rethrowing, allowing a misleading invoice
   success state after accounting failure.

The remediation therefore keeps the database as the authoritative financial
boundary and retires, rather than legitimizes, direct client financial writes.

## 2. Existing matched-invoice write contract

Migrations 149–152 remain the canonical write foundation:

- `149_ap_three_way_match_allocations.sql`
  - append-only `supplier_invoice_receipt_allocations`;
  - accepted-GRN matching evidence and snapshots;
  - atomic supplier invoice + allocation + accounting behavior;
  - uninvoiced balance derived from persisted allocation facts.
- `150_ap_matched_invoice_idempotency_and_grn_gate.sql`
  - mandatory idempotency key and canonical request hash;
  - exact replay vs changed-payload protection;
  - duplicate supplier-document-number protection;
  - legal GRN header gate;
  - public wrapper requires `purchasing.purchase_invoices.approve`.
- `151_ap_helper_security_hardening.sql`
  - hardens receipt-balance helper tenancy and execution surface.
- `152_ap_allow_fully_received_purchase_orders.sql`
  - permits terminal `fully_received` PO state in the legal matched path.

The canonical write boundary remains:

```text
rpc_create_matched_supplier_invoice(p_payload)
```

No later remediation in this design may weaken that write boundary merely to
imitate the old form.

## 3. Non-negotiable safety rules

1. No direct client INSERT/UPDATE/DELETE may be restored or newly granted on:
   - `supplier_invoices`;
   - `supplier_invoice_lines`;
   - `supplier_invoice_receipt_allocations`;
   - financial `purchase_orders` status transitions;
   - `gl_entries` / `gl_entry_lines`.
2. Historical Migrations 149–152 are not rewritten.
3. Database changes remain additive and receive a legal migration number only
   after repository and Production ledger preflight.
4. `purchasing.purchase_invoices.approve` remains the permission for the final
   operation that creates approved state and posts GL; it is not downgraded to
   `.create`.
5. Missing GL event mappings, stale receipt balance, cross-org references, price
   variance or accounting errors fail closed.
6. PO/GRN invoiced quantity is derived from persisted allocation facts, never a
   client-maintained `alreadyInvoiced` value.
7. Idempotency identity belongs to one logical user operation and survives
   ambiguous retries.
8. `without-po` and pre-receipt invoices are not routed through the matched GRN
   contract using fabricated references.

## 4. Accepted first-slice scope

### Supported

**PO-backed supplier invoice with at least one accepted, legally invoiceable GRN
line, submitted by a caller authorized for the final atomic approve/post action.**

### Explicitly excluded from this slice

- PO invoice before accepted receipt exists;
- direct invoice without PO/GRN;
- persisted draft-only AP lifecycle;
- configurable price/quantity tolerance;
- supplier credit note / cancellation / reversal;
- multi-currency matching.

Those remain valid future business possibilities, but each requires its own
reviewed accounting contract.

## 5. D1–D7 decision record

### D1 — First slice — ACCEPTED

Accepted-GRN matched invoices only.

### D2 — Final action permission — ACCEPTED

Keep `purchasing.purchase_invoices.approve` for the operation that creates
approved state and posts GL. Do not downgrade it to `.create`.

### D3 — Meaning of `create` — ACCEPTED FOR THIS ROUND

`create` permits local preparation/preview of a new request. This round does not
invent a persisted draft DB lifecycle.

A create-only caller may prepare locally when read permissions allow it, but:

- no DB draft is created;
- the final approve/post action is disabled or omitted;
- the UI explains that posting requires
  `purchasing.purchase_invoices.approve`;
- no hidden fallback to direct writes exists.

### D4 — Candidate-read permissions — ACCEPTED AND IMPLEMENTED

Active organization membership plus **both**:

```text
purchasing.purchase_orders.read
purchasing.purchase_invoices.read
```

No goods-receipt permission namespace was invented for this remediation.

### D5 — PO with no accepted receipt — ACCEPTED

Block in the first slice. A pre-receipt AP workflow, if required, is a separate
future design.

### D6 — `without-po` — ACCEPTED

Block/remove submission in the first slice. Direct AP invoices, if required, are
a separate future design.

### D7 — Existing one-step matched RPC — ACCEPTED

Keep `rpc_create_matched_supplier_invoice(jsonb)` as the canonical first-slice
write boundary.

## 6. PR A outcome — candidate read contract

PR #186 implemented the reviewed DB-only read contract and was merged to `main`.
Migration 181 is:

```text
181_supplier_invoice_candidate_read.sql
```

It adds:

```text
rpc_list_supplier_invoice_candidates(
  p_org_id uuid,
  p_vendor_id uuid default null,
  p_purchase_order_id uuid default null
) returns jsonb
```

The read contract:

- is tenant-scoped and requires active organization membership;
- enforces the D4 all-of permission set;
- returns only accepted candidate receipt lines from legal GRN/PO states;
- preserves `fully_received` as a legal PO state;
- derives allocated quantity using original allocations positive and reversals
  negative;
- excludes fully consumed lines;
- returns persisted UoM/conversion and PO pricing snapshots;
- uses the allocation ledger as the authoritative remaining-balance source;
- is a read convenience contract only; the matched write RPC revalidates and
  locks authoritative facts at write time.

### Execution surface

Migration 181 intentionally leaves EXECUTE as:

```text
authenticated = allowed
anon          = denied
service_role  = denied
PUBLIC        = denied
```

The function is `SECURITY DEFINER`, `STABLE`, and uses a pinned search path.
`service_role` denial is deliberate because this is a permission-aware user read
contract based on `auth.uid()` and D4, not a background-service bypass.

## 7. Migration 181 verification state

Production ledger records:

```text
version: 20260826112454
name:    181_supplier_invoice_candidate_read
```

Post-apply verification confirmed:

- `SECURITY DEFINER`;
- `STABLE` volatility;
- pinned `search_path`;
- `authenticated` EXECUTE only;
- D4 permission enforcement;
- read-only smoke execution under an authenticated member context;
- no commercial document mutation during verification.

Repository documentation was reconciled through PR #187, so the documented
repository/live cutoff is 181.

## 8. Baseline state after Migration 181

The repository follows the DB-first rule: a new baseline is generated only after
the migration appears in the Production ledger.

`Generate Schema Baseline` run #29 was re-run successfully after correcting the
GitHub Actions Production database connection secret. The successful run proved:

```text
repo_max:                     181
live_cutoff:                  181
repository_ahead_by:          0
pending_repository_files:     []
```

Generated pair:

```text
000_schema_baseline_20260826_131415.sql
001_system_reference_data_20260826_131415.sql
```

Verification evidence from the workflow:

- PostgreSQL 17 client/rebuild path passed;
- schema baseline: 35,603 lines;
- ACL preserved: 1,130 GRANT/REVOKE statements;
- system reference snapshot: 5 tables / 263 rows;
- Production = snapshot = clean rebuild for system reference data;
- clean rebuild object counts: 133 tables / 258 functions / 318 policies.

The workflow pushed branch
`automation/baseline-cutoff-181-32971574241`. GitHub Actions itself could not
open a PR because repository policy prevents Actions from creating/approving pull
requests, so PR #188 was opened manually from that exact generated branch.

**PR #188 remains a normal review/merge gate. This design record does not
pre-authorize its merge.**

## 9. Accounting mapping rollout blocker

The legacy client reads `gl_mappings` keys such as:

```text
PURCHASE_INVENTORY
PURCHASE_TAX
PURCHASE_PAYABLE
```

The canonical matched supplier-invoice write contract instead uses
`gl_event_mappings` event codes:

```text
AP_MATCHED_INVOICE_GOODS
AP_MATCHED_INVOICE_VAT
```

These are separate configuration contracts.

Current Production preflight has confirmed **zero active mappings** for the two
matched-invoice event codes above. Therefore:

- Migration 181 is complete and valid;
- candidate reads are not blocked;
- **PR B pilot/write rollout remains blocked**;
- missing mappings must continue to fail as `AP_ACCOUNT_MAPPING_MISSING`;
- there is no fallback to `gl_mappings` or client-side posting.

Before PR B is enabled for any pilot organization, both event mappings must exist
for that organization and every referenced GL account must exist and be postable.

`gl_event_mappings` are org-scoped operational configuration, not a schema
migration and not system reference baseline data.

## 10. PR B — application migration to legal contracts

PR B may begin only after the baseline review step and the GL mapping rollout
preflight are complete.

It may then:

- add a typed AP candidate service using
  `rpc_list_supplier_invoice_candidates`;
- replace PO-line reads with candidate RPC reads;
- replace direct supplier-invoice header/line, PO-status and GL mutations with
  `rpc_create_matched_supplier_invoice`;
- implement stable idempotency-key lifecycle;
- implement explicit approve/post action and permission gating;
- provide the create-only non-persisted preparation/preview UX from D3;
- block unsupported pre-receipt and `without-po` submissions rather than falling
  back to direct writes;
- add clear Arabic mappings for known `AP_*` errors;
- preserve unknown server errors rather than reporting false success;
- remove the dead legacy `createGLEntry` path and client-generated GL number
  path;
- prove that accounting failure can no longer be swallowed while invoice success
  is reported.

### Stable idempotency requirement

Generate one operation key for one logical invoice attempt and retain it across:

- lost first response;
- ambiguous network timeout;
- retry of the same unchanged logical operation;
- candidate refetch during that same operation.

A genuinely new/changed invoice request receives a new operation key.

## 11. PR C — direct-write ratchet / cleanup

Prefer including the ratchet in PR B if the diff remains small and directly
proves surface reduction. Otherwise use a separate immediately-following PR.

The ratchet should protect at least:

```text
supplier_invoices
supplier_invoice_lines
supplier_invoice_receipt_allocations
purchase_orders
gl_entries
gl_entry_lines
```

It should tighten the reviewed mutation inventory for removed signatures and fail
CI on newly introduced protected financial direct writes without bundling
unrelated historical audit debt.

## 12. Acceptance matrix

### Candidate read — implemented/proven by PR A

1. Cross-org caller fails closed.
2. Vendor filter cannot expose another vendor's PO/GRN.
3. Draft/unconfirmed GRN is excluded.
4. Rejected/pending-inspection lines are excluded.
5. Accepted line returns true remaining quantity after existing allocations.
6. Fully consumed line is excluded.
7. `fully_received` PO remains invoiceable while its accepted GRN line has
   balance.
8. Snapshot values come from persisted PO/GRN facts, not current UoM catalog.
9. `anon`/`PUBLIC` have no execute privilege.
10. Caller lacking either D4 permission is denied.
11. A real allocation + reversal pair restores the pre-probe net allocated and
    remaining balances.

### Application — required for PR B

1. No direct INSERT/UPDATE/DELETE for supplier invoice, PO status or GL creation.
2. Create-only caller cannot trigger approve/post RPC.
3. Create-only caller gets clear non-persisted preparation/preview behavior.
4. Approve-capable caller submits real GRN-line ids and server candidate snapshot
   values.
5. Ambiguous retry reuses the same idempotency key.
6. Exact replay yields one invoice / one GL result.
7. A changed logical request receives a new operation key.
8. PO with no accepted GRN cannot fall back to old direct writes.
9. `without-po` cannot fall back to old direct writes.
10. Known quantity, price, duplicate-document and permission errors are surfaced
    clearly.
11. Missing `gl_event_mappings` fails visibly with no fallback.
12. No path can report invoice success after GL creation/posting failure.
13. Existing invoice listing/read behavior remains intact.

### Security / CI — required before PR B merge

1. TypeScript and Vitest green.
2. Sonar quality gate green on final head.
3. RBAC Mutation Inventory green with reviewed surface reduction.
4. AP 149 Fresh DB acceptance remains green as regression proof.
5. Migration 181 candidate-read acceptance remains green on PostgreSQL 17 Fresh
   DB.
6. No unresolved review threads before merge.

## 13. Rollout and stop conditions

Stop implementation or rollout and return to review if any of these occurs:

- Production ledger differs from documented state;
- D4 permission keys or semantics materially change;
- candidate read exposes cross-org or rejected/unposted receipt data;
- the matched write RPC drifts materially from the 149–152 assumptions;
- the pilot organization lacks active `AP_MATCHED_INVOICE_GOODS` or
  `AP_MATCHED_INVOICE_VAT` mappings;
- referenced mapping accounts are missing or non-postable;
- app requirements require pre-receipt or `without-po` posting in the same
  release;
- restored behavior would require reopening direct table writes;
- implementation would require editing an applied migration.

Missing configuration remains a fail-closed rollout condition, not a reason to
weaken `AP_ACCOUNT_MAPPING_MISSING`.

## 14. Optional later designs

Only when confirmed as real business requirements:

- persisted supplier-invoice draft lifecycle;
- pre-receipt invoice workflow;
- without-PO/direct AP invoice workflow;
- cancellation/reversal and supplier credit notes;
- price/quantity tolerance and PPV approval;
- multi-currency matched AP.

## 15. Current sequence and definition of done

Current sequence after this record was accepted:

```text
D1–D7 design accepted
  → PR A / #186 merged
  → Migration 181 applied to Production
  → Production verification passed
  → #187 documentation reconciliation merged
  → #188 baseline cutoff 181 generated and under review
  → configure/verify org-scoped matched AP gl_event_mappings
  → PR B application migration
  → PR C ratchet if not included in PR B
```

For this design-record PR itself, definition of done is now:

- D1–D7 remain accurately recorded;
- completed PR A / Migration 181 state is reconciled with reality;
- baseline and GL-mapping rollout state are explicit;
- future PR B/C boundaries remain fail-closed and reviewable;
- the document is merged only through normal review and CI.

Merging this design record **does not itself authorize** PR #188 merge, GL mapping
writes, PR B implementation, or any future Production mutation.
