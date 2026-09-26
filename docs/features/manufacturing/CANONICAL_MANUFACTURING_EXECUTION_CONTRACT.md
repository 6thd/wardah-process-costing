# Canonical Manufacturing Execution Contract

> **2026-09-25 post-M191 reconciliation (anchor `main@0761d567`):** PR #241 is merged, so Migration 191 is on `main`. PR #246 was merged into the #241 branch first. Repository presence is **not** Production application. §22 below records observations previously reported from a disposable PostgreSQL 17 database (raw output is not committed), plus the explicit #229/#230 contract statements, the current-vs-required lifecycle matrix, and the worked #230 numerical case with its open decision points. Full findings: `docs/architecture/MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md`. Nothing here implements #229/#230/#234 or authorizes Production/Staging changes.

> **2026-09-25 repository reconciliation:** imported from the side documentation branch into current documentation. The design-time baseline named below is historical; re-entry must start from current `main@e3869c2f6f7485c423281e42dfc72504edca30e8` and re-verify #229/#230/#234 plus M190/M191 state. The design decisions and sequencing remain the governing contract; this import does not implement them or authorize Production/Staging changes.


**Status:** design contract — documentation only  
**Purpose:** preserve the target manufacturing design while PR #246 / PR #241 are being closed  
**Tracks:** #229, #230, #234  
**Repository baseline used for this design:** `main@1d8221a5cc07c6f18e93820a464512f0860a230a`  
**Implementation state:** **NOT IMPLEMENTED by this document**  
**Production state:** **NO Production/Staging change authorized or performed**

---

## 1. Why this document exists

Wardah already has strong security, inventory, reservation, costing, and concurrency boundaries that must not be weakened merely to restore convenient manufacturing behavior.

Three open manufacturing contracts must be solved together rather than independently:

- **#229** — partial material consumption must be retry-safe and lifecycle-guarded;
- **#230** — manufacturing completion must have one authoritative success condition across finished-goods stock, cost, WIP, and GL;
- **#234** — backflush must be reimplemented on the canonical BOM + reservation/inventory contract instead of reviving legacy direct writes.

The key design rule is:

> **Backflush is an input mode into the canonical material-consumption transaction. It is not a second inventory/costing engine.**

This document intentionally freezes that rule before implementation begins.

---

## 2. Current boundaries that MUST survive

### 2.1 Authorization boundary from Migration 190

The supported material-consumption boundary uses the exact ordinary permission:

`manufacturing.material_consumption.consume`

The canonical client-facing consumption path is `rpc_consume_reserved_materials_v2(...)` (with compatibility wrappers delegating to it). Legacy backflush is currently quarantined fail-closed; it must not be restored by bypassing this boundary.

The future backflush implementation MUST preserve all of the following:

1. same-org membership validation;
2. exact permission enforcement for human/manual execution;
3. no client-reachable direct mutation path that bypasses the canonical DB boundary;
4. no reintroduction of direct `material_consumption` writes from retired backflush code;
5. no silent fallback to a legacy endpoint when the canonical path fails.

### 2.2 Inventory/concurrency boundary from the F2/M191 design

The manufacturing consumption path participates in the same stock-write lock discipline as the rest of the inventory subsystem.

Future backflush code MUST NOT invent a different lock order.

In particular:

- product identity must be captured deterministically before stock mutation;
- the canonical products-first lock prefix remains authoritative;
- bin / stock-ledger / reservation mutation must remain inside the existing reviewed ordering;
- a retry must re-enter the same canonical transaction rather than replaying ad-hoc table writes;
- no trigger or helper may acquire locks in a conflicting order merely because the source event is “automatic”.

### 2.3 Tenant and RLS boundary

Automatic behavior does not mean tenant-free behavior.

Every manufacturing mutation must still be bound to one organization, one manufacturing order, and one legal source event. Cross-org BOMs, reservations, warehouses, stages, products, or cost records are invalid input and must fail closed.

### 2.4 Accounting boundary

Backflush must never independently post an accounting result that can diverge from material consumption / WIP / inventory valuation.

Material cost entering WIP must come from the same valued stock movement that consumed inventory. There must be no second “backflush cost” calculation that can disagree with the canonical stock valuation.

---

## 3. Target architecture

```text
                ┌──────────────────────────────┐
                │ Manufacturing execution UI   │
                │ MES / operation completion   │
                │ MO completion                │
                └──────────────┬───────────────┘
                               │
                    one source event identity
                               │
                               ▼
                ┌──────────────────────────────┐
                │ Material Consumption Gateway │
                │ human guard / system context │
                └──────────────┬───────────────┘
                               │
                               ▼
                ┌──────────────────────────────┐
                │ Canonical consumption core   │
                │ idempotency + lifecycle      │
                │ reservation + valuation      │
                │ M191 lock order              │
                └───────┬─────────┬────────────┘
                        │         │
                        │         └────────► stage/WIP material cost
                        ▼
                stock ledger + bins
                        │
                        ▼
                  reservation decrement
```

There is only **one material-consumption mutation engine**.

Manual consume, manual backflush, automatic backflush, and completion-time backflush may have different orchestration, but they converge before mutation.

