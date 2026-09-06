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
> `main` is currently at): the four stock-write helpers this design replaces —
> `wardah_apply_stock_incoming` 9-arg and 10-arg, `wardah_apply_stock_outgoing` 9-arg
> and 10-arg — carry the identical live ACL `REVOKE ALL FROM PUBLIC; GRANT ALL TO
> service_role;`. None of the four grant `authenticated` anything today. (A fifth
> function this design also touches, `rpc_cancel_stock_adjustment`, has a different,
> unrelated ACL — see the gap note and §5 below; it is not part of this correction.)
>
> The full history is worse than "97 granted it": Migration 94 granted the 9-arg
> overload `GRANT EXECUTE ... TO authenticated`; Migration 95 closed it
> (`REVOKE ALL FROM PUBLIC` + `REVOKE EXECUTE FROM authenticated`, "P0-2"); Migration
> 97's `CREATE OR REPLACE FUNCTION` **silently reintroduced the same grant** as part
> of an unrelated feature change; Migration 101 revoked it again, explicitly noting in
> its own comment that it was reversing 97
> ("إعادة إغلاق ثغرة wardah_apply_stock_incoming (عكستها 97)"). That closure is what's
> still live. §5's ACL carry-forward list below reflects the corrected, verified
> state, and — because a `CREATE OR REPLACE` has already reopened this hole once
> without anyone intending it to — 191 does not just "leave ACL alone": it explicitly
> re-issues the revoke/grant and verifies it with `has_function_privilege()` in
> postflight, so the invariant is re-proven, not silently inherited.

> **Gap note (found in review, not silently patched around):** the prior revision of
> this design covered exactly four functions (`wardah_apply_stock_incoming` 9/10-arg,
> `wardah_apply_stock_outgoing` 9/10-arg) and treated that as the complete set of
> `products`-mutating stock helpers. It wasn't. A systematic sweep of the live schema
> for every writer of `products.stock_quantity` turns up six functions, not four:
> the same four, plus `rpc_cancel_stock_adjustment`
> (`sql/migrations/124_atomic_stock_adjustments_and_material_consumption.sql`,
> still the live definition — no later migration replaces it) and
> `rpc_complete_manufacturing_order`. The second one is confirmed harmless (verified:
> its body never references `bins` at all, so it cannot invert lock order against
> anything — it stays out of scope exactly as originally assessed). The first one is
> not harmless: `rpc_cancel_stock_adjustment` updates `bins` (line 428) *before*
> updating `products` (line 458) for each affected line — the exact opposite of this
> design's products-then-bins order. A concurrent incoming/outgoing call holding
> `products` and waiting on `bins`, racing against a cancellation holding that `bins`
> row and waiting on `products`, is a real circular wait — the precise failure mode
> this design exists to prevent. §4, §5, §6, §7, and §9 below now cover
> `rpc_cancel_stock_adjustment` as a fifth function this migration must touch, not as
> a documented exception — an exception would still leave the deadlock live.

---

## 1. Decision

**One additive migration. One PR. Two independent defect fixes plus one
lock-order compatibility update, bundled for locality.**

Not two PRs. Not two successive migrations that each `CREATE OR REPLACE` the
same functions.

The runbook must say, in those words, that RED-A and RED-B are independent
defects that both live in the two incoming overloads, that outgoing and
`rpc_cancel_stock_adjustment` are touched only for lock-order compatibility,
and that they are bundled so the lock-order contract is installed once,
consistently, across every function that mutates `products` for a stock
movement.

### Why not two PRs

RED-A (bins unique-key insert race) and RED-B (unlocked product-aggregate
race) touch different tables and different lock points. Fixing the bin upsert
does not close the product `SUM`. Fixing the product `SUM` at the tail, using
a precomputed partial, does not close the first-bin overwrite.

They still share a locality problem:

