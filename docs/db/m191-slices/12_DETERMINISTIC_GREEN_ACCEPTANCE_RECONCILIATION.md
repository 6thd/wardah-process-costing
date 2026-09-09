# M191 Slice 12 — deterministic GREEN acceptance + reconciliation

**Status:** review/acceptance artifact only. No Production or Staging access is authorized by this file.

**PR:** #241  
**Entry head:** `0bb5dde37d01f052127ff45ec703a6d1cfe9ece4`  
**Design authority:** `docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md`  
**Evidence authority:** `docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md`

This is implementation step 11. It does not reopen Slices 01–11. It defines the
single aggregate acceptance run that must be executed after all thirteen M191
objects are assembled in one candidate transaction/database state.

A prior per-slice PASS is evidence that a local change was reviewed; it is **not**
a substitute for this aggregate run. Integration can change function order,
ACL/search-path carry-forward, lock choreography, or postflight placement without
changing any individual slice file.

---

## 1. Environment and evidence freeze

Run only on a disposable Fresh DB / dedicated PostgreSQL test cluster. Never run
RED mutants or rollback RED re-proofs on Production.

Before the first scenario, save:

```text
candidate_git_sha
PostgreSQL version
SHOW standard_conforming_strings
SHOW default_transaction_isolation
baseline cutoff
highest prerequisite migration
exact M191 candidate checksum / file hash
```

Required baseline/prerequisite state:

- cutoff-189 baseline;
- Migration 190 authorization boundary present;
- the complete assembled M191 candidate applied in one transaction, with Slice
  11's two sections embedded in that same transaction (§11);
- test roles `anon`, `authenticated`, `service_role` exist;
- no test-only advisory gate is present in the production candidate body;
- `default_transaction_isolation` is **`read committed`**.

The isolation level is a hard harness prerequisite, not a recorded field. Every
mapping-drift fixture in §10.3–§10.5 depends on the mapper's commit becoming
visible to a **later statement** of the still-open candidate transaction. That is
READ COMMITTED behaviour. Under REPEATABLE READ or SERIALIZABLE the candidate
keeps its transaction-level snapshot, the remap is never observed, no drift can
occur, and all three fixtures report GREEN while testing nothing. Assert the
level before Drift A/B/C and record the assertion; anything else is
`HARNESS_FAIL`, not `PASS`.

All deterministic concurrency checks use observed backend state
(`pg_stat_activity`, `pg_blocking_pids`, row-lock evidence, or an explicit harness
marker). A sleep by itself is not evidence that a required lock edge was reached.

---

## 2. Verdict classes

Every row below ends in exactly one of:

- `PASS` — required result and reconciliation both proved;
- `EXPECTED_BUSINESS_FAIL` — the specified pre-existing business rule won the
  serialization race and the whole losing call rolled back atomically;
- `HARNESS_FAIL` — the fixture/gate did not establish the required precondition;
- `CANDIDATE_FAIL` — wrong value, wrong lock edge, `40P01`, partial effect,
  unexpected timeout, wrong error, ACL/security drift, or missing evidence.

A harness failure can never be counted as GREEN.

---

## 3. Aggregate static gate — run before concurrency scenarios

Three files, run in this order from `docs/db/m191-slices/`:

| Order | File | Purpose |
|---|---|---|
| 1 | `12_acceptance_gate_selftest.sql` | proves the gate discriminates |
| 2 | `12_acceptance_static_gates.sql` | the candidate verdict |
| — | `12_acceptance_gate_defs.sql` | shared assertions, pulled in by both via `\ir` |

**The verdict is the psql exit code under `\set ON_ERROR_STOP on`: `0` is PASS,
non-zero is `CANDIDATE_FAIL`/`HARNESS_FAIL`.** The closing
`M191_ACCEPTANCE_STATIC_PASS` and `M191_GATE_SELFTEST_PASS` notices are
supplementary evidence for the bundle only. `NOTICE` output disappears whenever
`client_min_messages` is above `notice`, so a missing notice line is never a
failure and a present notice line is never, by itself, a pass.

