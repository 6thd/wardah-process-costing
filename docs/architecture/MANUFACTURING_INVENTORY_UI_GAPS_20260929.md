# Manufacturing and inventory UI gaps — source review, 2026-09-29

**Anchor:** `main@3e76a799`

**Scope:** tracking only; no implementation, database change, Production or Staging readback

**Parent:** [Manufacturing/inventory reconciliation](./MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md)

This is a repository-source inventory, not proof that a particular stock mismatch
exists in Production. The three gaps below need owner triage after the current #229
client work. Do not file Issues or start implementation from this Draft document.

## 1. Confirmed source gaps for later triage

### A. Inventory UI mixes product projection with warehouse stock

**Candidate severity:** P2; raise priority if a real adjustment with a wrong
warehouse baseline is reproduced. **Owner overlap:** #157 owns direct product
write permissions; #259 owns the physical-count server snapshot. Neither
specifies these catalog and manual-adjustment UI reads.

- `src/features/inventory/index.tsx` calculates stock/value KPIs and low/out
  filters from `products.stock_quantity`, and offers an opening quantity when
  creating a product.
- `src/features/inventory/helpers/stockAdjustmentHelpers.ts` seeds
  `current_qty` from the product aggregate despite taking a `warehouseId`.
- `src/features/inventory/components/StockTransfer.tsx` displays the product
  aggregate in search results, while its add-item availability check reads
  `bins` for the selected warehouse.

**Acceptance to refine:** Warehouse-scoped availability and adjustment
`current_qty` come from the selected warehouse's bins or a reviewed read RPC.
Catalog totals have a defined relationship to bins and are labeled accurately.
An opening stock entry uses a canonical stock event, never a free-form product
field. Test a two-warehouse product where the aggregate differs from either
warehouse balance. Any change to the adjustment posting contract belongs with
the stock-adjustment workstream, not a display-only fix.

### C. Warehouse service reports success without verifying a row change

**Candidate severity:** P2. **Surface:** client service and future database
write contract.

`src/services/warehouse-service.ts` checks only whether a visible
`stock_ledger_entries` row exists, then sends direct UPDATE or DELETE on
`warehouses` and reports success when the request has no error. It never
checks that a row was changed. At the cutoff-189 baseline,
`warehouses` has RLS enabled and only a SELECT policy for `authenticated`;
an ordinary client UPDATE/DELETE can affect zero rows without an error.
`bins_warehouse_id_fkey` also blocks hard deletion while a bin row references
the warehouse. Thus this source review does **not** establish that an ordinary
client can actually deactivate or delete a stocked warehouse today.

**Acceptance to refine:** Distinguish denied/no-row writes from a real success
and show a truthful result. Before enabling an authorized deactivate/delete
path, put a transactional guard at the database boundary: nonzero bin quantity
**or value** must prevent deactivation/deletion, with org and concurrency
checks. An optional client precheck improves messaging but is not the
enforcement boundary. Test a bin with stock but no visible SLE and verify the
stored warehouse state after each attempt.

### D. Stock Transfer uses an arbitrary membership lookup

**Candidate severity:** P2. **Owner overlap:** #160 owns transfer mutation
permissions and a future posting RPC; this is the draft/list org selection.

`src/features/inventory/components/StockTransfer.tsx` reads
`user_organizations` with `.single()` for both list loading and draft save,
rather than the effective organization chosen by the user. Multiple membership
rows can make the lookup fail; the code then clears the list or declines the
draft. Submit remains disabled under #160.

**Acceptance to refine:** Derive the list and draft organization from the
effective tenant context, fail closed when it is unavailable, and verify the
selected warehouses belong to that organization. Test a user in two
organizations, switching between them, including a stale form. Keep transfer
posting with #160.

## 2. Claims removed from the original scan

- **Sales delivery (former B):** `DeliveryNoteForm` calls
  `createDeliveryNote`, which calls `rpc_post_delivery_note` first.
  M133/M191's RPC uses `wardah_apply_stock_outgoing` and records canonical
  stock effects; a missing RPC fails closed in Production. The
  `products.stock_quantity` + `stock_moves` fallback is reachable in
  development only. It is legacy code worth containing separately, but the
  former claim of a live Production P1 bypass was wrong. No new Issue proposed.
- **MES consumption (former E):** #229 and Draft PR #279 already own retirement
  of `mesService.consumeMaterial` and the old hooks. On `main` the unused
  method is still present; #279 makes it throw before any write. Do not file a
  duplicate Issue or mount this hook.
- **Legacy modules writers (former F):** `StockLedgerService` and
  `GoodsReceiptController` contain browser-side SLE/bin/product writers and
  remain exported, but no mounted purchasing feature calls them. The mounted
  path uses `purchasing-service` and `rpc_post_goods_receipt`. This is a
  latent cleanup candidate, not a demonstrated P2 live incident. Revisit
  after the current work, with an import inventory before assigning severity.

The original scan also cited #186 as an owner of retired `stock_moves`;
#186 is about supplier-invoice candidate reads and is unrelated.

## 3. Decision boundary

Keep this PR Draft for review. Defer new Issues and code PRs until the current
#229/#279 work is resolved. When triaged, separate read-only UI corrections
from any database mutation guard; use the repository-first, DB-first process
for the latter. Nothing here authorizes Production material-issue events,
changes to Staging, or closing #229/#160/#259.