- both bugs sit in the 9-arg and 10-arg `wardah_apply_stock_incoming` bodies
- any lock-order change on incoming that takes the `products` row **before**
  `bins` deadlocks with live `wardah_apply_stock_outgoing` **and** live
  `rpc_cancel_stock_adjustment` (confirmed: it updates `bins` before
  `products` today) unless both are updated in the **same** replace
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
chain on five stock helpers (`incoming` 9-arg, `incoming` 10-arg,
`outgoing` 9-arg, `outgoing` 10-arg, `rpc_cancel_stock_adjustment`) for no
operational gain. Rollback of a `CREATE OR REPLACE` is "put the previous
bodies back." One replace rolls both fixes back together; two replaces leave
a window where incoming is half-fixed and lock order vs outgoing and
cancellation is undefined.

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

### Function coverage on `main`

| Body | Last `CREATE OR REPLACE` | RED-A/B live? | Behavioral proof? |
|---|---|---|---|
| `wardah_apply_stock_incoming` 9-arg | Migration 97 | yes | yes (Goods Receipt) |
| `wardah_apply_stock_incoming` 10-arg | Migration 187 | yes (static `pg_get_functiondef`) | no — adjustment path only |
| `wardah_apply_stock_outgoing` 9-arg | Migration 186 | not these two races; lock-order peer | Control-2 vs incoming |
| `wardah_apply_stock_outgoing` 10-arg | Migration 187 | same as 9-arg outgoing | static |
| `rpc_cancel_stock_adjustment` | Migration 124 | not RED-A/B; lock-order peer, currently **inverted** (bins before products) | new control required (see §6) |

A fix that replaces only the incoming overloads — or the four stock-write
helpers without `rpc_cancel_stock_adjustment` — cannot pass the existing
static contract or the new cancellation controls (§6, §7), and cannot be the
whole remediation. A systematic sweep for every function that writes
`products.stock_quantity` on `main` turns up exactly six: these five plus
`rpc_complete_manufacturing_order`, which never touches `bins` (confirmed by
reading its full body) and stays out of scope per §5.

---

## 4. Two remediations, one lock-order prefix

### Shared prefix (not a third defect)

Every stock-mutating helper this migration replaces acquires, in this order:

1. **Product row(s)** — `SELECT … FROM products WHERE id = p_product AND org_id = p_org FOR UPDATE`.
   For helpers that only ever touch one product per call (incoming, outgoing)
   this is a single row. For a helper that can touch several products in one
   call (`rpc_cancel_stock_adjustment` — one adjustment can have lines across
   multiple products), this is the *distinct set* of affected products,
   locked in ascending `id` order (see Fix C) — the same "acquire in one
   deterministic global order" discipline the Migration 186 bins lock already
   uses, extended to cover locking more than one row of the same table.
2. **Existing bins for that product** — the Migration 186 outgoing order,
   `ORDER BY warehouse_id, id FOR UPDATE` (no-op when none exist)
3. **Target bin** — `SELECT … FOR UPDATE` on `(product, warehouse)`, then
   insert-or-update from the locked snapshot
4. **Product projection** — re-`SUM` bins and `UPDATE products` while still
   holding (1)

Outgoing already does (2) then (3) then (4) without (1). Incoming today does
a single-bin (3) then an unlocked (4). `rpc_cancel_stock_adjustment` today
does (3)-equivalent (a plain `UPDATE bins`, which row-locks implicitly) then
(4)-equivalent, also without (1) — and it can do this for several different
products across the lines of one adjustment. Putting (1) on incoming alone
deadlocks with outgoing, and separately with cancellation:

- incoming holds `products`, waits for `bins`
- outgoing holds `bins`, waits for `products`
- cancellation holds a `bins` row (from its `UPDATE bins`), waits for
  `products` (its later `UPDATE products`) — same shape as the outgoing case

So outgoing 9-arg/10-arg and `rpc_cancel_stock_adjustment` must all take (1)
**before** (2) in the same migration. That is lock-order compatibility, not a
claim that outgoing or cancellation have RED-A or RED-B.

