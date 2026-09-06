# F2 Stock Bin Race — Fix Design (targets Migration 191)

**Status:** design only. No SQL in this document, no migration file, no Production
access. This is the artifact the next implementation PR is built from.
**Tracking:** follow-up to #228 (closed at the RED-proof merge, PR #235,
`main@eada076a98cf9b5391bebdcec550159d22c5da0b`). Remediation is tracked as a new
issue, not a reopen of #228.
**Confirmed defects this design closes:** RED-A (first-bin insert race) and RED-B
(product-aggregate race), both documented with live evidence in
`docs/db/F2_STOCK_BIN_RACE_RED_PROOF.md`.

## Recap: why these are two defects, not one

- **RED-A** — `wardah_apply_stock_incoming` reads the target `bins` row with
  `SELECT ... FOR UPDATE`, but a row that does not exist yet cannot be locked. Two
  concurrent first-bin calls for the same `(product, warehouse)` both compute from
  `v_prev_qty = 0`; the second's `INSERT ... ON CONFLICT (product_id, warehouse_id) DO
  UPDATE SET actual_qty = EXCLUDED.actual_qty` blindly overwrites the first's insert.
- **RED-B** — the same function's tail does an unlocked `SELECT SUM(actual_qty) ...
  FROM bins` followed by `UPDATE products SET stock_quantity = ...`, with no lock
  spanning either. Two concurrent calls against *different* warehouses for the same
  product each write their own bin correctly, but each one's `SUM` only sees its own
  uncommitted bin, and the second `UPDATE products` overwrites the first's
  contribution.

A fix for RED-A alone (e.g. only changing how the `bins` row is created) does not
touch the unlocked `SUM`/`UPDATE products` step at all — RED-B survives untouched. A
fix for RED-B alone (locking only at the aggregate tail) still leaves the earlier
`bins` insert racing on its unique key. They must both be closed, and neither closes
the other by accident.

## Why they are fixed in one migration anyway

Both bugs live inside the same four function bodies:
`wardah_apply_stock_incoming(...9 args...)`, `wardah_apply_stock_incoming(...10
args, p_source_line_id...)` (Migration 187), and their two
`wardah_apply_stock_outgoing` counterparts. Whatever lock/serialization strategy
closes RED-A has to be threaded through the same function that then runs into RED-B a
few statements later — there is no natural seam to split "the RED-A fix" from "the
RED-B fix" inside one function body without either fixing both in the same edit or
leaving the function in a half-fixed, internally inconsistent state.

Worse, if incoming's lock order changes but outgoing's does not, that alone is a new
regression risk (see **Deadlock analysis** below) — so outgoing has to move in the same
change for the fix to be safe, not as a courtesy.

Splitting this into two migrations would mean a second `CREATE OR REPLACE FUNCTION`
landing immediately after the first, replacing the same four function bodies again.
That is exactly the pattern CLAUDE.md's `has_permission()` (170–173) and
`rpc_get_trial_balance` (182–183) chains warn about: the live contract becomes
"whichever body landed last," a partial rollback cannot cleanly drop one fix without
the other, and any later reader has to reconstruct the union of two migrations to know
what is actually live. One migration, one CI-verified GREEN state, one rollback unit.

## The serialization point: lock `products` first, not `bins`

The design locks the product row *before* touching any `bins` row, and holds that lock
for the whole incoming/outgoing call:

```
SELECT ... FROM products WHERE id = p_product AND org_id = p_org FOR UPDATE;
-- (existing NOT FOUND / valuation_method handling stays exactly as today)
-- ... only now read-or-create/update the target bin, and only now SUM+UPDATE products ...
```

This single change closes both defects at once, because both bugs are really the same
underlying problem — mutating a product's stock state without first claiming
exclusive access to that product's state — expressed at two different points in the
function:

- **RED-A** is closed because the first transaction to reach the lock excludes every
  other transaction (for this product, any warehouse) from touching `bins` until it
  commits. There is no more "two transactions both see an absent row" window: the
  second transaction blocks on the product lock itself, not on a `bins` unique-key
  insert it can't see coming.
- **RED-B** is closed because the `SUM(actual_qty)` read and the `UPDATE products`
  write now happen inside the same held lock that serialized the `bins` write. No
  other transaction can insert or update a bin for this product between the `SUM` and
  the `UPDATE`, because doing so requires the same product lock this transaction is
  still holding.

This does trade away cross-warehouse parallelism for the same product (two incoming
calls to different warehouses of the same product now serialize instead of racing) —
that is the correct trade per #228's fix boundary ("preserve product aggregation
across warehouses"), and it is the same trade `wardah_apply_stock_outgoing` already
makes today for its own multi-bin `SUM` (see below).

### Why not just fix the `ON CONFLICT` clause instead

A smaller-looking fix would be to change `ON CONFLICT (product_id, warehouse_id) DO
UPDATE SET actual_qty = EXCLUDED.actual_qty` into a *relative* update — e.g.
`actual_qty = bins.actual_qty + EXCLUDED.actual_qty` — so the loser's write adds to
whatever is there instead of overwriting it. That patches the `actual_qty` scalar, but
`stock_queue` (the FIFO/LIFO lot array) is not a scalar: each concurrent call computes
its own `v_new_queue` by appending to (or consuming from) the `v_prev_queue` it read,
which was already stale for the same reason `v_prev_qty` was stale. There is no SQL
expression that merges two independently-computed FIFO/LIFO queues after the fact into
the queue that would have resulted from applying both transactions in some real order
— the merge has to happen by construction, i.e. by making the second transaction
actually read the first transaction's *committed* queue before computing its own. That
requires the same serialization this design already provides; a relative-arithmetic
patch to `ON CONFLICT` cannot substitute for it and would leave FIFO/LIFO valuation
silently wrong even after "fixing" the visible quantity bug.

Once the product lock is held for the duration of the call, the existing `INSERT ...
ON CONFLICT DO UPDATE` structure is no longer unsafe in principle — nothing can
interleave once the lock is held. This design still replaces it with an explicit
read-or-insert (`IF FOUND ... ELSE INSERT ...` on the locked `bins` row) rather than
keeping `ON CONFLICT`, for one reason: correctness should not depend on a reader
noticing that "this `ON CONFLICT` is safe *because* something upstream holds a lock."
A future edit that touches this function without full context could reintroduce the
race by innocuously reordering statements; an explicit read-then-branch makes the
dependency on "we already hold the row we're about to write" visible in the code
itself, not just in a comment.

## Outgoing must move in the same migration

`wardah_apply_stock_outgoing` (both overloads) already does something close to right
for its own multi-warehouse aggregate: it locks *every* existing bin for the product
before reading or writing any of them —

```
PERFORM 1 FROM bins WHERE org_id = p_org AND product_id = p_product
ORDER BY warehouse_id, id FOR UPDATE;
```

— which is why Control 1 and Control 2 in the RED proof show outgoing behaving
correctly against an *existing* bin. But it never locks the `products` row itself
before that step; it only reaches `products` at its own tail `UPDATE`.

If Fix A changes incoming's lock order to **products → bins** while outgoing keeps
**bins → products**, that is a lock-order inversion between two functions that
legitimately run concurrently against the same product, and it is a textbook
deadlock:

- Txn 1 (incoming, fixed): holds `products` lock, blocks trying to lock `bins`.
- Txn 2 (outgoing, unfixed): holds `bins` lock (from its `ORDER BY ... FOR UPDATE`),
  blocks trying to update `products` at its tail.

Neither can proceed; PostgreSQL's deadlock detector eventually kills one, surfacing as
a new, unexplained `40P01 deadlock detected` error under load that did not exist
before this fix — a regression introduced by fixing something else, on a path #228
explicitly asks to be checked ("exercise incoming versus outgoing lock ordering").

The fix: add the same `SELECT ... FROM products ... FOR UPDATE` as the first
statement in both `wardah_apply_stock_outgoing` overloads too, before their existing
`ORDER BY warehouse_id, id FOR UPDATE` on `bins`. Outgoing already reads
`valuation_method` from `products` first (with a `NOT FOUND` → `RAISE EXCEPTION
'PRODUCT_NOT_FOUND_OR_WRONG_ORG'` it does not have today) as its very first query;
adding `FOR UPDATE` to that existing statement is a one-line change that preserves its
current behavior exactly and gives every code path the same global lock order:
**products, then bins, always.** With one consistent order enforced everywhere,
circular wait — the necessary condition for deadlock — cannot arise between these four
functions, regardless of which one starts first.

## What does not change

- Reservation-floor logic in outgoing (`v_other_mo_reserved` / `INSUFFICIENT_STOCK`
  checks) — untouched, sits after the new lock, same as before it sat after the old
  `PERFORM ... FOR UPDATE`.
- FIFO/LIFO/weighted-average valuation math — untouched; only *when* it is safe to
  read the prior state changes, not how the new state is computed from it.
- The existing `NOT FOUND` / permissive-default behavior when `p_product` doesn't
  resolve to a row in `products` (incoming silently defaults to `'Weighted Average'`
  today; outgoing raises). This design does not tighten or loosen that — it is a
  separate, orthogonal decision and out of scope here.
- Source-line validation for stock adjustments on the 10-arg overload — untouched,
  runs before the new lock exactly as the existing `p_source_line_id` checks run
  before the existing `bins` lock today.
- `ADJ-000001` historical duplicate — not touched, per #228's explicit exclusion.
- Global uniqueness across unrelated vouchers — not introduced, per #228's explicit
  exclusion.
- Manufacturing completion's no-bin `products` write path flagged in the Round 3
  inventory notes — out of scope for this design; it is a different call site, not a
  defect in `wardah_apply_stock_incoming`/`outgoing` themselves, and should be its own
  issue if it needs one.

## Migration mechanics

- **Number:** 191 (190 is `material_consumption_authorization_boundary`, already on
  `main` from the F1 fix — 191 is the next free number as of this design).
- **Shape:** one additive migration, `CREATE OR REPLACE FUNCTION` on all four targets
  (`wardah_apply_stock_incoming` 9-arg and 10-arg, `wardah_apply_stock_outgoing` 9-arg
  and 10-arg). No table changes, no new columns, no new indexes required — the
  existing `bins` unique index and row-level locking primitives are sufficient once
  the lock order is corrected.
- **Guard:** per `scripts/ci/check_definer_guards.py`'s expectations, these stay
  `SECURITY DEFINER` with the same ACLs they have today (incoming: `service_role`
  only per Migration 187's tightening; outgoing: whatever its current live grants
  are) — this migration does not change who can call them, only what happens once
  they're called.
- **Fresh DB acceptance:** invert `acceptance_f2_stock_bin_race_red.sh` into a GREEN
  sibling that runs the *same* four scenarios (RED-A shape, existing-bin control,
  RED-B shape, incoming-vs-outgoing control) against post-191 functions and asserts
  the *correct* sums (12/120 for RED-A's shape, 15/240/rate 16 for RED-B's shape)
  instead of the documented lost-update values. The existing RED script is not
  edited, deleted, or repointed at post-191 functions — it stays exactly as merged,
  a permanent, CI-checked record that the defect was real on pre-191 functions,
  per the project's golden rule against rewriting historical evidence.
- **New deadlock-regression check:** the GREEN suite should add a fifth scenario the
  RED proof didn't need — concurrent incoming and outgoing on an existing bin *without*
  a pre-seeded external blocker (i.e. the two callers racing to acquire the new
  `products` lock directly against each other, not against a third blocker
  transaction) — to positively demonstrate the new lock order resolves without
  deadlock under real contention, not just under the RED proof's forced blocker
  handshake.

## Open questions for review before implementation

1. **Redundant `bins` `FOR UPDATE` after the `products` lock.** Once `products` is
   locked first, the existing `SELECT ... FOR UPDATE` on the target `bins` row (in
   incoming) or the `ORDER BY ... FOR UPDATE` over all bins (in outgoing) is no longer
   load-bearing for correctness — but keeping it is harmless and keeps the function
   defensible in isolation (e.g. under `READ COMMITTED` if a future caller somehow
   invoked bin mutation logic without going through the locked product path). This
   design keeps both locks. Flag if you'd rather drop the now-redundant one for
   simplicity.
2. **Contention under load.** Serializing all incoming/outgoing calls per product
   (across every warehouse) is a real throughput trade-off for high-volume products
   with many warehouses. #228's fix boundary accepts this explicitly
   ("preserve product aggregation across warehouses" over per-warehouse parallelism),
   but it's worth naming before 191 ships rather than discovering it as a support
   ticket later.
3. **Whether to also tighten incoming's silent `p_product` NOT FOUND default.**
   Left unchanged in this design (see above) as out of scope, but it sits right next
   to the code this migration touches, so it's cheap to fold in *if* you want it —
   otherwise it stays exactly as permissive as it is today.

## Sequencing

This design produces no SQL. The next step, if accepted, is a separate implementation
PR containing `sql/migrations/191_*.sql`, the GREEN Fresh-DB acceptance script, and a
runbook, following the same repository-first-for-migration / DB-first-for-UI ordering
already in force (no UI depends on this fix, so there is no second PR to sequence
after it). That PR is tracked under a new issue, not a reopened #228.