---

## 4. Backflush MUST remain an explicit option

Backflush is a supported manufacturing capability, not something to remove permanently because the legacy implementation was unsafe.

The product-level / BOM-level policy should support an explicit mode such as:

| Mode | Meaning | Mutation path |
|---|---|---|
| `disabled` | no automatic derivation; operator consumes explicitly | canonical consumption gateway |
| `manual` | user requests BOM-derived consumption explicitly | backflush planner → canonical consumption gateway |
| `operation_complete` | selected components flush when the relevant operation/stage is completed | operation transition → internal canonical gateway |
| `mo_complete` | remaining eligible components flush as part of the MO completion transaction | completion orchestrator → internal canonical gateway |

### 4.1 Default safety rule

Until a BOM/backflush policy is explicitly approved, the default is **`disabled`**.

No historical behavior may implicitly reactivate automatic backflush.

### 4.2 One BOM may mix policies

A mature design should allow line-level eligibility where needed:

- component consumed manually;
- component backflushed at operation completion;
- component backflushed only at MO completion;
- component never backflushed.

However, line-level policy is allowed only when the BOM snapshot is deterministic and auditable.

---

## 5. Canonical BOM contract

The retired design assumed `manufacturing_orders.bom_id`, which is no longer a legal contract. The replacement must not simply restore that column and resume old behavior.

### 5.1 Resolve once, execute many

The BOM used by a manufacturing order must be **resolved deterministically and frozen for that order** before execution depends on it.

The resolver must consider at minimum:

- organization;
- finished product / item mapping;
- approved state;
- active state;
- effective date;
- version / revision;
- alternative BOM rules;
- routing/stage applicability where relevant.

Ambiguity is an error. `LIMIT 1` is not an acceptance rule.

### 5.2 Snapshot, not live re-resolution

Once an MO is released/reserved for execution, later backflush must use an immutable MO BOM snapshot (or an equivalent immutable captured structure).

Do **not** re-query “current active BOM” during every backflush call. Otherwise:

- a BOM edit between retries can change the payload behind the same event identity;
- costing becomes non-reproducible;
- two stages of the same MO may consume different revisions without an explicit revision transition;
- retry/idempotency cannot prove payload consistency.

### 5.3 Snapshot content

The implementation may choose the physical schema, but the logical snapshot must be able to prove:

- source BOM/revision identity;
- capture timestamp/version;
- component product identity;
- UoM and conversion basis;
- quantity basis per produced quantity;
- scrap/yield factor where applicable;
- stage/operation association;
- backflush policy;
- reservation mapping rule.

No backflush executor may infer component identity from mutable display codes after capture.

---

## 6. Canonical consumption-event contract (#229)

### 6.1 Stable event identity

Every material-consumption business event must have a stable idempotency identity.

Examples:

- operator partial consumption event;
- manual backflush request;
- operation-completion backflush event;
- MO-completion backflush event.

The identity must be generated **once** for the business event and reused across retries.

A retry must never generate a fresh identity.

### 6.2 Payload consistency

A reused event identity with a different semantic payload must fail closed.

At minimum the persisted contract must bind the event identity to:

- org;
- MO;
- stage/operation where applicable;
- source kind (`manual`, `manual_backflush`, `operation_backflush`, `completion_backflush`);
- produced quantity basis where applicable;
- canonical component set and requested quantities;
- BOM snapshot/revision identity for backflush events.

Implementation may use a canonical payload hash, normalized event rows, or both.

### 6.3 Retry result

If the exact event has already committed successfully, retry must return the previously accepted result (or an equivalent stable success response) without duplicating:

- stock-ledger entries;
- bin quantity/value effects;
- reservation decrement;
- material-consumption rows;
- stage/WIP material cost;
- GL effects that are owned by the consuming/completion transaction.

### 6.4 Lifecycle guard

Consumption/backflush is allowed only in lifecycle states explicitly approved by the manufacturing contract.

The final state table must be approved before implementation, but the minimum rule is:

- never consume on cancelled MOs;
- never create a new consumption event after an MO is fully completed/done;
- completion-time orchestration may execute its own final consumption event inside the same transaction **before** the terminal state is committed;
- on-hold / quality-check semantics must be explicit, not guessed.

---

## 7. Manual backflush design

Manual backflush is a human-initiated convenience operation.

### Required flow

1. authenticate actor;
2. derive active org context;
3. verify same-org MO;
4. enforce `manufacturing.material_consumption.consume`;
5. verify lifecycle allows consumption;
6. load immutable MO BOM snapshot;
7. derive only backflush-eligible components;
8. calculate requested component quantities from the approved production quantity basis;
9. bind to stable event identity;
10. call the canonical consumption transaction;
11. return canonical consumption result.

Manual backflush MUST NOT:

- insert directly into `material_consumption`;
- update product/bin totals directly;
- write stage WIP independently;
- use a different valuation algorithm;
- bypass reservation rules.

---

## 8. Automatic backflush design

Automatic backflush is permitted, but it must not create a hidden authorization or concurrency bypass.

