# F2 / Migration 191 — implementation evidence gates

**Status:** companion contract for the design in `F2_STOCK_BIN_RACE_FIX_DESIGN.md`.
**Scope:** design/acceptance only. No SQL is implemented by this file.
**Authority:** the main F2 design remains the source of truth for lock order, function bodies, behavior preservation, and scope. If this checklist ever conflicts with that design, the main design wins and this file must be corrected before implementation.
**Backlink:** the main design links to this companion from its status block and from §9's implementation gate, and records this file's addition as its twenty-third correction. The link is deliberately two-way — a reader entering through either document must be able to find the other.

This companion captures the implementation-quality recommendations that are useful for F2 without changing the architecture or broadening the fix. It deliberately does **not** convert PR #236 into an implementation PR.

---

## 1. What this companion adds

The main design already defines the concurrency architecture, thirteen-object scope, deterministic RED/GREEN mechanisms, ACL carry-forward, rollback sources, and reject-list. This file adds five evidence disciplines for the future Migration 191 implementation PR:

1. valuation/queue integrity assertions beyond quantity-only checks;
2. exact security/ACL evidence by function signature;
3. a staging rollback rehearsal, not only rollback prose;
4. measured throughput/lock-wait characterization;
5. a compact source-of-truth matrix so every `CREATE OR REPLACE` body is carried forward from the correct live predecessor.

None of these changes the chosen `products FOR NO KEY UPDATE -> bins` architecture.

---

## 2. Explicit non-goals

The implementation PR must **not** use these gates as an excuse to widen F2.

Out of scope remains:

- equivalent units, WIP valuation, process-stage allocation, conversion cost, or variance logic;
- redesign of the manufacturing completion contract;
- changing the current projection asymmetry merely for symmetry: incoming continues to own `products.stock_quantity` and `cost_price`; outgoing also owns `products.stock_value` exactly as the main design specifies;
- historical SLE repair or global voucher uniqueness changes;
- closing unrelated direct-client write surfaces;
- changing `release_expired_reservations` semantics beyond the ordered-lock/frozen-snapshot change already specified;
- Production application as part of PR #236.

A performance result also cannot justify weakening serialization, dropping a deterministic lock, or changing isolation semantics inside M191. Any alternative architecture would require a separate design decision.

---

## 3. Source-of-truth carry-forward matrix

Before implementation, re-check `main` and update this table if any live body moved. Do not copy from this table blindly if `main` changed.

| # | Object | Pre-191 source body | M191 change boundary |
|---:|---|---|---|
| 1 | `wardah_apply_stock_incoming(...9 args...)` | Migration 97 | Fix A + Fix B + products-first prefix; preserve valuation and queue behavior |
| 2 | `wardah_apply_stock_incoming(...10 args...)` | Migration 187 | Fix A + Fix B + products-first prefix; preserve source-line contract |
| 3 | `wardah_apply_stock_outgoing(...8 args...)` | Migration 186 | lock-order prefix only |
| 4 | `wardah_apply_stock_outgoing(...9 args...)` | Migration 187 | lock-order prefix only; preserve source-line contract |
| 5 | `rpc_cancel_stock_adjustment(uuid,text)` | Migration 124 | Fix C lock order only |
| 6 | `rpc_manual_stock_movement_v2(jsonb)` | Migration 134 | Fix D lock order only |
| 7 | `rpc_post_goods_receipt(jsonb)` | Migration 177 | Fix E whole-call prelock only; preserve sequential line validation/error order |
| 8 | `rpc_post_delivery_note(jsonb)` | Migration 133 | Fix E whole-call prelock only; preserve fresh per-occurrence business-state reads |
| 9 | `rpc_submit_stock_adjustment(uuid)` | Migration 187 | Fix E whole-call prelock only |
| 10 | `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` | Migration 190 | Fix E reservation superset/product prelock only; carry M190 authorization unchanged |
| 11 | `release_expired_reservations(uuid)` | Migration 61 + current search-path hardening | Fix F ordered reservation lock only |
| 12 | `rpc_create_mo_with_reservation(jsonb,jsonb,uuid)` | Migration 186 | Fix G complete-product prefix before the first `bins` lock only; preserve availability semantics, `wardah_resolve_product_id` resolution, MO-creation and reservation-insert placement, and the existing per-product `bins ORDER BY warehouse_id,id FOR UPDATE`. **Client-facing RPC — keep `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`, and the `authenticated` + `service_role` grants; do not apply the stock-helper `service_role`-only form** |
| 13 | `wardah_lock_products_for_stock_write(uuid,uuid[])` | new in M191 | internal helper; deterministic ordered `FOR NO KEY UPDATE`; no client grant |