The selftest is not optional. The assertions take body text as a parameter and
the selftest feeds them synthetic bodies, so it installs and mutates nothing and
needs none of the thirteen objects. Run it in the same session on the same
candidate database immediately before the gate, and store both exit codes.

The gate must prove:

1. the 13-object inventory is **closed** — every required signature present
   **and** no other overload of any M191 target name still installed. Presence
   alone is not enough: a forgotten predecessor overload stays resolvable by any
   caller that passes the old argument shape, so the closure would not be closed;
2. both S1 header-lock patterns match the real stored bodies;
3. the shared helper remains `FOR NO KEY UPDATE`, not `FOR UPDATE`, and the
   locking query itself remains ordered by product id;
4. the two S1 child foreign keys exist;
5. **every body that takes the product prefix does so before its first
   `public.bins` touch** — all eleven of them, detected under
   `FROM`, `JOIN`, `UPDATE`, `INSERT INTO` and `DELETE FROM`, not `FROM` alone.
   `release_expired_reservations` is excluded by design: Fix F reorders
   reservation locks and takes no product prefix;
6. `rpc_create_mo_with_reservation` contains exactly one explicit
   `wardah_resolve_product_id` call after the validation pass/capture rewrite,
   keeps the exact `RETURNING`/`ITEM_PRODUCT_MAPPING_DRIFT` comparison, and
   contains no production `pg_advisory_*` gate;
7. the Migration 190 permission key is still present in the assembled
   consumption body.

Item 5 is the check the per-slice PASSes structurally cannot give, and it is the
reason this file exists: assembly can reorder statements inside a body without
changing any slice file.

### 3.1 What the negative S1 test does and does not prove

The gate builds a `FOR NO KEY UPDATE` mutant from each S1 body and requires the
pattern to reject it. **This is a regression test on the strength of the pattern,
not independent evidence about the deployed body.** The mutant is derived from
the same text that just satisfied the positive match, so it can only fire when
the pattern itself has been weakened — `FOR.*UPDATE`, say — into something that
would also accept a downgraded lock. The deployed body's correctness is
established by the positive match alone. Do not cite the negative half as a
second, independent proof in the evidence bundle.

Both halves normalize case on both sides before comparing. An earlier revision
built the mutant with a case-sensitive `replace()` and matched case-insensitively,
so a **correct** body written in lower case produced `MUTANT_FALSE_PASS` — an
error that blames the pattern for a body that was never wrong.

### 3.2 Why the escaping convention is fixed