### 8.1 No autonomous write trigger

Do not restore the retired pattern where a table trigger independently performs material consumption.

A trigger running as a side effect of a row update obscures:

- the authorization boundary;
- event identity;
- retry ownership;
- lock sequencing;
- failure attribution.

Automatic backflush should be initiated by an explicit DB orchestration RPC that already owns the manufacturing transition being performed.

### 8.2 System execution context

For automatic execution, distinguish **who authorized the business transition** from **which internal function performs the mutation**.

Recommended contract:

- the outer client-facing transition/completion RPC enforces the actor permission needed for that business transition;
- if automatic backflush is configured, the same transaction invokes an internal canonical consumption core;
- the internal core is not client-reachable;
- the internal core does not reinterpret the action as an anonymous/system bypass;
- audit records retain the initiating actor and source event type.

If product policy later requires a separate permission for enabling/changing automatic backflush configuration, define that as a configuration permission. Do not require a synthetic user to impersonate an operator at execution time.

### 8.3 Operation-completion mode

For `operation_complete` policy:

- the operation completion event owns the stable backflush event identity;
- only BOM lines assigned to that operation/stage are eligible;
- retrying operation completion reuses the same event identity;
- backflush and the operation transition must be one transaction or have an explicit two-phase contract that cannot leave the operation “completed” with missing material effects.

The preferred contract is one transaction.

### 8.4 MO-completion mode

For `mo_complete` policy:

- the completion orchestrator calculates remaining eligible quantities from the immutable BOM snapshot and already accepted consumption events;
- it does not blindly re-consume full BOM quantities;
- final backflush occurs before completion state is committed;
- a failure in final backflush aborts completion.

---

## 9. Reservation contract

Backflush is **not** permission to bypass reservations.

Where the canonical manufacturing flow reserves material, backflush must consume through those reservations.

Required invariants:

1. no negative reservation caused by repeated events;
2. no event consumes more than its legal remaining reservation unless an explicitly approved exception contract exists;
3. reservation decrement and valued stock movement commit atomically;
4. same-event concurrency produces one accepted business effect;
5. legitimate distinct partial events remain possible;
6. stale BOM revisions cannot consume a reservation created for another captured product identity.

If shortage/over-consumption policy is needed later, it must be a named manufacturing policy with explicit permission and accounting behavior, not an accidental backflush side effect.

---

## 10. Inventory valuation + M191 compatibility

The future backflush implementation MUST enter stock mutation through the same reviewed inventory machinery used by canonical reserved-material consumption.

### Non-negotiable invariants

- use the same deterministic product identity captured for the event;
- preserve products-first acquisition required by the F2/M191 stock-write design;
- preserve source-line / voucher / ledger idempotency contracts that apply to the canonical consumer;
- preserve stock-ledger/bin ordering and valuation queue behavior;
- never update cached `products.stock_quantity` as an independent source of truth;
- no second backflush-specific AVCO/FIFO engine.

If canonical consumption changes in the eventual post-M191 implementation, backflush must delegate to that new canonical core rather than pinning itself to an obsolete implementation detail.

---

## 11. Stage/WIP costing contract

Every accepted material event must feed stage/WIP material cost exactly once.

Backflush quantity derivation and inventory valuation answer different questions:

- BOM snapshot determines **what quantity should be requested**;
- inventory valuation determines **what monetary value actually leaves stock**.

WIP material cost must use the latter.

No BOM standard price or stale component unit cost may override the actual canonical issue valuation for actual-cost WIP.

---

## 12. Authoritative manufacturing completion contract (#230)

`Completed` / `done` must become one cross-domain transaction contract, not merely a status update.

### 12.1 Required completion preconditions

Before terminal completion is committed:

- MO lifecycle transition is valid;
- required material events (manual/backflush) are accepted;
- any configured final backflush is completed idempotently;
- required production quantity / UoM is valid;
- cost inputs required by the approved costing policy are available;
- FG destination warehouse is legal and same-org;
- accounting event mappings required for the supported contract exist.

### 12.2 Cost composition

The completion cost basis must explicitly separate:

- direct material consumed;
- direct labor;
- applied manufacturing overhead;
- normal scrap treatment;
- abnormal scrap / loss treatment;
- approved adjustments;
- transferred-in cost for multi-stage/process costing;
- ending WIP.

**Transferred-in cost must not be counted once per stage and then summed again at completion.**

The implementation contract must identify which cost records are incremental versus cumulative before any SQL is written.

### 12.3 Finished-goods receipt

Finished-goods completion must produce the legal inventory effect through the canonical stock ledger/bin path.

A direct increment of a cached product quantity is never sufficient evidence of FG receipt.

### 12.4 WIP relief

Completion must relieve only the cost associated with completed output under the approved process-costing method.

Ending WIP remains valued; it is not zeroed merely because some finished goods were produced.

For weighted-average/FIFO process costing, equivalent-unit assumptions and transferred-in treatment must be part of the approved numerical acceptance case.

### 12.5 GL contract

The final contract must state explicitly whether successful manufacturing completion requires:

- creation of a Draft journal/event, or
- Posting within the same transaction.