```text
incoming/outgoing (after 191)
  products  FOR UPDATE          ← always exists; serializes the SKU
  bins*     FOR UPDATE ORDER BY warehouse_id, id
  bins[wh]  FOR UPDATE / insert from locked snapshot
  SUM bins → UPDATE products    ← recompute under the product lock

rpc_cancel_stock_adjustment (after 191)
  DISTINCT product_id FOR UPDATE ORDER BY id  ← every product this adjustment touches, locked up front
  (existing per-line loop, unchanged: SLE cancel + reversal, bins UPDATE, re-SUM, products UPDATE)
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

### Fix C — lock-order compatibility for `rpc_cancel_stock_adjustment`

Not a RED-A/RED-B remediation — cancellation has neither defect today, since
it only ever operates on bins that already exist (it is reversing a
previously-posted adjustment) and its per-line `SUM`/`UPDATE products` is not
racing a first-bin creation. This is purely a lock-order change so
cancellation cannot deadlock against the newly-fixed incoming/outgoing.

Mechanically, before the existing per-line loop (which is otherwise
untouched):

- collect the distinct `product_id`s referenced by the non-cancelled SLEs
  this call is about to reverse (the same set the existing loop already
  iterates over, just gathered up front instead of discovered line by line)
- `SELECT … FROM products WHERE id = ANY(...) AND org_id = v_adj.org_id
  ORDER BY id FOR UPDATE` — lock all of them, in ascending `id` order, before
  touching any `bins` row
- run the existing loop exactly as today (cancel SLE, reverse SLE, `UPDATE
  bins`, re-`SUM`, `UPDATE products`) — every product it touches is already
  locked, so this is not a new correctness change, only a new precondition

The `ORDER BY id` matters for a second reason beyond incoming/outgoing
compatibility: two concurrent cancellations whose adjustments share more than
one product, locked in different orders, would deadlock against *each other*
even with the new prefix. A single deterministic order removes that
regardless of which adjustment a given cancellation call is processing.

This does not touch the adjustment-header lock (`stock_adjustments … FOR
UPDATE`, unrelated resource, unchanged), the `wardah_assert_org_admin` gate,
the `LATER_STOCK_MOVEMENT_EXISTS` fail-closed check, or the reversal SLE
shape (`'Stock Adjustment Reversal'`, negated quantities, restored
`qty_after_transaction`/`valuation_rate`/`stock_value`/`stock_queue` from the
prior surviving entry).

`rpc_complete_manufacturing_order` is the sixth `products`-writer found in the
sweep and needs none of this: its body has zero references to `bins`
anywhere, so it has no `bins` lock to invert against the new order. It stays
out of scope (§5).

### Why a product-row lock is the right shared prefix

| Candidate | RED-A | RED-B | Outgoing/cancellation compatibility | Notes |
|---|---|---|---|---|
| Product `FOR UPDATE` at start + re-SUM | yes | yes | yes, if outgoing and cancellation take it first, cancellation in a deterministic multi-row order | Lock target exists before any bin |
| Outgoing-style "lock all bins" only | no (no row) | no (no rows) | already live for outgoing; does not help cancellation's order at all | Empty `FOR UPDATE` is a no-op |
| Advisory lock on `(org, product)` only | yes | yes | extra lock space next to row locks; still needs a deterministic multi-key order for cancellation | Works, but diverges from the 186 row-lock style already on outgoing |
| `SERIALIZABLE` on the RPC | maybe | maybe | session default is READ COMMITTED; SSI aborts are a new client contract | Rejected |
| Relative `ON CONFLICT` upsert only | only if queue is re-derived | no | n/a | Does not touch `products`; does not touch cancellation's order at all |
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

Replace, in one file, all five bodies:

1. `wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)` — 9-arg, receipts / manual movement
2. `wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)` — 10-arg, stock adjustment
3. `wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)` — 9-arg
4. `wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)` — 10-arg
5. `rpc_cancel_stock_adjustment(uuid,text)` — lock-order prefix only (Fix C); no RED-A/RED-B logic change

Carry forward, verbatim except for the two fixes and the lock-order prefix
(items 1–4 below apply to the four stock-write helpers; `rpc_cancel_stock_adjustment`
carries forward everything listed in Fix C above, changing only its lock order):

- Valuation: FIFO / LIFO / weighted average, including queue rewrite
- SLE insert (incoming positive qty; outgoing negative qty and COGS)
- 10-arg source-line guards (`STOCK_SOURCE_LINE_REQUIRED` /
  `STOCK_SOURCE_LINE_MISMATCH`) and `source_line_id` storage
- Outgoing reservation floor (`INSUFFICIENT_UNRESERVED_STOCK`) and
  `BIN_NOT_FOUND` / `INSUFFICIENT_STOCK`
- 9-arg incoming early `NO_WAREHOUSE_OR_QTY` JSON return
- `search_path`: 9-arg incoming is `public`; 10-arg incoming and both
  outgoing overloads are `'public', 'pg_temp'` — keep each as it is
- **`rpc_cancel_stock_adjustment`'s ACL is unrelated to the rule below and must
  not change:** it is `GRANT ALL ... TO authenticated` and `TO service_role`
  today (it is a legitimate client-facing, `wardah_assert_org_admin`-gated
  RPC, not an internal helper). Fix C touches only its lock order, never its
  grants. The ACL discussion immediately below is scoped to the four
  stock-write helpers only.
- **ACL (the four stock-write helpers only): all four bodies are currently
  `service_role`-only in effect**
  (confirmed by the live-schema baseline dump in §2, which renders the
  resulting state as `REVOKE ALL FROM PUBLIC; GRANT ALL TO service_role` —
  that rendering is pg_dump's normalized summary of the *effective* ACL, not
  the literal historical DDL). The actual migrations that produced this state
  use varied, non-uniform statements: Migration 94 granted the 9-arg overload
  `GRANT EXECUTE ... TO authenticated`; Migration 95 closed it
  (`REVOKE ALL ... FROM PUBLIC` + `REVOKE EXECUTE ... FROM authenticated`,
  "P0-2"); Migration 97's `CREATE OR REPLACE` silently reintroduced the same
  `GRANT EXECUTE ... TO authenticated` line; Migration 101 revoked it again,
  explicitly noting in its own comment that it was reversing 97
  ("إعادة إغلاق ثغرة wardah_apply_stock_incoming (عكستها 97)"). Migration 187's
  10-arg overloads instead use three separate statements per function
  (`REVOKE ALL ... FROM PUBLIC`, `REVOKE ALL ... FROM anon`,
  `REVOKE ALL ... FROM authenticated`) plus `GRANT EXECUTE ... TO service_role`
  — not a single collapsed `REVOKE ALL FROM PUBLIC`.

  Given a grant was silently reintroduced by a `CREATE OR REPLACE` once
  already (94→95 closed, then 97's replace reopened it), Migration 191 must
  not treat "leave ACL alone" as implicit safety. `CREATE OR REPLACE
  FUNCTION` does not itself reset an existing ACL, but 191 should not rely on
  that as the only guarantee: it must **explicitly re-issue**, for all four
  overloads, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` followed by
  `GRANT EXECUTE ... TO service_role`, and the migration's own postflight
  must call `has_function_privilege('anon', ..., 'EXECUTE')`,
  `has_function_privilege('authenticated', ..., 'EXECUTE')`, and
  `has_function_privilege('service_role', ..., 'EXECUTE')` on each of the
  four signatures, asserting `false, false, true`. This does not change any
  currently-live permission — it makes 191 re-prove the invariant instead of
  inheriting it silently, which is exactly what 101 had to do by hand after
  97 broke it wordlessly.
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

