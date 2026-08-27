# Supplier Invoice Atomic Lifecycle — Design Record

**Status:** accepted design record; first matched-invoice application slice implemented, merged and deployed  
**Original design base:** `main@ad98a17ba88292e6fbc16957c1cc132b3447545f`  
**Current repository milestone:** PR #189 merged to `main` as `77fead16c5acb7104e129e89881d74ebce74df8b`  
**Current baseline milestone:** PR #188 merged; repository and Production remain reconciled at cutoff 181  
**Application migration:** PR B / #189 merged; PR C ratchet absorbed into PR B  

> This document began as the planning gate for the supplier-invoice lifecycle
> remediation. D1–D7 were reviewed and accepted before implementation. It now
> records both those accepted decisions and the implementation state reached
> through the merged application migration. It does not authorize a future
> Production financial write, new business lifecycle, mapping mutation, or PR
> merge by itself.

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

## 8. Baseline state after Migration 181 — COMPLETE

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

PR #188 was subsequently reviewed, reconciled against the then-current `main`,
and merged. Its merge commit is:

```text
b4c221f1d8dd963c6ad66a219b2edbaf5a6b2041
```

That closed the baseline cutoff-181 review gate without changing the Production
ledger.

## 9. Accounting mapping rollout — COMPLETE

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

Production preflight initially confirmed zero active mappings for the two matched
invoice events, which correctly blocked PR B rollout at that time. The required
org-scoped configuration was then applied after separate explicit Production
authorization and independently re-verified.

Current operational configuration for the active organization is:

```text
AP_MATCHED_INVOICE_GOODS -> Dr 210150 / Cr 210100 / active
AP_MATCHED_INVOICE_VAT   -> Dr 110600 / Cr 210100 / active
```

The referenced accounts remain active and postable:

```text
210150  Goods Received Not Invoiced (GRNI)
210100  Accounts Payable
110600  Input VAT
```

Post-write verification confirmed exactly one active mapping for each event and a
shared AP credit account `210100`. The configuration write did not alter schema,
migration history, or commercial documents.

`gl_event_mappings` remain org-scoped operational configuration, not a schema
migration and not system reference baseline data. Missing mappings in any other
organization must still fail closed as `AP_ACCOUNT_MAPPING_MISSING`.

## 10. PR B — application migration to legal contracts — COMPLETE

PR B was implemented as PR #189 and merged to `main`.

Final PR head:

```text
e4f0bb7913220ad1fa5327865734166f83471e32
```

Merge commit:

```text
77fead16c5acb7104e129e89881d74ebce74df8b
```

The merged application flow now:

- reads candidates only through
  `rpc_list_supplier_invoice_candidates`;
- writes only through
  `rpc_create_matched_supplier_invoice(jsonb)`;
- derives quantity, price, discount and tax from the server candidate snapshot;
- keeps `.create` as local preparation/preview only;
- requires `purchasing.purchase_invoices.approve` for the final approve/post
  action and checks it inside the form boundary;
- generates one stable idempotency key per unchanged logical operation and
  rotates it only when the logical request changes;
- keeps pre-receipt and `without-po` posting disabled with no direct-write
  fallback;
- maps known `AP_*` errors to clear Arabic messages;
- keeps unknown write failures as failures rather than reporting false success;
- separates a committed financial success from any later local refresh failure;
- removes the active client `createGLEntry` and client-generated journal-number
  path from supplier-invoice posting.

The original integration point in `src/features/purchasing/index.tsx` did not need
rewriting: `SupplierInvoiceForm.tsx` became a thin permission-aware wrapper around
the atomic implementation.

### Stable idempotency requirement — IMPLEMENTED

One operation key is retained across:

- lost first response;
- ambiguous network timeout;
- retry of the same unchanged logical operation;
- candidate refetch during that same operation.

A genuinely new/changed invoice request receives a new operation key.

## 11. Direct-write ratchet / PR C — ABSORBED INTO PR B

The plan preferred including the ratchet in PR B when the diff remained small and
directly proved surface reduction. That is what happened in PR #189, so no
separate PR C is required.

The merged ratchet protects against restoring direct financial mutations involving
at least:

```text
supplier_invoices
supplier_invoice_lines
supplier_invoice_receipt_allocations
purchase_orders
gl_entries
gl_entry_lines
```

It also prevents restoration of the old client GL helper/manual journal-number
path and unsupported pre-receipt/without-PO fallback behavior.

The reviewed RBAC mutation baseline was tightened from 335 to 332 signatures,
reflecting real removal of mutation surface rather than a blind baseline reset.
The PR's changed production files exposed only the two legal RPC surfaces for
candidate read and atomic matched write.

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

### Application — implemented/proven by PR B / #189

1. No direct INSERT/UPDATE/DELETE for supplier invoice, PO status or GL creation.
2. Create-only caller cannot trigger approve/post RPC.
3. Create-only caller gets clear non-persisted preparation/preview behavior.
4. Approve-capable caller submits real GRN-line ids and server candidate snapshot
   values.
5. Ambiguous retry reuses the same idempotency key.
6. Exact replay remains delegated to the canonical server idempotency contract.
7. A changed logical request receives a new operation key.
8. PO with no accepted GRN cannot fall back to old direct writes.
9. `without-po` cannot fall back to old direct writes.
10. Known quantity, price, duplicate-document and permission errors are surfaced
    clearly.
11. Missing `gl_event_mappings` fails visibly with no fallback.
12. No path can report invoice success after GL creation/posting failure.
13. Existing invoice listing/read integration remains mounted through the same
    purchasing module entry point.

### Security / CI — passed before and after PR B merge

1. TypeScript and Vitest green.
2. Sonar quality gate green on final PR head.
3. RBAC Mutation Inventory green with reviewed surface reduction.
4. AP 149 Fresh DB acceptance green as regression proof.
5. Migration 181 candidate-read acceptance green on PostgreSQL 17 Fresh DB.
6. No unresolved review threads before merge.
7. Post-merge CI/CD Pipeline green on
   `77fead16c5acb7104e129e89881d74ebce74df8b`.
8. Post-merge SonarQube Analysis green on the same merge commit.

### Post-merge Production read-only smoke — passed within tool limits

A read-only smoke was performed after deployment of the merge commit:

- Vercel Production deployment for `77fead16...` was `READY`;
- `/purchasing/invoices` returned HTTP 200 from the Production deployment;
- no Vercel runtime errors/fatals were observed for the deployment during the
  checked window;
- under the real authenticated user context, D4 read permissions and
  `purchasing.purchase_invoices.create` / `.approve` resolved true;
- `rpc_list_supplier_invoice_candidates` returned two legal candidates from a
  `fully_received` PO with confirmed GRNs and accepted receipt lines;
- the probe used a read-only transaction ending in rollback;
- pre/post counts of `supplier_invoices`, `supplier_invoice_lines`,
  `supplier_invoice_receipt_allocations`, `gl_entries`, and `gl_entry_lines`
  were unchanged.

This smoke did not perform a browser-authenticated interactive React session and
did not press the final approve/post action. A real financial pilot therefore
remains a separate, explicitly authorized Production step.

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

The accepted first-slice sequence is now complete through the application
migration:

```text
D1–D7 design accepted
  → PR A / #186 merged
  → Migration 181 applied to Production
  → Production verification passed
  → #187 documentation reconciliation merged
  → #188 baseline cutoff 181 merged
  → matched AP gl_event_mappings configured and independently verified
  → PR B / #189 merged
  → PR C ratchet absorbed into #189
  → post-merge Production read-only smoke passed
```

Definition of done for the matched supplier-invoice first slice is therefore:

- D1–D7 remain accurately recorded;
- repository and Production ledger remain reconciled through Migration 181;
- baseline cutoff 181 is merged;
- required org-scoped matched AP mappings are active and postable;
- active UI reads candidates through the legal read RPC only;
- final matched write uses the canonical atomic RPC only;
- direct client financial write paths remain ratcheted closed;
- final-head and post-merge CI/Sonar gates are green;
- read-only Production smoke shows legal candidates and zero financial mutation.

A **controlled real financial pilot is not part of this documentation update**.
It remains a separately authorized Production write step. Merging this record does
not authorize that pilot or any future supplier-invoice lifecycle expansion.