It is not acceptable for manufacturing to say “done” while accounting success is ambiguous.

Whichever policy is approved must be atomic and retry-safe.

---

## 13. Recommended future DB shape

This section is intentionally logical, not a migration script.

The implementation should provide equivalents of the following concepts:

### A. Immutable BOM snapshot

`MO → captured BOM revision → captured component lines`

### B. Consumption event ledger

A stable event record with:

- `event_id` / business idempotency key;
- org + MO;
- source kind;
- stage/operation source;
- BOM snapshot identity when applicable;
- payload fingerprint;
- status/result metadata;
- initiating actor metadata.

### C. Canonical consumption core

One internal mutation function used by all supported source modes.

### D. Thin public orchestration RPCs

Examples conceptually:

- explicit material consumption;
- manual backflush;
- operation completion;
- MO completion.

These own authorization and orchestration, not alternate stock algorithms.

The physical names and exact migration layout remain implementation decisions after the contract review.

---

## 14. Security model

### 14.1 Human manual consumption/backflush

Requires:

- active same-org membership;
- `manufacturing.material_consumption.consume`;
- valid lifecycle state;
- canonical DB execution only.

### 14.2 Automatic backflush

Authorization belongs to the outer business transition.

Automatic backflush is never directly callable by clients as an unguarded internal helper.

### 14.3 Configuration

Changing BOM/backflush configuration should be separated from execution permission if the product later needs stronger segregation of duties.

For example, a planner/engineering permission may control BOM/backflush policy while an operator permission controls material consumption.

### 14.4 SECURITY DEFINER rules

Any future SECURITY DEFINER RPC/helper must comply with the repository's final reviewed guard contract after #246/#241 close.

Do not design around a temporary scanner workaround.

---

## 15. Failure and rollback semantics

A supported material/backflush transaction succeeds completely or leaves no business effect.

On failure, there must be no partial mismatch among:

- consumption event state;
- material consumption rows;
- reservation quantity;
- stock ledger;
- bins;
- WIP/stage material cost.

For final completion, the atomic boundary additionally includes:

- MO terminal state;
- FG stock receipt;
- completion cost snapshot/result;
- WIP relief;
- required GL event/journal state.

No compensating “cleanup later” path is accepted as the normal success contract.

---

## 16. Concurrency requirements

Acceptance must include forced overlap, not sleep-based assumptions.

### Required races

1. same consumption event submitted concurrently;
2. two different legitimate partial consumption events for the same reservation;
3. manual consume racing automatic backflush;
4. two operation-completion attempts for the same operation;
5. final backflush racing explicit consume;
6. completion racing a late consumption attempt;
7. BOM/config update attempt after MO snapshot/release;
8. two MOs consuming the same product/warehouse under the M191 lock contract.

Expected result is deterministic serialization or fail-closed conflict — never duplicated stock/cost effects.

---

## 17. Acceptance matrix

### 17.1 #229 retry/lifecycle

- lost response then retry → one business effect;
- concurrent same event → one effect;
- same event id + changed payload → fail closed;
- distinct second partial event → allowed;
- invalid MO lifecycle → denied;
- rollback leaves no partial stock/cost/reservation state.

### 17.2 #234 backflush

- disabled mode → no automatic event;
- manual mode → exact permission required;
- operation-complete mode → correct stage lines only;
- MO-complete mode → remaining eligible quantities only;
- no BOM → deterministic failure according to approved policy;
- multiple valid BOM candidates → fail ambiguous;
- inactive/unapproved/not-effective BOM → not selected;
- cross-org BOM → impossible/denied;
- retry uses same event identity;
- no direct `material_consumption` write bypass;
- stock ledger / bins / reservation / WIP reconcile.

### 17.3 #230 completion

One worked numerical case must prove:

- materials;
- labor;
- overhead;
- scrap policy;
- ending WIP;
- completed FG quantity;
- FG unit cost;
- FG SLE/bin value;
- WIP relief;
- GL debit/credit state;
- Draft/Posted policy;
- retry produces no duplicate FG or GL effect.

A second acceptance case should cover partial completion with non-zero ending WIP.

---

## 18. Delivery sequence after #246 / #241 cleanup

Do not implement this design inside PR #246 or PR #241.

Recommended sequence:

### Phase 0 — Contract closure (docs/tests only)

- review this document;
- approve lifecycle matrix;
- approve BOM selection/snapshot policy;
- approve backflush modes;
- approve the numerical completion case;
- turn #229/#230/#234 acceptance criteria into executable RED harnesses where possible.

### Phase 1 — Retry-safe canonical consumption (#229)

DB-first PR:

- stable event identity;
- payload consistency;
- lifecycle guard;
- concurrency/idempotency proof;
- preserve Migration 190 permission boundary;
- preserve post-M191 lock discipline.

Consumer PR follows only after DB contract is merged/applied/verified under normal repository governance.

### Phase 2 — BOM snapshot + canonical backflush (#234)

DB-first PR:

- deterministic BOM resolver;
- immutable MO snapshot;
- manual + configured automatic orchestration;
- all modes delegate to canonical consumption core;
- no trigger bypass;
- RED/GREEN + concurrency proof.

