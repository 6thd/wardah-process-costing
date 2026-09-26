# Manufacturing + Inventory Contract Reconciliation — 2026-09-25

**Anchor:** `main@0761d567965e7977ea2702166143ea6c2f1dc1da` (merge of PR #241, Migration 191)
**Mode:** documentation, issue linkage, and non-executing RED evidence only
**Evidence:** [`docs/db/manufacturing-inventory-red-20260925/`](../db/manufacturing-inventory-red-20260925/README.md)
**Parallel workstream originally not touched:** PR #258 was developed separately from this workstream and has since merged to `main` as `3c43f3d4`; this branch still does not modify its performance files

> This document re-derives every finding from two independent reviews plus a third
> (Genspark) review. It uses repository bytes and a disposable PostgreSQL 17.11 database
> only. It authorizes nothing: no merge, no Ready transition, no Production or
> Staging access, no migration apply, no data repair. It replaces none of the
> historical snapshots it references.

---

## 1. Repository and workflow state at the anchor (verified on GitHub)

| Item | State |
|---|---|
| PR #246 (Scanner v1 hardening) | **Merged** into the #241 branch at 2026-09-25T10:04Z (`a3ab0cb`). It is historical, not an open track. |
| PR #257 (sync main into #241) | Merged 2026-09-25T10:40Z |
| PR #241 (Migration 191) | **Merged to `main`** at 2026-09-25T11:43Z as `0761d567`. Migration 191 is now on `main`. |
| Migration 190 SHA256 | `0fa0134569b09d88bc91aafc2bc6424947c498626f9b2726e6e706d1bf38ba2f` (unchanged by this work) |
| Migration 191 SHA256 | `637a81caeaebea60693476222611b373dc1e738cd6b10c634bf4c236227f3f40` (unchanged by this work) |
| PR #258 | **Merged to `main`** as `3c43f3d4`. Authoritative benchmark implementation `260b540d`, run `36191681776`, artifact `10888402016`; final independent closure found no P1/P2 and §8 is technically complete for owner review. Production/Staging rollout is not implied. |
| Repository latest migration | 191 |

**Repository presence ≠ Production application.** This workstream had no Production
access and makes no Production claim. The `CLAUDE.md` DATABASE_STATE block is still a
generated 2026-09-05 snapshot at cutoff 189.

## 2. Deployment rule for M190 / M191 (no apply is authorized here)

An external review asserted that "Production ends at 189, therefore apply 190 then
191". That is **not** copied here as current truth. The rule is:

1. In a **separately authorized, read-only** session, read `supabase_migrations.schema_migrations`.
2. Verify every canonical predecessor through cutoff 189 exactly as the ledger guard
   (`scripts/ci/validate_migration_ledger.py` plus `migration_ledger_exceptions.json`) requires.
3. Apply **only the missing** canonical migrations, in order, each from `main` bytes.
   Never re-apply a chain such as `185 → 186 → 187 → 190 → 191` from memory.
4. **M191 precondition:** `190_material_consumption_authorization_boundary` is present
   **exactly once** in the live ledger **and** its postflight passes. M191's own
   preflight checks the 190 permission contract, but that check does not replace the
   ledger readback.
5. **M191 is never applied first.** The #258 repository performance gate is now technically complete, but any live rollout still requires a fresh live-ledger/readback preflight and separate explicit owner authorization.
6. Run the projection readback gate in §4 before any rollout decision.

## 3. Staging trust status: **UNVERIFIED / REBUILD RECOMMENDED**

Two external reviewers reported possible Staging drift: M191 applied before the
canonical merge, non-canonical migration names, `reconcile_*` ledger entries with no
repository file, and a function body redefined outside migration history. This
workstream had no Staging access and **did not verify** any of it. Neither the reports
nor their negation are treated as current truth.

Staging becomes trusted again only when all of the following hold:

- the project is identified by its immutable **project ref**, never by display name;
- its migration ledger is captured;
- every ledger row after the canonical cutoff matches a repository file exactly;
- there are no unknown `reconcile_*` (or otherwise non-canonical) entries;
- every migration name is canonical (file stem);
- function fingerprints (`pg_get_functiondef` hashes) match the repository chain;
- reset/rebuild provenance is documented;
- the E2E suite is green from canonical `main`.

Preferred remediation, after **separate** authorization: rebuild Staging from canonical
`main` rather than legitimizing unknown drift. No rebuild is performed here.

## 4. Legacy product-projection rollout gate (read-only)

An external reviewer reported a product with `products.stock_quantity = 3500` and no
supporting bin. This is **not** verified and **not** mutated here.

The gate matters because post-M191 canonical writers re-derive the projection from bins.
Probe A proves that the **first** canonical movement of a product silently replaces its
projection with its bin sum. Without a gate, the next goods receipt or consumption
becomes an accidental, unaudited reconciliation.

Before any Production M190/M191 rollout, run
[`R_projection_readback.sql`](../db/manufacturing-inventory-red-20260925/R_projection_readback.sql)
(a READ ONLY transaction) in a separately authorized session. Classify every row as:

- expected historical opening balance, needing a canonical opening SLE/bin;
- stale projection;
- unsupported legacy data;
- unresolved.

Any correction is a separately authorized, auditable data migration or reconciliation.
It is never a side effect of a stock movement.

## 5. Findings — verdicts

`CONFIRMED` = reproduced on the disposable DB (or proven from repository bytes where no
DB behavior applies). `NOT REPRODUCED` = the specific claim does not hold. `ALREADY
TRACKED` = true, and an existing issue owns it. `CONTRACT GAP` = no defined contract
exists to be violated; the gap itself is the defect.

| ID | Claim | Verdict | Owner |
|---|---|---|---|
| A | Completion creates no legal FG | **CONFIRMED.** Projection +5, 0 bins, 0 SLE. One canonical +1 movement erases the 5 units. | #230 |
| B | Completion cost includes non-canonical/pending rows | **CONFIRMED.** 10 canonical + 40 PENDING → 50. A direct `POSTED` insert is also accepted, so a status filter is insufficient. | #230 (+ #229, #154 direct surface) |
| C | Partial consumption retry/lifecycle | **CONFIRMED.** Replay duplicates SLE/bin/value/reservation/WIP. Consumption is accepted on cancelled, done, draft and on-hold MOs. An explicit `work_order_id` skips the WO status filter. | #229 |
| D | Completion / MO authorization | **CONFIRMED.** A read-only member reaches `done` via direct UPDATE, `rpc_transition_mo_status` and `rpc_complete_manufacturing_order`. `search_path` has no `pg_temp`. | #154, #158, #230 |
| E | Multi-warehouse physical count | **CONTRACT GAP confirmed**, **sourcing claim NOT REPRODUCED.** No writer of `system_qty` exists; the service flow is schema-broken; the adjustment RPC trusts client deltas (W1 60→20). | **#259 (new)**; auth stays #170/#153 |
| F | Stock Transfer UI uses closed SLE path | **CONFIRMED.** `42501` on SLE INSERT. No transfer RPC. The header can be set `SUBMITTED` with no stock effect. | #160 (+ PR-B containment) |
| G | Direct product mutation | **ALREADY TRACKED, still true.** A read-only member rewrites `cost_price`, `valuation_method` and `stock_queue`, and the projection moves off bin truth. | #157 |
| H | Reservation direct mutation | **ALREADY TRACKED, still true.** A read-only member rewrites reservation quantity and status. | #170 (vs #229, see §7) |
| I | Process costing / stage costing authority | **CONFIRMED and worse than reported.** The client formula and direct UPSERT are live, *and* the service writes non-existent columns and tables. The real `upsert_stage_cost` aborts with `42702`; the report aborts on a canonical row. | **#260 (new)** / MFG-P1 |
| J | `createOrder` legacy fallback | **CONFIRMED** (repository bytes). A missing RPC falls back to a browser availability check + direct MO insert + separate reservation, whose failure is swallowed. An RPC response without success and without error also falls through. | PR-B containment; #158 |
| K | Backflush | **CONFIRMED quarantined.** After the M190 guard, `backflush_materials` raises `0A000 BACKFLUSH_RETIRED_PENDING_CANONICAL_REIMPLEMENTATION`. The legacy `auto_backflush_materials()` trigger function still exists (with its retired `bom_id` body), but no trigger is attached to it and clients cannot execute it. No `trigger_auto_backflush` object exists. `useBackflushMaterials` has no UI caller, so no user-facing message change is needed. The legacy column default `manufacturing_orders.auto_backflush = true` is **not** policy: the contract default stays `disabled`. | #234 |
| DOMAIN-1 | `ProcessStage.fromRawData` hydrates inconsistent data | **CONFIRMED.** `unitsStarted=100, unitsCompleted=120` hydrates, and the failure is deferred until `unitsInProgress` is read. `completionPercentage` is not bounds-checked. | PR-B |
| DOMAIN-2 | `CalculateProcessCost` uses `quantity \|\| 1` | **CONFIRMED.** `0`, `NaN`, `null` and `undefined` all silently become 1. An existing test *asserts* the defect. | PR-B |
| TEST-1 | `process-costing.test.ts` tests a local fake | **CONFIRMED.** It defines `ProcessCostCalculator` inside the test and imports no production code. | PR-B |
| DOCS-1 | `PROCESS_COSTING_PLAN_REVIEW.md` says `stage_wip_log` does not exist | **CONFIRMED stale.** The table exists in the baseline and is written by `rpc_consume_reserved_materials_v2`. | PR-A (dated correction) |
| DOCS-2 | `SECURITY_DEFINER_AUDIT.md` shows pre-120 category C | **CONFIRMED historical.** It is a 2026-07-16 live snapshot. | PR-A (marked superseded) |
| M192 | "Completion locks products then calls `wardah_apply_stock_outgoing`; needs a lock-order M192" | **NOT REPRODUCED / REJECTED** (see §6) | — |

Additional discoveries made while re-deriving the findings:

| ID | Discovery | Owner |
|---|---|---|
| X1 | `update_mo_status_from_work_orders()` (AFTER UPDATE OF status on `work_orders`) fails on **every** work-order status change with `42702 column reference "completed_quantity" is ambiguous`. It also writes `manufacturing_orders.actual_end_date`, a column that does not exist. So `start_operation` / `complete_operation` abort for every caller. **Its intended behavior is a completion bypass:** it sets the MO to `COMPLETED` when all WOs complete, with no FG, cost or GL. It must **not** be "fixed" by disambiguating the column. The terminal step belongs to the #230 orchestrator. | #230 (terminal boundary) + #154 (MES) |
| X2 | `rpc_create_mo_with_reservation`, `rpc_manual_stock_movement_v2` and `rpc_transition_mo_status` are membership-only (no exact permission). | #158 / #153 |
| X3 | The adjustment approval gate: no approval RPC exists, and `requires_approval` is client-supplied to `rpc_create_stock_adjustment`. | #153 |
| X4 | `src/features/inventory/components/__tests__/stock-transfer.test.tsx` also tests local helper copies rather than the component. It is noted only, not changed. | quality follow-up |

## 6. Rejected claim — no lock-order Migration 192

The third review claimed that `rpc_complete_manufacturing_order` locks `products` and
then calls `wardah_apply_stock_outgoing`, so a new M192 must normalize lock order.

Re-read of the exact bytes: the live body is defined in
`sql/migrations/186_stock_moves_contract_repair.sql` lines 681–821 and is not redefined
by 191. It locks the MO (`FOR UPDATE`), then one finished product (`FOR UPDATE`),
updates `products.stock_quantity/cost_price`, updates the MO and calls
`rpc_post_event_journal` twice. Its `prosrc` contains **no** `wardah_apply_stock`, no
`bins` and no `stock_ledger_entries`. The `wardah_apply_stock_outgoing` reference at
line 850 is Migration 186's **postflight introspection**, not a call.

Therefore: **no M192 is created, and M191 is not modified.** Any future lock-order
claim needs a concrete call graph plus an isolated concurrent reproducer first. The
real completion defect is #230: no canonical FG receipt, and an incomplete
cross-domain contract. When #230 adds a canonical FG receipt, that receipt must enter
through the M191 products-first prefix like every other stock writer.

## 7. #229 vs #170 (and #157) — ownership boundary

- **#229** owns retry, lifecycle and idempotency of the **canonical** consumption RPC
  (`rpc_consume_reserved_materials_v2` and its successors).
- **#170** owns the **direct-table** mutation surface of `material_reservations` and
  `physical_count_*` (who may write rows at all).
- **#157** owns direct `products` mutation.

Neither track may be solved by weakening or bypassing the other. #229's
event-identity guarantee is meaningless while #170's surface lets a member rewrite
`quantity_consumed` directly. #170's permission contract must not be "satisfied" by
routing clients through a non-idempotent RPC. The integrated manufacturing simulation
needs both closed.

## 8. Delivery plan

| PR | Scope | Status |
|---|---|---|
| **PR-A** | This document, the evidence directory, dated reconciliation blocks in the current docs, `CLAUDE.md` prose outside the generated markers, issue linkage | this workstream, Draft |
| **PR-B** | Safe containment only: `createOrder` fails closed in production builds; Stock Transfer submit is disabled and linked to #160; the domain invariants DOMAIN-1/2; TEST-1 | this workstream, Draft, separate branch |
| C1 | #229 retry/lifecycle/idempotency core (DB-first) | not started; needs contract approval |
| C2 | #234 backflush adapter onto C1 | after C1 |
| C3 | #260 / MFG-P1 costing engine + report repair (DB-first), then consumer | not started; blocks C4 costing |
| C4 | #230 authoritative completion (includes the X1 terminal boundary) | after C1, C3 and owner decisions |
| C5 | #160 atomic stock transfer RPC | not started |
| C6 | #259 warehouse-local physical count | not started; needs concurrency policy |
| C7 | RBAC #154 / #158 / #157 / #170 as separately reviewed boundaries | not started |

No C-track starts without contract review and owner authorization. Each C-track turns
its RED probe GREEN and re-runs the existing M190/M191 acceptance suites.

## 9. Owner decisions required

1. **Completion permission:** is `manufacturing.orders.update` semantically sufficient
   for terminal completion, or is a first-class completion action required? No key is
   invented here. `manufacturing.orders.approve` exists, but its semantics for
   completion are unreviewed.
2. **FG destination warehouse contract:** `manufacturing_orders` has no destination
   warehouse column today. Choose where it comes from (MO, product default, routing)
   and how it is validated same-org.
3. **Draft vs Posted manufacturing GL:** the current completion writes **draft**
   entries (`auto_post=false`). Choose Draft-at-completion or Posted-in-transaction,
   and choose the material GL timing (per consumption event vs at completion).
4. **Process-costing authority:** incremental vs cumulative `stage_costs`, the
   authoritative labor and overhead input tables, and WA vs FIFO default.
5. **Physical-count concurrency policy:** snapshot + movement reconciliation, a freeze
   window, or another reviewed method.
6. **Consumption lifecycle matrix:** consumption is certainly forbidden in `cancelled`
   and `done`. `draft`, `pending`, `confirmed`, `on_hold` and `quality_check` need an
   explicit decision.
7. **Partial completion:** multiple FG receipt events per MO while it stays open, or a
   single terminal completion only.
