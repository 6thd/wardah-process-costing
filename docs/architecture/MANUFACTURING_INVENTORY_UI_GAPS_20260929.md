# Manufacturing + Inventory — Undiscovered UI/DB Gaps (2026-09-29)

**Anchor:** `main@3e76a799` (post M191/M192 Production docs #269)  
**Mode:** documentation / tracking only — **no code change, no migration, no Production/Staging action**  
**Method:** Bugbot-style review of manufacturing + inventory on `main` (empty feature diff; subsystem scan)  
**Parent reconciliation:** [`MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md`](./MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md)

> This document records gaps that are **not already owned** by open issues `#229`, `#230`, `#154`, `#157`, `#158`, `#160`, `#170`, `#234`, `#259`, `#260`, or by draft PRs `#279`, `#277`, `#272`, `#271`.  
> It authorizes nothing. Owner review decides whether each row becomes a GitHub Issue and/or a DB-first then UI PR pair.

---

## 1. Already tracked (do not re-file)

| Topic | Owner |
|---|---|
| Completion without legal FG / SLE; cost from all `material_consumption` incl. PENDING | #230 (+ PR #271 docs) |
| Consumption retry / lifecycle / idempotency | #229 (+ PR #279/#277 client) |
| Stock transfer: no atomic RPC; submit fail-closed | #160 (UI containment already on `main`) |
| Multi-warehouse physical count / `system_qty` | #259 |
| Process costing / `mo_material_issues` / `upsert_stage_cost` | #260 |
| Backflush retired; column default ≠ policy | #234 |
| `createOrder` legacy fallback (prod fail-closed) | #158 / PR-B |
| WO→MO trigger `42702` + completion bypass (X1) | #230 / #154 |
| Direct `products` / reservation mutation surfaces | #157 / #170 |
| M192 acceptance assertion gaps | #268 / PR #272 |

---

## 2. New findings — proposed Issues

GitHub Issues could not be filed from this agent session (integration write scope is PR-only).  
**Copy each block below into a new Issue** after owner triage. Suggested labels: `manufacturing`, `inventory`, `bug`, severity as noted.

### Issue A — Inventory UI stock truth (bins vs `products.stock_quantity`)

**Suggested title:** `inventory: UI stock truth must use bins / get_stock_balance, not products.stock_quantity`

**Severity:** P1  
**Surface:** UI (+ helper contracts)  
**Related but not owned by:** projection gate in 2026-09-25 reconciliation §4; #259 (physical count only)

**Problem:** Catalog KPIs, low/out-of-stock filters, stock-adjustment line seeding, and product search in Stock Transfer mix **`products.stock_quantity`** (derived projection) with **`bins.actual_qty`** (operational truth after M185–M192). Operators see conflicting available qty; adjustments can be drafted from the wrong baseline.

**Evidence (repository):**

- `src/features/inventory/index.tsx` — totals / low stock / create-item `stock_quantity` field  
- `src/features/inventory/helpers/stockAdjustmentHelpers.ts` — `current_qty: product.stock_quantity`  
- `src/features/inventory/components/StockTransfer.tsx` — search shows `product.stock_quantity`; `getAvailableQty` reads `bins`

**Acceptance sketch (owner to refine):**

1. Any warehouse-scoped qty in UI reads `bins` or `get_stock_balance` / equivalent RPC.  
2. Catalog “on hand” is either warehouse-sum of bins or explicitly labeled “projection (non-authoritative)”.  
3. Adjustment helpers never seed `current_qty` from `products.stock_quantity` alone.  
4. Creating a product does not accept a free-form opening `stock_quantity` without a canonical opening SLE/bin path.

**Out of scope here:** live data repair of existing projection drift (separate authorized reconciliation).

---

### Issue B — Sales delivery mutates projection / legacy `stock_moves`, not SLE/bin

**Suggested title:** `sales: delivery inventory path bypasses SLE/bin (products.stock_quantity + stock_moves)`

**Severity:** P1  
**Surface:** UI service + DB contract  
**Related but not owned by:** #157 (direct product mutation generally); #186 retired `stock_moves`

**Problem:** Live sales feature uses `enhanced-sales-service`, which checks and decrements **`products.stock_quantity`**, then attempts **`stock_moves` insert**. It does not call a canonical stock RPC and does not write `stock_ledger_entries` / update `bins`. After legal GR/MO movements, sales can desync projection vs bins or succeed with a warning while ledger truth is untouched.

**Evidence (repository):**

- `src/services/enhanced-sales-service.ts` — `checkStockAvailability`, `recordSalesInventoryMovement`  
- Consumer: `src/features/sales/index.tsx`

**Acceptance sketch:**

1. Production builds fail closed if no atomic sales-delivery / COGS stock RPC exists.  
2. Availability checks use warehouse bins (or RPC), not projection alone.  
3. No client write to `products.stock_quantity` or `stock_moves` for delivery.  
4. DB-first PR merges and applies before any UI that depends on the new RPC (repository-first / DB-first rule).

---

### Issue C — Warehouse deactivate/delete ignores live bin qty

**Suggested title:** `inventory: warehouse deactivate/delete must refuse non-zero bins, not SLE existence alone`

**Severity:** P2  
**Surface:** UI service  

**Problem:** `warehouse-service` blocks deactivate/delete only when a `stock_ledger_entries` row exists for the warehouse. A warehouse with positive **`bins.actual_qty`** and no (or filtered-away) SLE rows can be deactivated incorrectly.

**Evidence:** `src/services/warehouse-service.ts` (`deactivateWarehouse`, `deleteWarehouse`)

**Acceptance sketch:** Refuse when `SUM(bins.actual_qty) ≠ 0` (or any bin row with non-zero qty/value) for that warehouse; keep SLE check as additional signal if desired.

---

### Issue D — Stock Transfer org selection uses `.single()` on `user_organizations`

**Suggested title:** `inventory: Stock Transfer must use effective org context (FU-6), not user_organizations.single()`

**Severity:** P2  
**Surface:** UI  
**Related:** HR multi-org #188 / FU-6; transfer RPC remains #160

**Problem:** Draft save and list load resolve `org_id` via `user_organizations … .single()`. Multi-org members can fail or bind the wrong org. Stock Transfer submit remains correctly disabled (#160).

**Evidence:** `src/features/inventory/components/StockTransfer.tsx`

**Acceptance sketch:** Use `getEffectiveTenantId()` (or the same org channel as other inventory screens). No submit/RPC work in this issue.

---

### Issue E — Quarantine latent MES `consumeMaterial` / `useConsumeMaterial`

**Suggested title:** `manufacturing: quarantine mesService.consumeMaterial direct PENDING insert (latent #229 bypass)`

**Severity:** P2 (latent)  
**Surface:** dead UI path today; live service/hook  
**Related:** #229 contract forbids direct `material_consumption` writes

**Problem:** `mesService.consumeMaterial` inserts PENDING `material_consumption` with client cost and **no stock effect**. Hook `useConsumeMaterial` exists with **no `.tsx` caller**. Reconnecting the hook reopens the #229 bypass without a new migration.

**Evidence:**

- `src/services/manufacturing/mesService.ts` (`consumeMaterial`, `backflushMaterials`)  
- `src/hooks/manufacturing/useMES.ts` (`useConsumeMaterial`, `useBackflushMaterials`)

**Acceptance sketch:** Mark deprecated; throw / fail closed in production; route any future UI only through the canonical consumption RPC after #229 DB gates. Prefer deletion only if no external consumers.

---

### Issue F — Quarantine unused `modules/` browser SLE writers (GoodsReceiptController / StockLedgerService)

**Suggested title:** `inventory: quarantine modules StockLedgerService + GoodsReceiptController browser SLE/bin writers`

**Severity:** P2 (latent)  
**Surface:** unused by `features/purchasing` (live path is `purchasing-service` + `rpc_post_goods_receipt`)  
**Related:** M185 write closure

**Problem:** `StockLedgerService.createEntry` and `GoodsReceiptController` still implement client SLE insert + bin upsert + `products.stock_quantity` updates. Not wired from current purchasing UI, but remain importable and will hard-fail (`42501`) or confuse future wiring.

**Evidence:**

- `src/modules/inventory/StockLedgerService.ts`  
- `src/modules/purchasing/GoodsReceiptController.ts`  
- Live path: `src/services/purchasing-service.ts`

**Acceptance sketch:** Document as retired; CI snapshot/test asserting features do not import these writers; optional `@deprecated` + runtime throw in PROD.

---

## 3. Suggested follow-up PR shape (after Issues exist)

| Track | Order | Notes |
|---|---|---|
| A — UI stock truth | UI PR after contract note; no migration if read-only helper change | May need small read RPC later — then DB-first |
| B — Sales stock | **DB PR first** (atomic delivery RPC) → apply → verify → UI PR | Same discipline as GR/MO |
| C — Warehouse guard | Small UI PR | Safe containment |
| D — Transfer org | Small UI PR | Independent of #160 RPC |
| E — MES quarantine | Small UI/service PR | Align with #229; do not invent consumption |
| F — modules quarantine | Small cleanup/docs + CI assert | Do not delete history blindly |

Do **not** combine B’s UI with an unapplied migration. Do **not** “fix” completion/consumption here — those remain #230 / #229.

---

## 4. Explicit non-goals of this document

- No Production or Staging mutation  
- No migration authoring  
- No claim that Staging matches `main`  
- No re-opening of rejected “lock-order M192” claims  
- No duplicate Issues for rows in §1  

---

## 5. Review checklist for the owner

- [ ] File Issues A–F (or merge A+C+D into one inventory-UI epic if preferred)  
- [ ] Link each Issue back to this doc and to `MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md`  
- [ ] Decide whether B is owned by Sales or Inventory  
- [ ] Confirm E waits for #229 DB closure before any MES consume UI  
- [ ] Keep #279/#271 as the client tracks for #229/#230 — do not fork them into these Issues  
