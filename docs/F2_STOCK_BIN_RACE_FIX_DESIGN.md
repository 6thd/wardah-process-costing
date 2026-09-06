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

> **Second gap note (found in review, not silently patched around): the sweep in the
> note above was the wrong sweep.** It found every function that *writes*
> `products.stock_quantity` directly. It did not find every function that *calls*
> `wardah_apply_stock_incoming`/`wardah_apply_stock_outgoing` — a caller that never
> writes `products` itself can still break the lock order by locking something else
> first. Ran the correct sweep: every live call site of either helper, traced to its
> enclosing function, cross-checked against the baseline to confirm which body is
> actually live. Two distinct problems surfaced, both real:
>
> 1. **`rpc_manual_stock_movement_v2`** (`sql/migrations/134_uom_manual_movement_and_adjustment_enforcement.sql`,
>    line 31-32) takes `SELECT ... FROM bins ... FOR UPDATE` *itself*, to read the
>    current quantity for its `'adjustment'` movement-type delta calculation, **before**
>    calling `wardah_apply_stock_incoming`/`outgoing` a few lines later. That
>    reintroduces bins-before-products at the caller level even though the callee does
>    products-before-bins internally — the exact same shape of circular wait as the
>    `rpc_cancel_stock_adjustment` gap, now for manual stock movements. Single product
>    per call, so this is a local reordering fix (Fix D below), not a multi-row lock.
>
> 2. **Four live multi-line callers loop over potentially different products per line,
>    within one transaction, calling the helper once per line, without first locking
>    the full distinct product set** — the same shape of problem Fix C already solves
>    for `rpc_cancel_stock_adjustment`, just not yet generalized past that one
>    function: `rpc_post_goods_receipt` (`177_goods_receipt_number_sequence.sql`,
>    confirmed the live definition), `rpc_post_delivery_note`
>    (`133_uom_atomic_receipt_and_delivery.sql`, confirmed live, no later replace),
>    `rpc_submit_stock_adjustment` (`187_stock_adjustment_ledger_idempotency.sql`,
>    confirmed live), and `rpc_consume_reserved_materials_v2`
>    (`190_material_consumption_authorization_boundary.sql`, confirmed live — this is
>    F1's own fix, so 190 already touched this function once for an unrelated reason).
>    Each individually calls the now-correctly-ordered helper per line, but nothing
>    stops two such callers from processing an overlapping product set in reversed
>    order across their own lines and deadlocking on `products` between themselves —
>    Fix A/B/C only guarantee *one* call's internal order, not the order across
>    *multiple* calls issued by the same outer transaction.
>
> Also confirmed **not** part of this problem, so the scope stops here:
>  `rpc_consume_reserved_materials` and `consume_materials_for_mo` are thin SQL
> wrappers that delegate to `rpc_consume_reserved_materials_v2` and inherit its fix
> automatically; `backflush_materials` loops over BOM lines but only inserts into
> `material_consumption` with `status = 'PENDING'` — it never references `bins` or
> `products` at all (consistent with it already being flagged and quarantined as a
> broken legacy path in the F1 work on PR #233).
>
> §4 introduces a shared internal lock-order helper (generalizing what Fix C already
> did ad hoc) and Fixes D and E below; §5, §6, §7, §8, and §9 are updated to cover all
> eleven functions this migration now touches, not five.

> **Fourth correction (found in review, on a design that had already been marked
> Ready twice): the mechanism itself was wrong, not just its coverage.** Three
> problems, found in one review pass against `main` rather than against this
> document's own text:
>
> 1. **Lock mode.** Every products lock in this design was specified as `FOR UPDATE`.
>    `products.id` is referenced by 18 live foreign keys; PostgreSQL takes an implicit
>    `FOR KEY SHARE` lock on the parent row for every FK-referencing insert, and `FOR
>    KEY SHARE` conflicts with `FOR UPDATE` specifically (not with `FOR NO KEY
>    UPDATE`). `FOR UPDATE` on `products` would have been the first stock-write lock
>    strong enough to block those inserts, and it creates a genuine deadlock against
>    live `rpc_create_mo_with_reservation` (locks `bins` then implicitly `products`
>    via its `material_reservations` insert — the reverse of this design's order).
>    §4's "Incoming vs reservation" analysis, which had claimed this RPC "never takes
>    a products lock," was itself wrong for missing the implicit FK lock. Corrected
>    throughout to `FOR NO KEY UPDATE`, which still fully serializes stock writers
>    against each other but does not conflict with `FOR KEY SHARE`.
> 2. **The consumption pre-pass invariant didn't hold on `main`.** Fix E's original
>    "re-run the same per-line resolution once up front" shape is unsound for
>    `rpc_consume_reserved_materials_v2` specifically: the reservation a line resolves
>    to depends on `status = 'reserved'`, which the same call's own loop changes as it
>    consumes earlier lines, and `material_reservations.product_id` is a live,
>    client-writable-adjacent foreign key re-resolved by a trigger on `item_id`
>    changes — not stable metadata. Corrected to lock the full `status = 'reserved'`
>    superset for the MO up front (the complete universe the loop's own queries can
>    ever select from) instead of the specific rows an unlocked pre-pass guesses it
>    needs, plus a `PRODUCT_NOT_PRELOCKED` fail-closed guard applied uniformly to all
>    four Fix E functions as defense in depth.
> 3. **The new helper itself was fail-open.** As specified, a missing or wrong-org
>    product id in the input array would silently lock fewer rows than asked instead
>    of raising — the same class of gap 9-arg incoming's own fail-closed tightening
>    (§5) exists to close, just not yet applied to the function this design itself
>    introduced. Corrected to verify locked-row count against requested count and
>    raise `PRODUCT_NOT_FOUND_OR_WRONG_ORG` on mismatch, and to return the canonical
>    locked set so callers reuse it instead of each re-deriving it.
>
> §4, §5, §6, §7, and §9 are updated throughout for all three. None of RED-A, RED-B,
> or the function coverage list changes — this correction is entirely about how the
> already-identified fixes are implemented, not about which functions need them.

> **Fifth correction (found in review): the fourth correction's own pseudocode did not
> compile, and one of its invariants still didn't fully hold.** All four points below
> were checked empirically against a real PostgreSQL 17 instance, not reasoned about
> from documentation alone:
>
> 1. The shared helper combined `array_agg(...)` with `FOR NO KEY UPDATE` in one
>    query. PostgreSQL rejects any locking clause combined with an aggregate or
>    `DISTINCT` in the same query ("FOR UPDATE is not allowed with aggregate
>    functions" / "... with DISTINCT clause" — confirmed by executing both against
>    PostgreSQL 17), because the result rows can no longer be identified with
>    individual table rows to lock. Corrected the helper to lock row-by-row in a
>    `FOR ... LOOP`, collecting the locked ids into an array as it goes, instead of
>    trying to lock and aggregate in one statement. Also corrected the id-normalizing
>    subquery, which referenced an unaliased `unnest(...)` call by the bare name
>    `unnest` in its own `WHERE` clause — confirmed this fails with `column "unnest"
>    does not exist` — to `FROM unnest(...) AS u(id) WHERE u.id IS NOT NULL`.
> 2. `rpc_submit_stock_adjustment`'s Fix E was specified as `SELECT DISTINCT
>    product_id ... FOR UPDATE` — the same invalid `DISTINCT`-plus-locking-clause
>    shape as point 1, confirmed the same way. Corrected to lock the plain,
>    non-`DISTINCT` item rows (`SELECT id, product_id ... FOR UPDATE`) and derive
>    `DISTINCT product_id` from the rows the lock already produced.
> 3. The consumption superset fix from the fourth correction filtered on `status =
>    'reserved'` *inside* the locking query and called that "the complete universe."
>    It isn't: `material_reservations_status_check` only restricts `status` to five
>    valid string values — nothing prevents a client with ordinary `org_id`-gated
>    `UPDATE` access from flipping an existing `released`/`expired`/`cancelled` row
>    back to `'reserved'` mid-transaction, and such a row was never `'reserved'` at
>    lock time, so the status-filtered lock could miss it. Corrected to lock every
>    row for the MO regardless of status first, then read `status` from the
>    now-frozen locked snapshot to derive the `'reserved'` subset — the lock itself,
>    not the filter, is what prevents the flip from mattering.
> 4. The GREEN acceptance row for the `PRODUCT_NOT_PRELOCKED` guard asserted the
>    wrong failure mode for its "guard removed" mutant ("a silent wrong result"). The
>    actual failure mode a missing guard plus a narrowed lock allows is a
>    transaction-level deadlock between two overlapping-product calls (the same shape
>    as the multi-line-caller-vs-multi-line-caller control), not silent data
>    corruption in a single run. Split into three explicit mutants in §7: narrowed
>    lock with the guard present (must raise `PRODUCT_NOT_PRELOCKED`), narrowed lock
>    with the guard removed under reversed-order concurrency (must be able to
>    reproduce a genuine deadlock), and the real fix (neither).
>
> Also fixed the internal contradiction where the goods-receipt paragraph said "no
> guard needed" immediately before the design required the guard on all four Fix E
> functions uniformly — reworded to "no superset/source-row lock needed; the uniform
> guard still applies here too."

> **Sixth correction (found in review): the fifth correction's own fix still had a
> real gap and a placement error, both confirmed against the live Migration 190 and
> 134 bodies.**
>
> 1. **Effective product, not the bare column.** `material_reservations.product_id`
>    is nullable (confirmed against the live table definition — `product_id uuid`,
>    no `NOT NULL`), and the loop never trusts it alone: it computes `v_product :=
>    COALESCE(v_res.product_id, wardah_resolve_product_id(v_org, v_res.item_id,
>    now()))`. The superset fix as previously written derived its locked product set
>    from `product_id` directly, and the shared helper's own input-normalization
>    drops `NULL`s — so a reservation with a `NULL` `product_id` (resolvable only
>    through `item_id`) would never be locked, and the loop would later hit its real,
>    valid, resolved product outside the locked set. Corrected to derive the locked
>    set using the identical `COALESCE(...)` expression the loop uses, and made the
>    `PRODUCT_NOT_PRELOCKED` guard explicitly `NULL`-safe (`v_product IS NULL OR NOT
>    COALESCE(v_product = ANY(v_locked_products), false)` — a bare `IF NOT v_product =
>    ANY(...)` silently lets a `NULL` product through, since `NULL = ANY(...)`
>    evaluates to `NULL`, not `false`).
> 2. **Fix D's lock came one read too late.** `rpc_manual_stock_movement_v2` has an
>    earlier, *unlocked* `bins` read than the one this design's Fix D targeted: when
>    the caller omits `warehouse_id`, an inference query
>    (`SELECT count(*), min(warehouse_id) FROM bins WHERE ... product_id = v_product`)
>    runs before the locked read Fix D was placed in front of. Corrected to take the
>    products lock before that inference query, not just before the later `FOR
>    UPDATE` read — otherwise a concurrent transaction could create a second bin for
>    the product in a different warehouse between inference and lock, making the
>    already-inferred warehouse stale.
> 3. **A GREEN mutant fixture didn't actually test what it claimed to.** The
>    guard-regression mutant 2 (§7) used the same `mo_id` for both concurrent
>    `rpc_consume_reserved_materials_v2` calls. Since this function's first statement
>    locks `manufacturing_orders WHERE id = p_mo_id FOR UPDATE`, two calls on the same
>    MO fully serialize there and never reach product-level contention — the mutant
>    would pass by construction, proving nothing. Corrected to require two different
>    MOs. The adjacent superset-lock fixture had the same class of gap (two
>    reservations that could coincidentally share one product, letting a buggy
>    prelock pass by luck) and is now required to use genuinely different effective
>    products.
>
> §4 and §7 updated for all three; the reject-list in §9 gained matching bullets so a
> future implementation that reintroduces any of these three specific errors is
> caught by the checklist, not only by re-deriving the reasoning above.

> **Seventh correction (found in review, fresh Codex pass on `64fdc35`): two §7
> mutant constructions did not test what they claimed to, because they confused
> *caller-side* traversal order with the *helper's* actual lock-acquisition order.**
>
> Fix C (`rpc_cancel_stock_adjustment`) and the `rpc_consume_reserved_materials_v2`
> superset fix both compute the *complete distinct* product set for the whole call
> **before** any per-line/per-reservation work runs, then call
> `wardah_lock_products_for_stock_write` **once** with that set. That function's own
> locking query is `SELECT ... WHERE id = ANY(v_wanted) ORDER BY id FOR NO KEY UPDATE`
> — a single set-based query that sorts ascending by `id` regardless of what order the
> caller's array lists elements in. Two consequences follow that the previous text
> missed:
>
> 1. "Reversed line/traversal order between the two adjustments" (cancellation-vs-
>    cancellation) and "reversed-order concurrency" (consumption guard mutant 2) never
>    reach the helper's own query at all — by the time either reaches the helper, the
>    line/traversal order has already been collapsed into a *set*. Reversing how an
>    adjustment's lines are stored or iterated cannot change which element the
>    helper's `ORDER BY id` visits first.
> 2. Even the previously-specified way to build the "ordering removed" mutant build —
>    "run this fixture once against a build with the ascending-`id` ordering
>    removed" — just deletes the `ORDER BY` clause and hopes PostgreSQL happens to
>    scan the *same* two-element set in *different* physical orders across two
>    separate calls with identical input. Nothing guarantees that: the planner is
>    free to (and typically will) return the same scan order for the same query
>    against the same unchanged data both times, so the mutant could pass GREEN
>    while carrying no real ordering guarantee at all — exactly the false-negative
>    Codex flagged.
>
> Both mutants are corrected in §7 to force the crossed order directly instead of
> hoping for it: the "ordering removed" mutant build changes
> `wardah_lock_products_for_stock_write`'s locking query from a sorted set-based
> `SELECT ... ORDER BY id FOR NO KEY UPDATE` loop to `FOR v_id IN SELECT u.id FROM
> unnest(p_product_ids) WITH ORDINALITY AS u(id, ord) ORDER BY u.ord LOOP PERFORM 1
> FROM public.products WHERE org_id = p_org AND id = v_id FOR NO KEY UPDATE; ... END
> LOOP` (confirmed to compile and to preserve input order — not sort it — against a
> real PostgreSQL 17 instance: an array passed in as `[B, A]` locks B then A, not A
> then B) that locks each element **in the exact order the caller's array lists it**,
> with no de-duplication or re-sorting — the shape a real regression would actually
> take. The two fixture
> transactions are then given arrays in explicitly opposite, test-controlled order
> (adjustment 1's items inserted A-then-B, adjustment 2's B-then-A; the two
> `rpc_consume_reserved_materials_v2` calls' MOs and reservations built the same way),
> and driven through an explicit two-step rendezvous — transaction 1 locks only its
> first array element and signals; transaction 2 starts only after that signal, locks
> only its own first element (the other product, because its array lists it first),
> and signals; only then are both released to attempt their second lock — so the
> circular wait is constructed directly and proven via `pg_stat_activity.wait_event_type
> = 'Lock'` on **both** backends simultaneously (matching the RED-A/RED-B standard),
> not inferred from a timeout. The real-191 run of the same fixture (helper
> unmodified, `ORDER BY id` intact) must not deadlock — and now has a stated reason
> why: both transactions' arrays contain the same two products, so the real helper's
> `ORDER BY id` makes both of them attempt to lock the *same* (lower-`id`) product
> first regardless of the caller's array order, so one simply queues behind the other
> for a single row instead of each holding one and waiting on the other. The static
> contract row for `wardah_lock_products_for_stock_write` (§7) gained a requirement
> that `ORDER BY` on the primary-key/id column appear in the locking query itself
> (not only in the earlier `ARRAY(SELECT DISTINCT ... ORDER BY ...)` normalization
> step) — a static check on the property the dynamic mutant exists to catch, per
> Codex's "or otherwise verify the acquired sequence" alternative.
>
> The multi-line-caller-vs-multi-line-caller "Fix E omitted" row is unaffected and is
> not a case of this same error: with Fix E omitted, each line still calls
> `wardah_apply_stock_incoming`/`outgoing` separately, and each of those locks a
> single product row at the exact point the caller's own per-line loop reaches it —
> there is no batching helper in that build for the caller's line order to be
> collapsed by, so reversed line order there does directly reverse the actual lock
> sequence.

---

## 1. Decision

**One additive migration. One PR. Two independent defect fixes plus a single
lock-order contract, installed consistently at every place that contract can
be broken, bundled for locality.**

Not two PRs. Not two successive migrations that each `CREATE OR REPLACE` the
same functions. Not a lock-order fix scoped to "the four functions Astra's
audit named" while leaving other callers of those functions unexamined.

The runbook must say, in those words, that RED-A and RED-B are independent
defects that both live in the two incoming overloads; that outgoing,
`rpc_cancel_stock_adjustment`, and `rpc_manual_stock_movement_v2` are touched
only for lock-order compatibility; that `rpc_post_goods_receipt`,
`rpc_post_delivery_note`, `rpc_submit_stock_adjustment`, and
`rpc_consume_reserved_materials_v2` are touched to install the same contract
at the transaction level, not the single-call level; and that all of this is
bundled so the lock-order contract is installed once, consistently, across
every function that can touch `products`/`bins` for a stock movement — not
just the ones a first, second, or third pass happened to name.

### Why not two PRs

RED-A (bins unique-key insert race) and RED-B (unlocked product-aggregate
race) touch different tables and different lock points. Fixing the bin upsert
does not close the product `SUM`. Fixing the product `SUM` at the tail, using
a precomputed partial, does not close the first-bin overwrite.

They still share a locality problem, and that problem turned out to be larger
than "the two incoming overloads plus their nearest peers":

- both bugs sit in the 9-arg and 10-arg `wardah_apply_stock_incoming` bodies
- any lock-order change on incoming that takes the `products` row **before**
  `bins` deadlocks with live `wardah_apply_stock_outgoing`, live
  `rpc_cancel_stock_adjustment` (confirmed: updates `bins` before `products`
  today), and live `rpc_manual_stock_movement_v2` (confirmed: locks a `bins`
  row itself before calling the now-reordered helper) unless all of them are
  updated in the **same** replace
- four more live functions call the helpers once per line inside a loop,
  across potentially different products, without first locking the full set
  they will touch — `rpc_post_goods_receipt`, `rpc_post_delivery_note`,
  `rpc_submit_stock_adjustment`, `rpc_consume_reserved_materials_v2` — so even
  with every helper individually fixed, two such callers touching an
  overlapping product set in reversed order can still deadlock against each
  other
- a second migration immediately after the first would replace the same
  functions again, and — worse, given how this design's own scope grew across
  three review passes — a second pass discovering a twelfth function later
  would face the exact "which migration is the real contract" problem this
  section already argues against

That last point is the 170–173 / 182–183 pattern
`CLAUDE.md` already flags. Migrations 170, 172, 173 each replaced
`has_permission()`; the live contract is their union, and any later replace
must re-assert every layer or a prior fix silently disappears. Migrations
182 and 183 replaced `rpc_get_trial_balance` the same way: replaying 182
alone reopens the security hole; replaying 183 on an old body restores the
wrong ledger. See `docs/db/PERMISSION_HARDENING_170_173_CHAIN.md` and
`docs/db/TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md`.

Splitting RED-A and RED-B across two numbered migrations would recreate that
chain on eleven objects now (`incoming` 9/10-arg, `outgoing` 9/10-arg,
`rpc_cancel_stock_adjustment`, `rpc_manual_stock_movement_v2`,
`rpc_post_goods_receipt`, `rpc_post_delivery_note`,
`rpc_submit_stock_adjustment`, `rpc_consume_reserved_materials_v2`, and the
new shared lock helper) for no operational gain. Rollback of a `CREATE OR
REPLACE` is "put the previous bodies back." One replace rolls every fix back
together; splitting them leaves a window where some callers install the new
lock order and others don't — which is worse than either state alone, since
a caller with the fix racing a caller without it is exactly a fresh instance
of the same bug this migration exists to close.

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

| Body | Last `CREATE OR REPLACE` | Role | Behavioral proof? |
|---|---|---|---|
| `wardah_apply_stock_incoming` 9-arg | Migration 97 | RED-A/RED-B live | yes (Goods Receipt) |
| `wardah_apply_stock_incoming` 10-arg | Migration 187 | RED-A/RED-B live | static `pg_get_functiondef` — adjustment path only |
| `wardah_apply_stock_outgoing` 9-arg | Migration 186 | lock-order peer, not RED-A/B | Control-2 vs incoming |
| `wardah_apply_stock_outgoing` 10-arg | Migration 187 | lock-order peer, not RED-A/B | static |
| `rpc_cancel_stock_adjustment` | Migration 124 | lock-order peer, currently **inverted** (bins before products) | new control (§6/§7) |
| `rpc_manual_stock_movement_v2` | Migration 134 | lock-order peer, currently **inverted** (locks its own bin, then calls the helper) | new control (§6/§7) |
| `rpc_post_goods_receipt` | Migration 177 | multi-line caller, no upfront product lock today | new control (§6/§7) |
| `rpc_post_delivery_note` | Migration 133 | multi-line caller, no upfront product lock today | new control (§6/§7) |
| `rpc_submit_stock_adjustment` | Migration 187 | multi-line caller, no upfront product lock today | new control (§6/§7) |
| `rpc_consume_reserved_materials_v2` | Migration 190 | multi-line caller, no upfront product lock today | new control (§6/§7) |

Two functions found in the writer sweep are confirmed harmless and stay out
of scope: `rpc_complete_manufacturing_order` (never touches `bins`, confirmed
by reading its full body) and, from the caller sweep,
`rpc_consume_reserved_materials`/`consume_materials_for_mo` (thin wrappers
that delegate to `rpc_consume_reserved_materials_v2` and inherit its fix) and
`backflush_materials` (never touches `bins`/`products` at all — a separate,
already-quarantined legacy path per F1/#233).

A fix that replaces only the incoming overloads, or only the four stock-write
helpers, or the five functions from the prior revision without the four
multi-line callers and `rpc_manual_stock_movement_v2`, cannot pass the
existing static contract or the new controls in §6/§7, and cannot be the
whole remediation.

---

## 4. Two remediations, one lock-order contract, installed at every entry point

### The contract, stated once

Every function this migration touches acquires, in this order:

1. **Product row(s)** — the *complete distinct set* of `products` rows this
   *call* (not just this line) is about to touch, in ascending `id` order,
   locked before step 2. For a function that only ever handles one product
   per call (`wardah_apply_stock_incoming`/`outgoing`,
   `rpc_manual_stock_movement_v2`), this set has exactly one member — "locked
   in ascending order" is trivially true and costs nothing extra. For a
   function that loops over lines that can reference different products in
   one call (`rpc_cancel_stock_adjustment`, `rpc_post_goods_receipt`,
   `rpc_post_delivery_note`, `rpc_submit_stock_adjustment`,
   `rpc_consume_reserved_materials_v2`), this is the distinct product set
   across *all* lines, resolved and locked once, **before the per-line loop
   starts** — not discovered and locked line by line as the loop runs.
2. **Existing bins for that product** — the Migration 186 outgoing order,
   `ORDER BY warehouse_id, id FOR UPDATE` (no-op when none exist)
3. **Target bin** — `SELECT … FOR UPDATE` on `(product, warehouse)`, then
   insert-or-update from the locked snapshot
4. **Product projection** — re-`SUM` bins and `UPDATE products` while still
   holding (1)

Steps 2-4 are what `wardah_apply_stock_incoming`/`outgoing` already do (Fix
A/B below); every other function in the table above either calls into one of
those two helpers per line, or does the bins/products work itself
(`rpc_cancel_stock_adjustment`). What changes for the other eight functions
is entirely about *when* step 1 happens relative to steps 2-4 — none of them
need their valuation, reservation, idempotency, or business-rule logic
touched.

### Shared helper: `wardah_lock_products_for_stock_write`

Step 1 is identical logic everywhere it's needed: given an org and a set of
product ids, lock exactly those `products` rows, in ascending `id` order,
before returning. Five different functions need this (`rpc_cancel_stock_adjustment`,
`rpc_post_goods_receipt`, `rpc_post_delivery_note`,
`rpc_submit_stock_adjustment`, `rpc_consume_reserved_materials_v2`); the
single-product functions can call it too with a one-element set for
consistency, or inline the equivalent single-row lock — either is correct,
but the multi-product callers must not each reimplement their own copy of
"lock these, in this order." Five independent inline copies of the same
ordering rule is exactly the kind of duplicated invariant that has already
drifted once in this codebase (the ACL history in §5) and is more likely to
drift again than a single internal function reviewed once. Add one small
internal helper:

```text
wardah_lock_products_for_stock_write(p_org uuid, p_product_ids uuid[]) → uuid[]
  SET search_path TO 'public', 'pg_temp'

  -- normalize: dedupe, drop NULLs, fix a deterministic order — via
  -- unnest(...) AS u(id), not a bare unnamed unnest() referenced by
  -- function name in WHERE (that does not resolve: unnest() in the
  -- target list is not addressable as a column called "unnest").
  v_wanted := ARRAY(
    SELECT DISTINCT u.id
    FROM unnest(COALESCE(p_product_ids, '{}'::uuid[])) AS u(id)
    WHERE u.id IS NOT NULL
    ORDER BY u.id
  );

  -- Lock row-by-row via a loop, not a single aggregating SELECT: PostgreSQL
  -- rejects any locking clause (FOR NO KEY UPDATE / FOR UPDATE / FOR SHARE /
  -- FOR KEY SHARE) combined with DISTINCT, GROUP BY, or an aggregate in the
  -- same query, because the result rows can no longer be identified with
  -- individual table rows to lock. array_agg(...) ... FOR NO KEY UPDATE is
  -- not valid SQL for this reason — confirmed against PostgreSQL 17
  -- ("FOR UPDATE is not allowed with aggregate functions").
  v_locked := '{}'::uuid[];
  FOR v_id IN
    SELECT p.id FROM public.products p
    WHERE p.org_id = p_org AND p.id = ANY(v_wanted)
    ORDER BY p.id
    FOR NO KEY UPDATE  -- not FOR UPDATE: see "Lock mode" below
  LOOP
    v_locked := array_append(v_locked, v_id);
  END LOOP;

  IF cardinality(v_locked) <> cardinality(v_wanted) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG: wanted=%, locked=%',
      v_wanted, v_locked;
  END IF;
  RETURN v_locked;  -- callers keep this array; see the Fix E guard below
```

Not `SECURITY DEFINER` (it needs no elevated privilege beyond whatever the
calling `SECURITY DEFINER` function already has), not granted to `anon` or
`authenticated` or `PUBLIC` — an internal-only helper per the project's
existing rule for such functions, fully schema-qualified
(`public.products`) with its own `search_path` regardless of invoker
privilege. It fails closed on a missing or wrong-org id instead of silently
locking fewer rows than asked (see "Fail-closed on a partial match" below),
and it returns the canonical locked set so callers don't each recompute or
re-derive it. Each of the five multi-product callers resolves its own
distinct product set (from `stock_adjustment_items`,
payload lines, or resolved reservations — whatever each function already
uses today to find `v_product` per line) and calls this once, before its
existing loop.

### Lock mode: `FOR NO KEY UPDATE`, not `FOR UPDATE`

An earlier revision of this design specified `FOR UPDATE` for the products
lock, in the helper and throughout §4/§6/§7. That is wrong, and the error is
in the choice of lock strength, not in the decision to lock `products` at
all.

`products.id` is referenced by 18 foreign keys (`bins`, `material_reservations`,
`stock_ledger_entries`, `sales_invoice_lines`, `purchase_order_lines`,
`goods_receipt_lines`, `delivery_note_lines`, `stock_adjustment_items`,
`material_consumption`, and nine more — confirmed by counting `REFERENCES
public.products(id)` across the live schema). PostgreSQL enforces every one
of those by taking a `FOR KEY SHARE` lock on the referenced `products` row
whenever a child row referencing it is inserted — this is how referential
integrity has worked since PostgreSQL 9.3, specifically so that concurrent
inserts into unrelated child tables don't serialize against each other or
against ordinary updates of the parent. `FOR KEY SHARE` conflicts with
exactly one row lock mode: `FOR UPDATE`. It does not conflict with `FOR NO
KEY UPDATE`, `FOR SHARE`, or itself.

`products` has exactly two unique constraints (`products_pkey` on `id`,
`products_code_key` on `code`) and no others. The live
`UPDATE products SET stock_quantity = ..., cost_price = ...` tail in
`wardah_apply_stock_incoming`/`outgoing` never touches a column covered by
either, so PostgreSQL already takes the weaker `FOR NO KEY UPDATE` for that
statement today — which is *why* this has never blocked a concurrent FK
insert into `bins`, `sales_invoice_lines`, or any other child table. An
explicit `SELECT ... FOR UPDATE`, unlike a plain `UPDATE`, always takes the
strongest mode regardless of which columns it will eventually touch. Using
`FOR UPDATE` in the new helper would have been the first time any live
stock-writer took a lock strong enough to block those FK inserts — a new
class of contention this design did not intend to introduce, and, worse, a
new deadlock:

`rpc_create_mo_with_reservation` (live, unchanged by this design) locks
`bins` for the product first (`ORDER BY warehouse_id, id FOR UPDATE`) and
only afterward runs `INSERT INTO material_reservations (..., product_id,
...)`, which takes the FK's `FOR KEY SHARE` on that same `products` row.
With the products lock as `FOR UPDATE`:

- T1 (any Fix A-E function, post-191): holds `products(P)`, waits for
  `bins(P, W)`.
- T2 (`rpc_create_mo_with_reservation`): holds `bins(P, W)` (its existing
  lock, unchanged), waits for `products(P)` `FOR KEY SHARE` (blocked by T1's
  `FOR UPDATE`).

Circular wait — the exact class of bug this whole design exists to close,
now introduced at a call site §6 explicitly reasoned about and got wrong
("[reservation] never takes a `products` row lock at all today" is true only
of *explicit* locks; the implicit FK lock is real and conflicts with `FOR
UPDATE` specifically). `FOR NO KEY UPDATE` closes this: it still conflicts
with itself and with `FOR UPDATE`/`FOR SHARE` — so two concurrent stock
writers on the same product still fully serialize, RED-A/RED-B stay fixed —
but it does not conflict with `FOR KEY SHARE`, so it never blocks (and is
never blocked by) an FK-referencing insert from any child table, including
`rpc_create_mo_with_reservation`'s own reservation insert. Every `products`
lock this design specifies — the shared helper, the incoming/outgoing
prefix, and the static contract that checks for it — is `FOR NO KEY UPDATE`.
The `bins` locks are unaffected by this and stay `FOR UPDATE` — `bins` is
not the FK-fan-in table here, and `FOR UPDATE` on `bins` is the live,
pre-existing behavior this design is not changing.

`rpc_complete_manufacturing_order`'s existing `FOR UPDATE` on `products`
(cited earlier as precedent for locking `products` directly) is, by this
same analysis, itself a latent, live risk against any concurrent FK insert
on a product it locks — but it never touches `bins`, so it cannot deadlock
against anything this design changes, and fixing it is out of scope here.
It is not a model this design follows for lock *strength*, only for the
general idea that locking `products` directly is an established technique
in this codebase.

### Why putting the lock only on incoming was never going to be enough

Incoming today does an unlocked step 4 with no step 1 at all. Outgoing does
2-3-4 without 1. `rpc_cancel_stock_adjustment` does a 3-equivalent (`UPDATE
bins`, which row-locks implicitly) then a 4-equivalent, also without 1 — and
it can do this for several different products across one adjustment's lines.
`rpc_manual_stock_movement_v2` takes its own `bins` lock (to read the current
quantity for its `'adjustment'` movement-type math) before ever calling
incoming/outgoing, which is a 3-before-1 inversion at the caller level even
though the callee it then invokes will do 1-then-2-3-4 correctly in
isolation. Putting (1) on incoming alone deadlocks with every one of these:

- incoming holds `products`, waits for `bins`
- outgoing holds `bins`, waits for `products`
- cancellation holds a `bins` row (from its `UPDATE bins`), waits for
  `products` (its later `UPDATE products`) — same shape as the outgoing case
- manual movement holds a `bins` row (its own pre-lock), waits for `products`
  (inside the helper it's about to call) — same shape again

And even after every *individual* function does 1-2-3-4 correctly, the four
multi-line callers introduce a **second, transaction-level** version of the
same problem: each call to the helper only locks *that line's* product before
proceeding, so two different top-level calls (say, one `rpc_post_goods_receipt`
and one `rpc_post_delivery_note`, or two `rpc_submit_stock_adjustment` calls)
that both touch products A and B, in reversed order across their own lines,
can each hold one and wait for the other — a deadlock between two fully
correct individual helper calls, caused entirely by the absence of an
upfront, whole-transaction lock on every product either call will eventually
touch. This is why step 1 must happen once per top-level call, for the
*complete* set that call will touch, not once per line.

So outgoing 9-arg/10-arg, `rpc_cancel_stock_adjustment`, and
`rpc_manual_stock_movement_v2` must all take (1) **before** (2) in the same
migration (lock-order compatibility, not a claim any of them have RED-A or
RED-B); and `rpc_post_goods_receipt`, `rpc_post_delivery_note`,
`rpc_submit_stock_adjustment`, and `rpc_consume_reserved_materials_v2` must
each call `wardah_lock_products_for_stock_write` with their *complete*
per-call product set before their existing per-line loop starts (a second,
transaction-scoped instance of the same contract, not a new one).

```text
incoming/outgoing (after 191)
  products  FOR NO KEY UPDATE   ← always exists; serializes the SKU without blocking FK inserts
  bins*     FOR UPDATE ORDER BY warehouse_id, id
  bins[wh]  FOR UPDATE / insert from locked snapshot
  SUM bins → UPDATE products    ← recompute under the product lock

rpc_cancel_stock_adjustment / multi-line callers (after 191)
  wardah_lock_products_for_stock_write(org, DISTINCT product_id across ALL lines)
  (existing per-line loop, unchanged business logic — each line's call into
   incoming/outgoing, or cancellation's own bins/products work, now runs
   under a lock the loop itself no longer needs to acquire)

rpc_manual_stock_movement_v2 (after 191)
  wardah_lock_products_for_stock_write(org, [the one product])  ← or an inline single-row lock
  (existing bins read for delta math, then the existing incoming/outgoing call — unchanged)
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
- `PERFORM public.wardah_lock_products_for_stock_write(v_adj.org_id, that set)`
  — locks all of them, in ascending `id` order, before touching any `bins`
  row
- run the existing loop exactly as today (cancel SLE, reverse SLE, `UPDATE
  bins`, re-`SUM`, `UPDATE products`) — every product it touches is already
  locked, so this is not a new correctness change, only a new precondition

The ascending-`id` order (enforced once, inside the shared helper) matters
for a second reason beyond incoming/outgoing compatibility: two concurrent
cancellations whose adjustments share more than one product, locked in
different orders, would deadlock against *each other* even with the new
prefix. A single deterministic order removes that regardless of which
adjustment a given cancellation call is processing.

This does not touch the adjustment-header lock (`stock_adjustments … FOR
UPDATE`, unrelated resource, unchanged), the `wardah_assert_org_admin` gate,
the `LATER_STOCK_MOVEMENT_EXISTS` fail-closed check, or the reversal SLE
shape (`'Stock Adjustment Reversal'`, negated quantities, restored
`qty_after_transaction`/`valuation_rate`/`stock_value`/`stock_queue` from the
prior surviving entry).

### Fix D — lock-order compatibility for `rpc_manual_stock_movement_v2`

Not a RED-A/RED-B remediation, and not a multi-product function — this is the
single-product caller-level inversion described in the second gap note.
Today it does `SELECT … FROM bins … FOR UPDATE` (to read the current quantity
for its `'adjustment'` movement-type delta) *before* calling
`wardah_apply_stock_incoming`/`outgoing`. But that is not the first `bins`
read in the live function: when the caller omits `warehouse_id`, an earlier,
*unlocked* statement infers one — `SELECT count(*), min(warehouse_id) INTO
v_count, v_warehouse FROM public.bins WHERE org_id = v_org AND product_id =
v_product` — and only requires exactly one existing bin for the product to
succeed. Placing the products lock immediately before the later, locked
`bins` read (the naive reading of "before the existing bins read") still
leaves this inference unlocked: a concurrent transaction could create a
second bin for the same product in a different warehouse between the
inference read and the products lock, making the already-inferred warehouse
stale by the time this call actually acts on it. Fix: take the products
lock — `PERFORM public.wardah_lock_products_for_stock_write(v_org, ARRAY[v_product])`
(or an inline single-row equivalent) — immediately after resolving `v_org`
and validating `v_qty_entered`, **before** the `IF v_warehouse IS NULL THEN`
block, i.e. before *any* statement that reads `bins` for this product, not
just before the one that locks it. Nothing else in the function changes; the
`'in'`/`'out'` movement types don't even use the later locked-bin read for
their math, only `'adjustment'` does, but the warehouse-inference read runs
regardless of movement type, so the lock must precede it unconditionally.

### Fix E — transaction-wide product locking for multi-line callers

`rpc_post_goods_receipt`, `rpc_post_delivery_note`,
`rpc_submit_stock_adjustment`, and `rpc_consume_reserved_materials_v2` each
already resolve a product per line before calling the relevant helper. An
earlier revision of this design treated all four the same way: "run the same
per-line resolution logic once up front, deduplicate, lock." That is correct
for goods receipt and wrong, in different ways, for the other three — the
common failure mode is that a *pre-pass that re-derives the same answer the
loop would derive* is only safe if that answer cannot change between the
pre-pass and the loop. Whether it can change depends on where the product
identity for each line actually lives, which differs per function:

**`rpc_post_goods_receipt`** — `v_product` is read directly from
`p_payload->'lines'`. The payload is this call's own argument, not a
separate stored table; nothing else in the system can mutate it mid-call.
Pre-resolving is trivially safe here: `SELECT DISTINCT (value->>'product_id')::uuid
FROM jsonb_array_elements(p_payload->c_lines_key)` before the loop, then
`wardah_lock_products_for_stock_write`. No superset or source-row lock is
needed — there is no external state to drift — but the uniform
`PRODUCT_NOT_PRELOCKED` guard below still applies here too, as defense in
depth like the other three.

**`rpc_post_delivery_note`** — `v_product` comes from `sales_invoice_lines`,
resolved by `sales_invoice_line_id` values that are themselves fixed by the
payload. `sales_invoice_lines` is `GRANT ALL TO authenticated` with only an
`org_id` policy check, so a concurrent client update to a line's `product_id`
between an unlocked pre-pass read and the existing loop's own
`SELECT ... FOR UPDATE` on that same line is possible in principle. Fix:
lock the referenced `sales_invoice_lines` rows themselves — batched, once,
before resolving products — instead of relying on the loop's existing
per-line `FOR UPDATE` (which currently runs too late, after the point where
products would need to already be locked): `SELECT product_id FROM
sales_invoice_lines WHERE id = ANY(<line ids from payload>) AND invoice_id =
v_invoice_id AND org_id = v_org FOR UPDATE`, take `DISTINCT product_id` from
that locked read, then `wardah_lock_products_for_stock_write`. Because the
referenced line ids are fixed by the payload (not a dynamic "find whichever
matches" query), locking them once up front and reusing that locked read in
the subsequent loop (instead of re-querying) removes the drift window
entirely — no runtime guard is structurally necessary, but see below.

**`rpc_submit_stock_adjustment`** — `v_item.product_id` comes from
`stock_adjustment_items`, resolved by `adjustment_id` — a query that returns
a fixed row set regardless of processing state (unlike consumption's
status-based selection below). `stock_adjustment_items` is likewise `GRANT
ALL TO authenticated` with its own update policy. Fix: lock the item rows
first, plainly, with no `DISTINCT` in the same statement — `SELECT id,
product_id FROM stock_adjustment_items WHERE adjustment_id = v_adj.id ORDER
BY id FOR UPDATE`, collecting `DISTINCT product_id` from the *rows the loop
already produces* rather than asking PostgreSQL to lock a `DISTINCT`
projection directly (`SELECT DISTINCT product_id ... FOR UPDATE` is invalid:
PostgreSQL rejects any locking clause combined with `DISTINCT` in the same
query for the same reason it rejects one combined with an aggregate — the
result rows are no longer identifiable with individual table rows to lock;
confirmed against PostgreSQL 17, "FOR UPDATE is not allowed with DISTINCT
clause"). Then `wardah_lock_products_for_stock_write` on the distinct set
collected that way. As with delivery note, the row set itself is stable
(determined by `adjustment_id`, not by anything that changes as the loop
runs), so locking those specific rows up front and having the existing loop
consume the already-locked rows removes the drift window structurally.

**`rpc_consume_reserved_materials_v2`** — the genuinely hard case, and the
one an "equivalent pre-pass" cannot fix by construction. Two independent
problems, both confirmed against the live Migration 190 body:

1. The reservation selected per line is not a fixed row set — it depends on
   `status = 'reserved'`, which the *same call's own loop* changes as it
   consumes earlier lines. Two lines with the same `item_id` can resolve to
   *different* reservation rows depending on how much of the first
   reservation the first line already consumed — a pre-pass run before any
   consumption happens will not see that state change, so it can resolve
   both lines to the same (wrong, or incomplete) reservation the loop itself
   will not actually use for the second line.
2. `material_reservations.product_id` is not immutable metadata: it is a
   live foreign key to `products(id)`, and a `BEFORE INSERT OR UPDATE OF
   org_id, item_id, product_id` trigger (`resolve_material_reservation_product`)
   re-resolves it from `item_id` on every such write. The table is `GRANT ALL
   TO authenticated`/`anon` with an update policy gated only on `org_id` — a
   concurrent client-issued `UPDATE material_reservations SET item_id = ...`
   on a row this call has not yet locked can change which product that
   reservation resolves to, between an unlocked pre-pass and the loop.

Fix: lock the *entire relevant superset*, not the specific rows an unlocked
pre-pass thinks it needs, and not a `status = 'reserved'` filter applied
*before* locking. An earlier revision of this design filtered on `status =
'reserved'` in the same query that locks, and called that "the complete
universe the loop can select from." It isn't: `material_reservations_status_check`
only constrains `status` to five valid string values, and nothing —
no trigger, no other constraint — prevents a client with ordinary `UPDATE`
access (gated only by `org_id`) from setting an existing `released`,
`expired`, or `cancelled` row's `status` back to `'reserved'` mid-transaction.
Filtering on `status = 'reserved'` *before* taking the lock can miss exactly
such a row: it wasn't `'reserved'` yet when the filter ran, so it was never
locked, and it could still become `'reserved'` and get selected by the
existing loop's own fresh per-line query — outside the set this call
believes it locked.

The fix locks first, filters after: `SELECT id, mo_id, item_id, product_id,
status FROM material_reservations WHERE org_id = v_org AND mo_id = p_mo_id
ORDER BY id FOR UPDATE` — every row for this MO regardless of current
status, not filtered at all in the locking query. Only *after* every such
row is locked does the function read `status` from the now-frozen snapshot
to derive which of them are `'reserved'` (and therefore which products the
loop's own selection can legitimately land on). This closes the gap the
status-filtered version left open: once locked, no row's `status` can change
until this transaction commits (the lock itself is what prevents the
released-back-to-reserved flip, not the filter), so the `'reserved'` subset
read from the locked snapshot is a true, closed universe for the duration of
this call. This is not expensive beyond what the function already pays:
`manufacturing_orders` is locked `FOR UPDATE` as this function's very first
statement, and any concurrent `INSERT` of a *new* reservation for the same
`mo_id` needs `FOR KEY SHARE` on that same MO row (the FK), which already
blocks behind it — so no new reservation can appear for this MO while this
transaction runs. The reservations lock above is what additionally freezes
every *existing* row (any status) against direct client mutation, which the
MO lock alone does not cover (an `UPDATE` to an existing child row's own
columns does not re-touch its FK parent).

**Deriving the product set must use the same effective-product expression the
loop uses, not the bare column.** `material_reservations.product_id` is
nullable (`product_id uuid`, no `NOT NULL` — confirmed against the live
table definition), and the existing loop never trusts it alone: it computes
`v_product := COALESCE(v_res.product_id, public.wardah_resolve_product_id(v_org,
v_res.item_id, now()))` (Migration 190, live). A prelock that derives its
product set from `product_id` directly — the way `wardah_lock_products_for_stock_write`'s
own input-normalization drops `NULL`s — would silently omit the effective
product of any reservation whose `product_id` happens to be `NULL`, lock
everything else, and then hit the reservation with the resolved (real, valid)
product not in the locked set. That is not a corner case to leave to the
guard; it is a wrong prelock hitting its own guard on legitimate, unexceptional
data. Fix: compute `COALESCE(product_id, public.wardah_resolve_product_id(v_org,
item_id, now()))` for every `'reserved'` row in the locked snapshot — the
identical expression the loop uses — and lock *that* set, not `product_id`
filtered for `NOT NULL`.

Then `wardah_lock_products_for_stock_write`. The existing loop's own per-row
`SELECT ... FOR UPDATE` on `material_reservations` re-acquires a lock this
call already holds (a no-op wait) and is otherwise unchanged.

**The guard, generalized:** for delivery note and adjustment submit, locking
the referenced rows up front is structurally sufficient — there is no
plausible way the existing loop resolves a product outside what was just
locked, because it consumes the exact rows already locked rather than
re-querying. Material consumption's loop *is* a fresh per-line query against
a state (`status = 'reserved'`) that this call's own processing changes, so
it is worth a defense-in-depth check even though the superset lock should
make it unreachable: keep the locked array (`wardah_lock_products_for_stock_write`'s
return value) in a variable, and inside the loop, immediately after
resolving each line's `v_product`, assert it is both non-`NULL` and a member
of that array — `IF v_product IS NULL OR NOT COALESCE(v_product = ANY(v_locked_products),
false) THEN RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %', v_product; END IF;`
(the explicit `NULL`/`COALESCE` handling matters: `v_product = ANY(array)`
itself evaluates to `NULL`, not `false`, when `v_product` is `NULL`, and `IF
NULL THEN ...` silently does not raise — a bare `IF NOT v_product = ANY(...)`
would let a `NULL` effective product through instead of failing closed on
it). Apply the same guard to all four Fix E functions uniformly rather than
reasoning per-function about which ones structurally need it: it is cheap, it
turns any future edit that reintroduces per-line resolution drift (in any of
the four, including ones judged safe today) into a loud, immediate, fail-closed
error instead of a silent transaction-level race, and it means a reviewer
checking "does this function protect against resolving outside its locked
set" never has to re-derive the per-function argument above — the guard is
either present or it isn't.

None of these four functions' existing business rules, error codes, or
return shapes change beyond the new `PRODUCT_NOT_PRELOCKED` failure mode,
which should be unreachable given the locking above and exists only as a
backstop. The only expected new latency is a longer wait for the upfront
lock on a large multi-line document under heavy concurrent load on the same
products — the same throughput trade-off already accepted in §6.

`rpc_complete_manufacturing_order` is a `products`-writer found in the
original sweep and needs none of this: its body has zero references to
`bins` anywhere, so it has no `bins` lock to invert against the new order. It
stays out of scope (§5).

### Why a product-row lock is the right shared prefix

| Candidate | RED-A | RED-B | Cross-function/cross-call compatibility | Notes |
|---|---|---|---|---|
| Product `FOR NO KEY UPDATE` at start + re-SUM, shared helper for multi-product callers | yes | yes | yes — every caller acquires the same lock in the same ascending order, whether it needs one product or many, without blocking FK inserts from any child table | Lock target exists before any bin; generalizes cleanly; see "Lock mode" above |
| Outgoing-style "lock all bins" only | no (no row) | no (no rows) | already live for outgoing; does not help any multi-product caller's ordering at all | Empty `FOR UPDATE` is a no-op |
| Advisory lock on `(org, product)` only | yes | yes | extra lock space next to row locks; still needs the same deterministic multi-key order for every multi-product caller | Works, but diverges from the 186 row-lock style already on outgoing |
| `SERIALIZABLE` on the RPC | maybe | maybe | session default is READ COMMITTED; SSI aborts are a new client contract | Rejected |
| Relative `ON CONFLICT` upsert only | only if queue is re-derived | no | n/a | Does not touch `products`; does not touch any caller's lock order at all |
| Global SLE uniqueness | forbidden by #228 | n/a | n/a | Would break legal multi-line receipts |

Advisory locks are a valid alternative and would also exist before the bin
row. They are rejected for this migration because outgoing already speaks
row locks, Control-2 already waits on row locks, and mixing advisory + row
locks without converting outgoing would still deadlock on `products`.

There is precedent in this codebase for locking `products` directly:
`rpc_complete_manufacturing_order` already does
`SELECT id, stock_quantity, cost_price FROM public.products ... FOR UPDATE`
for finished goods with no bin, then `UPDATE products` under that same lock.
This design applies the same underlying technique — lock the product before
computing and writing its aggregate — to `wardah_apply_stock_incoming` and
`wardah_apply_stock_outgoing`, but deliberately not that function's choice of
lock *strength*: as detailed in "Lock mode" above, plain `FOR UPDATE` on
`products` is itself a latent risk against concurrent FK inserts, and this
design uses `FOR NO KEY UPDATE` throughout instead. Fixing
`rpc_complete_manufacturing_order`'s own `FOR UPDATE` is out of scope here —
it never touches `bins`, so it cannot deadlock against anything this
migration changes — but it should not be read as an endorsement of that
lock mode.

---

## 5. What the migration replaces (and what it must not)

Proposed number: **191** (190 is already on `main` for F1 material
consumption). Confirm at implementation time that 191 is still free.

Replace, in one file, all ten bodies plus one new internal helper:

1. `wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)` — 9-arg, receipts / manual movement (Fix A/B)
2. `wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)` — 10-arg, stock adjustment (Fix A/B)
3. `wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)` — 9-arg (lock-order prefix only)
4. `wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)` — 10-arg (lock-order prefix only)
5. `rpc_cancel_stock_adjustment(uuid,text)` — lock-order prefix only (Fix C); no RED-A/RED-B logic change
6. `rpc_manual_stock_movement_v2(jsonb)` — lock-order prefix only (Fix D)
7. `rpc_post_goods_receipt(jsonb)` — upfront multi-product lock only (Fix E)
8. `rpc_post_delivery_note(jsonb)` — upfront multi-product lock only (Fix E)
9. `rpc_submit_stock_adjustment(uuid)` — upfront multi-product lock only (Fix E)
10. `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` — upfront multi-product lock only (Fix E)
11. `wardah_lock_products_for_stock_write(uuid,uuid[])` — **new**, internal-only, no existing ACL to preserve; `REVOKE ALL FROM PUBLIC, anon, authenticated` at creation, no `GRANT` to any client role

Carry forward, verbatim except for the stated change to each:
- items 1–2: the two fixes (Fix A/B) plus the lock-order prefix
- items 3–4: the lock-order prefix only
- items 5–10: the lock-order prefix (single product for 5/6, upfront multi-product for 7–10) — every existing business rule, error code, and return shape in all six of these unchanged

- Valuation: FIFO / LIFO / weighted average, including queue rewrite
- SLE insert (incoming positive qty; outgoing negative qty and COGS)
- 10-arg source-line guards (`STOCK_SOURCE_LINE_REQUIRED` /
  `STOCK_SOURCE_LINE_MISMATCH`) and `source_line_id` storage
- Outgoing reservation floor (`INSUFFICIENT_UNRESERVED_STOCK`) and
  `BIN_NOT_FOUND` / `INSUFFICIENT_STOCK`
- 9-arg incoming early `NO_WAREHOUSE_OR_QTY` JSON return
- `search_path`: 9-arg incoming is `public`; 10-arg incoming and both
  outgoing overloads are `'public', 'pg_temp'` — keep each as it is
- **The ACLs of `rpc_cancel_stock_adjustment`, `rpc_manual_stock_movement_v2`,
  `rpc_post_goods_receipt`, `rpc_post_delivery_note`,
  `rpc_submit_stock_adjustment`, and `rpc_consume_reserved_materials_v2` are
  unrelated to the rule below and must not change.** Checked all six
  directly against the live baseline: every one is `GRANT ALL ... TO
  authenticated` plus `TO service_role`, consistently — they are legitimate
  client-facing RPCs (gated by `wardah_assert_org_member`/`wardah_assert_org_admin`
  and, for material consumption, an exact permission check, at the
  application layer, not by ACL), not internal helpers. Fixes C/D/E touch
  only lock order, never grants, on any of the six. The ACL discussion
  immediately below is scoped to the four stock-write helpers only. The new
  `wardah_lock_products_for_stock_write` helper gets no client grant at all
  (see item 11 above) — it is not one of "the four."
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
  coalesces to weighted average. Taking `FOR NO KEY UPDATE` on that row
  should raise `PRODUCT_NOT_FOUND_OR_WRONG_ORG` like outgoing, rather than
  lock nothing and proceed. Small, fail-closed, not part of RED-A or RED-B.

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

This is a deadlock-avoidance guarantee, not a claim that both operations
always succeed: cancellation's own `LATER_STOCK_MOVEMENT_EXISTS` check
(unchanged by Fix C) means that whichever of the two *commits* second still
has to pass its existing business rules against what the first one just
committed. If cancellation serializes first, incoming applies normally
afterward. If incoming serializes first, its new SLE row becomes a later
movement on that `(product, warehouse)` key, and cancellation correctly
fails closed with `LATER_STOCK_MOVEMENT_EXISTS` — not a deadlock, not a
silent partial reversal, and not a new behavior; this is the guard doing
exactly what it already does today, now reachable in a race instead of only
sequentially.

### Outgoing vs cancellation (new control)

Same shape as incoming vs cancellation: both take `products` first (outgoing
locks its one product before its `ORDER BY warehouse_id, id` bins lock;
cancellation locks its distinct product set before its per-line bins
`UPDATE`s). This is the scenario the Codex review on #236 identified as
missing and the reason Fix C exists — before Fix C, outgoing holding
`products` and waiting on `bins` while cancellation held a `bins` row and
waited on `products` was a genuine circular wait, not a hypothetical one.
Outcome-wise this follows the same rule as incoming vs cancellation above:
whichever serializes second is subject to the other's now-committed state —
outgoing after a completed cancellation just sees the reversed stock and
applies its normal `INSUFFICIENT_STOCK`/reservation checks; cancellation
after a completed outgoing sees a later movement on that
`(product, warehouse)` key and fails closed with
`LATER_STOCK_MOVEMENT_EXISTS`, exactly as it does today outside of any race.

### Cancellation vs cancellation (new control)

Two concurrent cancellations whose adjustments share more than one product
each lock their own distinct product set in ascending `id` order (Fix C).
Two sets sharing elements, both ordered the same way, cannot form a cycle —
the standard proof for lock-ordering deadlock avoidance. This control exists
specifically to catch a regression if a future edit locks cancellation's
product set in adjustment-line order (arbitrary, whatever order the SLEs
happen to iterate in) instead of a fixed order like `id`.

### Manual movement vs incoming/outgoing/cancellation (new control)

Same shape as the other pairwise controls: `rpc_manual_stock_movement_v2`
(Fix D) now takes its products lock before its own `bins` read, so it and
any of the already-fixed functions queue on `products`, never form a
bins-vs-products cycle. Single product per call, so no ordering concern
beyond the pairwise case.

### Multi-line caller vs multi-line caller, overlapping products (new control,
the transaction-level case)

This is the scenario Fix E exists for, and it is the one the pairwise
controls above cannot exercise: two *different* top-level calls — for
example one `rpc_post_goods_receipt` and one `rpc_post_delivery_note`, each
with two lines, both referencing products A and B but in reversed order
across the two calls' own line arrays — each lock their complete distinct
product set (Fix E) in the same ascending `id` order before either touches a
`bins` row. Whichever call's `wardah_lock_products_for_stock_write` commits
first proceeds through its whole per-line loop; the other queues on the
first product it needs, once, for the whole call — not line by line, and not
in the order its own payload happened to list lines. No circular wait is
possible because every multi-line caller now acquires its complete lock set
in the same global order before any per-line work begins, exactly as
`rpc_cancel_stock_adjustment`'s Fix C already established for adjustments
touching each other. This control must use two *different* functions (not
two calls to the same one) to prove the ordering discipline is a property of
the shared helper and the calling convention, not something incidentally
true of one function's own loop structure.

### Incoming vs reservation (`rpc_create_mo_with_reservation`)

An earlier revision of this section claimed this RPC "never takes a
`products` row lock at all today," citing its only explicit `products`
reference (an unlocked `SELECT base_uom_id` metadata lookup). That is true of
*explicit* locks and wrong about the function's actual lock footprint: it
locks `bins` in `warehouse_id, id` order
(`sql/migrations/186_stock_moves_contract_repair.sql` line 89, carried into
the live body) and *then* runs `INSERT INTO material_reservations (...,
product_id, ...)`. `material_reservations.product_id` is a live foreign key
to `products(id)`, and PostgreSQL's referential-integrity enforcement takes
an implicit `FOR KEY SHARE` lock on the referenced `products` row for that
insert — a real row lock this function has always taken, just never
written in its own source.

`FOR KEY SHARE` conflicts with `FOR UPDATE` but not with `FOR NO KEY UPDATE`
(see "Lock mode" in §4). With the products lock at `FOR UPDATE`, this
function does invert the lock order — `bins` then (implicitly) `products` —
against every function fixed in this design, which takes `products` then
`bins`, and creates exactly the circular wait this design exists to prevent.
This was the finding that forced the `FOR UPDATE` → `FOR NO KEY UPDATE`
correction in §4: with `FOR NO KEY UPDATE`, this function's implicit `FOR KEY
SHARE` insert never conflicts with the held products lock, so it is not
blocked by it and cannot deadlock against it, regardless of which order the
two functions' explicit locks were taken in.

191 should still **not** add any *explicit* `products` lock to the
reservation RPC (out of scope) — the fix is entirely in the lock mode chosen
by the functions this design already touches, not in changing reservation's
own body. But implementation review must check every function that inserts
into any of the 18 tables with a foreign key to `products(id)` for an
explicit `products` `FOR UPDATE` appearing *after* that function's own other
locks, not just check for explicit `products` references the way this
section originally (and wrongly) did — an implicit FK lock is still a lock,
and grepping for the literal string `products` in a function body will miss
it if the function only ever names the *child* table.

### Incoming vs `rpc_create_mo_with_reservation`, same product, existing bin
(new control, proves the lock-mode fix rather than assumes it)

Pre-seed a bin for product P in warehouse W. Run one incoming call on
`(P, W)` concurrently with one `rpc_create_mo_with_reservation` call that
reserves material P for a new manufacturing order. This control must be run
twice, against two different builds, to prove it actually catches the
regression it exists for rather than passing by construction:

1. Against a build with the products lock as `FOR UPDATE` (the error this
   design corrected) — must reproduce a genuine deadlock/cycle. If it
   doesn't reproduce one here, the control is not exercising the real
   mechanism and must be redesigned before it can be trusted post-fix.
2. Against the real 191 (`FOR NO KEY UPDATE`) — must complete both calls
   without deadlock, with the bin correctly incremented and the reservation
   correctly created, regardless of which one serializes first.

### The full post-191 lock graph for material consumption

`rpc_consume_reserved_materials_v2`'s locking order after Fix E is:

```text
manufacturing_orders (FOR UPDATE, existing, first statement)
  → stage_wip_log (FOR UPDATE, existing)
    → material_reservations, superset (FOR UPDATE, new — Fix E)
      → products (FOR NO KEY UPDATE, new — Fix E + shared helper)
        → bins (FOR UPDATE, existing, inside the incoming/outgoing call)
```

For this to be deadlock-free against every other function this design
touches or examined, no other live function may acquire any edge of this
graph in reverse. Checked directly against the live bodies, not assumed:

- `release_expired_reservations` only reads/updates `material_reservations`
  — no `products`, no `bins`, no `manufacturing_orders` lock. No edge to
  conflict with.
- `rpc_complete_manufacturing_order` locks `manufacturing_orders` then
  `products` — never touches `material_reservations` or `bins`. Consistent
  with (a proper prefix of) the graph above; no reverse edge.
- `rpc_create_mo_with_reservation` locks `bins` then implicitly `products`
  (its `material_reservations` insert's FK) — the `products`/`bins` edge
  is covered by the "Lock mode" analysis above (`FOR NO KEY UPDATE` removes
  the conflict regardless of order); it does not lock `manufacturing_orders`
  or pre-existing `material_reservations` rows at all, so it adds no further
  edge to check here.
- No live function locks `bins` or `products` and then locks
  `material_reservations` or `manufacturing_orders` afterward — confirmed by
  the same call-site sweep this design already performed for
  `wardah_apply_stock_incoming`/`outgoing` callers (§ "Two more P1s" note),
  extended to check what each caller locks *before* reaching the helper, not
  only whether it calls the helper at all.

### Throughput

Product-level serialization is coarser than per-warehouse. Two receipts
of the same SKU into two warehouses will queue. That is the cost of a
correct product aggregate under READ COMMITTED without a bins row to
lock. It is acceptable for this remediation. Per-warehouse advisory
locks would restore warehouse parallelism at the cost of leaving RED-B
open; do not split the lock grain in 191.

Fix E extends the same trade-off to whole documents: a large multi-line
Goods Receipt or Stock Adjustment now locks its complete product set up
front, so a second document sharing any of those products queues for the
whole duration of the first document's processing, not just for the
individual line that happens to collide. This is strictly necessary — the
alternative (locking line by line, as today) is exactly the transaction-level
deadlock this design closes — but it is a real, larger throughput cost than
the per-function case alone, and is worth naming explicitly rather than
letting it surface later as an unexplained latency regression on large
documents.

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
| New: incoming vs cancellation, existing bin | no deadlock; if cancellation wins the product lock first, cancellation completes then incoming applies and both effects reconcile; if incoming commits first, cancellation fails atomically with `LATER_STOCK_MOVEMENT_EXISTS`; no partial reversal in either ordering |
| New: outgoing vs cancellation, existing bin | no deadlock; if cancellation serializes first, cancellation then outgoing may both complete subject to normal stock checks; if outgoing becomes a later movement first, cancellation fails atomically with `LATER_STOCK_MOVEMENT_EXISTS`; `bins`/`products`/SLE remain reconciled. This is the exact scenario Codex's review found missing pre-Fix-C; must be run against a pre-Fix-C build first and shown to deadlock/hang, then shown fixed post-191, so the control itself is proven to catch the regression it exists for |
| New: cancellation vs cancellation, overlapping multi-product adjustments | no deadlock regardless of which adjustment's transaction starts first; both `products` rows end up equal to the sum of their own bins |
| New: manual movement vs incoming/outgoing/cancellation, existing bin | no deadlock; whichever serializes second sees the other's committed state and applies normally (single-product case, no `LATER_STOCK_MOVEMENT_EXISTS` interaction unless racing cancellation specifically, in which case the same rule as incoming/outgoing-vs-cancellation applies) |
| New: two different multi-line callers (e.g. one `rpc_post_goods_receipt`, one `rpc_post_delivery_note`), overlapping products in reversed line order, no pre-existing bins for one side | no deadlock regardless of which call's `wardah_lock_products_for_stock_write` commits first; run once against a build with Fix E omitted (must reproduce a real deadlock) and once with Fix E (must not) |
| New: `rpc_submit_stock_adjustment` vs `rpc_consume_reserved_materials_v2`, overlapping products in reversed order | no deadlock; both fully apply or one fails on its own pre-existing business rules (insufficient reservation, insufficient stock), never a hang |
| New: incoming vs `rpc_create_mo_with_reservation`, same product with an existing bin | run against a build with the products lock as `FOR UPDATE` first — must deadlock; run against real 191 (`FOR NO KEY UPDATE`) — must not; bin and reservation both correct regardless of which serializes first |
| New: `rpc_consume_reserved_materials_v2` superset lock, two lines same `item_id` where the first consumption fully exhausts the first-created reservation | the two reservations for that `item_id` must be built with genuinely different effective products (different `product_id`, or one `NULL` `product_id` resolving via `wardah_resolve_product_id` to a different product than the other's explicit `product_id` — not two reservations that happen to share one product). Second line resolves to the second reservation (existing behavior, unchanged) and *both* distinct effective products were locked by the upfront superset query — assert this by checking both products appear in the locked set, not just that the call succeeds; a narrower (buggy) pre-pass, or one that derives from the bare `product_id` column instead of the effective-product expression, could otherwise pass this fixture by coincidence |
| New: `rpc_consume_reserved_materials_v2` guard regression check, mutant 1 — narrowed superset, guard present | superset query deliberately narrowed to only the specific reservations named by `p_consumptions` (the earlier, wrong pre-pass shape) instead of the full per-MO lock; guard left in place. A fixture whose second line resolves to a reservation outside that narrowed set must raise `PRODUCT_NOT_PRELOCKED` — proves the guard is reachable, not dead code |
| New: `rpc_consume_reserved_materials_v2` guard regression check, mutant 2 — narrowed superset, guard removed, forced crossed lock order | same narrowed superset, guard also removed, run as two concurrent calls **on two different manufacturing orders** whose product sets are the same two products A and B. Two different MOs is required, not incidental: this function's first statement locks `manufacturing_orders WHERE id = p_mo_id FOR UPDATE`, so two calls on the *same* MO would already fully serialize there and never reach product-level contention at all. "Reversed-order concurrency" at the caller/reservation level is **not** the mechanism (per the seventh correction above): both calls still resolve their complete product set and call `wardah_lock_products_for_stock_write` once before any per-reservation work, so the helper's own `ORDER BY id` — not reservation or caller order — decides acquisition order. As with the cancellation-vs-cancellation mutant, this build must replace the helper's locking query with a positional loop over `p_product_ids` (no re-sort), feed the two calls arrays in explicitly opposite, test-controlled order (MO 1's derived array A-then-B, MO 2's B-then-A), and drive them through the same two-step rendezvous (each call locks only its first array element and signals before the other starts; both then attempt their second lock). This must reproduce a genuine transaction-level deadlock — both backends observed simultaneously via `pg_stat_activity.wait_event_type = 'Lock'`, or a `deadlock detected` (`40P01`) on the side PostgreSQL's detector aborts — not a silent wrong value in a single run and not an inferred hang; that live proof is the actual failure mode the missing guard/narrow lock allows |
| New: `rpc_consume_reserved_materials_v2` guard regression check, mutant 3 — real 191 | full per-MO superset lock (any status, filtered to `'reserved'` from the locked snapshot) plus the guard, both as specified. Neither the guard nor a deadlock should be reachable under normal operation — the guard exists as a backstop, not as an expected code path |
| Static contract, both incoming overloads | product `FOR NO KEY UPDATE` appears before bins `FOR UPDATE`; a bare products `FOR UPDATE` is **absent**; `actual_qty = EXCLUDED.actual_qty` is **absent**; unlocked `SUM`→`UPDATE products` without a preceding products lock is **absent** |
| Static contract, both outgoing overloads | product `FOR NO KEY UPDATE` appears before the all-bins `FOR UPDATE`; a bare products `FOR UPDATE` is **absent** |
| Static contract, `rpc_cancel_stock_adjustment` | a call to `wardah_lock_products_for_stock_write` (or an equivalent ordered multi-row `FOR NO KEY UPDATE`) appears before the first `UPDATE bins` in the function body |
| Static contract, `rpc_manual_stock_movement_v2` | a products `FOR NO KEY UPDATE` lock appears before the *first* `bins` reference in the function body — the unlocked warehouse-inference `SELECT ... FROM bins` when `warehouse_id` is omitted, not only the later `bins ... FOR UPDATE` |
| Static contract, `rpc_post_goods_receipt` / `rpc_post_delivery_note` / `rpc_submit_stock_adjustment` / `rpc_consume_reserved_materials_v2` | a call to `wardah_lock_products_for_stock_write` appears before the per-line `LOOP` in each function body; the resolved/locked product array is referenced later in the loop (the `PRODUCT_NOT_PRELOCKED` guard, see Fix E) |
| Static contract, `wardah_lock_products_for_stock_write` | uses `FOR NO KEY UPDATE`, not `FOR UPDATE`, on `products`; a bare `FOR UPDATE` on `products` anywhere in its body is **absent**; raises on a locked-row-count mismatch (`cardinality` comparison present); the query carrying `FOR NO KEY UPDATE` itself also carries `ORDER BY` on `id` (ascending) — not only the earlier `ARRAY(SELECT DISTINCT ... ORDER BY ...)` normalization step — since acquisition order, not just the deduplicated input set, is what the deadlock-avoidance argument in §6/§7 depends on |
| Static contract, `wardah_lock_products_for_stock_write` | exists, is not `SECURITY DEFINER`, has its own `SET search_path`, references `public.products` schema-qualified, and has no `EXECUTE` grant for `anon`/`authenticated`/`PUBLIC` |
| Static contract, `rpc_consume_reserved_materials_v2` | the pre-loop reservation lock filters only on `org_id`/`mo_id` (every row for the MO, any status) with `FOR UPDATE` and no `status` predicate in the locking query itself; the `status = 'reserved'` filter is applied afterward, reading from the already-locked rows, not before locking (locking a `status = 'reserved'`-filtered query is the earlier, wrong shape — it can miss a row that flips to `'reserved'` mid-transaction); the `PRODUCT_NOT_PRELOCKED` guard appears inside the per-line loop |
| Static contract, all four Fix E functions | the `PRODUCT_NOT_PRELOCKED` guard (or equivalent `= ANY(locked set)` assertion) appears at least once per function, after product resolution and before any `bins`/`products` write for that line |

10-arg incoming is Production's stock-adjustment path. The red proof only
covered it statically. GREEN should add **one** behavioral 10-arg first-bin
race (adjustment qty pair with distinct `source_line_id`s) so a 9-arg-only
fix cannot ship. If that forces too much adjustment-header fixture, say so
in the implementation PR and keep a named gap; do not silently skip it.

The outgoing-vs-cancellation and cancellation-vs-cancellation scenarios need
a multi-line stock-adjustment fixture to actually exercise the ordered
multi-row product lock in Fix C — a single-product adjustment cancellation
would pass even with an unordered or missing lock, the same way RED-B's
two-warehouse shape was needed to catch what a single-warehouse fixture
couldn't. Do not settle for a single-product cancellation fixture and call
this control covered.

For cancellation-vs-cancellation specifically, one multi-product adjustment
is not enough either — it doesn't force the two transactions to actually
contend for the same two products in opposite order. As the seventh
correction above explains, "reversed line/traversal order" cannot be the
mechanism, because Fix C resolves each adjustment's complete distinct
product set and calls `wardah_lock_products_for_stock_write` once, before
either adjustment's per-line work runs — the helper's own `ORDER BY id`
locking query discards whatever order the caller's set arrived in, so
reversing adjustment-line order never reaches the actual lock acquisition.

The fixture must instead force the crossed order directly. Two `SUBMITTED`
adjustments, each with lines touching the *same* two products A and B, with
A and B on a *different* warehouse/bin per adjustment (adjustment 1's line
for product A in warehouse X, adjustment 2's line for product A in
warehouse Y, and similarly for B) — this keeps the two cancellations'
reversal `SLE` rows off each other's `(product_id, warehouse_id)` key, so
neither cancellation's own `LATER_STOCK_MOVEMENT_EXISTS` check can be
tripped by the other's reversal entries; without that separation, a run
that happens to abort one cancellation could look like a passing control
when it's actually the unrelated business-rule guard firing, not proof the
lock order is correct. Build adjustment 1's items with product A inserted
before B, and adjustment 2's with B inserted before A.

Run this fixture twice:

- **Ordering-removed build:** `wardah_lock_products_for_stock_write`'s
  locking query is replaced with a positional loop —
  `FOR v_id IN SELECT u.id FROM unnest(p_product_ids) WITH ORDINALITY AS
  u(id, ord) ORDER BY u.ord LOOP PERFORM 1 FROM public.products WHERE org_id
  = p_org AND id = v_id FOR NO KEY UPDATE; ... END LOOP` (same verified shape
  as the seventh correction above) — that locks each element in the exact
  order the caller's array lists it, with no de-duplication or re-sort.
  Drive it with an explicit two-step
  rendezvous: adjustment 1's transaction locks only its first element
  (product A, since its items were inserted A-then-B) and signals ready;
  adjustment 2's transaction starts only after that signal, locks only its
  own first element (product B, since its items were inserted B-then-A),
  and signals ready; only once both signals are observed are both released
  to attempt their second lock. This must produce a genuine circular wait —
  both backends observed simultaneously in `pg_stat_activity` with
  `wait_event_type = 'Lock'` (the same standard as RED-A/RED-B), or a
  `deadlock detected` (`40P01`) surfacing on whichever side PostgreSQL's own
  detector aborts. A "hang until timeout" without that live proof is not
  sufficient evidence.
- **Real Fix C:** identical fixture, unmodified helper (`ORDER BY id` in the
  locking query itself, not only in the earlier deduplication step). Both
  transactions' arrays contain the same two products, so the real helper
  makes both of them attempt to lock the *same* lower-`id` product first
  regardless of which order either adjustment's own array lists it in —
  one transaction simply queues behind the other for that single row, and
  neither can hold one product while waiting on the other. Both
  cancellations must complete without deadlock and each product's aggregate
  must equal the sum of its own bins.

The same "one multi-product document is not enough, it must be two documents
in reversed order" requirement applies to the Fix E control above: a single
multi-line Goods Receipt cancelling out against itself proves nothing about
cross-document ordering. Use two distinct documents (ideally from two
different functions, as specified in the scenario row, to prove the shared
helper generalizes rather than one function's loop happening to be safe) that
share at least two products, referenced in opposite order across the two
documents' own lines. Unlike the corrected cancellation-vs-cancellation and
consumption mutant-2 fixtures above, plain reversed line order *is* sufficient
here, because this control's "before" build is Fix E **omitted entirely** —
no batching helper exists in that build to collapse the caller's line order
into a set, so each line's separate, single-row lock call happens exactly
when the per-line loop reaches it, in that same order. `rpc_post_goods_receipt`/`rpc_post_delivery_note` have
no `LATER_STOCK_MOVEMENT_EXISTS`-equivalent guard to worry about confounding
the result, so unlike the cancellation fixture, these two do not need
separate warehouses per product to isolate the deadlock test from a business
rule — verify this against each function's actual body at implementation
time rather than assuming it, the same way this design verified
`LATER_STOCK_MOVEMENT_EXISTS`'s exact scope before writing the cancellation
fixture requirement.

CI: a new workflow on the green script against cutoff+191, plus the
existing red workflow still running against a database **without** 191
(same pattern as 186's red/green pair).

---

## 8. Runbook framing (required prose)

The 191 runbook is not a "stock incoming lock upgrade." It is:

> Two independent defect fixes plus a single lock-order contract, installed
> at every function that can break it, bundled because all of them live in
> functions that share the same `products`/`bins` state and because the lock
> order must be installed everywhere at once or it isn't a real invariant —
> a lock order three functions follow and two don't is not an invariant, it's
> a trap for whichever caller is the exception.
>
> - Fix A closes RED-A (`bins` unique-key insert / stale `EXCLUDED`).
> - Fix B closes RED-B (`products` aggregate from an unlocked `SUM`).
> - Outgoing 9-arg and 10-arg take the same product-row lock first so
>   incoming vs outgoing cannot deadlock.
> - Fix C reorders `rpc_cancel_stock_adjustment`'s locking (products before
>   bins, in a deterministic multi-row order via the new
>   `wardah_lock_products_for_stock_write` helper) so it cannot deadlock
>   against incoming/outgoing — it has neither RED-A nor RED-B, this is
>   compatibility only.
> - Fix D reorders `rpc_manual_stock_movement_v2`'s locking the same way,
>   single product — same compatibility-only status.
> - Fix E adds an upfront call to the same shared helper, for the complete
>   distinct product set each call will touch, to `rpc_post_goods_receipt`,
>   `rpc_post_delivery_note`, `rpc_submit_stock_adjustment`, and
>   `rpc_consume_reserved_materials_v2` — closing a transaction-level
>   deadlock between two such calls that Fix A/B/C/D alone do not close,
>   since each only guarantees the order *within* one call.
>
> This design's own review history is part of why the runbook states it this
> way: a first pass covered four functions, a second pass found a fifth after
> a systematic writer-sweep, a third pass found five more after a systematic
> *caller*-sweep the first sweep's methodology couldn't have found. State the
> full list and the sweep methodology that produced it, not just the fix,
> so a future reader auditing this migration can tell whether a sweep like
> this one was re-run before trusting the list is still complete.

It must also record:

- additive only; no history rewrite; no `ADJ-000001` repair
- rollback = restore the ten previous bodies from Migrations 97 (incoming
  9-arg), 124 (`rpc_cancel_stock_adjustment`), 133 (`rpc_post_delivery_note`),
  134 (`rpc_manual_stock_movement_v2`), 177 (`rpc_post_goods_receipt`), 186
  (outgoing 9-arg), 187 (incoming 10-arg, outgoing 10-arg,
  `rpc_submit_stock_adjustment`), and 190 (`rpc_consume_reserved_materials_v2`)
  — eight distinct files for ten functions — and drop the new
  `wardah_lock_products_for_stock_write` helper. That restores every change
  together — RED-A, RED-B, and every lock-order/upfront-lock change on the
  other eight functions revert as one unit. There is no supported "roll back
  Fix A, keep Fix B" or "keep Fix C/D/E but not A/B"
- The *effective* permission on the four stock-write helpers
  (`service_role`-only) is unchanged by this migration, but 191 must still
  explicitly re-issue `REVOKE ALL ... FROM PUBLIC, anon, authenticated` +
  `GRANT EXECUTE ... TO service_role` for each of those four signatures, and
  verify with `has_function_privilege()` in postflight — per §5, this is not
  a grant change, it is re-proving an invariant that a prior `CREATE OR
  REPLACE` (97) already broke silently once. The six other functions this
  migration touches keep their existing `authenticated` + `service_role`
  ACLs untouched (verified identical across all six) — every one of Fixes
  C/D/E is body-only, lock-order-only
- Production apply requires a separate authorization, preflight (ledger
  head, all eleven objects' signatures, ACLs on the four stock-write
  helpers, search_path), apply-once, postflight (`pg_get_functiondef`
  contract on all eleven), and **no** Production concurrency test against
  live vouchers
- Merging 191 onto `main` does not close the Production gap; 170 sat
  merged-but-unapplied (`PERMISSION_HARDENING_170_173_CHAIN.md` §6)

---

## 9. Implementation gate (still later; not this package)

Do not write SQL until this design is accepted. Then, in
`wardah-process-costing`, in a new tracking issue:

1. Open the issue (do not reopen #228 as if the proof were missing).
2. Add `sql/migrations/191_…sql` with preflight, **eleven** replaces/additions
   (incoming 9/10-arg, outgoing 9/10-arg, `rpc_cancel_stock_adjustment`,
   `rpc_manual_stock_movement_v2`, `rpc_post_goods_receipt`,
   `rpc_post_delivery_note`, `rpc_submit_stock_adjustment`,
   `rpc_consume_reserved_materials_v2`, and the new
   `wardah_lock_products_for_stock_write` helper), explicit ACL restatement
   on the four stock-write helpers only (`REVOKE ALL FROM PUBLIC, anon,
   authenticated` + `GRANT EXECUTE TO service_role` per signature — not
   granting anything new, but not silently inherited either; the other six
   functions' existing ACLs are left alone; the new helper gets no client
   grant at all), and an in-migration postflight that asserts
   `has_function_privilege()` is `false` for `anon`/`authenticated` and
   `true` for `service_role` on the four stock-write signatures, plus a
   static lock-order assertion on each of the other six per §7's contract
   rows.
3. Before writing any of it, re-run both sweeps from this design — every
   direct writer of `products.stock_quantity`, and every caller of
   `wardah_apply_stock_incoming`/`outgoing` — against `main` at implementation
   time, not against this document's list. If `main` moved between this
   design's acceptance and implementation, a twelfth function is not this
   design's problem to have predicted, but it is the implementation PR's
   problem to have checked for.
4. Add the green acceptance script + workflow, including all the new
   controls in §6/§7 (cancellation, manual movement, and the two
   multi-line-caller-vs-multi-line-caller scenarios) with the fixtures
   specified there; leave the red proof intact.
5. Runbook as §8.
6. No Production.

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
  stock-write helper bodies — they are `service_role`-only today and this
  migration does not change that
- it grants `EXECUTE` on `wardah_lock_products_for_stock_write` to `anon`,
  `authenticated`, or `PUBLIC`, or marks it `SECURITY DEFINER` without
  reason — it is an internal-only helper
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
- it ships Fix A/B/C without also fixing `rpc_manual_stock_movement_v2`'s
  own bins-before-products pre-lock (Fix D) — same failure shape, found in
  the same review round as Fix C, no reason to treat it differently
- it ships without Fix E on all four multi-line callers
  (`rpc_post_goods_receipt`, `rpc_post_delivery_note`,
  `rpc_submit_stock_adjustment`, `rpc_consume_reserved_materials_v2`) —
  fixing every individual helper's internal order does not stop two such
  callers from deadlocking on each other across a whole transaction
- any of the four Fix E callers locks its product set line-by-line as the
  loop runs, instead of resolving the complete distinct set once and
  locking it before the loop starts — this reintroduces exactly the
  transaction-level race Fix E exists to close, just with an extra step in
  between
- Fix E's green acceptance uses only one multi-line document instead of two
  different documents (or two calls) in reversed product order — this
  cannot distinguish a correct upfront lock from one that still processes
  lines one at a time
- five independent inline copies of "lock these products in ascending id
  order" appear instead of one shared `wardah_lock_products_for_stock_write`
  call site each — duplicated invariants are how the ACL history in §5
  drifted once already
- it re-uses this design's function list without re-running the two sweeps
  (writers of `products.stock_quantity`, callers of
  `wardah_apply_stock_incoming`/`outgoing`) against `main` at implementation
  time — this design's own list came from three successive passes, each
  correcting the one before
- it uses `FOR UPDATE` instead of `FOR NO KEY UPDATE` anywhere the products
  lock is taken (the shared helper, the incoming/outgoing prefix, or any
  inline equivalent) — this is the exact error a fourth review pass found
  in this design itself, and it creates a live deadlock against
  `rpc_create_mo_with_reservation`'s implicit FK lock, not a hypothetical one
- `wardah_lock_products_for_stock_write` does not verify the number of rows
  it actually locked against the number of distinct ids it was asked to
  lock, or does not raise on a mismatch — a missing or wrong-org product id
  must fail closed, not silently lock fewer rows than the caller assumes
- `wardah_lock_products_for_stock_write` is missing its own `search_path`
  or references `products` without the `public.` qualifier
- `rpc_consume_reserved_materials_v2`'s Fix E locks only the specific
  reservations resolved by `p_consumptions`, or filters on `status =
  'reserved'` *inside* the locking query, instead of locking every
  reservation row for the MO regardless of status and deriving the
  `'reserved'` subset from the frozen locked snapshot afterward — either
  narrower shape looks like Fix E but doesn't actually close the race: the
  first can miss a reservation the loop's stateful per-line resolution
  later selects, and the second can miss a row that flips from
  `released`/`expired`/`cancelled` back to `'reserved'` mid-transaction,
  since nothing in the schema prevents that transition
- `rpc_consume_reserved_materials_v2`'s Fix E derives its locked product set
  from the bare `material_reservations.product_id` column instead of the
  same `COALESCE(product_id, wardah_resolve_product_id(...))` expression the
  loop actually uses — `product_id` is nullable, so this would drop any
  reservation whose product is only resolvable through `item_id` and lock a
  set the loop's real product resolution doesn't match
- the `PRODUCT_NOT_PRELOCKED` guard is not `NULL`-safe (a bare `IF NOT
  v_product = ANY(v_locked_products)` lets a `NULL` effective product through
  instead of failing closed on it, since `NULL = ANY(...)` evaluates to
  `NULL`, not `false`, and `IF NULL THEN` does not raise)
- Fix D's products lock is placed before the *locked* `bins ... FOR UPDATE`
  read but after the earlier, *unlocked* warehouse-inference read
  (`rpc_manual_stock_movement_v2`'s `SELECT ... FROM bins` when
  `warehouse_id` is omitted) — the lock must precede the first `bins`
  reference in the function, not only the one that takes `FOR UPDATE`
- the mutant-2 guard-regression fixture (§7) uses the same `mo_id` for both
  concurrent `rpc_consume_reserved_materials_v2` calls — this cannot exercise
  product-level contention at all, since both calls would fully serialize on
  the function's first statement (`manufacturing_orders ... FOR UPDATE`)
  before reaching any product lock
- any of the four Fix E functions is missing the `PRODUCT_NOT_PRELOCKED` (or
  equivalent) guard after per-line product resolution — required uniformly
  on all four per this design, not only on the ones judged structurally
  necessary, so a future edit that reintroduces per-line drift fails loudly
  instead of silently
- the lock graph in §6 is not re-verified against `main` at implementation
  time — it depends on `release_expired_reservations`,
  `rpc_complete_manufacturing_order`, and `rpc_create_mo_with_reservation`
  each not acquiring `products`/`bins`/`material_reservations`/
  `manufacturing_orders` in an order this design didn't account for, and
  that must be re-checked against whatever `main` looks like when 191 is
  actually written, not assumed from this document
- `wardah_lock_products_for_stock_write`'s green acceptance for lock order
  (cancellation-vs-cancellation, consumption guard mutant 2) relies on
  "reversed line/traversal order" at the caller or reservation level instead
  of an explicit positional-loop mutant plus a two-step rendezvous that
  forces each side's *first* lock before the other starts — since Fix C and
  Fix E both resolve the complete product set and call the helper once
  before any per-line/per-reservation work, caller-side ordering never
  reaches the helper's own locking query, so this cannot actually prove
  anything about lock acquisition order (the seventh correction above; this
  is the exact Codex finding on `64fdc35`)
- the static contract for `wardah_lock_products_for_stock_write` checks only
  that dedup/normalization is sorted (`ARRAY(SELECT DISTINCT ... ORDER BY
  ...)`) without also asserting `ORDER BY` on `id` in the query that carries
  `FOR NO KEY UPDATE` itself — a helper can satisfy the former and still lock
  rows in scan order, not id order, which is the property the whole
  deadlock-avoidance argument in §6/§7 actually depends on