### Phase 3 — Authoritative completion (#230)

DB-first contract/implementation:

- final optional backflush;
- complete cost basis;
- FG legal stock receipt;
- WIP relief;
- GL contract;
- completion idempotency;
- one atomic success condition.

### Phase 4 — UI / MES consumer alignment

- preserve event identity across retries;
- expose backflush policy explicitly;
- do not fabricate client-side costing;
- surface fail-closed errors accurately.

### Phase 5 — Integrated manufacturing simulation

Run the complete chain:

```text
BOM revision
→ MO creation/reservation
→ partial consume
→ lost-response retry
→ operation completion + optional backflush
→ additional partial consume
→ final backflush if configured
→ MO completion
→ FG SLE/bin
→ WIP relief
→ cost-of-production reconciliation
→ GL reconciliation
```

Only after this integrated round should the manufacturing lifecycle be described as end-to-end accepted.

---

## 19. Explicit non-goals

This design does NOT authorize:

- any Production/Staging mutation;
- changing PR #246 / PR #241 scope;
- rewriting applied migrations;
- restoring legacy direct backflush writes;
- bypassing reservations because a component is backflushed;
- bypassing RBAC because execution is automatic;
- direct product-quantity updates as an inventory substitute;
- historical manufacturing data repair;
- changing the Chart of Accounts without a separate reviewed accounting contract.

---

## 20. Decision register

The following are design decisions frozen by this document unless explicitly revised:

1. **Backflush remains a supported option.**
2. **Backflush is orchestration into canonical consumption, not a separate mutator.**
3. **Automatic backflush is explicit policy, default disabled.**
4. **No autonomous legacy-style trigger writes.**
5. **BOM is resolved deterministically and captured/snapshotted for the MO.**
6. **All consumption modes use stable event identity and retry-safe semantics.**
7. **Migration 190 authorization remains the manual-consumption security boundary.**
8. **Post-M191 products-first stock lock discipline is preserved.**
9. **Reservation, inventory valuation, and stage/WIP material cost remain one atomic consumption effect.**
10. **Manufacturing completion becomes one authoritative cross-domain success contract.**
11. **#229 → #234 → #230 implementation follows contract approval, with #230 semantics approved up front.**
12. **Final manufacturing readiness requires an integrated simulation, not isolated green RPCs.**

---

## 21. Re-entry checklist after PR #246 / PR #241

When returning to this work:

1. re-read current `main` and latest DB baseline — do not assume this document's baseline is still current;
2. re-read #229, #230, #234 and any newer comments/linked PRs;
3. confirm Migration 190/191 final deployed state before choosing the next migration number;
4. verify current `rpc_consume_reserved_materials_v2` body/ACL/RLS/lock order;
5. verify whether any consumer still writes `material_consumption` directly;
6. verify backflush remains quarantined and no trigger was reintroduced;
7. freeze lifecycle + BOM snapshot + backflush policy contracts;
8. start RED acceptance before implementation;
9. keep DB and consumer PRs separate;
10. require explicit Production authorization later, as a separate step.

This checklist exists so the design can survive the temporary focus on #246/#241 without being reconstructed from memory.

---

## 22. Addendum — 2026-09-25 RED evidence and contract hardening

**Anchor:** `main@0761d567965e7977ea2702166143ea6c2f1dc1da`. **Evidence:** `docs/db/manufacturing-inventory-red-20260925/` (disposable PostgreSQL 17.11: cutoff-189 baseline pair + M190 + M191). This addendum does not implement #229/#230/#234, and does not change M190/M191. The earlier local RED run has no committed raw output; the revised probes require a new run with retained output before these observations can be used as PR acceptance evidence.

### 22.1 Previously observed behavior on the anchored checkout

| Behavior | Evidence |
|---|---|
| An identical consumption replay duplicates the SLE, bin qty/value, `material_consumption`, `quantity_consumed` and stage WIP material; a client-sent `event_id` is ignored | probe C1/C1b |
| Consumption is accepted on `cancelled`, `done`, `draft` and `on_hold` MOs; an explicit `work_order_id` skips the WO status filter that auto-resolution applies | probe C2/C3 |
| Completion sums **every** `material_consumption` row: 10 canonical + 40 PENDING client row → 50. A fabricated `status='POSTED'` direct insert is also accepted by RLS | probe B |
| Completion increments `products.stock_quantity` / rewrites `cost_price` with **no** FG bin/SLE; the next canonical movement erases the completed units from the projection | probe A |
| Completion writes **draft** `MATERIAL_ISSUE` (Dr WIP / Cr RM) and `FG_RECEIPT` (Dr FG / Cr WIP) entries only at completion, while the material value already left stock at consumption time | probes A/B |
| A same-org member with only `manufacturing.orders.read` reaches `done` via direct UPDATE, `rpc_transition_mo_status`, or `rpc_complete_manufacturing_order` | probe D |
| `update_mo_status_from_work_orders` aborts every work-order status change (`42702 completed_quantity ambiguous`, plus a write to the absent `actual_end_date`). Its intended effect is an MO `COMPLETED` bypass | probe D4 / reconciliation X1 |
| Completion quantity comes from the client payload, or defaults to the **planned** MO quantity | `rpc_complete_manufacturing_order` body (186) |

