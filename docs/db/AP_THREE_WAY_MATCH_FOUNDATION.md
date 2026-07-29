# AP Three-Way Match Foundation

**Tracking:** #46  
**Phase:** Supplier Invoice and PO ↔ GRN ↔ Invoice matching  
**Status:** Architecture decision record — no Production migration or behavior change

> **This document is a decision record, not an implementation branch.**
> Implementation starts from a **new branch cut from the latest `main`**. Do not
> build on top of this branch's history: it predates Migration 148 and the
> System Reference Data Baseline, and carrying that history forward would carry
> its assumptions with it.

## 1. Dependency and migration gate

This phase depends on the completed GRN partial-receipt contract in **Migration 148**.

### Resolved state

The gate this section originally described is now satisfied. Migration 148 is
merged and applied, and the baseline work that followed it has closed:

| Fact | State |
|---|---|
| Latest repository migration | **148** (`148_uom_purchase_receipt_snapshots`) |
| Live Supabase ledger | applied through **148** |
| Baseline cutoff | **148** |
| System Reference Data Baseline | closed — the second baseline layer landed in **#62**, and the first generated pair in **#63** |
| Next legal migration number | **149**, allocated from the current `main` ledger |

The original text of this section recorded that `main` and the live ledger both
ended at 147 and that Migration 148 was not yet visible remotely. That is no
longer true, and the instruction it produced — "rebase this branch onto the
commit that contains Migration 148" — has been superseded: start a new branch
instead, for the reason stated in the note above.

### What the gate still means

Migration 149 must be allocated from the ledger of the `main` that is current
**at implementation time**, not from any number assumed here. The gate continues
to prevent:

- a broken migration chain;
- duplicate migration numbers;
- assumptions about GRN statuses or columns that differ from what 148 actually defines;
- implementing invoice matching against the obsolete receipt path.

### Verified against Migration 148

The following were checked against `sql/migrations/148_uom_purchase_receipt_snapshots.sql`
and the services built on it, and the contracts below are written to match:

- **Receivable purchase-order states** are `approved` and `partially_received`.
  Section 5 refers to "a receivable PO state defined by Migration 148"; these are
  those states.
- **Quality-split receipt quantities** exist as `accepted_quantity` /
  `rejected_quantity` with base-unit counterparts `accepted_qty_base` /
  `rejected_qty_base`, alongside `received_quantity`, `received_qty_entered` and
  `received_qty_base`. Section 7's "accepted, uninvoiced" balance is derived from
  the accepted columns, never from `received_*`.
- **Snapshot naming** — 148 established `conversion_factor_snapshot` and an
  atomic PO snapshot contract. Section 6 reuses that name deliberately rather
  than inventing a parallel one.
- **`idempotency_key`** already exists in the 148 contract; section 8 extends the
  same concept to the invoice header rather than introducing a new mechanism.
- **No cumulative invoiced balance exists on receipt lines yet.** `invoiced_quantity`
  is present in the generated types only on `delivery_note_lines`, which is the
  sales side. The choice in section 6 between a locked cumulative column on
  `goods_receipt_lines` and a locked aggregate over immutable
  `supplier_invoice_lines` therefore remains genuinely open, and must be decided
  during implementation.

## 2. Current-state findings

The existing supplier-invoice path is not a legal posting boundary:

1. The UI inserts the invoice header, invoice lines, PO status, and GL records through separate client operations.
2. A failure after the header insert can leave a partial invoice.
3. GL creation catches errors without failing the invoice transaction.
4. `already_invoiced` is currently initialized to zero instead of being derived from persisted invoice lines.
5. Purchase-order selection currently includes `draft` orders.
6. No server-side line contract prevents invoicing more than the accepted GRN quantity.
7. No immutable PO/GRN UoM snapshot is authoritative during supplier invoicing.
8. No tenant/vendor-level duplicate supplier invoice-number guard is defined.
9. There is no concurrency lock preventing two sessions from consuming the same remaining GRN quantity.

The next implementation must replace this path for PO-backed invoices rather than adding more client-side validation around it.

## 3. Accounting boundary

### Goods receipt

The receipt stage recognizes inventory and the GRNI liability:

```text
Dr Inventory
    Cr Goods Received Not Invoiced (GRNI)
```

### Matched supplier invoice