### Incoming vs cancellation (new control)

Before 191: not exercised by the RED proof or any existing acceptance script
— a genuine gap, not a scenario that was checked and found safe. After 191:
both take `products` first (cancellation locks the distinct product set it
will touch, incoming locks its one product). Whichever acquires the shared
product row first proceeds through its own bins/SLE work; the other queues
on `products`, never on `bins`. No circular wait is possible because neither
function acquires a `bins` lock before its `products` lock anymore.

### Outgoing vs cancellation (new control)

Same shape as incoming vs cancellation: both take `products` first (outgoing
locks its one product before its `ORDER BY warehouse_id, id` bins lock;
cancellation locks its distinct product set before its per-line bins
`UPDATE`s). This is the scenario the Codex review on #236 identified as
missing and the reason Fix C exists — before Fix C, outgoing holding
`products` and waiting on `bins` while cancellation held a `bins` row and
waited on `products` was a genuine circular wait, not a hypothetical one.

### Cancellation vs cancellation (new control)

Two concurrent cancellations whose adjustments share more than one product
each lock their own distinct product set in ascending `id` order (Fix C).
Two sets sharing elements, both ordered the same way, cannot form a cycle —
the standard proof for lock-ordering deadlock avoidance. This control exists
specifically to catch a regression if a future edit locks cancellation's
product set in adjustment-line order (arbitrary, whatever order the SLEs
happen to iterate in) instead of a fixed order like `id`.

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
| New: incoming vs cancellation, existing bin | no deadlock; cancellation's reversal and incoming's addition both land; `bins`/`products` reflect both effects in whichever order they actually applied |
| New: outgoing vs cancellation, existing bin | no deadlock — this is the exact scenario Codex's review found missing pre-Fix-C; must be run against a pre-Fix-C build first and shown to deadlock/hang, then shown fixed post-191, so the control itself is proven to catch the regression it exists for |
| New: cancellation vs cancellation, overlapping multi-product adjustments | no deadlock regardless of which adjustment's transaction starts first; both `products` rows end up correctly reversed |
| Static contract, both incoming overloads | product `FOR UPDATE` appears before bins `FOR UPDATE`; `actual_qty = EXCLUDED.actual_qty` is **absent**; unlocked `SUM`→`UPDATE products` without a preceding products lock is **absent** |
| Static contract, both outgoing overloads | product `FOR UPDATE` appears before the all-bins `FOR UPDATE` |
| Static contract, `rpc_cancel_stock_adjustment` | a `products ... FOR UPDATE ... ORDER BY id` (or equivalent ordered multi-row lock) appears before the first `UPDATE bins` in the function body |

