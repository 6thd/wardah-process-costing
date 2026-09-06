# F2 — Stock incoming lost-update remediation design

**Status:** design for review. No SQL. No Production access.
**Date:** 2026-09-06
**Source repo:** [`6thd/wardah-process-costing`](https://github.com/6thd/wardah-process-costing)
**Verified `main`:** [`eada076a98cf9b5391bebdcec550159d22c5da0b`](https://github.com/6thd/wardah-process-costing/commit/eada076a98cf9b5391bebdcec550159d22c5da0b)
**Proof PR:** [#235](https://github.com/6thd/wardah-process-costing/pull/235) merged by `6thd`
**Proof writeup:** `docs/db/F2_STOCK_BIN_RACE_RED_PROOF.md`
**Original tracking:** [#228](https://github.com/6thd/wardah-process-costing/issues/228) — closed at proof merge; remediation needs a **new** issue
**Production writes:** none authorized by this document

This document chooses the remediation shape. It does not implement it.

> **Correction note (kept here, not silently fixed):** an earlier draft of this
> section asserted the 9-arg `wardah_apply_stock_incoming` overload is currently
> `GRANT EXECUTE`-able by `authenticated`. That is wrong. Checked directly against
> `sql/baseline/000_schema_baseline_20260905_184634.sql` (cutoff 189, the live schema
> `main` is currently at): all four functions this design touches —
> `wardah_apply_stock_incoming` 9-arg and 10-arg, `wardah_apply_stock_outgoing` 9-arg
> and 10-arg — carry the identical live ACL `REVOKE ALL FROM PUBLIC; GRANT ALL TO
> service_role;`. None of the four grant `authenticated` anything today. Migration 97
> originally granted the 9-arg overload to `authenticated`; Migration 101 revoked it
> (`P0-1: إعادة إغلاق ثغرة wardah_apply_stock_incoming`) and that closure is what's
> still live. §5's ACL carry-forward list below reflects the corrected, verified
> state — do not resurrect the 97 grant in Migration 191.

---

## 1. Decision

**One additive migration. One PR. Two independent fixes bundled for locality.**

Not two PRs. Not two successive migrations that each `CREATE OR REPLACE` the
same functions.

The runbook must say, in those words, that RED-A and RED-B are independent
defects that both live in the two incoming overloads, that outgoing is
touched only for lock-order compatibility, and that they are bundled so
the lock-order contract is installed once.

### Why not two PRs

RED-A (bins unique-key insert race) and RED-B (unlocked product-aggregate
race) touch different tables and different lock points. Fixing the bin upsert
does not close the product `SUM`. Fixing the product `SUM` at the tail, using
a precomputed partial, does not close the first-bin overwrite.

They still share a locality problem:

- both bugs sit in the 9-arg and 10-arg `wardah_apply_stock_incoming` bodies
- any lock-order change on incoming that takes the `products` row **before**
  `bins` deadlocks with live `wardah_apply_stock_outgoing` unless outgoing is
  updated in the **same** replace
- a second migration immediately after the first would replace the same
  functions again

That last point is the 170–173 / 182–183 pattern
`CLAUDE.md` already flags. Migrations 170, 172, 173 each replaced
`has_permission()`; the live contract is their union, and any later replace
must re-assert every layer or a prior fix silently disappears. Migrations
182 and 183 replaced `rpc_get_trial_balance` the same way: replaying 182
alone reopens the security hole; replaying 183 on an old body restores the
wrong ledger. See `docs/db/PERMISSION_HARDENING_170_173_CHAIN.md` and
`docs/db/TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md`.

Splitting RED-A and RED-B across two numbered migrations would recreate that
chain on four stock helpers (`incoming` 9-arg, `incoming` 10-arg,
`outgoing` 9-arg, `outgoing` 10-arg) for no operational gain. Rollback of a
`CREATE OR REPLACE` is "put the previous bodies back." One replace rolls both
fixes back together; two replaces leave a window where incoming is half-fixed
and lock order vs outgoing is undefined.

### What "bundled for locality" is not

It is not "one root cause." It is not "the product lock is the only change."
The migration installs **two** remediations and **one** lock-order
compatibility update. The acceptance script must be able to fail them
separately.

---

## 2. GitHub verification (this turn)

Checked live against GitHub, not against this empty design repo.

| Fact | Evidence |
|---|---|
| `main` is `eada076a` | `GET /repos/6thd/wardah-process-costing/commits/main` → `eada076a98cf9b5391bebdcec550159d22c5da0b` |
| Merge message | `Merge pull request #235 from 6thd/claude/red-concurrency-proof-6hy26g` / `F2 (#228): deterministic RED proof for stock bin lost-update races` |
| Merged by | `6thd` at 2026-09-06T08:04:37Z |
| #235 is proof-only | PR body: no migration, no locking strategy, no schema change, no Production access; diff against pre-proof `main` (`aa41b256`) is exactly the 3 proof-only files |
| Highest numbered migration on that tree | `190_material_consumption_authorization_boundary.sql` (F1). Next free number is **191** |
| #228 state | Closed `completed` at the same timestamp as the merge, despite the proof's "does not close #228" |
| Live ACL on all 4 target functions | `REVOKE ALL FROM PUBLIC; GRANT ALL TO service_role;` — no `authenticated` grant on any of them (see correction note above) |

Remediation tracking should be a **new issue**, not a silent reopen of #228.
#228's required proof now exists on `main`. Its "fix boundary if RED is
proven" section is the input to this design, not a reason to keep the proof
issue open.

---

## 3. Confirmed defects

Both are silent (`applied: true`). The stock ledger is never wrong. The
projection is.

### RED-A — first-bin unique-key insert race

**Table:** `bins`. **Constraint:** `idx_bins_product_warehouse`
`(product_id, warehouse_id)`. **Lock that does not exist:** row lock on a
missing bin.

Live shape on both incoming overloads (9-arg from Migration 94/97, 10-arg
from Migration 187):

1. `SELECT actual_qty, stock_value, stock_queue FROM bins … FOR UPDATE`
2. Derive absolute `v_new_qty` / `v_new_value` / `v_new_queue` from that
   snapshot (`COALESCE` of no-row → 0 / 0 / `[]`)
3. Insert the SLE using that derived after-qty
4. `INSERT INTO bins … ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
   actual_qty = EXCLUDED.actual_qty` (and the matching value/queue/rate)

A missing row cannot be locked. Two concurrent first receipts on the same
`(org, product, warehouse)` both derive from empty. The second `INSERT`
waits on the first's uncommitted unique-key insert, then overwrites the
winner with its own precomputed absolute.

**Frozen numbers (9-arg Goods Receipt, PostgreSQL 17, deterministic):**
qty 5 and 7 at rate 10. SLE sum 12 / 120. Bin **7 / 70**. Never 12 / 120.

**Bounded by Control-1:** once the bin exists, the same race shape sums
correctly (20+3+4 = 27). RED-A is the creation window, not a general failure
of `FOR UPDATE`.

### RED-B — unlocked product-aggregate race

**Table:** `products`. **Lock that does not exist:** anything that spans
"all bins of this product" when some of those bins do not exist yet.

Live tail on both incoming overloads:

1. Unlocked `SELECT SUM(actual_qty), weighted rate FROM bins WHERE
   product_id = p_product AND org_id = p_org`
2. `UPDATE products SET stock_quantity = v_prod_qty, cost_price = …`

Under READ COMMITTED each session's `SUM` sees only its own uncommitted bin.
The `UPDATE products` **does** row-lock; the second writer waits, then
stores its partial sum.

This is not a bin-key collision. Both bins are individually correct.

**Frozen numbers:** qty 6 @ 10 and qty 9 @ 20 on two warehouses. Bins 6/60
and 9/180. SLE sum 15 / 240. Product **9 / cost 20**, never 15 / 16.

Outgoing already locks every existing bin for the product
(`ORDER BY warehouse_id, id FOR UPDATE`, Migration 186/187) before it
projects. That does **not** close RED-B for incoming first-bins: an empty
`FOR UPDATE` set is a no-op. RED-B needs a lock target that exists before
any bin row exists — the `products` row.

### Overload coverage on `main`

| Body | Last `CREATE OR REPLACE` | RED-A/B live? | Behavioral proof? |
|---|---|---|---|
| `wardah_apply_stock_incoming` 9-arg | Migration 97 | yes | yes (Goods Receipt) |
| `wardah_apply_stock_incoming` 10-arg | Migration 187 | yes (static `pg_get_functiondef`) | no — adjustment path only |
| `wardah_apply_stock_outgoing` 9-arg | Migration 186 | not these two races; lock-order peer | Control-2 vs incoming |
| `wardah_apply_stock_outgoing` 10-arg | Migration 187 | same as 9-arg outgoing | static |

A fix that replaces only one incoming overload cannot pass the existing
static contract, and cannot be the whole remediation.

---

## 4. Two remediations, one lock-order prefix

### Shared prefix (not a third defect)

Every stock-mutating helper this migration replaces acquires, in this order:

1. **Product row** — `SELECT … FROM products WHERE id = p_product AND org_id = p_org FOR UPDATE`
2. **Existing bins for that product** — the Migration 186 outgoing order,
   `ORDER BY warehouse_id, id FOR UPDATE` (no-op when none exist)
3. **Target bin** — `SELECT … FOR UPDATE` on `(product, warehouse)`, then
   insert-or-update from the locked snapshot
4. **Product projection** — re-`SUM` bins and `UPDATE products` while still
   holding (1)

Outgoing already does (2) then (3) then (4) without (1). Incoming today does
a single-bin (3) then an unlocked (4). Putting (1) on incoming alone
deadlocks with outgoing:

- incoming holds `products`, waits for `bins`
- outgoing holds `bins`, waits for `products`

So outgoing 9-arg and 10-arg must take (1) **before** (2) in the same
migration. That is lock-order compatibility, not a claim that outgoing has
RED-A or RED-B.

```text
incoming/outgoing (after 191)
  products  FOR UPDATE          ← always exists; serializes the SKU
  bins*     FOR UPDATE ORDER BY warehouse_id, id
  bins[wh]  FOR UPDATE / insert from locked snapshot
  SUM bins → UPDATE products    ← recompute under the product lock
```

### Fix A — RED-A (bins)

Do not derive a bin balance from an absent, unlocked row, and do not write
that derived absolute through `ON CONFLICT … SET actual_qty = EXCLUDED.actual_qty`.

Mechanically, after the product lock:

- `SELECT … FROM bins WHERE product_id AND warehouse_id FOR UPDATE`
- if found: compute `v_new_*` from the locked current row, then `UPDATE` that
  row (the existing-bin path, already proven by Control-1)
- if not found: `INSERT` the first row from empty. Do **not** keep an
  absolute `EXCLUDED` upsert as the happy path
- if `unique_violation` still fires (should be unreachable under the product
  lock): retry from the `SELECT … FOR UPDATE`, never apply the failed
  statement's precomputed absolute

The product lock is what closes the creation window. Removing the
`EXCLUDED` overwrite is defense in depth: if a later migration drops the
product lock, the landmine is not still sitting in the upsert.

Do **not** "fix" this with `actual_qty = bins.actual_qty + EXCLUDED.actual_qty`
or `+ p_qty` while leaving `stock_queue` as the precomputed JSON. FIFO/LIFO
queues cannot be patched by adding scalars; the queue must be re-derived
from the locked current snapshot plus this movement.

### Fix B — RED-B (products)

Do not write a product aggregate computed from an unlocked bins scan, and do
not write a sum that was computed before concurrent first-bins committed.

Mechanically:

- the product row lock is taken **before** any bin insert, not at the tail
- after the bin write, **re-read** `SUM(actual_qty)` / `SUM(stock_value)`
  from `bins` for that `(org, product)` and then `UPDATE products`
- do not reuse a `v_prod_qty` captured before the lock or before the bin
  write

Locking `products` only at the tail, then storing a precomputed partial,
leaves RED-B intact (the wait serializes the `UPDATE`, not the `SUM`).
Locking all existing bins, as outgoing does, leaves RED-B intact when both
warehouses are creating their first bin (empty lock set).

### Why a product-row lock is the right shared prefix

| Candidate | RED-A | RED-B | Outgoing compatibility | Notes |
|---|---|---|---|---|
| Product `FOR UPDATE` at start + re-SUM | yes | yes | yes, if outgoing takes it first | Lock target exists before any bin |
| Outgoing-style "lock all bins" only | no (no row) | no (no rows) | already live | Empty `FOR UPDATE` is a no-op |
| Advisory lock on `(org, product)` only | yes | yes | extra lock space next to row locks | Works, but diverges from the 186 row-lock style already on outgoing |
| `SERIALIZABLE` on the RPC | maybe | maybe | session default is READ COMMITTED; SSI aborts are a new client contract | Rejected |
| Relative `ON CONFLICT` upsert only | only if queue is re-derived | no | n/a | Does not touch `products` |
| Global SLE uniqueness | forbidden by #228 | n/a | n/a | Would break legal multi-line receipts |

Advisory locks are a valid alternative and would also exist before the bin
row. They are rejected for this migration because outgoing already speaks
row locks, Control-2 already waits on row locks, and mixing advisory + row
locks without converting outgoing would still deadlock on `products`.

There is precedent in this codebase for locking `products` directly:
`rpc_complete_manufacturing_order` already does
`SELECT id, stock_quantity, cost_price FROM public.products ... FOR UPDATE`
for finished goods with no bin, then `UPDATE products` under that same lock.
This design applies the identical technique to `wardah_apply_stock_incoming`
and `wardah_apply_stock_outgoing`, not a novel locking primitive.

---

## 5. What the migration replaces (and what it must not)

Proposed number: **191** (190 is already on `main` for F1 material
consumption). Confirm at implementation time that 191 is still free.

Replace, in one file, all four bodies:

1. `wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)` — 9-arg, receipts / manual movement
2. `wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)` — 10-arg, stock adjustment
3. `wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)` — 9-arg
4. `wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)` — 10-arg

Carry forward, verbatim except for the two fixes and the lock-order prefix:

- Valuation: FIFO / LIFO / weighted average, including queue rewrite
- SLE insert (incoming positive qty; outgoing negative qty and COGS)
- 10-arg source-line guards (`STOCK_SOURCE_LINE_REQUIRED` /
  `STOCK_SOURCE_LINE_MISMATCH`) and `source_line_id` storage
- Outgoing reservation floor (`INSUFFICIENT_UNRESERVED_STOCK`) and
  `BIN_NOT_FOUND` / `INSUFFICIENT_STOCK`
- 9-arg incoming early `NO_WAREHOUSE_OR_QTY` JSON return
- `search_path`: 9-arg incoming is `public`; 10-arg incoming and both
  outgoing overloads are `'public', 'pg_temp'` — keep each as it is
- **ACL: all four bodies are currently `service_role`-only**
  (`REVOKE ALL FROM PUBLIC; GRANT ALL TO service_role`, verified in §2 above).
  Migration 97 briefly granted the 9-arg overload to `authenticated`;
  Migration 101 closed that. Keep all four `service_role`-only in 191 — do
  not add an `authenticated` grant to any of them
- Outgoing `wardah_assert_org_member`; do **not** add it to incoming 9-arg
- Projection asymmetry: incoming sets `products.stock_quantity` and
  `cost_price` only; outgoing also sets `products.stock_value`. Do not
  "align" that in this migration

Fail-closed tightening allowed, and it must be called out in the runbook:

- 9-arg incoming today reads `valuation_method` without `NOT FOUND` and
  coalesces to weighted average. Taking `FOR UPDATE` on that row should
  raise `PRODUCT_NOT_FOUND_OR_WRONG_ORG` like outgoing, rather than lock
  nothing and proceed. Small, fail-closed, not part of RED-A or RED-B.

### Explicitly out of scope

- Historical `ADJ-000001` repair (Migration 187 / #228)
- Any global uniqueness rule across unrelated vouchers (#228)
- Rewriting migration history; this is additive only
- `rpc_complete_manufacturing_order`'s direct `products.stock_quantity`
  write for finished goods with no bin. Verified: this path never touches
  `bins` at all (no bin lock, no bin reference anywhere in its body), so it
  cannot invert lock order against the new products-then-bins convention —
  it remains a known sibling, not F2
- Client GRANT / RLS / Migration 185 write-surface
- Production apply

---

## 6. Concurrency and deadlock contract

### Incoming vs incoming (RED-A)

Both wait on `products`. The loser starts after the winner commits, sees
the bin, takes `FOR UPDATE` on it, and adds. Final bin = sum. SLE rows
both survive (unchanged).

### Incoming vs incoming, two warehouses (RED-B)

Both wait on the same `products` row even though bin keys do not collide.
The loser re-`SUM`s both bins. Final product qty/value/rate = combined.

### Incoming vs outgoing, existing bin (Control-2, must stay green)

Today: no deadlock, net 50+8−10 = 48. After 191 both take `products` then
bins in the same order, so this must remain deadlock-free. Keep the
file-rendezvous / `pg_stat_activity` waiter proof.

### Incoming vs outgoing, first bin (new control)

Today outgoing raises `BIN_NOT_FOUND` if the bin is missing. After 191,
an incoming creating the first bin and an outgoing on the same key must
not deadlock: outgoing still waits on `products`, then either sees the
new bin or raises `BIN_NOT_FOUND` after incoming commits. Add this as a
control; do not weaken `BIN_NOT_FOUND`.

### Incoming vs reservation (`rpc_create_mo_with_reservation`)

Verified: this RPC locks bins in `warehouse_id, id` order
(`sql/migrations/186_stock_moves_contract_repair.sql` line 89, carried into
the live body) before reserving, and its only other `products` reference is
an unlocked `SELECT base_uom_id` metadata lookup — it never takes a
`products` row lock at all today. So it cannot currently invert lock order
against the new products-then-bins convention. 191 should **not** add a
`products` lock to the reservation RPC (out of scope); it must not introduce
a `products` lock **after** a bin lock anywhere. Implementation review must
grep the four replaced bodies for lock order, not assume reservation is
unchanged in spirit.

### Throughput

Product-level serialization is coarser than per-warehouse. Two receipts
of the same SKU into two warehouses will queue. That is the cost of a
correct product aggregate under READ COMMITTED without a bins row to
lock. It is acceptable for this remediation. Per-warehouse advisory
locks would restore warehouse parallelism at the cost of leaving RED-B
open; do not split the lock grain in 191.

---

## 7. GREEN acceptance (invert the RED proof; do not delete it)

Keep `acceptance_f2_stock_bin_race_red.sh` as a **pre-191** red proof. It
must keep failing on cutoff-189/190 functions with the documented
signatures (7/70 and 9/20). Do not "fix" the red script so a green tree
makes it pass.

Add a sibling green script (name to be chosen at implementation, e.g.
`acceptance_f2_stock_bin_race_green.sh`) that uses the same rendezvous,
the same `wait_event_type = 'Lock'` proof of real backends, and the same
numeric helpers, with inverted assertions:

| Scenario | Must hold after 191 |
|---|---|
| RED-A shape (5 @ 10 and 7 @ 10, no pre-existing bin) | one bin 12 / 120; SLE sum 12 / 120; product qty 12, cost 10 |
| RED-B shape (6 @ 10 and 9 @ 20, two warehouses) | bins 6/60 and 9/180; SLE sum 15 / 240; product qty 15, cost 16 |
| Control-1 existing bin (20+3+4) | 27 (unchanged) |
| Control-2 incoming vs outgoing (50+8−10) | 48, no deadlock (unchanged) |
| New: first-bin incoming vs outgoing | no deadlock; outgoing is either applied after the bin exists or `BIN_NOT_FOUND`, never a hang |
| Static contract, both incoming overloads | product `FOR UPDATE` appears before bins `FOR UPDATE`; `actual_qty = EXCLUDED.actual_qty` is **absent**; unlocked `SUM`→`UPDATE products` without a preceding products lock is **absent** |
| Static contract, both outgoing overloads | product `FOR UPDATE` appears before the all-bins `FOR UPDATE` |

10-arg incoming is Production's stock-adjustment path. The red proof only
covered it statically. GREEN should add **one** behavioral 10-arg first-bin
race (adjustment qty pair with distinct `source_line_id`s) so a 9-arg-only
fix cannot ship. If that forces too much adjustment-header fixture, say so
in the implementation PR and keep a named gap; do not silently skip it.

CI: a new workflow on the green script against cutoff+191, plus the
existing red workflow still running against a database **without** 191
(same pattern as 186's red/green pair).

---

## 8. Runbook framing (required prose)

The 191 runbook is not a "stock incoming lock upgrade." It is:

> Two independent remediations, bundled because both live in the same
> incoming overloads and because incoming lock-order must be installed
> together with outgoing.
>
> - Fix A closes RED-A (`bins` unique-key insert / stale `EXCLUDED`).
> - Fix B closes RED-B (`products` aggregate from an unlocked `SUM`).
> - Outgoing 9-arg and 10-arg take the same product-row lock first so
>   incoming vs outgoing cannot deadlock.

It must also record:

- additive only; no history rewrite; no `ADJ-000001` repair
- rollback = restore the four previous bodies from Migrations 97, 186, and
  187 (cite the files). That restores **both** defects. There is no
  supported "roll back Fix A, keep Fix B"
- ACL is unchanged by this migration (all four bodies stay `service_role`-
  only, per §5's corrected carry-forward) — 191 is a body-only replace, not
  a grant change
- Production apply requires a separate authorization, preflight (ledger
  head, four signatures, ACLs, search_path), apply-once, postflight
  (`pg_get_functiondef` contract), and **no** Production concurrency test
  against live vouchers
- Merging 191 onto `main` does not close the Production gap; 170 sat
  merged-but-unapplied (`PERMISSION_HARDENING_170_173_CHAIN.md` §6)

---

## 9. Implementation gate (still later; not this package)

Do not write SQL until this design is accepted. Then, in
`wardah-process-costing`, in a new tracking issue:

1. Open the issue (do not reopen #228 as if the proof were missing).
2. Add `sql/migrations/191_…sql` with preflight, four replaces, ACL
   restatement (asserting `service_role`-only, not granting anything new),
   in-migration catalog postflight.
3. Add the green acceptance script + workflow; leave the red proof intact.
4. Runbook as §8.
5. No Production.

Reviewers should reject the implementation PR if:

- it ships only one incoming overload
- it ships incoming without outgoing lock-order
- it keeps `ON CONFLICT … actual_qty = EXCLUDED.actual_qty` as the write
  path
- it `UPDATE`s `products` from a sum computed before the product lock
- it splits Fix A and Fix B across two migrations
- it repairs historical SLE rows
- it claims RED-A and RED-B are "the same bug"
- it grants `authenticated` (or any client role) execute on any of the four
  bodies — they are `service_role`-only today and this migration does not
  change that