The third-party "lock-order M192" claim is **rejected**: completion does not call `wardah_apply_stock_outgoing`. See the reconciliation document, §6.

### 22.2 #229 — material consumption contract (explicit)

1. Every consumption business event carries a **stable event ID**. The consumer generates it **once** and reuses it across retries; it never regenerates it per attempt.
2. Same ID + same canonical payload → stable replay: the previously accepted result is returned with **no** second SLE, bin, valuation, `material_consumption`, reservation or WIP effect.
3. Same ID + changed payload → **fail closed**.
4. A distinct legitimate partial-consumption event for the same reservation → allowed. `reservation_id` alone is **never** the event identity.
5. The MO lifecycle, and the explicitly supplied work-order state, are checked **before** any stock mutation. Cancelled and done MOs reject new consumption. The auto-resolved and explicit `work_order_id` branches enforce the **same** work-order state rule.
6. The canonical accepted consumption is the only source of material cost. It is the valued stock effect written by the canonical core (the SLE `stock_value_difference`, equal to the stage WIP material increment), recorded as a POSTED event produced by that core.
7. Client-provided monetary fields (`unit_cost`, `total_cost`) are **never** accounting authority.
8. Reservation decrement + SLE + bin + valuation queue + product projection + stage WIP material cost commit **atomically**, under the M191 products-first lock prefix.
9. There is **no** fallback to a direct `material_consumption` INSERT, and no fallback to an older non-idempotent endpoint. `mesService.consumeMaterial()` (a direct PENDING insert with client cost) is not a supported path. The direct INSERT surface that RLS still allows to `consume` holders must be closed, or bound to the canonical core, before #230 may read the table as a cost source.
10. The forced-overlap race list in §16 remains required for GREEN.

### 22.3 #230 — completion contract (explicit)

1. **One terminal authorization boundary.** `done` is reachable only through one guarded completion orchestrator. Direct `manufacturing_orders.status` UPDATE, `rpc_transition_mo_status(…,'done')` and any work-order-driven trigger must not be able to set the terminal state. The permission key is an **owner decision** (D-PERM); no key is invented here.
2. **FG destination warehouse is required** and must be same-org. Today `manufacturing_orders` has no such column (D-FG-WH).
3. **Canonical FG receipt required:** a FG SLE + bin + valuation-queue effect through the canonical incoming helper, under the M191 products-first prefix. The product projection is re-derived from bins.
4. A direct `products.stock_quantity` / `cost_price` mutation is **not** an FG receipt.
5. **Completed quantity** comes from accepted good output of the final stage. It is never the planned MO quantity by default, and never a free client number.
6. **Cost sources are enumerated**, and nothing else enters accepted cost:
   - direct material: canonical accepted consumption value (§22.2 item 6);
   - direct labor: the approved labor source × the approved rate (D-LAB);
   - applied overhead: the approved OH policy (D-OH);
   - normal scrap: absorbed by good output; abnormal scrap: period loss (D-SCRAP);
   - approved adjustments: explicit audited adjustment records only;
   - transferred-in: the previous stage's transferred-out cost, counted **once**;
   - beginning WIP: per the approved method (D-METHOD).