10-arg incoming is Production's stock-adjustment path. The red proof only
covered it statically. GREEN should add **one** behavioral 10-arg first-bin
race (adjustment qty pair with distinct `source_line_id`s) so a 9-arg-only
fix cannot ship. If that forces too much adjustment-header fixture, say so
in the implementation PR and keep a named gap; do not silently skip it.

The outgoing-vs-cancellation and cancellation-vs-cancellation scenarios need
a multi-line stock-adjustment fixture (at least one adjustment touching two
products) to actually exercise the ordered multi-row product lock in Fix C —
a single-product adjustment cancellation would pass even with an unordered
or missing lock, the same way RED-B's two-warehouse shape was needed to catch
what a single-warehouse fixture couldn't. Do not settle for a single-product
cancellation fixture and call this control covered.

CI: a new workflow on the green script against cutoff+191, plus the
existing red workflow still running against a database **without** 191
(same pattern as 186's red/green pair).

---

## 8. Runbook framing (required prose)

The 191 runbook is not a "stock incoming lock upgrade." It is:

> Two independent remediations plus one lock-order compatibility update,
> bundled because all three live in functions that share the same
> `products`/`bins` state and because the lock order must be installed
> everywhere at once or it isn't a real invariant.
>
> - Fix A closes RED-A (`bins` unique-key insert / stale `EXCLUDED`).
> - Fix B closes RED-B (`products` aggregate from an unlocked `SUM`).
> - Fix C reorders `rpc_cancel_stock_adjustment`'s locking (products before
>   bins, in a deterministic multi-row order) so it cannot deadlock against
>   the newly-fixed incoming/outgoing — it has neither RED-A nor RED-B, this
>   is compatibility only.
> - Outgoing 9-arg and 10-arg take the same product-row lock first so
>   incoming vs outgoing cannot deadlock.