Every regular expression in Slice 12 is an `E''` string with doubled
backslashes. Mixing `E''` and plain literals produced both prior escaping
defects: Slice 11's over-escaped pattern that rejected a correct body, and this
slice's own `'wardah_resolve_product_id[ ]*\\('`, which as a plain literal under
`standard_conforming_strings=on` reached the regex engine as an unbalanced group
and made the entire gate un-runnable on PostgreSQL 16.13 — no check after it,
including the M190 guard, ever executed. A syntactically valid but wrongly
escaped pattern can make a gate un-runnable; conversely, a dead pattern that
never fires can look "green" in a weak fixture. §3's selftest exists to close
the second failure mode the same way `ON_ERROR_STOP` closes the first.

---

## 4. Core numeric GREEN — frozen F2 proofs

These are aggregate reruns on the assembled candidate, not references to prior
slice output.

| ID | Scenario | Required final state |
|---|---|---|
| G-A | first-bin incoming: `5 @ 10` + `7 @ 10`, no pre-existing bin | one bin `qty=12`, `stock_value=120`; two SLE effects, `SUM(actual_qty)=12`, `SUM(stock_value_difference)=120`; product `stock_quantity=12`, `cost_price=10`; no lost layer/effect |
| G-B | same product, two warehouses: `6 @ 10` + `9 @ 20` | bins `6/60` and `9/180`; SLE `qty=15`, value `240`; product `stock_quantity=15`, `cost_price=16` |
| G-C1 | existing bin `20 + 3 + 4` | final `27`; SLE/bin/product reconcile |
| G-C2 | existing bin incoming/outgoing `50 + 8 - 10` | final `48`; no deadlock; COGS/queue follows the legal serial order |
| G-FB | first-bin incoming vs outgoing | no hang/deadlock; outgoing either runs after the bin exists or fails atomically with existing `BIN_NOT_FOUND`; never partial |

For every row, capture both participating backend outcomes and the final
post-commit invariant query. A transaction result without the reconciliation
block is not a PASS.

---

## 5. Valuation and queue GREEN

Run at least one forced-concurrency FIFO fixture and one LIFO fixture against the
assembled candidate. Use non-equal rates so queue/order mistakes cannot be masked.

For each valuation fixture prove after both transactions commit:

- `bins.actual_qty`, `stock_value`, `valuation_rate`, and `stock_queue` equal one
  valid legal serial execution of the same two calls;
- total queue-layer quantity matches the queue contract for the final bin;
- no layer is duplicated, lost, or overwritten;
- outgoing removes the correct FIFO/LIFO layer(s);
- SLE quantity/value/valuation/COGS fields agree with the same serial outcome;
- product projection is freshly reconciled from committed bins.

Weighted Average is already exercised by G-A/G-B and remains mandatory there.

---

## 6. Product-prefix global-order acceptance

### 6.1 Standalone helper RED mutant

Invoke a **test-only ordering-removed helper mutant directly** with literal
crossed arrays `ARRAY[A,B]` and `ARRAY[B,A]`. Do not derive order from an RPC.
Use the previously verified advisory gate barrier. Require a genuine symmetric
row-lock wait / `40P01`.

This is RED evidence only; the mutant never enters production M191.

### 6.2 Real helper GREEN

Fixture precondition: prove UUID `A < B`.

Use two independent blockers:

- blocker A holds only product A;
- blocker B holds only product B.

Call the real helper with input `ARRAY[B,A]`.

Required observed sequence:

1. caller initially blocks **only** on blocker A;
2. release A;
3. caller then blocks **only** on blocker B;
4. release B;
5. helper completes without deadlock.

One blocker holding both products is rejected as non-discriminating.

---

## 7. Fix C / Fix D whole-call controls

Run on the assembled candidate:

- cancellation vs cancellation, two overlapping multi-product adjustments;
- incoming vs cancellation, existing bin;
- outgoing vs cancellation, existing bin;
- manual movement vs incoming;
- manual movement vs outgoing;
- manual movement vs cancellation where practical.

Required semantics:

- no `40P01`;
- if cancellation serializes after a later committed stock movement, it fails
  atomically with `LATER_STOCK_MOVEMENT_EXISTS`;
- if cancellation serializes first, later valid stock movement applies normally;
- no partial reversal survives any business failure;
- after completion/failure, every affected product equals the sum of its bins and
  SLE/reversal state is internally consistent.

The outgoing-vs-cancellation control must retain the already-proven pre-Fix-C
RED evidence; its post-M191 GREEN alone is not the regression proof.

---

## 8. Fix E whole-call multi-product controls

### 8.1 Cross-caller ordering

Run at least:

- Goods Receipt `[A,B]` vs Delivery Note `[B,A]`;
- Stock Adjustment vs Consumption with overlapping `{A,B}`.

For GR vs DN, retain the deterministic RED mutant with the external B blocker
using **`FOR NO KEY UPDATE`**, not `FOR UPDATE`, so FK `FOR KEY SHARE` can pass
and the test reaches the product-lock edge it intends to test.

Real candidate GREEN requires:

- no `40P01`;
- the second caller serializes at the product prefix before taking a conflicting
  bin lock;
- line-level business validation/error order remains predecessor-compatible;
- each completed document's SLE/source-line/COGS effects reconcile.

### 8.2 Consumption superset/guard regression

Carry forward the already proven three-way evidence on the assembled candidate:

1. narrowed superset + guard => `PRODUCT_NOT_PRELOCKED`;
2. genuinely narrowed superset + guard removed, two different MOs with crossed
   needed products => deterministic `40P01`;
3. real full per-MO superset + guard => neither guard nor deadlock under normal
   fixture, and material/WIP/COGS reconciliation passes.

Also rerun the C1 fixture:

- unrelated `reserved` row with `product_id IS NULL` and no resolvable mapping
  must **not** poison consumption of a valid named reservation;
- naming that unresolved reservation must still raise the predecessor resolver
  error at the original semantic point.

---

## 9. Fix F ordered reservation release

Run the proven pair:

- test-only reversed reservation-lock order vs consume-shaped ascending order =>
  genuine `40P01` RED;
- real `release_expired_reservations` ascending lock order vs consumption => both
  complete/serialize without deadlock.

Also prove both business serializations:

- release wins => consumption returns existing `ACTIVE_RESERVATION_NOT_FOUND`
  with zero partial consumption/SLE effects;
- consumption fully exhausts first => release returns `0` for that row and does
  not corrupt the consumed reservation.

Preserve exact `quantity_released = quantity_reserved - quantity_consumed` NULL
semantics.

---

## 10. Fix G aggregate acceptance

All of these are required on the assembled candidate.

### 10.1 Control A/B

Products `A < B`, real observed blockers, no sleeps as proof:

- reservation `[A,B]` vs GR `[B,A]`;
- reservation `[A,B]` vs outgoing/DN `[B,A]`.

Pre-Fix-G evidence must contain genuine `40P01`. Real candidate must complete
both calls without deadlock and demonstrate that the competing stock writer is
serialized at the shared product prefix before it owns any bin from the crossed
path.

An ascending `[A,B]` vs `[A,B]` run is diagnostic only and cannot satisfy this
row.

### 10.2 Real lock-mode probe

While a real reservation call holds product P through the prefix and is blocked
later on its bin:

- independent FK child insert referencing P must complete under real helper
  `FOR NO KEY UPDATE`;
- the same probe must block against a test-only helper/prefix `FOR UPDATE` mutant.

No deadlock is required. KEY SHARE compatibility vs blocking is the discriminator.

**Use `public.goods_receipt_lines` as the FK child**, inserting a row whose
`product_id` is P. That is the table the design's twentieth correction verified
against the live `rpc_post_goods_receipt` body: its
`goods_receipt_lines_product_id_fkey` makes the INSERT take an implicit
`FOR KEY SHARE` on P, which is exactly the lock the probe needs. Do not leave the
child table unnamed and do not substitute `material_reservations` — the
reservation call under test is itself inserting into that table, so a probe there
would not be independent of the transaction it is probing.

### Drift fixtures 10.3–10.5: isolation precondition

All three drift fixtures below require `default_transaction_isolation` to be
`read committed` (§1). Assert it in the candidate session immediately before
Drift A and record the assertion in the bundle. Under a snapshot isolation level
the mapper's remap is invisible to the open candidate transaction, no drift can
ever occur, and A/B/C report GREEN while testing nothing — that is
`HARNESS_FAIL`, not `PASS`.

### 10.3 Mapping drift A

Test-only gate exactly after snapshot+prefix and before first bins query.

- capture `I -> X`;
- mapper commits a valid in-place `X -> Y` remap while candidate is observed at
  the gate;
- after release, candidate must continue to captured X bins, not Y bins;
- Y's bin must never be acquired.

A mapper uniqueness failure is `HARNESS_FAIL`.

### 10.4 Mapping drift B

Gate after availability/MO creation and before first reservation INSERT.
Mapper commits in-place `X -> Y` while gated, retaining an already eligible
`valid_from`.

Required:

- INSERT still offers captured X;
- trigger persists/returns Y;
- exact comparison raises `ITEM_PRODUCT_MAPPING_DRIFT`;
- whole RPC rolls back: **zero surviving MO and zero reservation**.

### 10.5 Mapping drift C

Capture `I1 -> X`, `I2 -> Y`, prefix `{X,Y}`. At the persistence gate perform a
legal uniqueness-preserving swap. Before releasing the gate prove using the
candidate transaction's mapping timestamp that resolver now returns
`I1 -> Y`, `I2 -> X`.

New mapping rows must use explicit `valid_from <= v_candidate_mapping_at`.
`DEFAULT now()` is rejected because PostgreSQL `now()` is transaction-start
stable and can make the new mappings invisible to the candidate.

Required result is `ITEM_PRODUCT_MAPPING_DRIFT` + whole-RPC rollback.
`ITEM_PRODUCT_MAP_MISSING` is a fixture failure, not drift evidence.

### 10.6 Fix G timestamp reject-list invariants

Record these two invariants in the acceptance output:

- reservation trigger resolution currently uses
  `COALESCE(NEW.created_at, now())`; captured-vs-trigger identity assumes the
  normal INSERT does not inject a materially different historical/future
  `created_at`. A future migration that does so must re-review Fix G;
- drift fixtures must make the remap eligible at the candidate transaction's
  timestamp. A future `valid_from` that is newer than that timestamp does not
  prove resolver drift.

---

## 11. Security/S1 evidence — inside the candidate transaction, not after it

**Slice 11 is not a postflight script that can be "rerun" on an already-applied
candidate.** It has two placement sections and they belong to the candidate
transaction itself:

- **Slice 11/A (pre-replace capture)** runs after M191's prerequisite preflight
  and **before the first `CREATE OR REPLACE`/helper creation**;
- **Slice 11/B (postflight)** runs after all thirteen object definitions and ACL
  statements and **before the candidate `COMMIT`**.

So the assembled candidate transaction is: preflight → **11/A** → thirteen
objects + ACL → **11/B** → `COMMIT`. The security evidence for §14's bundle is
**that transaction's own output**, captured when it runs.

Running A and B again after the candidate has committed is not a rerun and must
not be recorded as pre/post evidence. It fails one of two ways:

- **B alone** → `pg_temp.m191_pre_function_security_contract` no longer exists.
  Slice 11/A's temp tables are `ON COMMIT DROP`, so the candidate's own `COMMIT`
  destroyed them. This is `HARNESS_FAIL`.
- **A and B together after the commit** → A now captures the **post-M191**
  catalog, and group 1 compares that state to itself. It is green by
  construction and proves nothing. This is precisely the "dead pattern that never
  fires looks green in a weak fixture" failure from §3, landing on the strongest
  security gate in the slice.

If the candidate was assembled without 11/A embedded, the security evidence
cannot be recovered after the fact. Rebuild the disposable database and re-run
the candidate transaction with 11/A in place.

The candidate must pass **all seven** of Slice 11/B's live PostgreSQL groups,
plus 11/A's capture assertion:

| | Assertion |
|---|---|
| A | 12/12 pre-capture signatures (`M191_SECURITY_CAPTURE_INCOMPLETE`) |
| 1 | 12/12 exact pre/post catalog equality — oid, owner, security mode, proconfig, normalized ACL |
| 2 | four canonical stock helpers remain client-closed and `service_role`-only |
| 3 | new shared helper: `SECURITY INVOKER`, hardened `search_path`, client-closed, and executable by every `SECURITY DEFINER` caller owner |
| 4 | Fix F's broad historical EXECUTE surface unchanged (explicit carry-forward, not an endorsement of anon exposure) |
| 5 | Fix G stays client-facing; Fix C stays `authenticated` + `service_role` and not `anon` |
| 6 | S1 header locks + both child FKs |
| 7 | `stock_adjustment_items.relacl` unchanged — separate debt, neither repaired nor widened |

Group 2 is easy to drop from a checklist because group 1 usually catches the same
mutation first; keep it. Keep the dedicated hard assertions generally, for the
same reason: they are defense-in-depth against a database whose pre-M191 ACL is
already malformed, where exact equality would happily carry a bad ACL forward.
The helper needs its own assertions because it has no predecessor row to capture.

---

## 12. Mandatory reconciliation block

After **every stock-mutating GREEN scenario**, after all participating
transactions have committed, run fresh queries and save one evidence row per
`(org_id, product_id, warehouse_id)` plus product aggregate.

Required columns/evidence:

```text
scenario_id
org_id
product_id
warehouse_id
bin_actual_qty
bin_stock_value
bin_valuation_rate
bin_stock_queue
sle_actual_qty_sum
sle_stock_value_difference_sum
sle_last_qty_after_transaction
product_stock_quantity
product_stock_value       -- assert only where the predecessor contract owns it
product_cost_price
queue_qty_sum             -- FIFO/LIFO fixtures
unexpected_negative_count
```

For scoped voucher/source-line fixtures also save:

```text
sle_row_count
source_line_id set/count
COGS/value result
business_error (if any)
partial_effect_count_after_error
```

Global pass rules for the fixture scope:

- `products.stock_quantity = SUM(bins.actual_qty)`;
- committed bin quantity/value equals the committed movements;
- SLE quantity/value totals equal the same committed movements;
- `qty_after_transaction` continuity is valid for the tested key/order;
- FIFO/LIFO queue total/order matches the final bin state;
- any expected business-rule failure leaves zero partial effects;
- no unexpected negative stock;
- no `40P01`, leaked gate, orphan test backend, or unexplained timeout.

Do not invent an incoming `products.stock_value` requirement: incoming's existing
projection asymmetry remains out of scope.

---

## 13. Evidence that may be reused vs evidence that must be rerun

### May be reused as historical/control proof

- per-slice RED mutants proving a specific bad shape is reachable;
- pre-Fix-C outgoing-vs-cancellation RED;
- Fix F reversed-order RED;
- Fix G pre-prefix Control A/B RED;
- membership-only Fix G drift-C false-pass mutant;
- individual C1/B8/B9 diagnostic outputs.

Reuse requires exact fixture/code identification and stored output. A prose claim
that a mutant "was tested earlier" is not enough.

### Must be rerun on the assembled candidate

- G-A/G-B numeric GREEN;
- at least one FIFO and one LIFO forced-concurrency GREEN;
- real helper acquisition-order GREEN;
- real Fix C/Fix D whole-call controls;
- real Fix E cross-caller GREEN and consumption full-superset GREEN;
- real Fix F GREEN;
- Fix G Control A/B GREEN, real lock-mode probe, and drift A/B/C against the
  final body (test instrumentation derived from that exact body);
- the aggregate static gate **and its selftest** (§3), both by exit code;
- Slice 11/A + 11/B security/S1 evidence produced **by the candidate transaction
  itself** (§11) — never a post-commit re-execution of the pair;
- final reconciliation blocks.

---

## 14. Aggregate verdict

Slice 12 may be marked **CLOSED** only when one evidence bundle identifies one
candidate SHA and contains:

- all mandatory assembled-candidate reruns above;
- exit code `0` from both `12_acceptance_gate_selftest.sql` and
  `12_acceptance_static_gates.sql`, in that order, on that candidate;
- Slice 11/A + 11/B output emitted by the candidate transaction itself;
- the recorded `default_transaction_isolation = read committed` assertion;
- all required RED/mutant controls or a traceable stored prior RED artifact;
- post-commit reconciliation for every stock-mutating GREEN;
- no unexplained failure, timeout, `40P01`, or partial effect;
- no production advisory gate in the candidate;
- no claim that M191 closes the separate direct-client write surfaces on
  `products`, `material_reservations`, or `stock_adjustment_items`.

After Slice 12 closes, the next implementation step is the **rollback rehearsal**.
Do not promote to `sql/migrations/191_f2_stock_write_concurrency_closure.sql` and
do not request final Codex/Astra review before rollback and final assembly are
complete.