7. **Excluded:** unposted/PENDING rows, rows not written by the canonical core, client-supplied monetary fields, and `stage_costs` values produced by the simplified client path (until #260 / MFG-P1 closes).
8. **Ending WIP stays valued.** WIP is relieved only for the cost of completed output.
9. **No transferred-in double counting.** The invariant is `FG + Σ ending WIP (all stages) + abnormal loss = Σ incremental inputs`. Choose whether `stage_costs` rows are incremental or cumulative (D-STAGE) before any SQL is written.
10. **Draft vs Posted GL is an explicit owner decision** (D-GL-POST), together with material GL timing (D-GL-TIME). Either way, the stock subledger and GL must reconcile.
11. **The same completion event is idempotent.** A replay produces no second FG SLE/bin or GL. The same event ID with a changed payload fails closed.
12. **One atomic success condition:** stock + MO state + completion cost snapshot + WIP relief + GL either all commit or none do. There is no "cleanup later".
13. The definer posture complies with the repository scanner contract, with `search_path` including `pg_temp` (today's `{search_path=public}` does not).

### 22.4 Lifecycle matrix — current vs required

| MO state | New consumption today | Required |
|---|---|---|
| draft | accepted (probe C2) | D-LIFE |
| pending | accepted (no lifecycle check in body; not separately probed) | D-LIFE |
| confirmed | accepted (no lifecycle check in body; not separately probed) | D-LIFE |
| in_progress | accepted | allowed |
| on_hold | accepted (probe C2) | D-LIFE (must be explicit) |
| quality_check | accepted (no lifecycle check in body; not separately probed) | D-LIFE |
| done | **accepted** (probe C2) | **reject**; only the completion orchestrator's own final event, inside the same transaction and before the terminal commit, may consume |
| cancelled | **accepted** (probe C2) | **reject** |

| Path to `done` | Today | Required |
|---|---|---|
| direct `UPDATE manufacturing_orders SET status='done'` | read-only member succeeds | impossible |
| `rpc_transition_mo_status(…,'done')` | read-only member succeeds; no FG/cost/GL | refuses the terminal state |
| `rpc_complete_manufacturing_order` | read-only member succeeds; illegal FG | the one guarded orchestrator |
| work orders all `COMPLETED` → trigger | aborts today (X1) | may signal readiness only; never terminal |

### 22.5 Worked numerical acceptance case (#230)

**Status: CONTRACT EXAMPLE, not implemented.** The numbers are exact *given* assumption
set **AS-1**. Every assumption is an owner decision point (§22.6). An approved change to
any assumption changes the expected numbers, and must be re-derived here before any SQL.

**AS-1:** weighted average; scrap inspected at the **end** of stage 1 (scrap units 100%
complete); normal scrap absorbed by good output; abnormal scrap expensed as a period
loss; material added at the start of each stage; labor and OH given as applied amounts
from their approved sources; one WIP control account with a per-stage subledger;
amounts in the org currency with 2-decimal display (no intermediate rounding).

#### Case 1 — terminal completion, two stages, transferred-in, scrap

Starting inventory (canonical bins, W1): RM 1,000 u @ 10.00 = 10,000.00; PK 500 u @ 1.00 = 500.00. FG: no bin.

**Stage 1 (Mixing)**, beginning WIP 0:

| Input | Source | Amount |
|---|---|---|
| RM consumed | events E1 = 60 u, E2 = 40 u; canonical AVCO issue value | 1,000.00 |
| Direct labor | D-LAB | 200.00 |
| Applied OH | D-OH | 100.00 |
| **Stage 1 inputs** | | **1,300.00** |

Units: started 100 → good 90, normal scrap 8, abnormal scrap 2, ending WIP 0.
EUP (DM) = 90 + 8 + 2 = 100 → 10.00/EU. EUP (CC) = 100 → 3.00/EU. Cost per EU = 13.00.

| Allocation | Units | Amount |
|---|---|---|
| Good output 90 × 13.00 | 90 | 1,170.00 |
| + normal scrap 8 × 13.00 (absorbed) | — | 104.00 |
| **Transferred-out to stage 2** | 90 | **1,274.00** |
| Abnormal scrap 2 × 13.00 → period loss | 2 | 26.00 |
| Ending WIP | 0 | 0.00 |
| Check | | 1,274.00 + 26.00 = 1,300.00 ✓ |

**Stage 2 (Packing):**

| Input | Source | Amount |
|---|---|---|
| Transferred-in (90 u) | stage 1 transferred-out, **counted once** | 1,274.00 |
| PK consumed 90 u | canonical AVCO issue value | 90.00 |
| Direct labor | D-LAB | 160.00 |
| Applied OH | D-OH | 96.00 |
| **Stage 2 cumulative** | | **1,620.00** (incremental own cost 346.00) |

Units: 90 in → 90 completed; no scrap; ending WIP 0.

**Completion result:** FG 90 u, **FG unit cost 18.00**, FG value 1,620.00.
Invariant check: FG 1,620.00 + ending WIP 0 + abnormal loss 26.00 = Σ incremental inputs (1,000 + 200 + 100 + 90 + 160 + 96 = 1,646.00) ✓.
Double-count guard: Σ stage totals (1,300 + 1,620 = 2,920) is **wrong**, and so is stage 2 incremental alone (346). If `stage_costs` stores incremental rows, then FG = 1,646 − 26 − 0 = 1,620. If it stores cumulative rows, then FG = the last stage's cumulative cost for completed units = 1,620.

**Legal stock effects:**

| Warehouse/bin | Effect | After |
|---|---|---|
| W1 RM | SLE −60 (−600.00), SLE −40 (−400.00) | 900 u / 9,000.00 |
| W1 PK | SLE −90 (−90.00) | 410 u / 410.00 |
| **FG warehouse (D-FG-WH)** | **SLE +90 @ 18.00 (+1,620.00)**, voucher = the completion event | 90 u / 1,620.00 |
| `products` projections | re-derived from bins by the canonical helper | RM 900, PK 410, FG 90 |

**Journal (per AS-1 and pending D-GL-TIME / D-GL-POST):**

| # | Event | Dr | Cr | Amount |
|---|---|---|---|---|
| J1 | RM issue E1 | WIP | RM inventory | 600.00 |
| J2 | RM issue E2 | WIP | RM inventory | 400.00 |
| J3 | Stage 1 labor | WIP | payroll/labor clearing | 200.00 |
| J4 | Stage 1 OH | WIP | OH applied | 100.00 |
| J5 | Abnormal scrap | abnormal manufacturing loss | WIP | 26.00 |
| J6 | Stage 1 → 2 transfer | — (single WIP control, subledger only) or WIP-S2 / WIP-S1 per D-WIP-ACCT | | (1,274.00) |
| J7 | PK issue | WIP | PK inventory | 90.00 |
| J8 | Stage 2 labor | WIP | payroll/labor clearing | 160.00 |
| J9 | Stage 2 OH | WIP | OH applied | 96.00 |
| J10 | FG receipt | FG inventory | WIP | 1,620.00 |

WIP balance after J10: 600 + 400 + 200 + 100 − 26 + 90 + 160 + 96 − 1,620 = **0.00** ✓.
**Final MO state:** `done`; completed_quantity 90; scrap 10 (normal 8, abnormal 2); total_cost 1,620.00; unit_cost 18.00.

**What current `main` would produce from the same inputs (RED contrast):** total_cost = Σ `material_consumption` = 1,090.00. Labor, OH and scrap are ignored. unit_cost = 1,090 / 90 = 12.11 (or ÷ 100 if the client omits `completed_quantity`). The FG projection is +90 with **no** bin/SLE. Draft `MATERIAL_ISSUE` 1,090 + draft `FG_RECEIPT` 1,090 are written only at completion. FG is understated by 530.00, and the abnormal loss is never recognized.

#### Case 2 — partial completion with ending WIP, then beginning WIP

Single stage, MO planned 100 u. **Requires D-PARTIAL = multiple FG receipt events per open MO.**

Period P1: RM 100 u @ 10.00 = 1,000.00 at start; DL 180.00; OH 90.00 (CC 270.00). Completed 80; ending WIP 20 @ DM 100%, CC 50%.
EUP DM = 100 → 10.00; EUP CC = 80 + 10 = 90 → 3.00; cost/unit 13.00.
FG receipt event #1: 80 u × 13.00 = **1,040.00**. Ending WIP = 20 × 10.00 + 10 × 3.00 = **230.00**, which remains in WIP. Check: 1,040 + 230 = 1,270 ✓.
GL P1: Dr WIP 1,000 / Cr RM 1,000; Dr WIP 180 / Cr labor 180; Dr WIP 90 / Cr OH 90; Dr FG 1,040 / Cr WIP 1,040 → WIP **230.00**.
MO after P1: **in_progress**, completed_quantity 80. The MO is **not** `done`.

Period P2: beginning WIP 20 u (DM 200.00, CC 30.00). Remaining 50% CC added: DL 20.00 + OH 10.00. 20 u completed.
FIFO: 230.00 + 10 EU × 3.00 = 260.00 → 13.00/u. WA gives the same 260.00 here only because the P1 and P2 rates are equal. A differing P2 rate separates them (D-METHOD).
FG receipt event #2: 20 u, 260.00. WIP → 0.00. MO → `done`; completed 100; total cost 1,300.00 (1,000 + 270 + 30).

RED contrast: today a P1-end completion call with `completed_quantity=80` books 1,000 / 80 = 12.50 per unit, zeroes WIP (loses the 230 ending WIP) and sets the MO `done`. The remaining 20 units can never be received, because a second call returns `already_done`.

#### Retry rows required in the GREEN harness

- replay of FG receipt event #1 with the same ID and payload → same result; FG bin stays 80 u / 1,040.00; no second J10;
- same event ID with quantity 81 → fail closed;
- completion racing a late consumption (§16 item 6) → deterministic serialization or fail-closed conflict.

### 22.6 Owner decision register (open)

| ID | Decision |
|---|---|
| D-PERM | terminal completion permission (is `manufacturing.orders.update` sufficient, or is a first-class completion action needed?) |
| D-FG-WH | FG destination warehouse source and validation |
| D-GL-POST | Draft vs Posted manufacturing GL at completion |
| D-GL-TIME | material GL at each consumption event vs at completion |
| D-WIP-ACCT | single WIP control + subledger vs per-stage WIP accounts |
| D-LAB / D-OH | authoritative labor and overhead sources and rates (see #260) |
| D-SCRAP | inspection point, normal-scrap absorption method, abnormal-loss account |
| D-STAGE | incremental vs cumulative `stage_costs` semantics |
| D-METHOD | WA vs FIFO default and per-MO override |
| D-LIFE | consumption in draft/pending/confirmed/on_hold/quality_check |
| D-PARTIAL | partial FG receipts per open MO vs single terminal completion |

### 22.7 #234 and MFG-P1 dependencies

- #234 still delegates into the #229 core. Backflush is an input/orchestration mode, never a second consumption, inventory or costing engine. Manual and automatic backflush share the stable event identity, the immutable BOM snapshot, canonical reservation consumption, SLE/bin valuation, stage WIP material cost and the M191 lock order. The legacy `manufacturing_orders.auto_backflush` column defaults to `true`; that default is **not** policy (§4.1 default stays `disabled`). `backflush_materials` remains retired (`0A000`) and `auto_backflush_materials()` remains unattached.
- **MFG-P1 (#260) must close before #230 treats stage/process cost as authoritative.** On the cutoff-189 schema, the real `upsert_stage_cost` aborts (`42702`), `rpc_cost_of_production_report` aborts on a canonical row, and the live service writes columns and tables that do not exist. Having the SQL engine in migrations 66–69/120 is **not** the same as having the live path integrated and accepted.