It must also record:

- additive only; no history rewrite; no `ADJ-000001` repair
- rollback = restore the five previous bodies from Migrations 97, 124, 186,
  and 187 (cite the files). That restores **all three** changes together —
  RED-A, RED-B, and cancellation's lock order all revert as one unit. There
  is no supported "roll back Fix A, keep Fix B" or "keep Fix C but not A/B"
- The *effective* permission on the four stock-write helpers
  (`service_role`-only) is unchanged by this migration, but 191 must still
  explicitly re-issue `REVOKE ALL ... FROM PUBLIC, anon, authenticated` +
  `GRANT EXECUTE ... TO service_role` for each of those four signatures, and
  verify with `has_function_privilege()` in postflight — per §5, this is not
  a grant change, it is re-proving an invariant that a prior `CREATE OR
  REPLACE` (97) already broke silently once. `rpc_cancel_stock_adjustment`'s
  ACL (`authenticated` + `service_role`) is untouched — Fix C is a body-only,
  lock-order-only change
- Production apply requires a separate authorization, preflight (ledger
  head, all five signatures, ACLs on the four stock-write helpers,
  search_path), apply-once, postflight (`pg_get_functiondef` contract on all
  five), and **no** Production concurrency test against live vouchers
- Merging 191 onto `main` does not close the Production gap; 170 sat
  merged-but-unapplied (`PERMISSION_HARDENING_170_173_CHAIN.md` §6)

---

## 9. Implementation gate (still later; not this package)

Do not write SQL until this design is accepted. Then, in
`wardah-process-costing`, in a new tracking issue:

1. Open the issue (do not reopen #228 as if the proof were missing).
2. Add `sql/migrations/191_…sql` with preflight, **five** replaces (incoming
   9/10-arg, outgoing 9/10-arg, `rpc_cancel_stock_adjustment`), explicit ACL
   restatement on the four stock-write helpers only (`REVOKE ALL FROM
   PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` per
   signature — not granting anything new, but not silently inherited
   either; `rpc_cancel_stock_adjustment`'s existing `authenticated` +
   `service_role` grants are left alone), and an in-migration postflight
   that asserts `has_function_privilege()` is `false` for
   `anon`/`authenticated` and `true` for `service_role` on the four stock-
   write signatures, plus a static lock-order assertion on
   `rpc_cancel_stock_adjustment` (per §7's contract row).
3. Add the green acceptance script + workflow, including the three new
   cancellation controls (§6, §7) with a multi-product adjustment fixture;
   leave the red proof intact.
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
- it relies on `CREATE OR REPLACE` leaving the ACL alone instead of
  explicitly re-issuing the revoke/grant, or omits the `has_function_privilege()`
  postflight — the 94→95→97→101 history is the reason this is required, not
  a stylistic preference
- it ships Fix A/B without also fixing `rpc_cancel_stock_adjustment`'s lock
  order (Fix C) — this is the exact gap Codex found in review; leaving it
  out reintroduces the incoming/outgoing-vs-cancellation deadlock this whole
  migration exists to prevent
- it locks `rpc_cancel_stock_adjustment`'s affected products in adjustment-
  line order (or any order not fixed and deterministic, e.g. `ORDER BY id`)
  instead of a stable global order — this passes a single-product fixture
  and deadlocks on a real multi-product adjustment or against a concurrent
  cancellation
- it changes `rpc_cancel_stock_adjustment`'s ACL (it must stay `authenticated`
  + `service_role` — Fix C is lock-order only) or any of its existing
  behavior (`wardah_assert_org_admin`, `LATER_STOCK_MOVEMENT_EXISTS`,
  reversal SLE shape)
- its green acceptance for cancellation uses only a single-product
  adjustment fixture, which cannot distinguish an ordered lock from an
  unordered or missing one