Implementation preflight must still rerun the writer/caller/**bins same-table**
sweeps required by the main design. This matrix is a carry-forward aid, not a
substitute for those sweeps. Item 12's predecessor is Migration 186, the same
file as item 3; rollback that restores only one of 186's two bodies is an
unreviewed third state.

---

## 4. Valuation and queue integrity gate

The GREEN suite must not declare success from final quantities alone. Every scenario that mutates stock must assert the pieces of the valuation contract that the touched path owns.

### 4.1 Bin assertions

For the affected `(product_id, warehouse_id)` rows, assert as applicable:

- `actual_qty`;
- `stock_value`;
- `valuation_rate`;
- `stock_queue`.

For FIFO/LIFO, queue assertions must prove the queue was re-derived from the **locked current snapshot plus the current movement**, not patched by scalar arithmetic. At minimum:

- queue layer quantity totals reconcile to the bin quantity represented by the queue contract;
- no layer is silently lost, duplicated, or overwritten by the losing concurrent writer;
- outgoing consumption removes the correct layers/order under the existing FIFO/LIFO rules;
- the post-race queue is the same result as the equivalent legal serial execution order.

### 4.2 SLE assertions

For each deterministic race/control, assert the relevant ledger fields, including:

- movement quantity and sign;
- stock value / valuation rate where the live contract records them;
- `qty_after_transaction` continuity for the tested key;
- COGS/value on outgoing paths where already part of the function contract;
- `source_line_id` behavior on the source-line-aware paths: incoming 10-arg and outgoing 9-arg. Migration 187 added the source-line contract to both, and their arities differ, so evidence must be captured per signature — a gate scoped to one shared argument count would test incoming and silently skip outgoing.

The SLE remains ledger truth; GREEN must never be inferred only from `bins`/`products` projections.

### 4.3 Product projection assertions

After both transactions commit, run a **fresh** reconciliation query, not a value cached by either transaction:

- `products.stock_quantity = SUM(bins.actual_qty)` for the product;
- `products.cost_price` equals the existing weighted/valuation projection defined by the live helper behavior;
- assert `products.stock_value` only on paths where the current contract already updates it. Do **not** turn an incoming-only test into a requirement to add an incoming `products.stock_value` write.

### 4.4 Valuation-method coverage

The implementation GREEN suite must include:

- weighted-average coverage for the RED-A and RED-B numeric proofs;
- at least one forced-concurrency FIFO case that exercises `stock_queue`;
- at least one forced-concurrency LIFO case that exercises `stock_queue`.

The FIFO/LIFO cases do not replace the frozen RED-A/RED-B numbers; they add evidence that fixing scalar quantities did not corrupt queue semantics.

---

## 5. Reconciliation gate

Every stock-mutating GREEN scenario must finish with an invariant block after all participating transactions have committed.

Required checks, scoped to the fixture's organization/product/warehouse/voucher set:

1. no unexpected negative quantity unless the scenario's existing business rule explicitly permits it;
2. product quantity equals the sum of its bins;
3. bin quantities/values match the movements that actually committed;
4. SLE quantity/value totals match the same committed movements;
5. FIFO/LIFO queue totals/order reconcile to the final bin state when that valuation method is under test;
6. a business-rule failure (`BIN_NOT_FOUND`, `LATER_STOCK_MOVEMENT_EXISTS`, `ACTIVE_RESERVATION_NOT_FOUND`, `OVER_DELIVERY`, etc.) leaves no partial stock/SLE/projection effects.

This invariant block is mandatory even when the primary purpose of the test is "no deadlock". Deadlock freedom without state reconciliation is not GREEN.

---

## 6. Exact ACL / security evidence gate

The implementation PR must save machine-readable or plainly copyable postflight evidence for exact signatures, not function names alone.

### 6.1 Four stock-write helpers

For each exact overload signature, assert:

| Role | Expected EXECUTE |
|---|---:|
| `PUBLIC` | false |
| `anon` | false |
| `authenticated` | false |
| `service_role` | true |

The migration must explicitly re-issue the revoke/grant contract before this postflight; inheritance from the pre-migration ACL is not accepted as evidence.

### 6.2 New internal helper

For `wardah_lock_products_for_stock_write(uuid,uuid[])` assert:

- no `PUBLIC`, `anon`, or `authenticated` execute privilege;
- `SECURITY INVOKER` / not `SECURITY DEFINER` unless the design is separately amended;
- `SET search_path TO 'public', 'pg_temp'`;
- schema-qualified `public.products` access.

### 6.3 Client-facing RPCs replaced for lock order

For items 5–12 in the source matrix, capture pre/post ACL, security mode, and `search_path`, and assert they are unchanged except for changes explicitly authorized by the main design. Lock-order work must not silently become an authorization change.

Item 12, `rpc_create_mo_with_reservation`, needs its evidence captured by **exact signature** — `(p_order jsonb, p_materials jsonb, p_tenant uuid)`, its only overload — and must show `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`, `REVOKE ALL ... FROM PUBLIC`, `GRANT ALL ... TO authenticated`, and `GRANT ALL ... TO service_role`, all unchanged. It sits in the same migration as four `service_role`-only helpers, so the postflight must positively assert `has_function_privilege('authenticated', ..., 'EXECUTE')` is still `true` for it rather than only asserting the helpers are closed.

---

## 7. Rollback rehearsal gate

Rollback must be demonstrated in a disposable Fresh DB/Staging environment before any Production proposal. A prose list of predecessor migrations is necessary but not sufficient.

Run this sequence against a database seeded to the required precondition (including Migration 190 and its invariants):

1. capture pre-191 `pg_get_functiondef`, ACL, `prosecdef`, and `proconfig`/search-path evidence for all twelve existing bodies;
2. apply M191;
3. run the deterministic GREEN suite and ACL/security postflight;
4. execute the documented rollback that restores the twelve predecessor bodies and removes the new helper — note that Migration 186 supplies **two** of them (outgoing 8-arg and `rpc_create_mo_with_reservation`), so a rollback that restores only one of 186's bodies leaves the database in a third, unreviewed state;
5. prove function definitions, ACLs, security modes, and search paths match the captured pre-191 state, including the out-of-band hardening that must be preserved for `release_expired_reservations`;
6. in this disposable environment only, rerun the frozen F2 RED proof and confirm the old RED-A/RED-B failure shape is observable again — evidence that rollback restored the actual old behavior rather than a third, unreviewed state;
7. reapply M191 and rerun GREEN to prove forward recovery is repeatable.

A rollback rehearsal must never be performed on Production merely to prove the RED behavior.

---

## 8. Throughput and lock-wait characterization

Product-level serialization is intentionally coarser than warehouse-level locking. Correctness is the gate; performance characterization tells us the operational cost before Production.

Run the same dataset/hardware/environment before and after M191 and record at least:

- operations/second;
- p50, p95, and p99 RPC latency;
- time waiting on product-row locks (aggregate and worst observed call);
- one hot-SKU same-warehouse workload;
- one hot-SKU multi-warehouse workload;
- one distinct-SKU workload that should retain parallelism;
- receipt, outgoing, adjustment/manual-movement, and manufacturing-consumption representatives where practical.

The report must state fixture size, concurrency level, iteration count, and whether results include warm-up.

No arbitrary performance threshold is invented by this design because Wardah has no established SLO for these RPCs. Instead:

- any material regression must be quantified and reviewed before Production;
- an unexplained lock-wait/latency regression is a rollout blocker until understood;
- the remedy may **not** be to weaken the correctness lock contract inside M191 without a separately reviewed design.

---

## 9. Bounded stress run (supplemental, never the proof)

After all deterministic RED/GREEN fixtures pass, repeat a bounded subset of the real GREEN scenarios under randomized start jitter/concurrency (for example tens or hundreds of iterations in CI/Staging, sized to runtime budget).

Fail the stress run on any:

- `40P01` deadlock;
- invariant mismatch from §5;
- leaked advisory lock/test session;
- unexpected business error;
- timeout/hang.

This is **supplemental evidence only**. A thousand scheduler-lucky passes do not replace the deterministic blocker/gate/`pg_blocking_pids()` proofs required by the main design.

---

## 9a. Fix G multi-product reservation evidence (must not be collapsed into the single-product control)

The companion does not restate the architecture. It records the evidence the implementation PR must produce for the twenty-fifth correction, because a quantity-only or single-product GREEN can pass while the crossed-`bins` cycle remains.

Required, matching main design §7 Control A/B:

1. **RED against the pre-prefix Migration 186 reservation body**, products `A < B`, observed-blocker choreography (not sleeps): reservation `[A,B]` vs goods receipt `[B,A]` must produce genuine `40P01` with the cycle on `bins`; the same vs an outgoing/delivery-note-class caller `[B,A]` must also `40P01`. Incoming's target-bin-only footprint remains part of the RED assertion.
2. **GREEN against real M191**: both variants complete with no `40P01`; the competing stock caller serializes at the shared product prefix before taking any bin lock (`pg_blocking_pids` plus `bins.xmax = 0` on the not-yet-visited product).
3. Keep the existing single-product incoming-vs-reservation control; it still proves `FOR NO KEY UPDATE` / FK compatibility. Do **not** treat it, or an ascending `[A,B]` vs `[A,B]` run, as evidence that Fix G works — both pass against the defective body.
4. Exact-signature ACL/security/search-path evidence for item 12 is in §6.3; rollback of both Migration 186 bodies is in §7.

The bounded `bins` same-table sweep lives in the main design §6. This companion does not duplicate the table; implementation preflight must re-run that sweep, not this file's matrix.

---

## 10. Implementation evidence bundle

Before an M191 implementation PR can be called ready, its review artifacts should make the following easy to inspect without reconstructing them from prose:

- Migration 191 diff and exact object list;
- `acceptance_f2_stock_bin_race_green.sh` (or final chosen name) plus CI workflow;
- deterministic RED/controlled-mutant evidence required by the main design;
- valuation/queue/reconciliation output from §§4–5;
- exact ACL/security/search-path matrix from §6;
- Fresh DB/Staging rollback rehearsal output from §7;
- throughput/lock-wait report from §8;
- bounded stress summary from §9;
- Fix G Control A/B observed-blocker RED/GREEN from §9a (not the single-product reservation control alone);
- preflight proof that Migration 190 is already applied and its authorization/quarantine invariants still hold;
- implementation-time rerun of the writer/caller/**bins same-table** sweeps against the then-current `main`.

The implementation PR is not ready if any one of those artifacts contradicts the main F2 design, even if unit/CI checks are otherwise green.

---

## 11. Definition of done for the design handoff

PR #236 may remain design-only. The handoff to implementation is complete when reviewers can answer all of these from the two design documents without inventing policy during coding:

- Which objects change? — the thirteen-object contract is explicit.
- What lock order/mode is required? — main design §4/§6.
- How are deterministic races proven? — main design §7, including Fix G Control A/B.
- Which business semantics must not move? — main design correction/reject-list, including line-error ordering and fresh per-occurrence reads.
- What valuation state must reconcile? — §§4–5 here.
- What exact permissions/search paths must survive? — §6 here plus main design §5.
- How is rollback proven? — §7 here.
- How is the intentional throughput trade-off measured? — §8 here.
- What is explicitly not being fixed? — §2 here plus the main design's out-of-scope section.

That is the quality bar for starting Migration 191; it does not authorize writing or applying it.