The invoice stage clears GRNI, recognizes recoverable input VAT, and creates the supplier payable:

```text
Dr GRNI
Dr Input VAT
    Cr Accounts Payable
```

The existing two-line `rpc_post_event_journal` abstraction is not sufficient for this three-leg posting. The implementation must use the canonical journal-entry RPC, or add a dedicated guarded multi-line accounting RPC. Missing account mappings must fail the entire transaction; accounting errors must never be logged and ignored.

A price variance must not be silently buried in Inventory, GRNI, or Accounts Payable. Until a PPV policy, tolerance, approval role, and account mapping are approved, the first posting slice remains **zero-tolerance** and does not post price exceptions.

## 4. Source-of-truth hierarchy

For a PO-backed invoice, the legal source hierarchy is:

1. **Purchase-order line snapshot** — ordered commercial UoM, conversion factor, and agreed commercial price.
2. **Goods-receipt line snapshot** — accepted commercial/base quantity received under that PO snapshot.
3. **Supplier invoice input** — vendor document number, dates, tax data, and quantity requested for invoicing.
4. **Current UoM catalog** — display/reference only; it must not reinterpret historical PO or GRN facts.

No matching RPC may call the current conversion resolver to recalculate an existing PO/GRN conversion.

## 5. First implementation slice

### Read RPC

Proposed contract:

```text
rpc_list_supplier_invoice_candidates(
  p_org_id uuid,
  p_vendor_id uuid default null
) returns jsonb
```

It must return only lines that are:

- inside the explicitly selected organization;
- linked to the selected vendor;
- from a receivable PO state defined by Migration 148;
- from a posted/confirmed GRN state defined by Migration 148;
- quality accepted;
- not fully invoiced;
- backed by complete PO and GRN UoM snapshots.

Each candidate should include:

- PO and GRN identifiers/numbers;
- PO line and GRN line identifiers;
- product identity;
- commercial UoM and symbol;
- conversion-factor snapshot;
- PO commercial/base quantity;
- accepted GRN commercial/base quantity;
- already invoiced base quantity;
- remaining invoiceable commercial/base quantity;
- PO commercial/base unit price;
- discount and tax snapshot required for matching.

### Atomic creation RPC

Proposed contract:

```text
rpc_create_matched_supplier_invoice(p_payload jsonb) returns jsonb
```

One PostgreSQL transaction must:

1. Resolve the explicit organization and assert membership.
2. Validate vendor ownership and invoice dates.
3. Enforce a normalized unique vendor invoice number within `org_id + vendor_id`.
4. Validate and lock all referenced PO, PO-line, GRN, and GRN-line rows.
5. Re-read remaining invoiceable quantity under the lock.
6. Reject mixed organizations, vendors, purchase orders, products, or snapshot identities.
7. Reject quantity above the accepted, uninvoiced GRN balance.
8. Match invoice price against the PO price snapshot with zero tolerance in the first slice.
9. Insert the invoice header and all lines.
10. Persist line-level match evidence and variance values.
11. update cumulative invoiced quantities and document statuses.
12. Create the balanced journal entry through the canonical accounting path.
13. Return one deterministic result.

Any failure must roll back every step.

## 6. Proposed additive persistence

Exact columns must be finalized only after inspecting Migration 148. The likely additive model is:

### `supplier_invoices`

- `idempotency_key text`
- `request_hash text`
- `match_status text`
- `journal_entry_id uuid`
- `matched_at timestamptz`
- `matched_by uuid`

### `supplier_invoice_lines`

- `purchase_order_line_id uuid`
- existing `goods_receipt_line_id` becomes mandatory for the matched path
- `uom_id uuid`
- `qty_entered numeric`
- `conversion_factor_snapshot numeric`
- `unit_cost_entered numeric`
- `po_unit_price_snapshot numeric`
- `quantity_variance numeric`
- `price_variance numeric`
- `match_status text`

### Receipt invoicing balance

Use one of these only after evaluating Migration 148:

- a locked cumulative `invoiced_quantity` on `goods_receipt_lines`; or
- a locked aggregate derived from immutable `supplier_invoice_lines`.

The chosen approach must support concurrency-safe remaining-quantity validation and cancellation/reversal later.

## 7. Matching rules

The first slice posts only when all are true:

- organization, vendor, PO, GRN, line, and product identities agree;
- GRN line is accepted and legally posted;
- invoice quantity is positive and does not exceed the remaining accepted quantity;
- invoice commercial UoM equals the source snapshot UoM;
- conversion factor equals the immutable source snapshot;
- commercial unit price equals the PO snapshot price;
- period is open;
- required GRNI, input VAT, and AP account mappings exist;
- the request is new or an exact idempotent replay.

Server error codes must distinguish at least:

- `AP_PO_NOT_INVOICEABLE`
- `AP_GRN_NOT_INVOICEABLE`
- `AP_GRN_LINE_NOT_ACCEPTED`
- `AP_VENDOR_MISMATCH`
- `AP_PRODUCT_MISMATCH`
- `AP_UOM_SNAPSHOT_MISMATCH`
- `AP_QUANTITY_EXCEEDS_RECEIPT`
- `AP_PRICE_VARIANCE_REQUIRES_APPROVAL`
- `AP_DUPLICATE_VENDOR_INVOICE_NUMBER`
- `AP_IDEMPOTENCY_KEY_REUSED`
- `AP_ACCOUNT_MAPPING_MISSING`

## 8. Idempotency and concurrency

- Store an idempotency key and a canonical request hash on the invoice header.
- Replaying the same key and hash returns the original invoice and journal result.
- Reusing the same key with a different hash fails.
- Lock every consumed GRN line with `FOR UPDATE` before calculating remaining quantity.
- Two concurrent sessions attempting to consume the final balance must result in exactly one successful invoice.
- Number generation must use an advisory transaction lock or an existing canonical document-number generator.

## 9. Security

All new RPCs must:

- pin `search_path`;
- resolve an explicit organization;
- call the Wardah membership guard;
- validate every referenced row against that organization;
- revoke `EXECUTE` from `PUBLIC` and `anon`;
- grant only the intended authenticated role;
- avoid exposing internal helper functions to clients.

RLS remains defense in depth and is not a substitute for explicit tenant predicates inside `SECURITY DEFINER` functions.

## 10. Acceptance matrix

The migration-specific acceptance suite must prove:

1. First partial invoice succeeds.
2. Second invoice completes the same GRN line.
3. Over-invoicing fails with no side effects.
4. Cross-organization, cross-vendor, cross-PO, and cross-product references fail.
5. Draft/unposted PO or GRN sources fail.
6. Rejected-quality receipt quantity cannot be invoiced.
7. Duplicate supplier invoice number for the same organization/vendor fails.
8. The same supplier number for a different vendor follows the approved uniqueness policy.
9. Two concurrent attempts against the final balance produce one winner.
10. Exact idempotent replay creates no duplicate invoice, lines, status update, or journal.
11. Reused idempotency key with changed payload fails.
12. Missing accounting mapping rolls back the complete invoice.
13. Changing the current UoM conversion after PO/GRN creation does not change matching results.
14. Header totals equal persisted rounded line totals.
15. `anon` and `PUBLIC` have no execution privilege.

## 11. Delivery sequence

Migration 148 is merged and applied, so this sequence is unblocked. It begins on
a **new branch cut from the latest `main`** — not on this document's branch.

1. Cut a new branch from the latest `main`.
2. Inspect the final GRN RPC, statuses, snapshots, and acceptance fixtures as they
   stand in that `main`, and reconcile any drift from section 1's verified list.
3. Allocate the next legal migration number from the live ledger at that moment.
4. Add the read RPC and atomic matched-invoice RPC.
5. Generate database types.
6. Add a typed TypeScript service and legal Arabic error mapping.
7. Replace the PO-backed branch of `SupplierInvoiceForm` with RPC-backed candidate selection.
8. Add dedicated Fresh DB acceptance and workflow gates.
9. Add a deployment runbook.
10. Pilot through the UI before any Production rollout.

The database migration and the UI that depends on it are separate pull requests,
merged and applied in that order. `CLAUDE.md` states the rule and records the gap
that produced it.

## 12. Explicitly outside the first slice

- direct invoices without PO/GRN;
- credit notes and supplier returns;
- cancellation/reversal workflow;
- landed cost allocation;
- configurable quantity/price tolerances;
- PPV posting and approval;
- multi-currency matching;
- Production migration application.
