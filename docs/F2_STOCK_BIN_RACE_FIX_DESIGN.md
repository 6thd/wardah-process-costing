# F2 — Stock incoming lost-update remediation design

**Status:** design for review. No SQL. No Production access.
**Date:** 2026-09-06
**Source repo:** [`6thd/wardah-process-costing`](https://github.com/6thd/wardah-process-costing)
**Verified `main`:** [`eada076a98cf9b5391bebdcec550159d22c5da0b`](https://github.com/6thd/wardah-process-costing/commit/eada076a98cf9b5391bebdcec550159d22c5da0b)
**Proof PR:** [#235](https://github.com/6thd/wardah-process-costing/pull/235) merged by `6thd`
**Proof writeup:** `docs/db/F2_STOCK_BIN_RACE_RED_PROOF.md`
**Companion:** `docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md` — implementation
evidence gates for the future Migration 191 PR (valuation/queue assertions, exact
ACL evidence by signature, rollback rehearsal, throughput characterization,
source-of-truth carry-forward matrix). It adds no architecture and no scope.
**This file is authoritative:** if the companion ever conflicts with this design,
this design wins and the companion must be corrected before implementation.
**Original tracking:** [#228](https://github.com/6thd/wardah-process-costing/issues/228) — closed at proof merge; remediation needs a **new** issue
**Production writes:** none authorized by this document

This document chooses the remediation shape. It does not implement it.

> **Correction note (kept here, not silently fixed):** an earlier draft of this
> section asserted the 9-arg `wardah_apply_stock_incoming` overload is currently
> `GRANT EXECUTE`-able by `authenticated`. That is wrong. Checked directly against
> `sql/baseline/000_schema_baseline_20260905_184634.sql` (cutoff 189, the live schema
> `main` is currently at): the four stock-write helpers this design replaces —
> `wardah_apply_stock_incoming` 9-arg and 10-arg, `wardah_apply_stock_outgoing` 8-arg
> and 9-arg — carry the identical live ACL `REVOKE ALL FROM PUBLIC; GRANT ALL TO
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
> `wardah_apply_stock_outgoing` 8/9-arg) and treated that as the complete set of
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

> **Eighth correction (found in review): the seventh correction's own fix had a
> mechanism gap and conflated two different invariants in one mutant.**
>
> 1. **The "signals"/"rendezvous" wording had no concrete, implementable mechanism.**
>    The pause between a mutant transaction's first and second lock has to happen
>    *inside* one running PL/pgSQL call (`wardah_lock_products_for_stock_write`,
>    called once). The RED-A/RED-B file-touch/poll rendezvous pauses *between*
>    a returned `SELECT rpc(...)` and the client's next statement — it has no way to
>    reach a point mid-loop inside a single function call, and "signals" was never
>    tied to an actual primitive. Corrected to a session-level advisory-lock gate: a
>    coordinator session takes `pg_advisory_lock(1)` and `pg_advisory_lock(2)` before
>    either mutant transaction starts; the mutant helper calls
>    `PERFORM pg_advisory_lock(<its gate>)` immediately after its first row lock,
>    which blocks because the coordinator holds it; the coordinator polls
>    `pg_stat_activity` for both backends showing `wait_event_type = 'Lock'`,
>    `wait_event = 'advisory'`, then releases both gates from its own session
>    (advisory locks are session-scoped — only the acquiring session can release
>    one). Verified empirically against a live PostgreSQL 17 instance: both
>    backends reached the advisory wait as expected, and releasing both gates
>    together produced a real `deadlock detected` (`40P01`) from PostgreSQL's own
>    detector, with `pg_stat_activity` showing the symmetric wait
>    (`Process A waits for … blocked by process B` / `Process B waits for … blocked
>    by process A`) immediately before it fired.
> 2. **Consumption guard mutant 2 tested the wrong invariant.** As previously
>    written, both MOs' narrowed prelocks already covered the *complete* `{A, B}`
>    set (just fed to the mutated, order-preserving helper in opposite array
>    order) — so removing `PRODUCT_NOT_PRELOCKED` played no role in the deadlock;
>    it was a second copy of the helper-ordering test wearing the guard mutant's
>    name, and would deadlock identically whether the guard was present or absent
>    (the guard only fires on a product *outside* the locked set, and every product
>    here was inside it). Corrected to a genuinely different construction that
>    isolates guard completeness from helper ordering: MO 1's superset lock covers
>    only `{A}` (not `{A, B}`) and its per-line loop later resolves an item to the
>    *un-prelocked* product `B`; MO 2's superset covers only `{B}` and its loop
>    later needs `A`. This calls the real, unmodified
>    `wardah_lock_products_for_stock_write` — no positional-loop mutation, no
>    ordering mutation, because each upfront call locks only one product and there
>    is nothing to reorder. The advisory-lock gate barrier moves to *after* the
>    upfront (single-product) superset lock and *before* the per-line loop: MO 1
>    locks `A`, gates on `1`; MO 2 locks `B`, gates on `2`; releasing both together
>    lets both loops proceed to resolve their un-prelocked product at the same
>    instant. With the guard present, each side must raise `PRODUCT_NOT_PRELOCKED`
>    the instant its loop resolves the un-prelocked product — before ever
>    attempting to lock it, so neither side can reach a blocking wait and no
>    deadlock is possible. With the guard removed, each side's loop calls straight
>    into the ordinary per-line `wardah_apply_stock_incoming`/`outgoing` path, which
>    takes a plain single-row `FOR NO KEY UPDATE` on the un-prelocked product — `T1`
>    holds `A` and waits on `B`, `T2` holds `B` and waits on `A`: a genuine
>    deadlock caused specifically by the missing guard, with no helper-ordering
>    mutation involved at all. Mutant 1 (narrowed superset, guard present,
>    single-transaction) and mutant 3 (real 191) are unaffected by this
>    correction.
>
> §7's cancellation-vs-cancellation construction and the consumption guard
> mutant-2 row are both rewritten below; §9's reject-list gained matching bullets.

> **Ninth correction (found in review): the cancellation-vs-cancellation helper-order
> mutant still assumed a caller-side ordering guarantee Fix C never makes.**
>
> The eighth correction fixed *how* the two mutant transactions pause mid-call, but
> not *where their input arrays come from*. The fixture as written tried to control
> `wardah_lock_products_for_stock_write`'s input order by inserting adjustment 1's
> `stock_adjustment_items` rows A-then-B and adjustment 2's B-then-A. That controls
> nothing: Fix C's own source is "collect the distinct `product_id`s referenced by
> the non-cancelled SLEs this call is about to reverse" (§4, Fix C) — a different
> table than `stock_adjustment_items`, gathered via an unordered `DISTINCT`/array
> collection with no explicit `ORDER BY` specified anywhere in this design. Nothing
> ties SLE scan order to item-insertion order, and nothing guarantees a `DISTINCT`
> collection without `ORDER BY` returns rows in any particular, testable order at
> all — the exact class of "implementation-defined order used as if it were
> deterministic" error the seventh and eighth corrections already found elsewhere.
> Forcing item-insertion order could have both callers hand the mutant helper `{A,
> B}` in the *same* physical order by coincidence, and the mutant would pass GREEN
> without the helper's ordering ever having been genuinely crossed — a live version
> of exactly the false-negative risk this whole correction chain exists to close.
>
> Fix: stop trying to make a real RPC produce a specific array order at all. Split
> into two independent tests, each proving exactly one thing:
>
> 1. **Standalone helper-order mutant** (new): call the ordering-removed
>    `wardah_lock_products_for_stock_write` mutant directly, as its own test-only
>    invocation, with literal `ARRAY['<A>','<B>']` and `ARRAY['<B>','<A>']` — the
>    test harness supplies the crossed order itself, with no caller in between to
>    lose it. Uses the same advisory-lock gate barrier verified in the eighth
>    correction. This is now the *only* place the ordering-removed mutant runs; it
>    proves the helper's ascending-`id` ordering is what prevents the deadlock,
>    independent of any specific caller's collection logic — a property that then
>    applies to every caller of the real, unmodified helper (Fix C included),
>    regardless of what order that caller's own array happens to be built in.
> 2. **Cancellation-vs-cancellation real-path control** (kept, reframed): the
>    two-`SUBMITTED`-adjustments-sharing-two-products fixture, run against the real,
>    unmodified Fix C and helper. It no longer tries to force or assert a specific
>    lock-acquisition order — that is now the standalone mutant's job — and it no
>    longer needs an "ordering-removed" build at all, since there is nothing this
>    fixture can control that would make one meaningful. It asserts business
>    correctness under genuine concurrency instead: no deadlock, and both products'
>    aggregates equal the sum of their own bins. The separate-warehouse-per-product
>    fixture shape (to keep each cancellation's own `LATER_STOCK_MOVEMENT_EXISTS`
>    check from tripping on the other's reversal SLEs) is unchanged from before,
>    since that requirement had nothing to do with array ordering.
>
> The global-ordering guarantee for Fix C specifically therefore rests on two things
> together, neither of which depends on Fix C's own collection order: the standalone
> mutant (dynamic proof that the shared helper's `ORDER BY id` is what prevents a
> crossed-order deadlock) and the existing static contract row requiring
> `wardah_lock_products_for_stock_write` to be called before `rpc_cancel_stock_adjustment`'s
> first `UPDATE bins`. Fix C's own "collect the distinct product_ids" step needs no
> `ORDER BY` added for correctness — the helper re-sorts ascending by `id`
> regardless of the input array's order — only the *test* needed to stop pretending
> otherwise.
>
> §7 is restructured below: a new GREEN table row for the standalone helper-order
> mutant, and the cancellation-vs-cancellation row/prose reframed as a real-path
> control. §9's reject-list gained a matching bullet.

> **Tenth correction (found in review): the standalone helper-order mutant's own
> GREEN (real-helper) run reused a barrier the real function cannot participate
> in.**
>
> The ninth correction's mutant description said to "run the identical
> literal-array fixture once more against the real, unmodified helper" — reusing
> the *same* advisory-lock-gate barrier as the RED (ordering-removed) run. That
> does not work: the advisory-lock gate call (`PERFORM pg_advisory_lock(<gate>)`
> immediately after the first row lock) is code the RED mutant is instrumented
> with for the test; the real, unmodified `wardah_lock_products_for_stock_write`
> has no such call anywhere in its body (production code has no reason to call a
> test-only synchronization primitive). With the real helper, both calls resolve
> `ARRAY[A,B]`/`ARRAY[B,A]` to the same ascending-`id` order and both attempt to
> lock `A` first — so the second call would block *before* ever reaching a gate
> that only the mutant's own code calls. A coordinator waiting for two
> `wait_event = 'advisory'` waiters, one of which can never appear, hangs
> forever; the GREEN run described this way would never actually complete, let
> alone prove anything.
>
> Fix: the GREEN (real-helper) run does not need a gate at all — ordinary row-lock
> waiting, the same primitive RED-A/RED-B already uses, is enough. Transaction 1
> calls the real helper with `ARRAY[A,B]`, gets both products back, and holds its
> transaction open (no `COMMIT` yet). Transaction 2, started only after
> transaction 1's call has already returned, calls the real helper with
> `ARRAY[B,A]`. Verified empirically against a live PostgreSQL 17 instance:
> transaction 2's call does not return at all while transaction 1's transaction
> is open — no partial progress, confirming it is blocked trying to acquire the
> *first* product in ascending order (`A`) despite its own array listing `B`
> first — and `pg_blocking_pids(<transaction 2's pid>)` returns
> `{<transaction 1's pid>}`, PostgreSQL's own documented, precise mechanism for
> proving one backend is genuinely blocked by another (more direct than parsing
> `wait_event`/`wait_event_type` alone, though those corroborate: `Lock` /
> `transactionid`). Committing transaction 1 lets transaction 2 immediately
> proceed to lock `A` then `B` and return successfully — no deadlock. This
> directly demonstrates the real helper's `ORDER BY id` converges both callers on
> the same acquisition order regardless of the caller's own array order, using
> only mechanisms present in the real, uninstrumented function.
>
> The RED (ordering-removed) run of the standalone mutant is unchanged — the
> advisory-lock gate is correct there, because that build's own code is the one
> instrumented with the gate call.
>
> §7's standalone helper-order mutant row is corrected below; §9's reject-list
> gained a matching bullet.

> **Eleventh correction (found in review): the tenth correction's own GREEN
> proof didn't discriminate correct from buggy — it proved blocking, not order.**
>
> The tenth correction's GREEN construction held transaction 1's call locking
> **both** `A` and `B` (via `ARRAY[A,B]`), then showed transaction 2 (calling with
> `ARRAY[B,A]`) is blocked by transaction 1 via `pg_blocking_pids()`. That proves
> transaction 2 is blocked by transaction 1 — it does not prove *which* product
> transaction 2 tried to lock first, because transaction 1 holds both. A helper
> that instead respects the caller's own input order verbatim (locks `B` first
> because the array lists `B` first) would be blocked by the same transaction 1
> for the same reason, and `pg_blocking_pids()` would return the identical
> result. Verified empirically: built a "buggy" helper that locks products in
> literal input-array order (no re-sort), ran it as transaction 2 against
> transaction 1 holding both `A` and `B` — `pg_blocking_pids()` returned
> transaction 1's pid regardless, even though the buggy helper's own `NOTICE`
> log showed it was attempting `B` (not `A`) first. The construction could not
> tell a correct helper from a wrong one; it was a livelock/liveness check
> wearing an ordering proof's clothes.
>
> Fix: give each product an *independent* single-row blocker instead of one
> transaction holding both. `blocker_A` locks only `A` (`FOR NO KEY UPDATE`,
> its own transaction, held open); `blocker_B` locks only `B`, independently.
> Transaction 2 then calls the real helper with `ARRAY[B, A]`. Before releasing
> anything, `pg_blocking_pids(<transaction 2's pid>)` must equal
> `{<blocker_A's pid>}` **only** — proving transaction 2's *first* lock attempt
> landed on `A`, not `B`, despite `B` being listed first in its input.
> Releasing `blocker_A` alone must move `pg_blocking_pids(<transaction 2's
> pid>)` to `{<blocker_B's pid>}` — proving transaction 2 then attempted `B`
> next, i.e. the acquisition sequence really is `A` then `B`, not merely "blocked
> by something." Releasing `blocker_B` lets transaction 2 complete. Verified
> empirically against a live PostgreSQL 17 instance, run twice: against the
> real (correct) helper, `pg_blocking_pids()` showed `{blocker_A}` then
> `{blocker_B}` in that order, exactly as specified; against the same "buggy",
> input-order-preserving helper used to reproduce the flaw, `pg_blocking_pids()`
> showed `{blocker_B}` immediately and releasing `blocker_A` had **no effect**
> on it (still `{blocker_B}`, confirming transaction 2 was never waiting on `A`
> at all) — the corrected construction cleanly separates the two cases the
> previous one could not.
>
> §7's standalone helper-order mutant GREEN row and prose are corrected below;
> §9's reject-list gained a matching bullet.

> **Twelfth correction (found in review, minor — fixture specification gap, not
> an architectural defect): the GREEN run's "`A` first" expectation was never
> tied to an explicit ordering guarantee on `A`'s and `B`'s actual UUIDs.**
>
> The eleventh correction's GREEN construction expects `pg_blocking_pids()` to
> show `{blocker_A}` before `{blocker_B}`, because the real helper locks
> ascending by `id` and the fixture calls the lower-`id` product "`A`" throughout
> the prose. Nothing in the construction itself asserts that the literal UUID
> chosen for `A` actually sorts below the one chosen for `B` — if a fixture
> happened to pick them the other way around, the *correct* helper would lock
> `B` first (matching its own ascending-`id` order) and the GREEN run would
> report a false failure against a correct implementation, not a false pass. Not
> a false-GREEN risk (no defect could hide behind it), but worth closing before
> the acceptance script is written, the same way §7 elsewhere insists on exact,
> checked preconditions rather than assumed ones.
>
> Fix: the implementation's fixture setup must assert `A`'s UUID `< ` `B`'s UUID
> before running either the RED or GREEN standalone-mutant scenario (e.g. `SELECT
> 1 WHERE '<A>'::uuid < '<B>'::uuid` as a fixture precondition, or select two
> literal UUID constants and record which one sorts lower directly in the test
> file's comment) — a one-line guard, not a design change.

> **Thirteenth correction (found in review): a twelfth live function,
> `release_expired_reservations`, has the same counter-ordering shape as the
> defects Fix C/E already close — but on `material_reservations`, not `products` —
> and this design's own §6 "edge" definition was too narrow to have caught it.**
>
> Checked directly against the live baseline (cutoff 189; body unreplaced since
> Migration 61, `search_path` added later out-of-band via
> `FIX_SEARCH_PATH_WARNINGS`, not a numbered migration):
>
> ```sql
> CREATE FUNCTION public.release_expired_reservations(p_org_id uuid DEFAULT NULL::uuid)
>     RETURNS integer LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
> ...
>     UPDATE material_reservations
>     SET status = 'expired', released_at = NOW(),
>         quantity_released = quantity_reserved - quantity_consumed, updated_at = NOW()
>     WHERE status = 'reserved' AND expires_at IS NOT NULL AND expires_at < NOW()
>       AND (p_org_id IS NULL OR org_id = p_org_id);
> ...
> ```
>
> `SECURITY INVOKER`, `GRANT ALL TO anon, authenticated, service_role` (confirmed
> against the live baseline) — any authenticated caller can invoke it directly. It
> is a multi-row `UPDATE` with no `ORDER BY`/row-lock of its own: it locks whatever
> order its scan visits (index or heap), not `id` order. Fix E's consumption
> superset lock (§4) locks every reservation row for an MO `ORDER BY id`. Two
> reservations `r1`/`r2` for the same MO, both `reserved` and expired, with
> `id(r1) < id(r2)` but the scan reaching `r2` first: a consuming transaction
> locking `r1` then waiting on `r2`, concurrent with a release locking `r2` (mid-scan)
> then waiting on `r1`, is a real circular wait — confirmed by constructing the
> exact shape (a deterministic mutant forcing the reversed order, not a
> planner-dependent fixture; see below) and observing a genuine `deadlock detected`
> (`40P01`) against a live PostgreSQL 17 instance.
>
> Two things about this needed correcting from how it was first raised:
>
> 1. **Not a new class of bug — a weaker version already exists on `main` today.**
>    Live `rpc_consume_reserved_materials_v2` already locks reservations one at a
>    time, in the *payload's* order (not `id` order), which also doesn't match
>    `release_expired_reservations`'s scan order. 191 doesn't introduce this
>    category; it makes consumption's reservation order deliberate and contractual
>    (ascending `id`, the same discipline as `products`), which means
>    `release_expired_reservations` becomes the **one remaining known exception to
>    that contract on the same table** — exactly the "a lock order three functions
>    follow and two don't is not an invariant, it's a trap for whichever caller is
>    the exception" framing §8 already uses for `products`. The same standard
>    applies here.
> 2. **The gap was in §6's *criterion*, not its list.** §6 stated the edge test as
>    a *table-to-table* lock-order reversal and cleared `release_expired_reservations`
>    on the grounds that it "only reads/updates `material_reservations` — no
>    `products`, no `bins`, no `manufacturing_orders` lock. No edge to conflict
>    with." That is true of *inter-table* edges and irrelevant to this defect: two
>    multi-row lockers on the *same* table, over a shared row set, in different
>    orders, is exactly as much a cycle risk as two lockers on different tables in
>    reversed order — Fix C and the cancellation-vs-cancellation control already
>    rest on that exact principle for `products`. The criterion needed to say
>    "table-to-table transition **or** multi-row lock on a shared row set of the
>    *same* table in a non-identical order," not just the former.
>
> **Fix F** brings `release_expired_reservations` under the same lock discipline:
>
> ```sql
> CREATE OR REPLACE FUNCTION public.release_expired_reservations(p_org_id uuid DEFAULT NULL::uuid)
> RETURNS integer
> LANGUAGE plpgsql
> SET search_path TO 'public', 'pg_temp'
> AS $$
> DECLARE
>   v_count integer;
>   v_ids uuid[] := '{}'::uuid[];
>   v_id uuid;
> BEGIN
>   FOR v_id IN
>     SELECT id FROM public.material_reservations
>     WHERE status = 'reserved' AND expires_at IS NOT NULL AND expires_at < now()
>       AND (p_org_id IS NULL OR org_id = p_org_id)
>     ORDER BY id
>     FOR NO KEY UPDATE
>   LOOP
>     v_ids := array_append(v_ids, v_id);
>   END LOOP;
>
>   UPDATE public.material_reservations
>   SET status = 'expired', released_at = now(),
>       quantity_released = quantity_reserved - quantity_consumed, updated_at = now()
>   WHERE id = ANY(v_ids);
>
>   GET DIAGNOSTICS v_count = ROW_COUNT;
>   RETURN v_count;
> END;
> $$;
> ```
>
> Confirmed to compile and behave correctly against a live PostgreSQL 17 instance:
> locks the eligible set ascending by `id`, then updates exactly that frozen set —
> a reservation with `quantity_consumed IS NULL` still produces
> `quantity_released IS NULL` (the live function's existing behavior, unchanged;
> see point 3 below), and a not-yet-expired row is left untouched.
>
> Three refinements to how this was first proposed, all adopted:
>
> 1. **No `SKIP LOCKED` in the primary design.** An earlier draft of Fix F added
>    `FOR UPDATE SKIP LOCKED` reasoning that a release sweep should never wait and
>    can safely defer a contended row to the next scheduled run. That is a genuine
>    *semantic* change — from "process every eligible row, waiting if necessary" to
>    "process what's immediately available, skip the rest" — not a lock-order-only
>    change, and does not belong in a migration billed as lock-order compatibility
>    only (the same standard already held Fix C/D to: ACL and business behavior
>    unchanged, lock order only). `ORDER BY id FOR NO KEY UPDATE` alone is
>    sufficient to remove the cycle with every function this design controls, and
>    keeps `release_expired_reservations`'s existing blocking, complete-sweep
>    behavior intact. `SKIP LOCKED` is not adopted; if it is wanted later as a
>    best-effort cron-sweep optimization, it is a separate, explicitly-labeled
>    semantic change with its own retry/next-run acceptance criteria, not folded
>    into 191.
> 2. **Reservation lock mode unified to `FOR NO KEY UPDATE`, not `FOR UPDATE`, in
>    both Fix E's consumption superset lock and Fix F.** `material_consumption`
>    (confirmed against the live baseline) carries `material_consumption_reservation_id_fkey
>    FOREIGN KEY (reservation_id) REFERENCES material_reservations(id)` — the exact
>    same shape that forced `FOR NO KEY UPDATE` on `products` earlier in this
>    design (§4, "Lock mode"): inserting a `material_consumption` row takes an
>    implicit `FOR KEY SHARE` lock on the referenced `material_reservations` row,
>    which conflicts with a bare `FOR UPDATE` there but not with `FOR NO KEY
>    UPDATE`. `rpc_consume_reserved_materials_v2` is the only current writer that
>    populates `material_consumption.reservation_id`
>    (`src/services/manufacturing/mesService.ts`'s `consumeMaterial()` also
>    inserts `material_consumption` rows directly from the client, but never
>    sets `reservation_id` — a separate, `NULL`-`reservation_id` write path
>    this correction is not about), so this is not a live deadlock today via
>    the FK this paragraph concerns. The principle this design already
>    applies to `products` ("no bare `FOR UPDATE` on a referenced parent row
>    without a specific reason") applies identically here regardless — and
>    the existence of that second, direct-insert write path is itself a
>    reason to prefer the weaker lock, not a reason it's safe to skip: an
>    authenticated client with ordinary `material_consumption` write access
>    is not structurally prevented from supplying a `reservation_id` of its
>    own, so nothing here should assume `rpc_consume_reserved_materials_v2`
>    is the only possible source of an FK-referencing insert going forward,
>    only that it is today's. There is no reason `material_reservations`
>    needs the stronger lock either way: the columns Fix E's guard and Fix
>    F's `UPDATE` touch (`status`, `quantity_*`,
>    `released_at`, `updated_at`) are exactly the kind of non-key columns `FOR NO
>    KEY UPDATE` is for. Both the consumption superset lock and Fix F now specify
>    `ORDER BY id FOR NO KEY UPDATE`.
> 3. **`quantity_released = quantity_reserved - quantity_consumed` is left exactly
>    as the live function computes it, `NULL`-propagation included, deliberately not
>    wrapped in `COALESCE(quantity_consumed, 0)`.** The live column is nullable with
>    a `DEFAULT 0`, so a `NULL` here is possible but is a pre-existing data-semantics
>    question independent of lock ordering — bundling an unrelated tightening into a
>    lock-order-only migration is exactly the scope creep §1 already argues against
>    for Fix C/D. Tracked as a named, separate follow-up; not part of 191.
>
> **RED for Fix F must be a deterministic mutant, not a planner-dependent
> fixture.** An earlier proposal suggested constructing two `reserved`, expired
> rows and relying on `expires_at` index/heap scan order differing from `id`
> order — after the standalone helper-order mutant work (tenth/eleventh
> corrections), this design does not accept "the planner will probably visit rows
> in this order" as an acceptance mechanism again. Instead, mirroring the
> standalone helper-order mutant exactly: a test-only mutant of the *locking loop*
> (not the real function) explicitly locks two reservation rows in literal
> `[B, A]` order with an advisory-lock gate after the first lock, run concurrently
> against a caller locking `[A, B]` (consume's real, ascending order) with the same
> gate mechanism. Confirmed empirically against a live PostgreSQL 17 instance:
> this reproduces a genuine `deadlock detected` (`40P01`), with both backends
> observed on their advisory gate beforehand exactly as the standalone
> helper-order mutant already established for `products`. The real, unmodified
> Fix F body, run under the same forced-overlap fixture, must not deadlock.
>
> §1/§4/§5/§6/§7/§8/§9 all gain matching content below: object count rises to
> **twelve**; a new "Fix F" subsection follows Fix E; the lock graph and its edge
> criterion are corrected; GREEN/RED rows and a static contract for
> `release_expired_reservations` are added; the reservation lock mode changes to
> `FOR NO KEY UPDATE` everywhere it appears; the rollback file/function count and
> preflight are updated, with the `cron.job` check guarded
> (`to_regclass('cron.job') IS NOT NULL`) since not every environment has
> `pg_cron` installed; and a residual-risk paragraph documents unmediated
> multi-row client writes on `products`/`material_reservations` as an F1/write-surface
> concern this migration does not and should not attempt to close.

> **Fourteenth correction (found in review): two P1s in the thirteenth
> correction's own text, plus a P2 wording imprecision, all confirmed and
> fixed.**
>
> 1. **The `cron.job` "guard" in §9's preflight does not guard anything.**
>    `SELECT ... FROM cron.job WHERE to_regclass('cron.job') IS NOT NULL AND
>    ...` still fails with `relation "cron.job" does not exist` on an
>    environment without `pg_cron` — confirmed against a live PostgreSQL 17
>    instance without the extension. PostgreSQL resolves the `FROM cron.job`
>    reference while planning the query, before the `WHERE` clause is
>    evaluated against any row, so a `to_regclass` condition inside `WHERE`
>    cannot prevent the failure; it only ever would have filtered rows from a
>    query that already failed to plan. Fixed: replaced with a `DO $$ ... $$`
>    block that only reaches a dynamic `EXECUTE` of the `cron.job` query
>    inside an `IF to_regclass('cron.job') IS NOT NULL THEN` branch — real
>    control flow, confirmed empirically to skip cleanly (`RAISE NOTICE
>    'pg_cron not installed...'`) on an instance without `pg_cron`, rather
>    than a `WHERE`-clause condition that can never run early enough to help.
> 2. **No explicit precondition that Migration 190 is applied before 191.**
>    191's replace of `rpc_consume_reserved_materials_v2` is built on top of
>    the Migration 190 body (§5's own rollback bullet already says so), which
>    means 191 carries forward 190's `manufacturing.material_consumption.consume`
>    permission-key guard (confirmed: lines 111–116 of the live 190 body)
>    unconditionally — regardless of whether 190 itself has ever been applied
>    to the target database. Production is confirmed at cutoff 189 as of this
>    design (190 merged, not yet applied). Applying 191 directly to such a
>    database would deploy the guard's *code* without 190's own `INSERT` ever
>    having created the permission-key row the guard checks — silently
>    denying every non-org-admin caller of consumption
>    (`MATERIAL_CONSUMPTION_PERMISSION_DENIED`) the moment 191 lands, since
>    `has_permission()`'s org-admin override bypasses the key check entirely
>    but an ordinary granted role does not. Fixed: §9's preflight now
>    hard-asserts, before proceeding — 190 in the Production ledger; the
>    permission row's exact module/resource/action shape; that the *current*
>    `rpc_consume_reserved_materials_v2` body already contains the M190
>    guard (proving 191 would be replacing the M190 body, not an earlier
>    one); and 190's own quarantine postflight invariants
>    (`backflush_materials` retired, `trigger_auto_backflush` absent) still
>    hold. This makes the dependency this design already assumed into a
>    checked gate instead of an implicit one — the same `repository-first`/
>    `DB-first` ordering principle `CLAUDE.md` already states generally, now
>    a specific, verifiable precondition for this migration.
> 3. **P2 — "the only current writer of `material_consumption`" is imprecise.**
>    `src/services/manufacturing/mesService.ts`'s `consumeMaterial()` also
>    inserts `material_consumption` rows directly from the client (confirmed:
>    a plain `.insert()`, `consumption_type: 'MANUAL'`), and Migration 190
>    deliberately left this path in place. It does not set `reservation_id`,
>    so it does not collide with the FK this design's lock-mode argument
>    concerns — but the claim as written overstated exclusivity. Corrected
>    to "the only current writer that populates `reservation_id`," and noted
>    that the existence of a second, direct-insert write path is itself a
>    reason `FOR NO KEY UPDATE` (not `FOR UPDATE`) is the right choice, not a
>    reason the FK conflict is safe to ignore: an authenticated client with
>    ordinary write access to `material_consumption` is not structurally
>    prevented from supplying its own `reservation_id`.
>
> §9's preflight is corrected below for points 1 and 2; the "only writer"
> phrasing is corrected in both places it appears (§4, thirteenth correction
> and Fix F sections) for point 3.

> **Fifteenth correction (found in review): the consumption superset lock's own
> per-line loop still takes a bare `FOR UPDATE` on `material_reservations`, and
> the claim that this is "a no-op wait" is wrong.**
>
> The live Migration 190 body's per-line loop selects the reservation to
> consume in one of two branches — `reservation_id` given (lines 143–145) or
> derived from `item_id` (lines 147–150, `ORDER BY created_at, id LIMIT 1`) —
> and both lock it with a bare `FOR UPDATE`. An earlier revision of this
> design left both untouched, reasoning that since the superset lock already
> holds `FOR NO KEY UPDATE` on every reservation for the MO, the loop's later
> `FOR UPDATE` on the same row "re-acquires a lock this call already holds (a
> no-op wait)."
>
> That is not how a lock-mode *upgrade* behaves. Verified empirically against
> a live PostgreSQL 17 instance: a transaction holding `FOR NO KEY UPDATE` on
> a row, with a second, independent transaction concurrently holding `FOR KEY
> SHARE` on the same row (via an `INSERT` into a child table with an FK to
> it — exactly the shape of an `INSERT INTO material_consumption` referencing
> a reservation), then requesting `FOR UPDATE` on that row itself — genuinely
> blocks, confirmed via `pg_blocking_pids()` showing the upgrading transaction
> blocked by the `FOR KEY SHARE` holder, until that holder commits. A lock
> request is evaluated against every other transaction's currently-held locks
> at the moment it is made, not only against what this same transaction
> already holds; `FOR UPDATE` conflicts with `FOR KEY SHARE` where `FOR NO KEY
> UPDATE` does not, per the same conflict table this design already used to
> justify `FOR NO KEY UPDATE` on `products`. So the per-line loop's bare `FOR
> UPDATE` reintroduces exactly the conflict the superset lock was chosen to
> avoid, the instant any concurrent transaction holds `FOR KEY SHARE` on that
> reservation — which the fourteenth correction's own point 3 already
> established is possible via either write path (`rpc_consume_reserved_materials_v2`
> itself, or the direct `mesService.consumeMaterial()` insert once it is
> extended to set `reservation_id`, or any other future FK-referencing
> insert).
>
> Fix: both per-line branches change from `FOR UPDATE` to `FOR NO KEY UPDATE`.
> With that change, "re-acquires a lock this call already holds" becomes
> literally true — same mode, on a row the superset lock already holds — and
> is a genuine no-op, verified by the same empirical test with both sides
> using `FOR NO KEY UPDATE`: no block. Business semantics are unaffected: the
> per-line `UPDATE`s that follow touch `status`, `quantity_*`, `product_id`,
> `uom_id`, and timestamps — never a reservation's own `id` or anything
> another table's FK depends on staying fixed — exactly the class of column
> `FOR NO KEY UPDATE` is for, the same argument already made for the superset
> lock and for Fix F.
>
> §4, §7, and §9 are corrected below: the per-line lock mode; a static
> contract requirement that **no** bare `FOR UPDATE` on `material_reservations`
> exists anywhere in `rpc_consume_reserved_materials_v2` after 191, not only in
> the pre-loop superset lock; a dynamic mutant proving the mechanism (a
> concurrent `FOR KEY SHARE` holder forces a bare-`FOR UPDATE` build to wait,
> and does not force the real, `FOR NO KEY UPDATE` build to wait); and a
> matching reject-list bullet.

> **Sixteenth correction (found in review): the fifteenth correction's own
> §7 mutant offered a real `INSERT INTO material_consumption` as one way to
> build the `FOR KEY SHARE` blocker — that option risks blocking on the
> wrong resource, not the one this check exists to test.**
>
> `material_consumption` (confirmed against the live baseline) carries FKs
> to `work_order_id`, `mo_id`, `product_id`, `reservation_id`, and `stage_id`,
> at minimum. An `INSERT` into it takes an implicit `FOR KEY SHARE` on *every*
> referenced row simultaneously — not only the reservation. `rpc_consume_reserved_materials_v2`'s
> own first statement is `manufacturing_orders ... FOR UPDATE`. If the blocker
> transaction's `INSERT` references the *same* MO the consumption call under
> test is about to process, the consumption backend can block on the MO lock
> before it ever reaches the per-line reservation lock this check exists to
> test — genuine blocking, confirmed via `pg_blocking_pids()`, but attributed
> to the wrong resource. A test that passes for that reason proves nothing
> about the reservation lock mode at all, and a test-writer who builds the MO
> row to avoid this collision has just built the isolated fixture below by
> another name, while a fixture description that presents the `INSERT` as an
> equally valid option invites exactly the version that doesn't.
>
> Fix: the blocker in this specific mutant must be a `FOR KEY SHARE` taken
> **directly and only** on the reservation row —
> `SELECT id FROM material_reservations WHERE id = <R> FOR KEY SHARE;`, held
> open in its own transaction, touching no other table. Verified empirically
> against a live PostgreSQL 17 instance, run both ways with this isolated
> blocker: against a bare-`FOR UPDATE` build, `pg_blocking_pids(<consumption's
> pid>)` returns exactly `{<the blocker's pid>}`; against the real,
> `FOR NO KEY UPDATE` build, the identical fixture returns `{}` — no
> blocking at all. A real `INSERT INTO material_consumption` remains valid as
> supporting evidence that this `FOR KEY SHARE` conflict is a genuine,
> naturally-occurring shape in this schema (not a test artifact) — it is just
> not the isolation mechanism for *this* mutant, which must attribute the
> block (or its absence) to the reservation lock specifically, asserted via
> the exact blocking pid, not merely `wait_event_type = 'Lock'`.
>
> §7's per-line reservation lock-mode mutant is corrected below to require
> the isolated, reservation-only blocker.

> **Seventeenth correction (found in review): the sixteenth correction's own
> GREEN criterion — a `{}` snapshot from `pg_blocking_pids()` — is not itself
> race-free proof that the per-line lock statement was ever reached.**
>
> A test harness that starts the real-191 consumption call and, at some
> point during its execution, checks `pg_blocking_pids(<consumption's pid>)
> = {}` cannot distinguish "the per-line lock was attempted and did not
> conflict" from "the harness sampled before the backend reached that
> statement at all." An empty result is consistent with both. This is
> exactly the class of timing-dependent, non-deterministic acceptance this
> whole correction chain has been closing everywhere else (the RED-A/RED-B
> `wait_event_type`/`pg_stat_activity` standard, the advisory-lock gates, the
> `pg_blocking_pids()`-not-`wait_event_type`-alone tightening in the
> sixteenth correction itself) — a one-time snapshot with no forcing
> mechanism behind it doesn't meet that standard.
>
> Fix: do not release the reservation-only blocker at all during the GREEN
> run. Start the real-191 consumption call while the blocker's `FOR KEY
> SHARE` transaction is open and held, and require the consumption call to
> **return successfully — with its expected business side effect visible
> (a `material_consumption` row inserted / the reservation's
> `quantity_consumed` advanced) — while the blocker is still open**. This is
> race-free by construction: if the per-line `FOR NO KEY UPDATE` lock ever
> conflicted with the still-held `FOR KEY SHARE`, the call could not return
> at all until the blocker released (which it never does, in this run) — so
> observed completion is unambiguous proof the lock attempt did not
> conflict, with no dependency on sampling timing. `pg_blocking_pids() = {}`
> may still be recorded as corroborating information, but is no longer the
> pass/fail criterion; only after completion is observed does the blocker
> get released, for cleanup. The RED run's assertion (exact blocking pid,
> per the sixteenth correction) needs no change — a mutant that genuinely
> blocks has no completion-timing ambiguity to close.
>
> §7's per-line reservation lock-mode mutant row is corrected below: the
> GREEN success criterion changes from a `pg_blocking_pids() = {}` snapshot
> to observed call completion before the blocker is released.

> **Eighteenth correction (found by a fresh, full Codex review requested on
> `ace4fd2`, two P1s and a P2, all confirmed and fixed):**
>
> 1. **P1 — the "Fix E omitted" multi-line-caller RED fixture is
>    scheduler-dependent, not deterministic.** "Reverse the two callers' line
>    order and run them concurrently" does not by itself force the crossed
>    acquisition this control is supposed to prove: nothing stops one call
>    from completing both its lines before the other one starts, or from
>    acquiring its second product before the other call reaches its first —
>    the exact "hope the scheduler cooperates" failure mode the seventh
>    through eleventh corrections already eliminated everywhere else in this
>    document. Fixed with the same external-blocker-plus-FIFO-queue
>    technique verified for point 2 below (no instrumentation of either real
>    multi-line caller needed): an external blocker locks the *second*
>    caller's first-needed product; both callers are started in a controlled
>    order so the wait queue on that product is deterministic; releasing the
>    blocker resolves who acquires it, forcing the crossed hold-and-wait
>    shape before either call's second lock attempt.
> 2. **P1 — the "incoming vs `rpc_create_mo_with_reservation`" mutant is
>    equally scheduler-dependent** ("run them in parallel, must deadlock" has
>    the same gap — nothing forces incoming to hold the product at the
>    instant reservation needs it, or forces reservation to hold the bin at
>    the instant incoming needs it). Verified empirically against a live
>    PostgreSQL 17 instance that a **single external, test-only blocker on
>    the shared bin row** — never itself a party to the final deadlock —
>    resolves this deterministically, using only PostgreSQL's documented
>    FIFO ordering of conflicting lock requests on one row, with no
>    instrumentation of either real function: an external session locks the
>    bin first; the real `rpc_create_mo_with_reservation` is started and
>    queues behind it (confirmed via `pg_blocking_pids`); the mutant
>    `wardah_apply_stock_incoming` build is started next, locks the product
>    (uncontested), then also queues behind the external blocker for the bin,
>    *after* reservation in the queue (confirmed); the external blocker
>    releases; PostgreSQL's FIFO ordering grants the bin to reservation
>    (which queued first), not incoming; reservation proceeds to its
>    FK-implied `FOR KEY SHARE` on the product, which conflicts with
>    incoming's held (mutant) `FOR UPDATE` — the cycle is now real and
>    complete (incoming waits on reservation for the bin; reservation waits
>    on incoming for the product) and PostgreSQL's own deadlock detector
>    fired a genuine `deadlock detected` in the exact run that produced this
>    correction. This generalizes directly to point 1's scenario (same
>    mechanism, same-type resources instead of cross-type).
> 3. **P2 — the Fix F real-helper GREEN row's "consumption proceeds
>    normally" claim is not true under every serialization order.**
>    `rpc_consume_reserved_materials_v2`'s reservation lookup filters on
>    `status = 'reserved'` and raises `ACTIVE_RESERVATION_NOT_FOUND` on no
>    match. If `release_expired_reservations` wins the race for that
>    reservation's lock and commits first, the row is `'expired'` by the
>    time consumption's own lookup runs, and consumption correctly fails
>    atomically with `ACTIVE_RESERVATION_NOT_FOUND` — not "proceeds
>    normally." Both outcomes are correct (no deadlock, no partial effects
>    either way); only one specific claim ("consumption proceeds normally")
>    was wrong as a universal statement. Corrected to name both orderings and
>    their respective correct outcomes explicitly, the same way this design
>    already does for `LATER_STOCK_MOVEMENT_EXISTS` orderings elsewhere in §7.
>
> §7's three affected rows are corrected below; §9's reject-list gained
> matching bullets. CI/SonarQube passed on `ace4fd2` — this correction is
> concurrency-test-determinism and acceptance-wording only, no architecture
> or SQL change.

> **Nineteenth correction (found in review): the eighteenth correction's own
> "documented FIFO ordering" claim was an unqualified generalization, and the
> specific `pg_blocking_pids()` relationship it should have asserted before
> release was never written down — and the exact values first proposed for
> that assertion turned out to be wrong when checked live.**
>
> The instinct behind this finding is correct and adopted: "confirmed via
> `pg_blocking_pids`" plus a general appeal to "PostgreSQL's documented FIFO
> ordering of conflicting lock requests" is exactly the kind of claim this
> whole correction chain has been eliminating everywhere else — an
> assertion invoked by name instead of pinned to an exact, checked value.
> The fix must state precisely what `pg_blocking_pids()` returns for each
> party *before* the external blocker is released, not merely gesture at
> ordering behavior.
>
> Checking that precisely, however, does not confirm the specific values an
> earlier draft of this correction proposed. Verified against a live
> PostgreSQL 17 instance, with an external blocker `R` holding a row, a
> second session `T2` requesting the same row second, and a third session
> `T1` requesting it third: immediately before `R` is released,
> `pg_blocking_pids(T2) = {R}` (as expected), but `pg_blocking_pids(T1) =
> {T2}` — **not** `{R, T2}`. `pg_locks` explains why: row-level locking in
> PostgreSQL is two-staged. The first waiter to request a row already
> targeted by a lock acquires a heavyweight *tuple lock* (`LOCKTAG_TUPLE`)
> before checking whether the row's current locker (`R`, via its uncommitted
> `xmax`) has finished — `T2` held that tuple lock and was itself waiting on
> `R`'s transaction id (`wait_event = transactionid`). `T1`, arriving after,
> could not even acquire the tuple lock — `T2` already held it — so `T1`
> waited directly on `T2` (`wait_event = tuple`), with no reference to `R` in
> its own `pg_blocking_pids` result at all. This is a *more* precise and more
> useful fact than the transitive set originally proposed: it shows `T1` is
> blocked specifically by the earlier-arriving waiter, not by the ultimate
> holder, which is if anything a cleaner proof of arrival order than a
> compound set would have been.
>
> Fix: both corrected §7 rows now state the exact `pg_blocking_pids()` value
> each party must show immediately before the blocker is released —
> `pg_blocking_pids(<second-arriving waiter>) = {<blocker>}` and
> `pg_blocking_pids(<third-arriving waiter>) = {<second-arriving waiter>}`
> — replacing both "confirmed via `pg_blocking_pids`" (no value stated) and
> the unqualified "documented FIFO ordering" claim with the specific,
> checked two-stage tuple-lock mechanism that actually produces the ordering
> here, verified live rather than assumed from either revision's reasoning
> about it.
>
> §7's two RED/mutant rows are corrected below with the exact pre-release
> assertions; §9's reject-list gained a matching bullet.

> **Twentieth correction (found by a fresh Codex review requested on
> `8f4aa0d`, one P1): the multi-line-caller RED fixture's external product-B
> blocker must take `FOR NO KEY UPDATE`, not `FOR UPDATE`, or it can stop the
> call at the wrong statement.**
>
> Confirmed directly against the live `rpc_post_goods_receipt` body
> (Migration 177, line 366 vs line 377): the per-line loop does `INSERT INTO
> goods_receipt_lines` — which carries an FK to `products` and so takes an
> implicit `FOR KEY SHARE` on that line's product — *before* calling
> `wardah_apply_stock_incoming` for the line. A `FOR UPDATE` blocker on
> product B (as an earlier revision of this fixture left unspecified,
> defaulting to the stronger mode used elsewhere in this document) conflicts
> with that `FOR KEY SHARE` and can stop the call at the `INSERT`, before it
> ever reaches the helper-lock edge this mutant exists to test — the exact
> same false-attribution shape the sixteenth correction already found and
> fixed for `material_reservations`, recurring here on a different table.
>
> Fix: the external product-B blocker takes `FOR NO KEY UPDATE`. It does not
> conflict with the `INSERT`'s `FOR KEY SHARE`, so the call proceeds past it
> normally, while `FOR NO KEY UPDATE` still conflicts with the per-line
> product lock (also `FOR NO KEY UPDATE`, per this design's own "Lock mode"
> section) both callers take inside `wardah_apply_stock_incoming`/`outgoing`
> — the actual edge under test. The exact `pg_blocking_pids()` assertions
> from the nineteenth correction are unchanged; only the blocker's lock mode
> is corrected.
>
> The incoming-vs-`rpc_create_mo_with_reservation` mutant's blocker (on the
> *bin*, not a product) is unaffected — nothing inserts a row with an FK to
> `bins` ahead of that fixture's edge, so this finding does not apply there.
>
> §7's multi-line-caller row is corrected below; §9's reject-list gained a
> matching bullet.

> **Twenty-first correction (found by a fresh Codex review requested on
> `2b09ce2`, one P1): Fix E's `rpc_post_delivery_note` design proposed
> caching the upfront prelock read and reusing it in the per-line loop —
> that silently changes business behavior when the same
> `sales_invoice_line_id` appears more than once in one payload.**
>
> Confirmed directly against the live Migration 133 body: the existing loop
> does `SELECT id, product_id, quantity, unit_price, COALESCE(delivered_quantity,
> 0) AS delivered INTO v_inv_line FROM sales_invoice_lines WHERE id = ... FOR
> UPDATE` **fresh, every iteration** — not once up front — and then `UPDATE
> sales_invoice_lines SET delivered_quantity = v_inv_line.delivered +
> v_qty_base, unit_cost_at_sale = round((v_inv_line.delivered *
> COALESCE(unit_cost_at_sale, 0) + v_line_cogs) / (v_inv_line.delivered +
> v_qty_base), 6) WHERE id = v_inv_line.id`. The live code's own comment
> states why: *"Cumulative weighted average across partial deliveries, so
> the generated invoice-line cogs equals the exact summed delivery COGS once
> fully delivered."* If the same line id appears twice in one payload (a
> real, unvalidated possibility — nothing rejects a duplicate
> `sales_invoice_line_id`), the live behavior is: iteration 1 reads
> `delivered = 0`, applies its quantity, writes `delivered = 6`; iteration 2
> re-reads the *same row*, now correctly sees `delivered = 6` (read-your-own-
> writes within the transaction), and either raises `OVER_DELIVERY` if the
> combined total exceeds `quantity`, or accumulates correctly and computes a
> correct weighted-average `unit_cost_at_sale` across both deliveries.
>
> An earlier revision of this design's Fix E proposed locking
> `sales_invoice_lines` once up front and "reusing that locked read in the
> subsequent loop (instead of re-querying)." Doing that would make both
> iterations of a duplicated line read the *same* stale `delivered = 0` and
> the *same* stale `unit_cost_at_sale`, both compute against that stale
> base, and the second `UPDATE` would overwrite the first's result instead of
> accumulating onto it — silently under-counting `delivered_quantity` by
> however much the duplicate line shipped, permitting stock to be decremented
> beyond what the invoice line records as delivered, corrupting the
> cumulative weighted-average COGS, and defeating the `OVER_DELIVERY` guard
> for exactly the payload shape it exists to catch. This is a real
> business-behavior change, not merely a lock-order one — precisely what
> Fix E is supposed to never be (§1: "no business-behavior change" is the
> standing rule for every Fix E function).
>
> Fix: the upfront batched lock on `sales_invoice_lines` exists *only* to
> resolve and lock the row identities early enough to build the product-lock
> set before the per-line loop starts — it takes `product_id` (and only
> `product_id`) from that read. It changes nothing about the existing loop,
> which keeps its own fresh `SELECT ... FOR UPDATE` and read of `delivered`/
> `unit_cost_at_sale`/etc. on every iteration, byte-for-byte as today. Both
> locks target the identical row (payload-fixed `sales_invoice_line_id`), so
> the loop's own lock is a same-mode, same-transaction, no-op re-acquisition
> — never a value cache. The upfront lock still closes the concurrency gap
> this design is about: once locked (upfront), a concurrent client cannot
> change that row's `product_id` out from under the resolved lock set,
> because the row stays locked continuously from the upfront batch through
> the loop's own re-acquisition of it.
>
> §4's `rpc_post_delivery_note` description and the adjacent guard-generalization
> paragraph are corrected below; §7 gains a duplicate-line-id regression row;
> §9's reject-list gained a matching bullet.

> **Twenty-second correction (found by a fresh Codex review requested on
> `3b330a1`, one P2, plus a compounding risk this design found while fixing
> it): `rpc_post_goods_receipt`'s Fix E pre-pass can reorder which line's
> error the caller sees, and — checked while designing the fix — the naive
> pre-pass shape can also throw a raw cast error before any business
> validation runs at all.**
>
> Confirmed directly against the live Migration 177 body: the per-line loop
> validates, in this fixed order, for each line in turn — `GR_LINE_OBJECT_REQUIRED`
> (line 201-203), the `product_id` cast and `ITEM_NOT_FOUND` (line 205-211),
> then `INVALID_QUALITY_STATUS` (line 213-216) — before moving to the next
> line. A payload whose line 1 has an invalid `quality_status` and whose
> line 2 has a well-formed but nonexistent `product_id` raises
> `INVALID_QUALITY_STATUS: line=1` today, because the loop never reaches
> line 2 first. Fix E's pre-pass — resolving every line's `product_id`
> up front and handing the set to `wardah_lock_products_for_stock_write`
> before the loop starts — reaches line 2's nonexistent product before the
> loop ever gets to line 1, and the helper's own `PRODUCT_NOT_FOUND_OR_WRONG_ORG`
> would fire first instead. That is a real business/error-behavior change,
> the same class of violation the twenty-first correction just closed for
> `rpc_post_delivery_note`.
>
> Checked while designing the fix: the risk compounds. A pre-pass built as
> `SELECT DISTINCT (value->>'product_id')::uuid FROM jsonb_array_elements(...)`
> — the literal shape this design specified — evaluates the cast for every
> line as part of executing that one query; if *any* line's `product_id` is
> not a syntactically valid UUID, PostgreSQL raises `invalid input syntax
> for type uuid` for the whole pre-pass, before the loop runs at all, even
> ahead of an earlier line's `INVALID_QUALITY_STATUS` or
> `GR_LINE_OBJECT_REQUIRED`. Confirmed empirically against a live PostgreSQL
> 17 instance: `SELECT DISTINCT (value->>'product_id')::uuid FROM
> jsonb_array_elements('[{"quality_status":"bogus"},{"product_id":"not-a-uuid-at-all"}]')`
> raises `invalid input syntax for type uuid: "not-a-uuid-at-all"` outright —
> a raw Postgres error, not even one of this RPC's own exception codes,
> replacing what should have been `INVALID_QUALITY_STATUS: line=1`.
>
> Fix: the pre-pass becomes a **non-throwing candidate extraction only**. It
> must not decide `GR_LINE_OBJECT_REQUIRED`, `ITEM_NOT_FOUND`, or
> `INVALID_QUALITY_STATUS` — those stay exactly where they are, decided by
> the unchanged loop, in unchanged order — and it must not raise on a
> malformed `product_id` string either. Guard the cast with a `CASE` whose
> condition is a UUID-shape check, so the cast is only attempted on a
> candidate that already matches the shape (PostgreSQL evaluates `CASE`
> branches in order and only evaluates the matching branch — unlike a
> `WHERE` predicate, whose evaluation order relative to a joined cast is not
> guaranteed):
>
> ```sql
> v_products := ARRAY(
>   SELECT DISTINCT p.id
>   FROM jsonb_array_elements(p_payload->c_lines_key) AS line(value)
>   JOIN public.products p
>     ON p.org_id = v_org
>    AND p.id = CASE
>                 WHEN line.value->>'product_id' ~
>                   '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
>                 THEN (line.value->>'product_id')::uuid
>                 ELSE NULL
>               END
> );
> ```
>
> Confirmed empirically against a live PostgreSQL 17 instance, same
> malformed-and-valid mixed payload as above: this form raises nothing and
> returns exactly the one genuinely resolvable product, silently excluding
> the malformed and nonexistent candidates from the locked set — which is
> correct, because the loop's own unchanged, sequential validation is what
> must decide what happens with the lines that produced those candidates,
> not the pre-pass.
>
> > **Superseded by the twenty-fourth correction.** The canonical
> > `8-4-4-4-12` regex above is the exact form that was tested here, and it is
> > preserved verbatim on purpose: it is the intermediate fix that solved the
> > *throwing* defect and was only later found to be semantically **narrower
> > than PostgreSQL's own UUID parser**, which also accepts brace-wrapped and
> > hyphenless spellings. The empirical result recorded immediately above
> > belongs to *this* regex form and to nothing else. The live specification in
> > §4 now uses `pg_input_is_valid(..., 'uuid')` instead; see the twenty-fourth
> > correction below for that form and its own separate evidence. Do not
> > rewrite this block to the newer form — doing so would destroy the record of
> > what was actually tested and why it was replaced.
>
> **Swept the other three Fix E pre-passes for the same defect class, not
> only the one Codex named:** `rpc_post_delivery_note`'s pre-pass (twenty-first
> correction) has the identical shape — resolving `sales_invoice_line_id`
> strings from the payload — and needs the same `CASE`-guarded join, not an
> `ANY(ARRAY(... ::uuid ...))` built by casting every payload id directly;
> corrected below alongside it. `rpc_submit_stock_adjustment`'s pre-pass is
> keyed by `adjustment_id`, an already-typed function parameter resolved
> from an earlier lookup, not a per-line payload string — no raw cast over
> payload data occurs, so this defect class does not reach it.
> `rpc_consume_reserved_materials_v2`'s superset lock is keyed by `p_mo_id`,
> likewise an already-typed parameter, not a payload-array cast — also
> unaffected. Both were re-checked directly against this design's own text
> for this correction, not assumed safe by category.
>
> §4's `rpc_post_goods_receipt` and `rpc_post_delivery_note` descriptions are
> corrected below with the `CASE`-guarded extraction; §7 gains two regression
> rows (validation-error ordering preserved; malformed-UUID-in-a-later-line
> does not preempt an earlier line's own error); §9's reject-list gained
> matching bullets.

> **Twenty-third correction (companion evidence-gates document, commit
> [`f582669`](https://github.com/6thd/wardah-process-costing/commit/f5826697cb4789e5346825d8c1e746d91b50d1da)):
> the implementation-quality gates were split into a companion file, and that
> file was reachable only in one direction.**
>
> `f582669` added `docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md`, which
> collects five evidence disciplines for the future Migration 191
> implementation PR — valuation/queue integrity assertions, exact ACL evidence
> by signature, a rollback rehearsal, throughput/lock-wait characterization,
> and a source-of-truth carry-forward matrix. It changes no architecture and
> adds no scope; it is an acceptance companion, not a second design.
>
> That commit is logged here because it was not previously recorded in this
> correction log at all, and because the link between the two documents ran
> only one way: the companion names this design as its source of truth, but a
> reader entering through this design had no indication the companion existed.
> Both the status block at the top and §9's implementation gate now link to it.
>
> **Authority is unchanged and not negotiable:** `F2_STOCK_BIN_RACE_FIX_DESIGN.md`
> — this file — is authoritative for lock order, function bodies, behavior
> preservation, and scope. If the companion ever conflicts with this design, this
> design wins and the companion must be corrected before implementation.

> **Twenty-fourth correction (two P2s from the fresh review of `f5826697`):
> candidate extraction must accept every spelling PostgreSQL's live UUID cast
> accepts, and the shared lock contract's universal part is the product prefix,
> not outgoing's function-specific all-bins scan.**
>
> First, the twenty-second correction's hand-written canonical UUID regex was
> non-throwing but not parser-equivalent to the unchanged loop's `::uuid` cast.
> PostgreSQL also accepts valid non-canonical spellings, including brace-wrapped
> UUIDs and 32 hexadecimal digits without hyphens. The regex silently omitted
> those candidates, after which the loop could resolve the product and hit the
> fail-closed `PRODUCT_NOT_PRELOCKED` guard for a request that succeeds today.
> Both affected Fix E pre-passes now use PostgreSQL's own
> `pg_input_is_valid(text, 'uuid')`, with the cast still confined to the matching
> `CASE` branch. Malformed, nonexistent, and wrong-org candidates remain silently
> excluded; only the unchanged per-line loop decides their business errors and
> their order. §7 adds parser-parity GREEN coverage for both RPCs, and §9 rejects
> either eager casts or narrower hand-written shape tests.
>
> **Empirical evidence for this correction, run against a disposable
> `PostgreSQL 17.6` instance** (`PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled
> by gcc (GCC) 15.2.0, 64-bit`, the Supabase PostgreSQL 17 build) **and
> re-run in full against a disposable stock upstream build**
> (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), which produced **identical
> results in every case below and in every locking-clause probe further down**.
> The cross-check is recorded deliberately: a parser-parity argument that
> rested on a vendor-patched build would be worth very little, and the point
> of this correction is that the guard must track PostgreSQL's own UUID
> parser rather than anyone's approximation of it. This evidence belongs to
> the twenty-fourth
> correction and to the `pg_input_is_valid` form only; it is **not** the
> twenty-second correction's result and must never be relabelled as such:
>
> 1. **Parser parity.** `pg_input_is_valid(..., 'uuid')` returns `t` for the
>    canonical `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`, `t` for the brace-wrapped
>    `{a0eebc99-…-6bb9bd380a11}`, and `t` for the 32-hex hyphenless
>    `a0eebc999c0b4ef8bb6d6bb9bd380a11`; it returns `f` for `not-a-uuid-at-all`.
>    All three accepted spellings cast to the *same* value — both
>    `'{…}'::uuid = '…'::uuid` and `'a0eebc99…0a11'::uuid = '…'::uuid` return
>    `t` — which is exactly the equivalence the canonical regex was silently
>    breaking, since it matched only the first spelling.
> 2. **Malformed input.** Inside the guarded `CASE`, `not-a-uuid-at-all` yields
>    `NULL` and raises nothing. The eager form is unchanged in its failure:
>    `SELECT (value->>'product_id')::uuid FROM jsonb_array_elements(...)` over the
>    same mixed payload still aborts with
>    `ERROR:  invalid input syntax for type uuid: "not-a-uuid-at-all"`, so the
>    twenty-second correction's premise stands and only its *guard* was too narrow.
> 3. **`NULL` / missing-key input.** This case is called out separately because it
>    is the one the unchanged loop must keep owning. `line.value->>'missing_key'`
>    is `NULL`; `pg_input_is_valid(NULL, 'uuid')` is itself `NULL`, not `false`,
>    so the `CASE` takes its `ELSE` branch and the guarded expression yields
>    `NULL` — no exception, no match, and no business-error decision stolen from
>    the loop. **The two functions differ here and the difference matters:** for
>    goods receipt an object *missing* `product_id` is **not**
>    `GR_LINE_OBJECT_REQUIRED` — Migration 177 raises that only when the array
>    element is not a JSON object at all (line 201-203); an object without the
>    key yields `v_product = NULL` and the loop raises **`ITEM_NOT_FOUND`**
>    (line 205-211). For delivery note, Migration 133 checks
>    `NULLIF(v_line->>'sales_invoice_line_id','') IS NULL` first and raises
>    **`LINE_REQUIRED`** (line 171). So the correct expectation is
>    `ITEM_NOT_FOUND` for goods receipt and `LINE_REQUIRED` for delivery note,
>    each decided by its own unchanged loop. Verified explicitly rather
>    than assumed from the `false` case, because a three-valued condition
>    reaching a `CASE` is precisely the kind of detail that reads as obvious and
>    is wrong often enough to matter.
> 4. **Goods-receipt exact pre-pass.** Against a disposable `products` fixture,
>    the §4 query run over one payload mixing a canonical existing id, a
>    brace-wrapped existing id, a hyphenless existing id, a malformed id, an
>    object with the `product_id` key *missing*, a well-formed nonexistent id,
>    and a well-formed id belonging to a **different org**, returned exactly the
>    three genuinely resolvable products and raised nothing. Resolved
>    case-by-case: canonical → `P-CANON`, brace-wrapped → `P-BRACE`,
>    hyphenless → `P-HYPHENLESS`; malformed, missing-key, nonexistent, and
>    wrong-org each → `NULL`, silently excluded from the locked set.
> 5. **Delivery-note exact pre-pass.** Against a disposable `sales_invoice_lines`
>    fixture, the §4 query — including `ORDER BY sil.id` and the outer `DISTINCT`
>    over the inner locked rows — returned exactly the three resolvable products
>    for the same seven-case mix and raised nothing.
>
> Both spellings were exercised against **both** pre-passes, not one spelling
> each; §7's acceptance row requires that full matrix rather than splitting
> coverage across the two functions.
>
> Second, an earlier statement of the shared contract incorrectly generalized
> outgoing's existing ordered all-bins scan to every object Migration 191 touches.
> The universal invariant is only the complete, distinct, globally ordered
> `products FOR NO KEY UPDATE` prefix before any bins work (and before the loop for
> multi-line callers). Bin footprints remain function-specific: incoming locks
> only its target bin, outgoing retains its all-bins scan, and cancellation,
> manual movement, and Fix E callers retain their existing per-line/bin behavior.
> Fix F remains a separate same-table `material_reservations` ordering contract.
> This is a correction to the prose invariant, not broader locking or a change to
> Fix A-F.

> **Twenty-fifth correction (P1 from an independent Astra review of `bafc50f`,
> source-confirmed here and reproduced as a deterministic `40P01`): the
> global-lock-graph completeness criterion was applied to `products` and
> `material_reservations` but never to `bins`. That omission — not a forgotten
> function — is what allowed a multi-product `bins` locker to be cleared on a
> `products`/FK argument alone.**
>
> The thirteenth correction already established the right criterion: an edge is
> not only a table-to-table lock-order transition, it is **also a multi-row lock
> on a shared row set of the same table taken in a non-identical order by two
> different functions**. That criterion exists precisely because an earlier pass
> had cleared `release_expired_reservations` under the table-to-table sense
> alone. The sweep written immediately after it then applied the same-table
> sense to exactly two tables — `material_reservations` and `products` — and
> **never to `bins`**, the one table every function in this design locks. §6's
> clearing bullet for `rpc_create_mo_with_reservation` is the direct
> consequence: it reasoned only about that function's `products`/`bins` edge,
> concluded `FOR NO KEY UPDATE` removed the conflict, and stopped — without ever
> asking whether the function's own multi-row `bins` acquisition order matches
> that of the functions it overlaps. It does not. The criterion was sound; it
> was simply not run against the table that mattered most.
>
> **The reusable rule, stated so that the next multi-product `bins` locker
> cannot repeat this.** Any routine that can retain `bins` row locks for more
> than one product within a single transaction must either
>
> 1. acquire the complete transaction-wide product set through the shared
>    ascending `products` `FOR NO KEY UPDATE` prefix **before its first `bins`
>    lock**; or
> 2. carry a separately demonstrated, globally compatible lock-order contract
>    against **every** overlapping `bins` writer.
>
> Two qualifications are part of the rule, not commentary on it. First,
> "retains `bins` locks" includes locks taken **implicitly** by `UPDATE` or
> `INSERT ... ON CONFLICT DO UPDATE`, not only an explicit `FOR UPDATE`; an
> implicit row lock is still a lock, which is the same point §6 already had to
> make about implicit FK locks, applied to a second lock source. Second, **a
> single-product control is not sufficient evidence for a multi-product `bins`
> locker** — §7 now states this where that control is defined, because the
> existing single-product control passes cleanly against the defective body.
>
> `rpc_create_mo_with_reservation` is the one live routine that violates this
> rule. It therefore joins Migration 191's replaced bodies, and the object count
> rises from twelve to thirteen (twelve predecessor bodies plus the one new
> helper). The bounded sweep that establishes it is the *only* violator is
> recorded in §6, with its search criterion, so a later reader can re-run it
> rather than trust it.
>
> **Why the previous reasoning looked complete and was not.** Migration 186's
> body groups its resolved demand by product, visits products `ORDER BY
> product_id`, and for each product locks **all** of that product's bins with
> `ORDER BY warehouse_id, id FOR UPDATE` (`sql/migrations/186_stock_moves_contract_repair.sql`
> lines 288-315, carried into the live body). It holds product `A`'s bins while
> it moves on to product `B`. Meanwhile `rpc_post_goods_receipt` iterates
> `jsonb_array_elements(p_payload->lines)` in **payload order** with no
> `ORDER BY` (Migration 177 line 199), and Fix E deliberately preserves that
> loop. After 191, receipt prelocks its complete product set — but reservation
> takes no `products` lock at all until its closing `material_reservations`
> insert, and that insert's implicit `FOR KEY SHARE` does not conflict with the
> prefix's `FOR NO KEY UPDATE`. **The prefix therefore cannot serialize these
> two functions**, and the cycle that remains is `bins`↔`bins`, which no
> `products` lock mode can resolve.
>
> **Empirical evidence for this correction**, run against a disposable stock
> upstream build (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), `READ
> COMMITTED`, stock `deadlock_timeout = 1s`. The choreography is gated on
> **observed** state — `pg_stat_activity`, `pg_blocking_pids()`, and `bins.xmax`
> — never on a sleep, so no result below is scheduler-dependent. The model
> reproduces the live lock choreography (reservation's per-product all-bins
> scan, receipt's payload-order loop, incoming's target-bin-only footprint,
> outgoing's all-bins footprint); it is not the live schema, and nothing was run
> against Production or Staging:
>
> 1. **RED, reservation vs incoming/goods receipt.** Products `A < B`, both with
>    existing bins in warehouses `W1` and `W2`. `T1` (reservation over `[A,B]`)
>    locked `A`'s bins — `bins.xmax` showed `839` on both `A/W1` and `A/W2` —
>    and was gated before `B`. `T2` (post-191 receipt, payload `[B,A]`) then
>    **passed the product prefix `{A,B}` without blocking**, took only
>    `bins(B,W1)` (`xmax` `840`), and was gated. Releasing `T1` put it in
>    `Lock`/`transactionid` wait with `pg_blocking_pids = {T2}`. Releasing `T2`
>    produced the sampled mutual wait — `T1 blocked_by={1134}`, `T2
>    blocked_by={1125}` — and then:
>    `ERROR: 40P01: deadlock detected`, `DETAIL: Process 1125 waits for
>    ShareLock on transaction 840; blocked by process 1134. Process 1134 waits
>    for ShareLock on transaction 839; blocked by process 1125.`,
>    `CONTEXT: while locking tuple (0,3) in relation "bins"` inside the
>    reservation body's `ORDER BY warehouse_id, id FOR UPDATE`,
>    `LOCATION: DeadLockReport, deadlock.c:1130`. **Reservation was the victim**
>    and rolled back; the receipt committed. The cycle is tuple locking on
>    `bins` on both sides.
> 2. **Incoming's footprint confirmed, not assumed.** Throughout the receipt's
>    hold, `bins(B,W2).xmax` remained `0` — incoming locked only its target bin,
>    exactly as Fix A requires. The deadlock does not depend on widening it.
> 3. **RED, reservation vs outgoing/delivery-note class.** The same choreography
>    against a multi-product outgoing caller reproduced the identical cycle and
>    the same `40P01`. Because outgoing retains its all-bins scan, `T2` held
>    **both** `bins(B,W1)` and `bins(B,W2)`, so the contended footprint is
>    strictly wider on the outgoing side.
> 4. **The existing single-product control passes against the defective body.**
>    Single-product reservation vs single-product incoming completed with zero
>    deadlocks and produced its MO and reservation normally; `T2` simply waited
>    on the one shared bin. This is the acceptance-coverage half of the finding:
>    the control specified in §7 can go green while this defect ships.
> 5. **The crossed order is the defect, established by a negative control.**
>    Reservation `[A,B]` against a receipt payload in **ascending** `[A,B]` order
>    completed with no deadlock. That rules out a harness artifact and confirms
>    the relevant edge is the non-identical multi-row `bins` ordering, precisely
>    as the corrected criterion describes.
> 6. **GREEN candidate.** With the reservation body taking the complete distinct
>    material-product set through the shared helper — ascending ids, `FOR NO KEY
>    UPDATE`, before its first `bins` lock, bin loop otherwise untouched — both
>    the receipt and the delivery-note variants completed with **no `40P01`**.
>    The competing caller **serialized at the shared product prefix**: while
>    `T1` held the prefix, `T2` reported `pg_blocking_pids = {T1}` and had not
>    reached its post-bin gate, with `bins(B,W1).xmax` and `bins(B,W2).xmax`
>    both still `0` — it had taken **no bin lock at all**. Incoming's
>    target-bin-only footprint, reservation's per-product bin ordering,
>    availability results, and quantities were all preserved; the MO and both
>    reservation rows were created, so the FK inserts succeeded under the held
>    prefix.
>
> **State this result no more strongly than it is.** These runs show that the
> candidate removes the demonstrated crossed-`bins` cycle and does not reopen
> the FK conflict the "Lock mode" analysis already resolved. They do **not**
> prove that no unrelated cycle exists anywhere in the graph; the reject list in
> §9 forbids citing a passing run as that kind of proof.
>
> **What survives from the earlier reasoning, and what is narrowed.** The
> finding that `FOR NO KEY UPDATE` is compatible with the FK's implicit `FOR KEY
> SHARE` is correct and is retained — it is what lets reservation hold the new
> prefix and still perform its own `material_reservations` inserts, and it is
> what the single-product control proves. What is narrowed is the conclusion
> drawn from it: that compatibility eliminates the `products`/FK deadlock edge
> **only**. It says nothing about a multi-product `bins`↔`bins` ordering edge,
> and it was never evidence that this RPC could stay outside the prefix. The
> §6 clearing bullet and the §6 statement that 191 should add no explicit
> `products` lock to this RPC are corrected in place below rather than deleted,
> so the reasoning chain stays auditable.

> **Twenty-sixth correction (two P2s from an independent Astra review of
> `884135e`, source-confirmed against Migration 186 and the live baseline; no
> new database execution):** Fix G's first wording captured a product set and
> then let later statements re-resolve, and it reused a pre-Fix-G FK
> choreography as if it were still real-M191 acceptance.
>
> **P2-1 — resolution drift.** Live `rpc_create_mo_with_reservation` calls
> `wardah_resolve_product_id` in **two** later places after any upfront
> capture would sit: the grouped bins/availability query (Migration 186 lines
> 288–306) and the final per-material reservation loop (line 376).
> `item_product_map` is `authenticated` org-admin writable (baseline policy
> `item_product_map_admin`). The live `BEFORE INSERT OR UPDATE` trigger
> `resolve_material_reservation_product` runs
> `trg_resolve_item_product_reference`, which **overwrites** `NEW.product_id`
> from `item_id` whenever `item_id IS NOT NULL` (baseline 11789–11790) — so an
> INSERT that supplies the captured `product_id` can still store a different
> one. A later `v_product = ANY(v_locked_products)` guard is not a fix: it
> proves set membership and misses a swap among products already in the
> prefix. The contract below replaces "hoist one resolve, then keep the live
> later resolves" with a **single captured resolved-demand snapshot** that
> drives bins, availability, and reservation identity, plus an exact
> post-trigger `RETURNING` comparison.
>
> **P2-2 — obsolete FK choreography.** After Fix G, reservation owns the
> product prefix **before** it waits on a bin. An incoming `FOR UPDATE` mutant
> then blocks at the product, so the old single-product external-bin
> choreography can satisfy its PID assertion on the **wrong edge**. That
> choreography remains historical evidence for why products `FOR UPDATE` was
> rejected *before* Fix G. It is not real-M191 acceptance and must not be
> required to run identically post-Fix-G. The live lock-mode probe is a
> KEY SHARE compatibility test against the held prefix, not a `40P01`.
>
> **Twenty-seventh correction (Codex P2 at `9a13a96`, acceptance/evidence
> only):** Mapping-drift A's required remap window is after the product
> prefix and before the first bins query, but the twenty-sixth wording had
> no deterministic hold at that boundary, so a scheduler-lucky remap could
> false-pass. This correction adds a **test-only** advisory-lock gate at
> exactly `snapshot → prefix → GATE → first bins query`. The same
> observed-gate class is required for B (after availability/MO creation,
> before the first reservation INSERT) and C (same persistence-time
> boundary, then a legal in-prefix X/Y swap). None of these gates may exist
> in production Migration 191. Fix G architecture and object count are
> unchanged. Runtime A/B/C and the static source-shape checks are
> complementary; neither replaces the other.

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
  multiple review passes (four functions, then five, then eleven, then a
  twelfth found by the thirteenth correction below, then a thirteenth found
  by the twenty-fifth correction once the same-table criterion reached `bins`)
  — a second pass
  discovering a further function later would face the exact "which migration
  is the real contract" problem this section already argues against

That last point is the 170–173 / 182–183 pattern
`CLAUDE.md` already flags. Migrations 170, 172, 173 each replaced
`has_permission()`; the live contract is their union, and any later replace
must re-assert every layer or a prior fix silently disappears. Migrations
182 and 183 replaced `rpc_get_trial_balance` the same way: replaying 182
alone reopens the security hole; replaying 183 on an old body restores the
wrong ledger. See `docs/db/PERMISSION_HARDENING_170_173_CHAIN.md` and
`docs/db/TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md`.

Splitting RED-A and RED-B across two numbered migrations would recreate that
chain on thirteen objects now (`incoming` 9/10-arg, `outgoing` 8/9-arg,
`rpc_cancel_stock_adjustment`, `rpc_manual_stock_movement_v2`,
`rpc_post_goods_receipt`, `rpc_post_delivery_note`,
`rpc_submit_stock_adjustment`, `rpc_consume_reserved_materials_v2`,
`release_expired_reservations` (Fix F, thirteenth correction),
`rpc_create_mo_with_reservation` (Fix G, twenty-fifth correction), and the new
shared lock helper) for no operational gain. Rollback of a `CREATE OR
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
| `wardah_apply_stock_outgoing` 8-arg | Migration 186 | lock-order peer, not RED-A/B | Control-2 vs incoming |
| `wardah_apply_stock_outgoing` 9-arg | Migration 187 | lock-order peer, not RED-A/B | static |
| `rpc_cancel_stock_adjustment` | Migration 124 | lock-order peer, currently **inverted** (bins before products) | new control (§6/§7) |
| `rpc_manual_stock_movement_v2` | Migration 134 | lock-order peer, currently **inverted** (locks its own bin, then calls the helper) | new control (§6/§7) |
| `rpc_post_goods_receipt` | Migration 177 | multi-line caller, no upfront product lock today | new control (§6/§7) |
| `rpc_post_delivery_note` | Migration 133 | multi-line caller, no upfront product lock today | new control (§6/§7) |
| `rpc_submit_stock_adjustment` | Migration 187 | multi-line caller, no upfront product lock today | new control (§6/§7) |
| `rpc_consume_reserved_materials_v2` | Migration 190 | multi-line caller, no upfront product lock today | new control (§6/§7) |
| `rpc_create_mo_with_reservation` | Migration 186 | multi-product `bins` locker, no product lock today (Fix G, twenty-fifth/twenty-sixth) | new multi-product controls A/B (§7); mapping-drift A/B/C; real-M191 lock-mode probe (not the historical external-bin choreography); RED reproduced as a genuine `40P01` |

Two functions found in the writer sweep are confirmed harmless and stay out
of scope: `rpc_complete_manufacturing_order` (never touches `bins`, confirmed
by reading its full body) and, from the caller sweep,
`rpc_consume_reserved_materials`/`consume_materials_for_mo` (thin wrappers
that delegate to `rpc_consume_reserved_materials_v2` and inherit its fix) and
`backflush_materials` (never touches `bins`/`products` at all — a separate,
already-quarantined legacy path per F1/#233).

A fix that replaces only the incoming overloads, or only the four stock-write
helpers, or the five functions from the prior revision without the four
multi-line callers and `rpc_manual_stock_movement_v2`, or any of those without
`rpc_create_mo_with_reservation` (Fix G, twenty-fifth correction), cannot pass
the existing static contract or the new controls in §6/§7, and cannot be the
whole remediation.

---

## 4. Two remediations, one lock-order contract, installed at every entry point

### The contract, stated once

The universal invariant for products/bins stock work is:

1. **Product-row prefix** — before a function touches any `bins` row for stock
   work, it holds `FOR NO KEY UPDATE` on the *complete distinct set* of
   `products` rows this
   *call* (not just this line) is about to touch, in ascending `id` order,
   acquired before any bins work. For a function that only ever handles one product
   per call (`wardah_apply_stock_incoming`/`outgoing`,
   `rpc_manual_stock_movement_v2`), this set has exactly one member — "locked
   in ascending order" is trivially true and costs nothing extra. For a
   function that loops over lines that can reference different products in
   one call (`rpc_cancel_stock_adjustment`, `rpc_post_goods_receipt`,
   `rpc_post_delivery_note`, `rpc_submit_stock_adjustment`,
   `rpc_consume_reserved_materials_v2`), this is the distinct product set
   across *all* lines, resolved and locked once, **before the per-line loop
   starts** — not discovered and locked line by line as the loop runs.

After that universal prefix, each function preserves its existing bin footprint:

- `wardah_apply_stock_incoming` 9/10 locks only the target bin (`FOR UPDATE`
  when it exists; insert/retry when absent), then computes the fresh `SUM` and
  projection under the product lock. It gains no all-bins scan.
- `wardah_apply_stock_outgoing` 8/9 retains its existing all-bins lock in
  `ORDER BY warehouse_id, id FOR UPDATE`, followed by its existing outgoing
  valuation/reservation/target-bin logic and projection.
- `rpc_cancel_stock_adjustment` takes its complete product-set prefix, then runs
  its existing per-line cancellation/SLE/bin/projection logic; it gains no
  all-bins scan.
- `rpc_manual_stock_movement_v2` takes its one-product prefix before its first
  bins reference, then preserves its warehouse-inference, locked-bin, and helper
  behavior; it gains no all-bins scan.
- The four Fix E top-level callers take their complete product-set prefix before
  their unchanged per-line business logic and helper calls; each helper's bin
  footprint remains function-specific.

Fix F is a separate same-table ordering contract for `material_reservations`,
not part of this products/bins footprint.

### Shared helper: `wardah_lock_products_for_stock_write`

The product prefix is identical logic everywhere it's needed: given an org and a set of
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

`rpc_create_mo_with_reservation` (live **pre-191 / pre-Fix-G** body — this
thought experiment describes that body only). Fix G later adds the shared
product prefix *before* bins work; **do not** reuse this bins-then-FK
choreography as real-M191 acceptance (twenty-sixth correction / P2-2). The
pre-Fix-G body locks
`bins` for the product first (`ORDER BY warehouse_id, id FOR UPDATE`) and
only afterward runs `INSERT INTO material_reservations (..., product_id,
...)`, which takes the FK's `FOR KEY SHARE` on that same `products` row.
With the products lock as `FOR UPDATE`:

- T1 (any Fix A-E function, post-191): holds `products(P)`, waits for
  `bins(P, W)`.
- T2 (`rpc_create_mo_with_reservation`, this lock-mode thought experiment
  uses the pre-Fix-G body): holds `bins(P, W)` (no product prefix yet),
  waits for `products(P)` `FOR KEY SHARE` (blocked by T1's
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

Incoming today updates its target bin and then does an unlocked projection
with no product prefix at all. Outgoing takes its all-bins/target-bin/projection
path without the prefix. `rpc_cancel_stock_adjustment` does a bin step (`UPDATE
bins`, which row-locks implicitly) then a product projection, also with no
product prefix — and
it can do this for several different products across one adjustment's lines.
`rpc_manual_stock_movement_v2` takes its own `bins` lock (to read the current
quantity for its `'adjustment'` movement-type math) before ever calling
incoming/outgoing, which puts its first bins work ahead of the product prefix
at the caller level even
though the callee it then invokes will take the product prefix before its own
function-specific bin/projection path in
isolation. Putting the product prefix on incoming alone deadlocks with every
one of these:

- incoming holds `products`, waits for `bins`
- outgoing holds `bins`, waits for `products`
- cancellation holds a `bins` row (from its `UPDATE bins`), waits for
  `products` (its later `UPDATE products`) — same shape as the outgoing case
- manual movement holds a `bins` row (its own pre-lock), waits for `products`
  (inside the helper it's about to call) — same shape again

And even after every *individual* function takes the prefix before its own bins
work correctly, the four
multi-line callers introduce a **second, transaction-level** version of the
same problem: each call to the helper only locks *that line's* product before
proceeding, so two different top-level calls (say, one `rpc_post_goods_receipt`
and one `rpc_post_delivery_note`, or two `rpc_submit_stock_adjustment` calls)
that both touch products A and B, in reversed order across their own lines,
can each hold one and wait for the other — a deadlock between two fully
correct individual helper calls, caused entirely by the absence of an
upfront, whole-transaction lock on every product either call will eventually
touch. This is why the product prefix must happen once per top-level call, for
the *complete* transaction-wide product set that call will touch, not once per
line.

So outgoing 8-arg/9-arg, `rpc_cancel_stock_adjustment`, and
`rpc_manual_stock_movement_v2` must all take the product prefix **before their
first bins work** in the same
migration (lock-order compatibility, not a claim any of them have RED-A or
RED-B); and `rpc_post_goods_receipt`, `rpc_post_delivery_note`,
`rpc_submit_stock_adjustment`, and `rpc_consume_reserved_materials_v2` must
each call `wardah_lock_products_for_stock_write` with their *complete*
per-call product set before their existing per-line loop starts (a second,
transaction-scoped instance of the same contract, not a new one).

```text
incoming (after 191)
  products  FOR NO KEY UPDATE   ← always exists; serializes the SKU without blocking FK inserts
  bins[wh]  FOR UPDATE / insert-retry from locked snapshot (target bin only)
  SUM bins → UPDATE products    ← recompute under the product lock

outgoing (after 191)
  products  FOR NO KEY UPDATE   ← same universal prefix
  bins*     FOR UPDATE ORDER BY warehouse_id, id  ← existing outgoing-only scan
  (existing valuation/reservation/target-bin logic, then projection)

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
separate stored table; nothing else in the system can mutate it mid-call, so
there is no *drift* concern here, unlike the other three. There is, however,
an *ordering* one (the twenty-second correction above): a naive pre-pass
that resolves every line's `product_id` before the loop starts can make the
helper's own `PRODUCT_NOT_FOUND_OR_WRONG_ORG` fire for a later line before
the loop ever reaches an earlier line's `GR_LINE_OBJECT_REQUIRED` /
`ITEM_NOT_FOUND` / `INVALID_QUALITY_STATUS` — confirmed against the live
Migration 177 body, which decides those in exactly that per-line order — and
a pre-pass that casts every line's `product_id` to `uuid` in one query can
raise a raw `invalid input syntax for type uuid` for a malformed later line
before the loop reaches an earlier line's own validation at all (confirmed
empirically against a live PostgreSQL 17 instance). Fix: a **non-throwing
candidate extraction**, deciding nothing and raising nothing:

```sql
v_products := ARRAY(
  SELECT DISTINCT p.id
  FROM jsonb_array_elements(p_payload->c_lines_key) AS line(value)
  JOIN public.products p
    ON p.org_id = v_org
   AND p.id = CASE
                WHEN pg_input_is_valid(line.value->>'product_id', 'uuid')
                THEN (line.value->>'product_id')::uuid
                ELSE NULL
              END
);
```

The `CASE` only attempts the cast when PostgreSQL's own UUID input validator
accepts the candidate (PostgreSQL evaluates `CASE` branches in order and only
the matching branch's `THEN`, unlike a `WHERE` predicate's evaluation order
relative to a joined cast, which is not guaranteed). This is deliberately
stronger than a canonical UUID regex: it accepts brace-wrapped and hyphenless
spellings exactly as the unchanged live `::uuid` cast does. A malformed or
nonexistent line's `product_id` is silently excluded from `v_products`
rather than raised on, and the unchanged loop is what decides, in its own
unchanged order, what happens with the line that produced it. No superset or
source-row lock is needed beyond this — there is no external state to drift
— but the uniform `PRODUCT_NOT_PRELOCKED` guard below still applies here
too, as defense in depth like the other three.

**`rpc_post_delivery_note`** — `v_product` comes from `sales_invoice_lines`,
resolved by `sales_invoice_line_id` values that are themselves fixed by the
payload.

**Corrected premise (fresh-review closure, and the lock is unchanged).** An
earlier revision of this paragraph justified the lock by claiming
`sales_invoice_lines` is `GRANT ALL TO authenticated` with only an `org_id`
policy check, so an authenticated client could `PATCH` a line's `product_id`
mid-call. That premise is **factually wrong against the live baseline** and is
corrected here rather than quietly dropped. `sales_invoice_lines` is **not** an
authenticated direct-client write surface: RLS is enabled
(`ALTER TABLE public.sales_invoice_lines ENABLE ROW LEVEL SECURITY`) and the
only policy on the table is `sales_invoice_lines_org_read`, which is
`FOR SELECT TO authenticated`. There is no `INSERT`/`UPDATE`/`DELETE`/`ALL`
policy for `authenticated` in the baseline or in any migration, so a PostgREST
`PATCH` is refused by RLS regardless of the broad table `GRANT`. (A historical
`sales_invoice_lines_org_isolation ... FOR ALL` policy did exist in an early
migration and is **not** in the live schema — the likely origin of the wrong
premise.)

The upfront row lock nevertheless **remains required**, on a narrower and
accurate argument: it freezes the product mapping against privileged and
server-side writers that legitimately operate outside that client RLS
boundary. No table in the baseline sets `FORCE ROW LEVEL SECURITY`, so the
table owner — and therefore every `SECURITY DEFINER` RPC running as owner —
bypasses RLS entirely, as does `service_role`. This is not hypothetical:
Migration 133's own delivery-note loop updates `sales_invoice_lines`
(`UPDATE public.sales_invoice_lines`, line 202) on every posting. The lock
therefore protects the mapping from **server-side concurrent mutation**; it is
not justified by an authenticated PostgREST `PATCH` path, and no acceptance row
or reject bullet may cite one.

**Do not cite broad table `GRANT`s alone as evidence of authenticated client
writability when RLS blocks `UPDATE`.** A `GRANT` is necessary but not
sufficient; the policy set is what decides. This is the specific reasoning
error that produced the wrong premise above, and it is easy to repeat while
reading a `pg_dump` baseline, where grants and policies sit thousands of lines
apart.

Fix:
lock the referenced `sales_invoice_lines` rows themselves — batched, once,
before resolving products — instead of relying on the loop's existing
per-line `FOR UPDATE` (which currently runs too late, after the point where
products would need to already be locked). As with `rpc_post_goods_receipt`
(twenty-second correction above), this must be a **non-throwing candidate
extraction**: the live loop checks `LINE_REQUIRED` (empty
`sales_invoice_line_id`) before its own cast, so a pre-pass built as
`ANY(ARRAY(SELECT (value->>'sales_invoice_line_id')::uuid FROM
jsonb_array_elements(...)))` has the identical raw-cast-ordering risk this
correction already found and fixed for goods receipt — a malformed id in a
later line would raise before an earlier line's own `LINE_REQUIRED` or
`INVALID_INVOICE_LINE`. Guard it the same way:

```sql
v_products := ARRAY(
  SELECT DISTINCT product_id FROM (
    SELECT sil.product_id
    FROM jsonb_array_elements(p_payload->'lines') AS line(value)
    JOIN public.sales_invoice_lines sil
      ON sil.invoice_id = v_invoice_id
     AND sil.org_id = v_org
     AND sil.id = CASE
                    WHEN pg_input_is_valid(
                      line.value->>'sales_invoice_line_id', 'uuid')
                    THEN (line.value->>'sales_invoice_line_id')::uuid
                    ELSE NULL
                  END
    ORDER BY sil.id
    FOR UPDATE OF sil
  ) locked
);
```

`DISTINCT` is applied in the *outer* query, over the already-locked rows the
inner query produces — not combined with `FOR UPDATE` in the same query,
which PostgreSQL rejects (confirmed against a live PostgreSQL 17 instance:
"FOR UPDATE is not allowed with DISTINCT clause" — the exact same
restriction this design already hit and worked around for
`rpc_submit_stock_adjustment`'s pre-pass; an earlier draft of this
correction made the identical mistake here before being caught against a
live instance). Then `wardah_lock_products_for_stock_write` on the distinct
product set this returns.

**`ORDER BY sil.id` is part of the specified shape, not decoration.** The
`FOR UPDATE OF sil` clause must follow the `ORDER BY`; PostgreSQL rejects the
reverse placement outright (confirmed on both PostgreSQL 17.6 and stock
17.11: putting
`FOR UPDATE OF sil` before `ORDER BY sil.id` fails with
`ERROR:  syntax error at or near "ORDER"`). The form above — inner
`ORDER BY sil.id` then `FOR UPDATE OF sil`, with `DISTINCT` in the outer
query — is the exact shape that was executed successfully against a
disposable fixture, and it is the shape a build must carry forward verbatim.

Be precise about *why* the ordering is required, because the honest answer is
narrower than "this fixes a deadlock." `rpc_post_delivery_note` already locks
its `sales_invoices` header `FOR UPDATE` (Migration 133) before it ever
reaches this line pre-pass, so two delivery-note calls against the *same*
invoice are serialized at the header long before they could contend on the
same `sales_invoice_lines` rows. The previously missing line-row ordering is
therefore **not** a proven, reachable delivery-note-vs-delivery-note deadlock
today, and this design does not claim it is. The reason to add `ORDER BY
sil.id` anyway is that M191 should not depend on a *hidden predecessor lock*
in an unrelated migration for the correctness of a lock-acquisition step it is
introducing. A future change that relaxes, moves, or removes the Migration 133
header lock — or any new caller that reaches these rows without it — would
silently reintroduce unordered multi-row acquisition, and nothing in this
pre-pass would signal it. Deterministic ordering makes the new pre-pass
self-contained: correct on its own terms, not correct by inheritance.

**Lock mode stays `FOR UPDATE` here — deliberately, and do not "optimize" it.**
Everywhere else this design pins `products` and `material_reservations` to
`FOR NO KEY UPDATE`, so `FOR UPDATE` on `sales_invoice_lines` looks at first
glance like an oversight worth tidying. It is not, and the reason is the
fifteenth correction's lesson applied to a different table. The unchanged
per-line loop re-reads each `sales_invoice_lines` row with its own
`SELECT ... FOR UPDATE`. If this upfront pre-pass took the weaker
`FOR NO KEY UPDATE` instead, the loop's later statement would stop being a
same-mode re-acquisition of a lock the transaction already holds and would
become a **lock-mode upgrade** — exactly the upgrade trap the fifteenth
correction already had to remove once, recreated here by a change that reads
like a cleanup. Matching the loop's existing mode keeps the second acquisition
free. Note what is *not* being claimed: `FOR NO KEY UPDATE` is not inherently
wrong for `sales_invoice_lines`, and moving **both** the pre-pass and the
loop to it could well be defensible. That is a separate architectural review
with its own evidence, not something to slip into a lock-order migration by
changing one of the two statements.

**On `FOR UPDATE OF sil` versus a bare `FOR UPDATE`:** an earlier draft of this
correction asserted that the `OF sil` qualifier was *required* here, on the
theory that a bare `FOR UPDATE` cannot be applied to a query whose `FROM` list
includes the `jsonb_array_elements(...)` function scan. That claim was tested
and is **false**, and it is recorded here rather than quietly dropped. On
PostgreSQL 17.6 the bare form compiles, runs, and genuinely locks: with a
holder session inside `BEGIN` running the bare-`FOR UPDATE` shape, a second
backend's `SELECT ... FOR UPDATE NOWAIT` against the same row failed with
`ERROR:  could not obtain lock on row in relation "sales_invoice_lines"`,
while the same probe with no holder succeeded — so the bare form is not a
silent no-op. The actual mechanism is narrower than the earlier claim:
PostgreSQL applies a bare locking clause only to the lockable relations in the
query and ignores the function scan, and it errors **only** when the function's
alias is named explicitly — `FOR UPDATE OF line` fails with
`ERROR:  FOR UPDATE cannot be applied to a function`. `OF sil` is therefore
retained for explicitness, not for validity: it states the lock target
unambiguously and keeps the clause correct if the `FROM` list ever grows
another lockable relation. No gate may assert that a bare `FOR UPDATE` is
invalid in this shape.

**This upfront read supplies only `product_id`, for building the lock set —
it does not replace anything the existing loop does (the twenty-first
correction above).** The existing loop's own `SELECT ... FOR UPDATE` — which
also reads `quantity`, `unit_price`, and `COALESCE(delivered_quantity, 0)`,
fresh, on every iteration — is unchanged, byte-for-byte. Reusing that value
across iterations instead of re-reading it, as an earlier revision of this
design proposed, would break a real, live behavior: the live body computes a
cumulative weighted-average `unit_cost_at_sale` and running `delivered_quantity`
across repeated deliveries of the *same* line within one call (its own
comment: "Cumulative weighted average across partial deliveries, so the
generated invoice-line cogs equals the exact summed delivery COGS once fully
delivered") — nothing rejects the same `sales_invoice_line_id` appearing more
than once in one payload, and the second occurrence must see the first's
update within the same transaction to compute `OVER_DELIVERY` and the
weighted average correctly. Both the upfront lock and the loop's own lock
target the identical, payload-fixed row, so the loop's re-acquisition is a
same-mode, same-transaction no-op — the upfront lock still closes the
concurrency gap (a concurrent client cannot move `product_id` once the row is
continuously locked from the upfront batch onward), without touching how the
loop reads or accumulates its own business state. No runtime guard is
structurally necessary for the identity concern, but see below.

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
ORDER BY id FOR NO KEY UPDATE` — every row for this MO regardless of current
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

Then `wardah_lock_products_for_stock_write`. The existing loop's own two
per-row reservation locks — confirmed against the live Migration 190 body,
lines 143–145 (the `reservation_id` branch) and 147–150 (the `item_id ...
ORDER BY created_at, id LIMIT 1` branch) — must also change from `FOR UPDATE`
to `FOR NO KEY UPDATE` (the fifteenth correction, below): a bare `FOR UPDATE`
here does **not** merely "re-acquire a lock this call already holds" as an
earlier revision of this design claimed. A lock-mode *upgrade* on a row this
same transaction already holds a weaker lock on is not a no-op — it is
re-evaluated against every other transaction's currently-held locks on that
row, and `FOR UPDATE` conflicts with `FOR KEY SHARE` where `FOR NO KEY
UPDATE` does not. So a bare `FOR UPDATE` in the per-line loop reintroduces
exactly the conflict the superset lock's `FOR NO KEY UPDATE` was chosen to
avoid, the moment any concurrent transaction holds `FOR KEY SHARE` on that
reservation (an `INSERT INTO material_consumption` referencing it, from
either write path — see the fourteenth correction, point 3). Changed to `FOR
NO KEY UPDATE` in both branches, "re-acquires a lock this call already
holds" becomes accurate: same mode, on a row already locked by the superset
lock, genuinely a no-op.

**The guard, generalized:** for delivery note and adjustment submit, locking
the referenced rows up front is structurally sufficient for the *identity*
concern — there is no plausible way the existing loop resolves a product
outside what was just locked, because both the upfront lock and the loop's
own lock target the identical, payload-fixed row set; the row's `product_id`
cannot drift once it is locked continuously from the upfront batch onward
(the twenty-first correction above: delivery note's loop still re-queries
its own *business* fields — `delivered_quantity`, `unit_cost_at_sale` — on
every iteration, unchanged, which is a correctness requirement, not a gap
this guard needs to cover). Material consumption's loop *is* a fresh per-line query against
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

### Fix F — lock-order compatibility for `release_expired_reservations`

Not a RED-A/RED-B remediation, and not a `products`/`bins` function at all —
found by the thirteenth correction above via the same "no live function may
acquire an edge of the lock graph in reverse" check §6 already applies, once
that check's own criterion was corrected to cover same-table counter-ordering
and not only inter-table reversal.

Live `release_expired_reservations` does a single unordered, unlocked-by-`id`
multi-row `UPDATE` on `material_reservations`. Fix E's consumption superset
lock (above) locks every reservation row for an MO ascending by `id`. Two
reservations for one MO, both `reserved` and expired, can have their `id`
order disagree with whatever scan order the live release function's `UPDATE`
happens to visit them in — the same shape as `rpc_cancel_stock_adjustment`
locking `bins` before `products` while incoming/outgoing does the reverse,
just within one table instead of across two.

Mechanically, replace the body with a lock-then-update:

```sql
CREATE OR REPLACE FUNCTION public.release_expired_reservations(p_org_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer;
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.material_reservations
    WHERE status = 'reserved' AND expires_at IS NOT NULL AND expires_at < now()
      AND (p_org_id IS NULL OR org_id = p_org_id)
    ORDER BY id
    FOR NO KEY UPDATE
  LOOP
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE public.material_reservations
  SET status = 'expired', released_at = now(),
      quantity_released = quantity_reserved - quantity_consumed, updated_at = now()
  WHERE id = ANY(v_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
```

`ORDER BY id FOR NO KEY UPDATE` on the locking loop, then an `UPDATE` scoped
to exactly the already-locked, already-frozen `v_ids` set — the identical
"lock first, act on the frozen snapshot" shape the consumption superset lock
above already uses, so no row this function will touch can have its `status`
change out from under it between the lock and the write. `FOR NO KEY UPDATE`,
not `FOR UPDATE`, for the same reason the consumption superset lock uses it
(below): `material_consumption.reservation_id` is a live FK to
`material_reservations(id)`, so a bare `FOR UPDATE` here would conflict with
the implicit `FOR KEY SHARE` an `INSERT INTO material_consumption` takes on
the row it references, for no benefit — this function only ever touches
`status`/`quantity_released`/`released_at`/`updated_at`, none of them keyed or
referenced.

Confirmed compiling and behaving correctly against a live PostgreSQL 17
instance: locks the eligible set ascending by `id`, updates exactly that set,
and leaves a reservation's existing `quantity_released = quantity_reserved -
quantity_consumed` computation — `NULL`-propagation included — untouched
(deliberately not tightened with `COALESCE`; see the thirteenth correction's
point 3, a separate, out-of-scope follow-up).

No `SECURITY DEFINER` change (stays `SECURITY INVOKER`; RLS already scopes
`authenticated` to its own organization's rows), no ACL change (the existing
`anon`/`authenticated`/`service_role` grant is left alone — noted as a
residual write-surface concern below, not something 191 closes), and no
behavior change beyond the lock order and the frozen-snapshot `UPDATE`
shape. This is lock-order-only, exactly like Fix C/D.

**Consumption superset lock mode, corrected to match:** the consumption
superset lock specified earlier in this section (§4, Fix E) is written as
`ORDER BY id FOR UPDATE`. For the identical FK reason just given
(`material_consumption.reservation_id → material_reservations(id)`), it
should read `ORDER BY id FOR NO KEY UPDATE` — `rpc_consume_reserved_materials_v2`
is the only current writer that populates `reservation_id` (a direct client
insert path exists via `mesService.consumeMaterial()`, but it never sets
`reservation_id`; see the thirteenth correction, point 2), so this is not a
live deadlock today via this specific FK, but the same "no bare `FOR UPDATE`
on a referenced parent row without a specific reason" principle this design
already applies to `products` applies here regardless, and the columns the
superset lock and its guard touch are the same non-key columns Fix F's
`UPDATE` touches. Every mention of this lock's mode elsewhere in this
document (§6's lock graph, §7's static contract) is corrected to `FOR NO KEY
UPDATE` to match.

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

### Fix G — transaction-wide product locking for `rpc_create_mo_with_reservation`

Not a RED-A/RED-B remediation. Found by the twenty-fifth correction above,
after the same-table criterion §6 already applies to `material_reservations`
and `products` was finally applied to **`bins`** as well. This function is the
only live routine that retains `bins` row locks across more than one product
without the shared prefix, so it is the only routine the new rule adds.

Live `rpc_create_mo_with_reservation` (Migration 186, lines 288-315) groups its
resolved demand by product, iterates `ORDER BY product_id`, and for each
product locks **all** of that product's bins with `ORDER BY warehouse_id, id
FOR UPDATE`, holding product `A`'s bins while it moves to product `B`. Every
overlapping stock writer visits bins in a different order — receipt and
delivery note in **payload** order, which Fix E deliberately preserves. The
result is a `bins`↔`bins` cycle that the products prefix cannot break, because
this function takes no `products` lock until its closing
`material_reservations` inserts, whose implicit `FOR KEY SHARE` does not
conflict with `FOR NO KEY UPDATE`. Reproduced as a genuine `40P01`; see the
twenty-fifth correction for the choreography and server evidence.

Mechanically, the body's ordering becomes (twenty-sixth correction — the
twenty-fifth's "resolve the set, then keep the live later resolves" shape is
withdrawn):

```text
1. org resolution + wardah_assert_org_member          (existing, unchanged)
2. existing p_materials validation                    (existing, unchanged)
3. materialize ONE canonical resolved-demand snapshot
   after validation and before any stock lock         (new)
   — one entry per original material line, at minimum:
     ordinal, item_id, quantity, captured resolved_product_id,
     and every input field the later reservation INSERT needs
     (expires_at and the rest of the live VALUES list)
   — resolve each line with the body's existing
     wardah_resolve_product_id(v_org, item_id, now()) semantics;
     no second parser
4. derive the complete distinct product prefix from that
   captured snapshot only                             (new)
5. wardah_lock_products_for_stock_write(v_org, <that set>)
   ascending ids, FOR NO KEY UPDATE                   (new)
6. existing per-product bins/availability aggregation,
   driven ONLY from the captured snapshot
   ORDER BY captured product_id; bins ORDER BY warehouse_id, id
   FOR UPDATE                                         (existing math and
                                                       bin order; source of
                                                       product identity is
                                                       now the snapshot)
7. INSERT manufacturing_orders, after availability    (existing, unchanged)
8. per-original-line reservation INSERT, driven from
   the same captured snapshot; INSERT ... RETURNING
   product_id (post-trigger) and compare it to that
   line's captured resolved_product_id                 (new fail-closed check)
```

No later `wardah_resolve_product_id` call may decide which product's bins are
locked, which product's availability is summed, or which `product_id` is
offered to the reservation INSERT. The live `BEFORE` trigger
`resolve_material_reservation_product` /
`trg_resolve_item_product_reference` still re-resolves `NEW.product_id` from
`item_id` when `item_id IS NOT NULL`; that is why step 8 compares the
**authoritative post-trigger** `product_id` to the captured identity, not
merely `= ANY(prelocked set)`. A mismatch raises a named error
(`ITEM_PRODUCT_MAPPING_DRIFT`) and rolls back the whole RPC — MO, bins
locks, and all. No bins for an uncaptured/unprelocked product may ever be
acquired.

Nothing else moves: existing validation/error order before capture; existing
item→product resolver semantics at capture time; existing product-group
aggregation (sum quantity per captured product_id); existing product-ascending
bins ordering; availability math; MO creation after availability; one
reservation per original input line.

**A membership-only guard is not this contract.** `IF captured_product = ANY(v_locked_products)`
would pass a swap of two products already in the prefix. The required
comparisons are exact per-line product identity: snapshot vs bins/availability
grouping key, and snapshot vs `RETURNING product_id`.

Incoming is **not** changed by Fix G: it keeps its target-bin-only footprint,
and no universal all-bins scan is introduced anywhere. ACL, `SECURITY DEFINER`,
and `search_path` carry forward unchanged (§5).

---

## 5. What the migration replaces (and what it must not)

Proposed number: **191** (190 is already on `main` for F1 material
consumption). Confirm at implementation time that 191 is still free.

Replace, in one file, all twelve bodies plus one new internal helper
(**thirteen objects**; the count rose from twelve at the twenty-fifth
correction, which added item 12):

1. `wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)` — 9-arg, receipts / manual movement (Fix A/B)
2. `wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)` — 10-arg, stock adjustment (Fix A/B)
3. `wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)` — 8-arg (lock-order prefix only)
4. `wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)` — 9-arg (lock-order prefix only)
5. `rpc_cancel_stock_adjustment(uuid,text)` — lock-order prefix only (Fix C); no RED-A/RED-B logic change
6. `rpc_manual_stock_movement_v2(jsonb)` — lock-order prefix only (Fix D)
7. `rpc_post_goods_receipt(jsonb)` — upfront multi-product lock only (Fix E)
8. `rpc_post_delivery_note(jsonb)` — upfront multi-product lock only (Fix E)
9. `rpc_submit_stock_adjustment(uuid)` — upfront multi-product lock only (Fix E)
10. `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` — upfront multi-product lock only (Fix E); reservation superset lock mode corrected to `FOR NO KEY UPDATE` (thirteenth correction)
11. `release_expired_reservations(uuid)` — same-table lock-order fix only (Fix F, thirteenth correction); no RED-A/RED-B, no `products`/`bins` involvement, no business-behavior change
12. `rpc_create_mo_with_reservation(jsonb,jsonb,uuid)` — Fix G (twenty-fifth/twenty-sixth): one captured resolved-demand snapshot after validation, shared product prefix from that snapshot, bins/availability and reservation inserts driven from the same snapshot, exact post-trigger `RETURNING` identity check. No RED-A/RED-B logic change; availability math, item→product resolver semantics at capture, MO-creation placement, and one reservation per original line are preserved. The only new error is `ITEM_PRODUCT_MAPPING_DRIFT`. **Client-facing RPC: its ACL is not the stock-helper `service_role`-only form** — see the ACL note below
13. `wardah_lock_products_for_stock_write(uuid,uuid[])` — **new**, internal-only, no existing ACL to preserve; `REVOKE ALL FROM PUBLIC, anon, authenticated` at creation, no `GRANT` to any client role

Carry forward, verbatim except for the stated change to each:
- items 1–2: the two fixes (Fix A/B) plus the lock-order prefix
- items 3–4: the lock-order prefix only
- items 5–12: the lock-order prefix (upfront multi-product for **5**, 7–10 and **12**, single product for **6** only, single-table ordered lock for 11) — every existing business rule, error code, and return shape in all eight of these unchanged, **except** item 12, which may add the named fail-closed error `ITEM_PRODUCT_MAPPING_DRIFT` and nothing else (twenty-sixth correction). Item 5, `rpc_cancel_stock_adjustment`, is **multi-product**: Fix C collects the complete distinct product set across all of the adjustment's lines and locks it before the per-line loop, exactly like items 7–10. Only item 6, `rpc_manual_stock_movement_v2`, handles one product per call. An earlier revision of this line grouped 5 with 6 as "single product", which contradicted Fix C's own specification in §4 and §6 and could have led an implementer to install a per-line single-product lock in cancellation — reintroducing the transaction-level ordering defect Fix C exists to close. Item 12, `rpc_create_mo_with_reservation`, is **multi-product** for the same reason: Fix G materializes one captured resolved-demand snapshot after validation, derives the distinct product prefix from that snapshot only, and locks it before the first `bins` lock; bins/availability and reservation inserts are driven from the same snapshot, with an exact post-trigger `RETURNING` identity check

- Valuation: FIFO / LIFO / weighted average, including queue rewrite
- SLE insert (incoming positive qty; outgoing negative qty and COGS)
- source-line overloads (incoming 10-arg / outgoing 9-arg): their source-line
  guards (`STOCK_SOURCE_LINE_REQUIRED` /
  `STOCK_SOURCE_LINE_MISMATCH`) and `source_line_id` storage. Migration 187
  installs these on **both** of its overloads — incoming at 10 args and
  outgoing at 9 — so evidence scoped to a single arity would silently omit
  outgoing's. Name both signatures explicitly; never describe this pair by one
  shared argument count
- Outgoing reservation floor (`INSUFFICIENT_UNRESERVED_STOCK`) and
  `BIN_NOT_FOUND` / `INSUFFICIENT_STOCK`
- 9-arg incoming early `NO_WAREHOUSE_OR_QTY` JSON return
- `search_path`: 9-arg incoming is `public`; 10-arg incoming and both
  outgoing overloads are `'public', 'pg_temp'` — keep each as it is
- **The ACLs of `rpc_cancel_stock_adjustment`, `rpc_manual_stock_movement_v2`,
  `rpc_post_goods_receipt`, `rpc_post_delivery_note`,
  `rpc_submit_stock_adjustment`, `rpc_consume_reserved_materials_v2`,
  `rpc_create_mo_with_reservation`, and
  `release_expired_reservations` are unrelated to the rule below and must not
  change.** Checked all eight directly against the live baseline: the first
  seven are `GRANT ALL ... TO authenticated` plus `TO service_role`,
  consistently, and `release_expired_reservations` is `GRANT ALL ... TO
  anon, authenticated, service_role` (its `anon` grant is a pre-existing,
  separate write-surface concern — see §6's residual-risk note — not
  something Fix F touches). These are legitimate client-facing RPCs (gated
  by `wardah_assert_org_member`/`wardah_assert_org_admin` and, for material
  consumption, an exact permission check, at the application layer, not by
  ACL; `release_expired_reservations` relies on `SECURITY INVOKER` + RLS
  instead), not internal helpers. Fixes C/D/E/F/G never change grants on any
  of the eight. Fix G's authorized body change is the captured-snapshot /
  `RETURNING` contract (and `ITEM_PRODUCT_MAPPING_DRIFT`); it is still not an
  ACL change. The ACL discussion immediately below is
  scoped to the four stock-write helpers only. The new
  `wardah_lock_products_for_stock_write` helper gets no client grant at all
  (see item 13 above) — it is not one of "the four."
- **`rpc_create_mo_with_reservation` exact carry-forward (Fix G, twenty-fifth
  / twenty-sixth correction).** Recorded explicitly because this function is a *client-facing*
  RPC that now sits in the same migration as four `service_role`-only helpers,
  and applying the helper ACL form to it would revoke `authenticated` and break
  every caller. Verified against the live baseline
  (`sql/baseline/000_schema_baseline_20260905_184634.sql`, function at line
  6675, ACL at lines 33645-33647) and against its predecessor body in
  `sql/migrations/186_stock_moves_contract_repair.sql` line 236:
  - exact overload signature:
    `public.rpc_create_mo_with_reservation(p_order jsonb, p_materials jsonb DEFAULT '[]'::jsonb, p_tenant uuid DEFAULT NULL::uuid)`,
    `RETURNS jsonb` — the only overload; 191 must replace this signature and
    create no second one
  - `LANGUAGE plpgsql`, **`SECURITY DEFINER`** — carry forward
  - **`SET search_path TO 'public', 'pg_temp'`** — carry forward verbatim
  - `REVOKE ALL ON FUNCTION ... FROM PUBLIC;`
  - `GRANT ALL ON FUNCTION ... TO authenticated;`
  - `GRANT ALL ON FUNCTION ... TO service_role;`

  The live predecessor is the authority for the exact privilege form, including
  the `GRANT ALL` spelling rather than `GRANT EXECUTE`. Preflight must capture
  this function's `pg_get_functiondef`, `prosecdef`, `proconfig`, and ACL by
  **exact signature**, and postflight must show all of them unchanged except
  the body. The authorized body change is the captured resolved-demand
  snapshot, the prefix derived from that snapshot, bins/availability and
  reservation inserts driven from it, and the exact post-trigger `RETURNING`
  identity check. The only new error is `ITEM_PRODUCT_MAPPING_DRIFT`.
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
  source-line overloads (incoming 10-arg / outgoing 9-arg) instead use three
  separate statements per function
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
- Client GRANT / RLS / Migration 185 write-surface, including
  `release_expired_reservations`'s pre-existing `anon` grant and the
  unmediated multi-row client-write risk on `products`,
  `material_reservations`, and `stock_adjustment_items`
  documented in §6's residual-risk note — recorded as an F1/write-surface-audit
  input, not addressed here. 191 does not close any of the three.
  (`sales_invoice_lines` is **not** in this set: RLS allows `authenticated`
  only `FOR SELECT` — see §4 and §6)
- `quantity_released = quantity_reserved - quantity_consumed`'s `NULL`
  propagation when `quantity_consumed IS NULL` (thirteenth correction, point
  3) — a data-semantics question independent of lock ordering; a separate,
  named follow-up, not part of Fix F
- `FOR UPDATE SKIP LOCKED` as a best-effort cron-sweep optimization for
  `release_expired_reservations` (thirteenth correction, point 1) — a
  semantic change to the function's contract, not a lock-order change; not
  adopted in 191
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

**Superseded by the twenty-fifth correction — read the replacement below
before acting on this paragraph.** An earlier revision concluded here that 191
should **not** add any *explicit* `products` lock to the reservation RPC (out
of scope), on the grounds that the fix was entirely in the lock mode chosen by
the functions this design already touches, not in changing reservation's own
body. **That conclusion was wrong, and it is withdrawn.** The lock-mode
argument above is correct and retained, but it settles the `products`/FK edge
**only**. It never addressed this function's own multi-row `bins` ordering,
which is a separate edge under the same-table criterion, and which was
reproduced as a genuine `40P01` against a post-191 goods receipt. Fix G
therefore *does* add the explicit shared `products` prefix to
`rpc_create_mo_with_reservation`, before its first `bins` lock; the text is
kept rather than deleted so the reasoning chain — and the reason it looked
sufficient — stays auditable.

Implementation review must also check every function that inserts
into any of the 18 tables with a foreign key to `products(id)` for an
explicit `products` `FOR UPDATE` appearing *after* that function's own other
locks, not just check for explicit `products` references the way this
section originally (and wrongly) did — an implicit FK lock is still a lock,
and grepping for the literal string `products` in a function body will miss
it if the function only ever names the *child* table.

### Historical: incoming vs `rpc_create_mo_with_reservation` (pre-Fix-G body only)

The eighteenth/nineteenth-correction external-bin choreography remains
**historical evidence** for why products `FOR UPDATE` was rejected *before*
Fix G. It is not real-M191 acceptance, and it must not be required to run
identically against a post-Fix-G body (twenty-sixth correction / P2-2).

Against the **pre-Fix-G reservation body** only: pre-seed a bin for product
P in warehouse W. An external, test-only session locks that bin row and
holds it. Start the real, unmodified `rpc_create_mo_with_reservation` — it
queues behind the external blocker at its own bin lock; before releasing
anything, assert `pg_blocking_pids(<reservation>) = {<blocker>}` exactly.
Start `wardah_apply_stock_incoming` with the products lock as `FOR UPDATE`
(the pre-fix mutant) — it locks the product uncontested, then also reaches
for the bin; before releasing anything, assert
`pg_blocking_pids(<incoming>) = {<reservation>}` exactly (**not**
`{<blocker>, <reservation>}` — PostgreSQL's row-level locking is
two-staged). Only once both exact values are confirmed, release the
external blocker: reservation acquires the bin and attempts its FK-implied
`FOR KEY SHARE` on the product, held by incoming's `FOR UPDATE` — conflict;
incoming is still waiting on the bin, now held by reservation — genuine
`40P01`. Confirmed empirically against a live PostgreSQL 17 instance on the
pre-Fix-G body.

**Why this choreography is obsolete after Fix G.** Reservation then owns
the product prefix **before** it waits on any bin. An incoming `FOR UPDATE`
mutant blocks at the **product**, so the old
`pg_blocking_pids(<incoming>) = {<reservation>}` assertion can pass on the
**wrong edge**. Do not treat a post-Fix-G run of this sequence as lock-mode
proof, and do not require it as GREEN.

This historical control was also never sufficient for Fix G's multi-product
`bins` edge (twenty-fifth correction): it exercises one product and passes
cleanly against the defective multi-product reservation body. Multi-product
Controls A/B below remain the `40P01` evidence for that edge.

### Real-M191 lock-mode probe (Fix G compatible)

This runtime probe, plus the existing static assertion that
`wardah_lock_products_for_stock_write` uses `FOR NO KEY UPDATE`, is the
current lock-mode evidence. It is a KEY SHARE compatibility test against
the held prefix, not a deadlock test.

Arrange:

1. A Fix G reservation call acquires product P through the shared prefix.
2. Hold that call before completion by blocking its **subsequent** bin lock
   (external test-only lock on the target bin, or equivalent), so
   reservation remains live and still holds the prefix.
3. While reservation still holds the prefix, run an independent real FK
   child insert referencing product P. The fixture must not contend on the
   reservation's other rows — use a **separate precreated manufacturing
   order**, not the in-flight MO.
4. Against **real 191** (`FOR NO KEY UPDATE` prefix): the FK insert /
   implicit `FOR KEY SHARE` **must complete** while reservation remains
   blocked at the bin.
5. Against a **test mutant** that changes the shared product prefix to
   `FOR UPDATE`: the same FK insert **must block**, and
   `pg_blocking_pids(<probe>)` must equal `{<reservation>}` exactly.
6. Release and clean up afterward.

Do **not** require a `40P01` for this probe. The discriminating fact is KEY
SHARE compatibility versus blocking. Genuine `40P01` remains required only
for scenarios whose defect is actually a deadlock (RED-A/B, helper-order
mutant, Fix E omitted, Fix G Controls A/B, Fix F mutant).

### Mapping-drift acceptance (Fix G, twenty-sixth correction)

Mapping changes go through live `item_product_map` (`authenticated`
org-admin writable). The live `BEFORE` trigger still re-resolves
`material_reservations.product_id` from `item_id` when `item_id IS NOT
NULL`. A, B, and C are proven on **test-instrumented** candidates (real
Fix G body plus one test-only gate each). Production Migration 191
contains none of those gates.

**A.** TEST-ONLY observed gate at the exact remap boundary (twenty-seventh
correction). Fix G architecture is unchanged. The gate must **not** exist
in production Migration 191.

Location, exactly:

```text
canonical resolved snapshot complete
→ shared complete product prefix acquired
→ TEST-ONLY GATE
→ first bins-locking / availability query
```

Use the same session-level advisory-lock discipline already required for
other deterministic concurrency mutants in this design (eighth correction):
`pg_advisory_lock`, held by a gate-holder session, observed via
`pg_stat_activity` / `pg_blocking_pids()`, not sleeps.

Choreography:

1. Fixture: item `I` captured initially as product `X`; product `Y` is
   outside `X`'s captured prefix; deterministic existing bin rows for `X`
   and `Y`.
2. A gate-holder session acquires advisory lock `K`.
3. Independently: `blocker_X` locks the first bin row that the correct
   captured-`X` bins query would attempt; `blocker_Y` locks the
   corresponding deterministic `Y` bin row.
4. Start the TEST-INSTRUMENTED candidate
   `rpc_create_mo_with_reservation` (real Fix G body plus this one gate).
5. The candidate performs existing validation, canonical per-line capture,
   and the complete product prefix, then attempts advisory gate `K`
   **immediately before** the first bins query.
6. Before any mapping update, REQUIRE observed proof that the reservation
   backend has reached that exact gate:
   - `wait_event_type = 'Lock'`
   - `pg_blocking_pids(reservation_pid) = {gate_holder_pid}`
   - if the harness uses `application_name` or another explicit test
     marker, assert that marker too.
   Sleep-only or timing inference is not acceptable.
7. Only after the gate wait is observed, a separate mapper transaction
   changes `I` from `X` to `Y` and COMMITs. The harness must prove the
   mapper commit completed **before** the gate is released.
8. Release advisory gate `K`.
9. Discriminate the next bins identity:
   - Correct capture-bound implementation:
     `pg_blocking_pids(reservation_pid) = {blocker_X_pid}`
     because the first bins query is still driven by captured `X`.
   - A defective implementation that re-runs `wardah_resolve_product_id`
     would instead block on `blocker_Y_pid`.
   The acceptance **must fail** if `Y` is the next bin target. This PID
   transition is the deterministic evidence that Mapping-drift A cannot
   false-pass due to scheduler timing.
10. Release `blocker_X` and allow cleanup/completion. `Y`'s bin must never
    have been acquired by the reservation transaction.

The static rule remains: no `wardah_resolve_product_id` call after capture
may determine bins or availability identity. Runtime Mapping-drift A and
that static check are complementary — static proves source shape; this
gate proves the concurrency window. Do not replace one with the other.

**B.** TEST-ONLY observed gate `K_B` at the persistence-time remap
boundary. Purpose: prove that a mapping change after availability was
checked cannot silently change the product persisted by the
`material_reservations` BEFORE trigger. The gate must **not** exist in
production Migration 191. This is a separate instrumented candidate from
A (A's gate stays before the first bins query).

Location, exactly:

```text
captured snapshot
→ complete product prefix
→ bins / availability completed successfully
→ manufacturing order created in the same still-open transaction
→ TEST-ONLY GATE K_B
→ first material_reservations INSERT
```

Choreography:

1. Fixture: item `I` captures to product `X`. Product `Y` is a valid
   same-org product and is **not** the captured identity.
2. Gate-holder acquires advisory lock `K_B`.
3. Start the TEST-INSTRUMENTED real Fix G candidate (real body plus this
   one gate).
4. Candidate runs normally through validation, capture, product prefix,
   bins/availability, and MO INSERT.
5. Immediately before the first reservation INSERT, the candidate
   attempts `K_B`.
6. Before any remap, REQUIRE observed evidence that the RPC backend is at
   exactly this gate:
   - `wait_event_type = 'Lock'`
   - `pg_blocking_pids(reservation_pid) = {gate_holder_pid}`
   - plus the harness marker / `application_name` if that convention is
     used.
   No sleeps or inferred timing.
7. Only after that observed wait, a separate mapper transaction changes
   `I` from `X` to `Y` and COMMITs. Require proof that mapper COMMIT
   completed before `K_B` is released.
8. Release `K_B`.
9. The reservation INSERT still supplies the captured intended product
   `X`, but the live BEFORE trigger re-resolves `I` and produces
   authoritative post-trigger `Y`.
10. `INSERT ... RETURNING product_id` must therefore return `Y`.
11. Exact per-line comparison `Y != captured X` must raise
    `ITEM_PRODUCT_MAPPING_DRIFT`.
12. Require whole-RPC atomic rollback: the newly inserted manufacturing
    order must **not** persist; no `material_reservations` row from this
    RPC may persist; no partial business state from the RPC may persist.

The test **must fail** if the INSERT commits with `Y`, if the mismatch is
ignored, or if only the reservation row is undone while the MO survives.

Runtime B and the static rules (captured line is the intended INSERT
product; authoritative post-trigger product is compared exactly against
that line) are complementary. Do not replace one with the other.

**C.** TEST-ONLY observed gate `K_C` at the **same persistence-time
boundary as B**, so C is isolated from Mapping-drift A: bins and
availability have already been driven correctly from the captured
identities; C tests **only** exact per-line identity versus set membership
at persistence time. Purpose: prove that membership-only protection such
as `resolved_product = ANY(v_locked_products)` is insufficient even when
every resulting product is already in the prefix. The gate must **not**
exist in production Migration 191.

Location, exactly:

```text
availability complete
→ MO created
→ TEST-ONLY GATE K_C
→ first reservation INSERT
```

Fixture: `I1` captures to `X`, `I2` captures to `Y`, `X != Y`, complete
prefix = `{X,Y}`.

Choreography:

1. Gate-holder acquires advisory lock `K_C`.
2. Start the TEST-INSTRUMENTED real Fix G candidate (real body plus this
   one gate).
3. Before any mapping change, REQUIRE observed proof that the candidate
   has captured `I1→X` and `I2→Y`, holds the complete `{X,Y}` product
   prefix, has completed availability, has created the MO in the same
   still-open transaction, and is waiting at `K_C`:
   - `wait_event_type = 'Lock'`
   - `pg_blocking_pids(reservation_pid) = {gate_holder_pid}`
   - plus the harness marker / `application_name` if used.
   No sleeps or inferred timing.
4. Then, in **one** separate mapper transaction, perform a **legal** swap
   `I1 → Y`, `I2 → X`. The fixture must respect the live
   `item_product_map` uniqueness rules — do **not** assume two direct
   `product_id` UPDATEs can swap rows without violating the current unique
   indexes (`uq_item_product_map_current_item` on `(org_id, item_id)`
   where `is_active AND valid_to IS NULL`, and
   `uq_item_product_map_current_product` on `(org_id, product_id)` under
   the same predicate). Use a transactionally valid mapping change, for
   example: retire/deactivate the two old current mappings as permitted by
   the live schema, then install the two new current mappings, then
   COMMIT.
5. The harness must prove that mapper COMMIT completed before `K_C` is
   released.
6. Release `K_C`.
7. Trigger result for `I1` is `Y` while captured identity is `X`; trigger
   result for `I2` is `X` while captured identity is `Y`. Both `Y` and `X`
   are members of the already-prelocked set `{X,Y}`. Therefore a
   membership-only `ANY()` guard would **accept** the drift. The required
   exact per-line comparison must instead raise
   `ITEM_PRODUCT_MAPPING_DRIFT` on the first mismatching reservation
   INSERT reached.
8. Require whole-RPC rollback: no MO persists; no reservation persists; no
   partially committed line survives.

This is the discriminating proof that exact per-line identity, not set
membership, is the contract. Runtime C and the static "ANY(prelocked_set)
is insufficient" rule are complementary. Do not replace one with the
other.

**Observed-gate rule for Mapping-drift A / B / C.** Every mapping-drift
test whose correctness depends on a mapping mutation occurring between
two RPC phases must have: (1) an exact test-only gate at that boundary;
(2) observed `pg_stat_activity` / `wait_event_type` evidence; (3) exact
`pg_blocking_pids` equality to the gate holder; (4) proof the mapper
COMMIT completed while the candidate was still gated; (5) only then
release of the gate. Sleep-based scheduling or "start updater around this
time" is not acceptance. The gates exist in test instrumentation only and
MUST NOT appear in production Migration 191. A's gate `K` stays after
prefix and before the first bins query; B's `K_B` and C's `K_C` stay after
availability/MO creation and before the first reservation INSERT. They are
not interchangeable.

### Multi-product reservation vs stock writers (Fix G, twenty-fifth correction)

Two deterministic controls, each run twice — against the pre-Fix-G reservation
body and against the real 191. Both use products `A < B` (assert the UUID
ordering in the fixture, as the twelfth correction already requires), with
existing bins for both products in the contended warehouse.

**Control A — reservation vs incoming / goods receipt.**
Reservation over materials `[A, B]` against `rpc_post_goods_receipt` with
payload lines in `[B, A]` order.

**Control B — reservation vs outgoing / delivery note.**
The same reservation against a multi-product outgoing caller with payload
lines in `[B, A]` order. Required separately rather than assumed from
Control A: outgoing locks **all** bins of each product, so its contended
footprint is strictly wider, and a fix verified only against incoming would
not have exercised it.

For both controls:

1. Against the pre-Fix-G reservation body — must produce a **genuine
   `40P01`**, not merely a slow run or a lock wait. If it does not, the
   control is not exercising the mechanism and must be redesigned before it
   can be trusted post-fix, exactly as required for the single-product control
   above.
2. Against the real 191 — both transactions must complete with no `40P01`,
   with bins, availability, the MO, and the reservation rows all correct.

**The choreography must be gated on observed blocker PIDs, not on sleeps.**
Advance each step only after the required state has been read back from
`pg_stat_activity` / `pg_blocking_pids()` (and `bins.xmax` to prove which
transaction physically holds which bin): reservation holding `A`'s bins; the
stock caller past its product prefix and holding `bins(B, W)`; then
reservation waiting on the stock caller; then the stock caller waiting on
reservation. A timing-only version of this test can pass or fail for reasons
that have nothing to do with the fix, and must be rejected under §9.

In the GREEN run, assert the **mechanism**, not just the absence of an error:
while reservation holds the shared product prefix, the competing caller must
report `pg_blocking_pids = {reservation}` **and** must not yet hold any bin
(`bins(B, W).xmax = 0`). That is what distinguishes "serialized at the product
prefix before either side could form the crossed-bin cycle" from "happened not
to interleave badly this time."

**Ascending-order control (diagnostic only — not proof of the fix).**
Reservation `[A, B]` against a stock caller whose payload is also `[A, B]`
completes without deadlock even against the *defective* body. Record it,
because it establishes that the crossed product order is the relevant
same-table ordering defect and that the harness is not manufacturing the
cycle. Do **not** report it as evidence that Fix G works: it passes either
way, and §9 rejects citing it as a GREEN result.

### The full post-191 lock graph for material consumption

`rpc_consume_reserved_materials_v2`'s locking order after Fix E is:

```text
manufacturing_orders (FOR UPDATE, existing, first statement)
  → stage_wip_log (FOR UPDATE, existing)
    → material_reservations, superset (ORDER BY id, FOR NO KEY UPDATE, new — Fix E)
      → products (FOR NO KEY UPDATE, new — Fix E + shared helper)
        → bins (FOR UPDATE, existing, inside the incoming/outgoing call)
```

**Edge criterion, corrected (thirteenth correction above):** an edge is not
only a *table-to-table* lock-order transition; it is also a **multi-row lock
on a shared row set of the same table taken in a non-identical order** by two
different functions. The first version of this check only tested the former
and missed `release_expired_reservations` as a result (below).

For this to be deadlock-free against every other function this design
touches or examined, no other live function may acquire any edge of this
graph in reverse, under either sense of "edge." Checked directly against the
live bodies, not assumed:

- **`release_expired_reservations` acquires the same `material_reservations`
  edge as the superset lock above, in scan order rather than `id` order —
  fixed by Fix F.** An earlier pass cleared this function on the grounds that
  it "only reads/updates `material_reservations` — no `products`, no `bins`,
  no `manufacturing_orders` lock. No edge to conflict with" — true under the
  table-to-table sense alone, and wrong under the corrected criterion: its
  unordered multi-row `UPDATE` and the superset lock's `ORDER BY id` lock
  both touch the same reservation rows for a given MO, in different orders,
  which is exactly the shape Fix C already treats as a real cycle risk for
  `products`. Fix F brings it to the identical `ORDER BY id FOR NO KEY
  UPDATE` discipline, so both functions now converge on the same acquisition
  order and cannot circularly wait on each other regardless of which starts
  first — the same argument the standalone helper-order mutant already
  proved for `products` (§7), extended to this table.
- `rpc_complete_manufacturing_order` locks `manufacturing_orders` then
  `products` — never touches `material_reservations` or `bins`. Consistent
  with (a proper prefix of) the graph above; no reverse edge.
- `rpc_create_mo_with_reservation` locks `bins` then implicitly `products`
  (its `material_reservations` insert's FK). **This bullet was wrong, and the
  twenty-fifth correction replaces it.** What it says is true as far as it
  goes: the `products`/`bins` edge *is* covered by the "Lock mode" analysis
  above (`FOR NO KEY UPDATE` removes the conflict regardless of order), and
  the function does not lock `manufacturing_orders` or pre-existing
  `material_reservations` rows. But it then concluded "no further edge to
  check here" **without applying the corrected same-table criterion to
  `bins`** — the very criterion stated four paragraphs above it. This function
  locks **all bins of each product**, iterating products ascending and holding
  earlier products' bins throughout, while receipt and delivery note visit
  bins in **payload** order. That is a multi-row lock on a shared row set of
  the same table in a non-identical order: a real edge, and the shared
  `products` prefix does not remove it, because this function holds no
  `products` lock while its bins locks are being taken. Reproduced as a
  genuine `40P01` (twenty-fifth correction). **Fix G** brings it under the
  prefix; the residual edge is closed there, not here.
- No live function locks `bins` or `products` and then locks
  `material_reservations` or `manufacturing_orders` afterward — confirmed by
  the same call-site sweep this design already performed for
  `wardah_apply_stock_incoming`/`outgoing` callers (§ "Two more P1s" note),
  extended to check what each caller locks *before* reaching the helper, not
  only whether it calls the helper at all.
- No other live function takes a multi-row lock on `material_reservations`
  or `products` at all, so no other same-table counter-ordering edge exists
  to check on **those two tables** under the corrected criterion — re-verify
  this specifically (not only the table-to-table sweep) at implementation time
  if `main` has moved.
- **`bins`, the third table, was omitted from the sweep above until the
  twenty-fifth correction, and that omission is what let the previous bullet
  clear `rpc_create_mo_with_reservation`.** The same-table criterion is now
  applied to all three tables this design locks — `products`,
  `material_reservations`, **and `bins`** — and the bounded sweep that closes
  it is recorded immediately below. Any future pass that re-runs the
  table-to-table sweep must re-run this one too; the two are not substitutes.

#### Bounded sweep: multi-product `bins`-lock retainers (twenty-fifth correction)

**Search criterion**, so this can be re-run rather than trusted: search the
live schema baseline (`sql/baseline/000_schema_baseline_20260905_184634.sql`,
cutoff 189) **and every numbered migration after that cutoff in the
repository** (currently `190_material_consumption_authorization_boundary.sql`;
190 is merged and is this design's prerequisite, but it is *not* folded into
the cutoff-189 dump, so a baseline-only grep would miss any bins-lock change
it introduced). Find every routine that acquires a `bins` row lock — counting
**both** an explicit locking clause (`FOR UPDATE` / `FOR NO KEY UPDATE` /
`FOR SHARE`) on a statement whose `FROM`/`UPDATE`/`JOIN` targets `bins`,
**and** the implicit row locks taken by `UPDATE bins`, `INSERT INTO bins ...
ON CONFLICT DO UPDATE`, or `DELETE FROM bins`. Match both the
schema-qualified `public.bins` and the bare `bins` spellings: the 9-arg
incoming body writes `FROM bins`, and a qualified-only pattern silently misses
it. Then classify each hit by whether one transaction can reach it for more
than one product — directly through a loop over a payload/collection, or
indirectly by calling `wardah_apply_stock_incoming`/`_outgoing` inside such a
loop. Thin wrappers that take no `bins` lock of their own are recorded as
transitive hits, not as additional M191 bodies.

**Result.** Eight explicit `bins` lock sites in six routines, plus five `bins`
write sites, plus the helper call sites in the five already-named callers.
Migration 190 replaces `rpc_consume_reserved_materials_v2` but does not add
or remove a `bins` lock of its own: the live post-190 body still reaches
bins only by calling outgoing inside its per-line loop (190 line 196), which
is already Fix E. Classified:

| Routine | How it locks `bins` | Multi-product in one transaction? | Status |
|---|---|---|---|
| `rpc_create_mo_with_reservation` | explicit, all bins per product, inside a per-product loop (baseline 6745) | **yes** | **the violator — Fix G** |
| `rpc_cancel_stock_adjustment` | **implicit**, `UPDATE public.bins` inside a per-SLE loop (baseline 5010) | **yes** | already **Fix C** with the upfront complete-product prefix — compliant |
| `rpc_post_goods_receipt` | indirectly, via incoming per line (baseline 8845) | yes | already **Fix E** — compliant |
| `rpc_post_delivery_note` | indirectly, via outgoing per line (baseline 8434) | yes | already **Fix E** — compliant |
| `rpc_submit_stock_adjustment` | indirectly, via incoming/outgoing per line (baseline 10664, 10680) | yes | already **Fix E** — compliant |
| `rpc_consume_reserved_materials_v2` | indirectly, via outgoing per line (baseline 5448) | yes | already **Fix E** — compliant |
| `rpc_manual_stock_movement_v2` | explicit target bin (baseline 8222) + one helper call (8232/8235) | no — one product per call | single-product, **Fix D** only |
| `wardah_apply_stock_incoming` 9-arg / 10-arg | explicit target bin only (baseline 15070, 15200) | no | single-product helper |
| `wardah_apply_stock_outgoing` 8-arg / 9-arg | explicit all bins of **one** product, then target bin (baseline 15366/15400, 15572/15611) | no | single-product helper; its all-bins scan is per-product, not per-transaction |
| `rpc_consume_reserved_materials` | no `bins` lock of its own; SQL wrapper to `_v2` (baseline 5357) | yes, transitively | already **Fix E** on the callee — **not** an additional M191 body |
| `consume_materials_for_mo` | no `bins` lock of its own; plpgsql wrapper to `rpc_consume_reserved_materials` (baseline 1755; 186 compatibility re-route) | yes, transitively | already **Fix E** on the callee — **not** an additional M191 body |

`rpc_complete_manufacturing_order` and `release_expired_reservations` take no
`bins` lock of either kind and are outside this sweep. `validate_stock_balance`
reads `bins` as `STABLE` with no locking clause. The helper call sites are
exactly the five callers this design already names — the sweep found no
unknown caller and no post-cutoff 190 bins locker.

**Conclusion: `rpc_create_mo_with_reservation` is the only routine that
violates the rule.** Every other multi-product `bins`-lock retainer is already
inside Migration 191 with the shared prefix, or is a thin wrapper onto one of
those bodies. No further body is added to 191 by this sweep — this was an
audit, and a second violator would have been reported as a separate blocker
before extending scope rather than folded in silently. Re-run the sweep with
the criterion above if `main` moves.

### Residual risk: unmediated multi-row client writes

The lock-order contract above covers every writer *this migration controls*
— every RPC and helper this design replaces or adds. It does not, and
cannot, cover a direct multi-row client write reaching, through PostgREST,
any of the client-writable tables this design's own paths depend on:

- **`products`** — the table every lock in this design orders on; policies
  `products_org_insert` / `_update` / `_delete` / `_select`, all
  `TO authenticated`;
- **`material_reservations`** — Fix F's table, and the per-line reservation
  lock in `rpc_consume_reserved_materials_v2`; its four policies carry **no
  `TO` clause at all**, so they apply to `PUBLIC` — broader than the other
  two, and worth the audit's attention on its own;
- **`stock_adjustment_items`** — the source of the product set
  `rpc_submit_stock_adjustment` and `rpc_cancel_stock_adjustment` resolve
  their lines from; policies `stock_adjustment_items_ins_m` / `_upd_m` /
  `_del_m` / `_sel_m`, all `TO authenticated`.

**`sales_invoice_lines` is deliberately excluded from this list** (fresh-review
closure). It was listed here in an earlier revision on the strength of its
broad table `GRANT` alone. Verified against the live baseline, RLS is enabled
and its only policy is `sales_invoice_lines_org_read`, `FOR SELECT TO
authenticated` — there is no write policy for `authenticated` anywhere, so a
client `PATCH` is refused by RLS and it is **not** a direct-client write
surface. It remains a table this design's RPC paths lock and mutate
server-side, and §4 states the corrected, narrower reason
`rpc_post_delivery_note`'s pre-pass locks its rows; that is a different
concern from this one and must not be merged back into it.

Each of the three above carries both a broad table `GRANT` **and** write
policies for a client role (confirmed against the live
baseline) with an `org_id`-scoped
predicate, so a filtered bulk `PATCH` (e.g. `PATCH /products?org_id=eq...`)
is one statement that locks rows in whatever order its own scan visits them —
the same shape as `release_expired_reservations` before Fix F, but reachable
by any authenticated client and not something a `CREATE OR REPLACE` in 191
can order, because it is not a function this design owns. This is a genuine,
open write-surface question — not merely a "clean `40P01`, safe to retry"
footnote, since an RPC's atomicity guarantee doesn't apply to a bulk client
write that never went through the RPC at all — but closing it is a write-
surface-closure question (the same shape Migration 185 already answered for
`stock_ledger_entries`/`bins`, and 176 for the RBAC tables), not a lock-order
question, and is explicitly out of scope for 191. Recorded here so it is not
rediscovered as a surprise P1 in a future pass: it belongs on the F1/write-
surface-audit backlog this design's own §8 framing already points toward, as
a required input, not an assumption to re-derive.

**Migration 191 does not close any of these three write surfaces, and no
acceptance row may be read as evidence that it does.** Every lock this design
adds — the product prefix, Fix F's ordered reservation lock, and Fix E's
`sales_invoice_lines` pre-pass lock — narrows the window *within a call that
goes through the RPC*; none of them has any effect on a client `PATCH` that
never enters the RPC at all. The
list above is an input to the F1 write-surface audit, and the audit is the
only thing that can close it.

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
| New: `wardah_lock_products_for_stock_write` standalone helper-order mutant, RED (ordering-removed) run | call the ordering-removed helper mutant directly with literal `ARRAY[A,B]` and `ARRAY[B,A]` (the test harness supplies the crossed order itself — no RPC's own collection logic in between to lose it), driven through the advisory-lock gate barrier (per the eighth/ninth corrections — this build's own code calls the gate). Must reproduce a genuine deadlock — both backends observed via `pg_stat_activity` waiting on each other's row, or a `deadlock detected` (`40P01`) on the side PostgreSQL's detector aborts |
| New: `wardah_lock_products_for_stock_write` standalone helper-order mutant, GREEN (real helper) run | Fixture precondition (per the twelfth correction above): assert `A`'s UUID `<` `B`'s UUID before running this scenario — the "`A` first" expectation below only holds if `A` genuinely sorts lower, and nothing else in the fixture guarantees that. **Not** the same barrier as the RED run — the real, unmodified helper has no advisory-lock call in its body to gate on (per the tenth correction above) — **and not one transaction holding both products either**, which cannot distinguish a correct helper from one that respects the caller's own input order verbatim (per the eleventh correction above: both would show the same `pg_blocking_pids()` result, since a single blocker holding both products blocks a second caller regardless of which one it tries first). Use two *independent* single-row blockers instead: `blocker_A` locks only `A` (its own held-open transaction), `blocker_B` locks only `B`, independently. Transaction 2 then calls the real helper with `ARRAY[B, A]`. Before releasing anything, `pg_blocking_pids(<transaction 2's pid>)` must equal `{<blocker_A's pid>}` **only** — proving transaction 2's first lock attempt landed on `A` despite `B` being listed first in its input. Releasing `blocker_A` alone must move `pg_blocking_pids(<transaction 2's pid>)` to `{<blocker_B's pid>}` — proving the acquisition sequence is genuinely `A` then `B`, not merely "blocked by something." Releasing `blocker_B` lets transaction 2 complete with no deadlock. Together with the RED run above, this is the sole basis for the global-ordering claim; neither run depends on any caller (Fix C included) producing a particular array order |
| New: cancellation vs cancellation, overlapping multi-product adjustments (real-path control, not an ordering proof) | two `SUBMITTED` adjustments sharing two products, run under genuine forced concurrency against the real, unmodified Fix C and helper — no attempt to force or assert which product either adjustment's own array lists first, since Fix C's collection step (distinct product_ids from the SLEs being reversed) has no specified order and nothing should depend on one. Asserts business correctness only: no deadlock regardless of which adjustment's transaction starts first, and both `products` rows end up equal to the sum of their own bins. The lock-ordering guarantee itself comes from the standalone helper-order mutant above plus the static contract requiring the helper call before the first `UPDATE bins` — both apply to Fix C regardless of its own array order, so this control does not need to reproduce a pre-fix deadlock to be meaningful |
| New: manual movement vs incoming/outgoing/cancellation, existing bin | no deadlock; whichever serializes second sees the other's committed state and applies normally (single-product case, no `LATER_STOCK_MOVEMENT_EXISTS` interaction unless racing cancellation specifically, in which case the same rule as incoming/outgoing-vs-cancellation applies) |
| New: two different multi-line callers (e.g. one `rpc_post_goods_receipt`, one `rpc_post_delivery_note`), overlapping products A and B in reversed line order (call 1: A then B; call 2: B then A), no pre-existing bins for one side | **Fix E omitted, deterministic RED (eighteenth/nineteenth/twentieth corrections):** "start both concurrently and hope" is not acceptable on its own — nothing forces either call to hold its first product at the exact instant the other needs it. Force it with an external, test-only blocker on product B taking **`FOR NO KEY UPDATE`, not `FOR UPDATE`** (twentieth correction): `rpc_post_goods_receipt`'s live body (confirmed against Migration 177, line 366 vs 377) does `INSERT INTO goods_receipt_lines` — which carries an FK to `products` and so takes an implicit `FOR KEY SHARE` on the line's product — *before* calling `wardah_apply_stock_incoming` for that line; a `FOR UPDATE` blocker would conflict with that `FOR KEY SHARE` and stop the call at the `INSERT`, before it ever reaches the helper-lock edge this mutant exists to test, misattributing the block exactly as the sixteenth correction already found for `material_reservations`. `FOR NO KEY UPDATE` does not conflict with `FOR KEY SHARE`, so the `INSERT` proceeds normally, while `FOR NO KEY UPDATE` still conflicts with the per-line product lock (also `FOR NO KEY UPDATE`) both callers take inside `wardah_apply_stock_incoming`/`outgoing` — the actual edge under test. Lock product B this way and hold it; start call 2 (needs B first) — before releasing anything, assert `pg_blocking_pids(<call 2>) = {<blocker>}` exactly; start call 1 (needs A first) — it locks A uncontested, then reaches for B — before releasing anything, assert `pg_blocking_pids(<call 1>) = {<call 2>}` exactly (**not** `{<blocker>, <call 2>}` — PostgreSQL's row-level locking is two-staged: the first waiter on a contended row acquires a heavyweight tuple lock before waiting on the current holder's transaction id, so a later waiter blocks on that first waiter directly, not transitively on the original holder; confirmed empirically against a live PostgreSQL 17 instance). Only once both exact values are confirmed, release the blocker: call 2 (queued first on the tuple lock) acquires B and reaches for A, held by call 1 — the cycle is complete (call 1 waits on call 2 for B; call 2 waits on call 1 for A) and must produce a genuine `deadlock detected` (`40P01`). No instrumentation of either real multi-line caller is needed — the blocker, its `FOR NO KEY UPDATE` mode, the two pre-release assertions, and the release ordering alone force the shape. **Fix E present, real 191:** identical fixture (same blocker and mode, same start order) must complete both calls without deadlock, regardless of which call's `wardah_lock_products_for_stock_write` commits first |
| New: `rpc_submit_stock_adjustment` vs `rpc_consume_reserved_materials_v2`, overlapping products (real-path control, not an ordering proof — same reasoning as the cancellation-vs-cancellation control) | no deadlock; both fully apply or one fails on its own pre-existing business rules (insufficient reservation, insufficient stock), never a hang. Does not require either call's own array to be in any particular order — the ordering guarantee comes from the standalone helper-order mutant and static contract, not from this fixture |
| Historical only: incoming vs `rpc_create_mo_with_reservation`, same product, existing bin (pre-Fix-G body) | **Not real-M191 acceptance (twenty-sixth correction / P2-2).** Retain the eighteenth/nineteenth-correction external-bin choreography only as historical evidence for why products `FOR UPDATE` was rejected *before* Fix G: external blocker holds the target bin; reservation queues (`pg_blocking_pids(<reservation>) = {<blocker>}`); incoming `FOR UPDATE` mutant then queues on reservation (`pg_blocking_pids(<incoming>) = {<reservation>}`, not `{<blocker>, <reservation>}`); release blocker; genuine `40P01` on the pre-Fix-G body. Do **not** require this sequence against a post-Fix-G body and do **not** treat a post-Fix-G run as lock-mode proof: after Fix G, reservation holds the product prefix before any bin wait, so the incoming mutant blocks at the product and the old PID assertion can pass on the wrong edge. Also never sufficient for Fix G's multi-product `bins` edge (twenty-fifth correction) |
| New: real-M191 lock-mode probe (Fix G compatible) | Reservation acquires product P through the shared prefix and is held before completion by blocking its **subsequent** bin lock, so it still holds the prefix. While it remains bin-blocked, an independent real FK child insert on P (fixture that does **not** contend on reservation's other rows — e.g. a separate precreated MO) must **complete** under real `FOR NO KEY UPDATE`. The same probe against a prefix mutant of `FOR UPDATE` must **block**, with `pg_blocking_pids(<probe>) = {<reservation>}` exactly. Then release/cleanup. **No `40P01` required** — the discriminator is KEY SHARE compatibility vs blocking. Together with the static `FOR NO KEY UPDATE` assertion on the helper, this is the current lock-mode evidence. See the subsection above this table |
| New: Fix G mapping-drift A — remap after prefix, before bins | **Test-only observed gate (twenty-seventh correction); not production 191.** Sequence: snapshot complete → complete product prefix → TEST-ONLY advisory gate `K` → first bins/availability query. Gate-holder holds `K`. Independently `blocker_X` holds the first captured-`X` bin row and `blocker_Y` holds the corresponding `Y` bin (`Y` outside the captured prefix). Start the TEST-INSTRUMENTED candidate. Before any mapping change, observe `wait_event_type = 'Lock'` and `pg_blocking_pids(reservation_pid) = {gate_holder_pid}` (plus harness marker if used). Only then mapper COMMITs `I: X→Y`; prove that commit finished **before** releasing `K`. After release: capture-bound body must show `pg_blocking_pids(reservation_pid) = {blocker_X_pid}`; blocking on `blocker_Y_pid` is a **FAIL** (later `wardah_resolve_product_id` chose `Y`). Then release `blocker_X`. `Y`'s bin must never have been acquired. Sleep-only placement of the remap is rejected. Complementary with the static no-later-resolver rule — neither replaces the other. Full choreography in the subsection above this table |
| New: Fix G mapping-drift B — remap after availability, before INSERT | **Test-only observed gate `K_B`; not production 191.** Sequence: snapshot → complete prefix → bins/availability success → MO INSERT in the still-open transaction → TEST-ONLY `K_B` → first `material_reservations` INSERT. Before any remap, observe `wait_event_type = 'Lock'` and `pg_blocking_pids(reservation_pid) = {gate_holder_pid}` (plus harness marker if used). Only then mapper COMMITs `I: X→Y`; prove that commit finished **before** releasing `K_B`. After release: INSERT still supplies captured `X`; BEFORE trigger re-resolves to `Y`; `RETURNING product_id` is `Y`; exact `Y != captured X` raises `ITEM_PRODUCT_MAPPING_DRIFT`. Whole-RPC rollback: MO must not persist; no reservation from this RPC may persist; no partial business state. **FAIL** if the INSERT commits with `Y`, if the mismatch is ignored, or if only the reservation is undone while the MO survives. Sleep-only placement is rejected. Complementary with the static captured-line vs post-trigger identity check. Full choreography in the subsection above this table |
| New: Fix G mapping-drift C — swap among already-prelocked products | **Test-only observed gate `K_C` at B's persistence-time boundary; not production 191.** Isolates C from A: bins/availability already ran on captured `{X,Y}`. Fixture `I1→X`, `I2→Y`, prefix `{X,Y}`. Observe wait at `K_C` (`wait_event_type = 'Lock'`, `pg_blocking_pids(reservation_pid) = {gate_holder_pid}`) **before** any remap. Then one mapper transaction performs a **legal** `I1↔I2` product swap that respects `uq_item_product_map_current_item` and `uq_item_product_map_current_product` (retire/deactivate the two old current mappings, then install the two new ones — not two naive `product_id` UPDATEs). Prove mapper COMMIT finished before releasing `K_C`. After release: trigger `I1→Y` vs captured `X`, `I2→X` vs captured `Y`; both products are in `{X,Y}`, so `ANY(prelocked_set)` would **accept**; exact per-line identity must raise `ITEM_PRODUCT_MAPPING_DRIFT` on the first mismatching INSERT. Whole-RPC rollback: no MO, no reservation, no partial line. Sleep-only placement is rejected. Complementary with the static "ANY() is insufficient" rule. Full choreography in the subsection above this table |
| New: Fix G Control A — reservation `[A,B]` vs goods receipt `[B,A]` | **Pre-Fix-G reservation body must RED with genuine `40P01`.** Choreography gated on observed `pg_stat_activity` / `pg_blocking_pids()` / `bins.xmax`, not sleeps: `T1` locks `A`'s bins and is held before `B`; `T2` (post-191 receipt) passes the product prefix then holds target `bins(B,W)`; release `T1` and require `T1` blocked by `T2`; release `T2` and require the sampled mutual wait and `40P01` with the cycle on `bins`. Incoming's target-bin-only footprint is part of the assertion (`bins(B, other warehouse).xmax` remains `0` while `T2` is gated). **Real 191 must GREEN:** both commit, no `40P01`; while reservation holds the shared product prefix the receipt must report `pg_blocking_pids = {reservation}` and must not yet hold any bin. Quantities, MO, and reservation rows must reconcile. See the subsection above this table for the full contract |
| New: Fix G Control B — reservation `[A,B]` vs outgoing / delivery-note `[B,A]` | Same observed-blocker choreography as Control A, required separately because outgoing holds **all** bins of `B` and therefore widens the contended set. Pre-Fix-G reservation body must RED with genuine `40P01`; real 191 must GREEN with the same prefix-serialization assertion. Do **not** treat an ascending `[A,B]` vs `[A,B]` run as either RED or GREEN for this row — that control passes against the defective body and only diagnoses that the crossed product order is the relevant defect |
| New: `rpc_consume_reserved_materials_v2` superset lock, two lines same `item_id` where the first consumption fully exhausts the first-created reservation | the two reservations for that `item_id` must be built with genuinely different effective products (different `product_id`, or one `NULL` `product_id` resolving via `wardah_resolve_product_id` to a different product than the other's explicit `product_id` — not two reservations that happen to share one product). Second line resolves to the second reservation (existing behavior, unchanged) and *both* distinct effective products were locked by the upfront superset query — assert this by checking both products appear in the locked set, not just that the call succeeds; a narrower (buggy) pre-pass, or one that derives from the bare `product_id` column instead of the effective-product expression, could otherwise pass this fixture by coincidence |
| New: `rpc_consume_reserved_materials_v2` guard regression check, mutant 1 — narrowed superset, guard present | superset query deliberately narrowed to only the specific reservations named by `p_consumptions` (the earlier, wrong pre-pass shape) instead of the full per-MO lock; guard left in place. A fixture whose second line resolves to a reservation outside that narrowed set must raise `PRODUCT_NOT_PRELOCKED` — proves the guard is reachable, not dead code |
| New: `rpc_consume_reserved_materials_v2` guard regression check, mutant 2 — genuinely narrow per-MO superset (missing a product the loop will need), guard removed, forced concurrency | run as two concurrent calls **on two different manufacturing orders**. Two different MOs is required, not incidental: this function's first statement locks `manufacturing_orders WHERE id = p_mo_id FOR UPDATE`, so two calls on the *same* MO would already fully serialize there and never reach product-level contention at all. This is **not** the helper-ordering mutant — do not reuse the positional-loop helper mutation here (per the eighth correction above): if both MOs' superset already covered `{A, B}`, removing the guard would be irrelevant to any deadlock, since the guard only fires on a product outside the locked set. Instead, MO 1's superset lock (the real, unmodified `wardah_lock_products_for_stock_write`, called with `p_consumptions`-derived reservations only) covers **only `{A}`**, and its fixture is built so the per-line loop's second line resolves to the *un-prelocked* product `B`; MO 2's superset covers **only `{B}`**, with its loop needing `A`. A session-level advisory-lock gate barrier (verified mechanism, per the eighth correction) sits after the upfront superset lock and before the per-line loop: MO 1 locks `A` then gates on `1`, MO 2 locks `B` then gates on `2`; releasing both gates together lets both loops proceed to resolve their un-prelocked product at the same instant. With the guard removed, this must reproduce a genuine transaction-level deadlock — `T1` holds `A` and waits on `B` via the ordinary per-line `wardah_apply_stock_incoming`/`outgoing` lock, `T2` holds `B` and waits on `A` — proven via `pg_stat_activity` showing the symmetric wait on both backends, or a `deadlock detected` (`40P01`) on the side PostgreSQL's detector aborts; not a silent wrong value in a single run and not an inferred hang |
| New: `rpc_consume_reserved_materials_v2` guard regression check, mutant 3 — real 191 | full per-MO superset lock (any status, filtered to `'reserved'` from the locked snapshot) plus the guard, both as specified. Neither the guard nor a deadlock should be reachable under normal operation — the guard exists as a backstop, not as an expected code path |
| New: Fix F, deterministic RED mutant — consume-shaped `[A,B]` lock vs release-shaped `[B,A]` lock on the same two reservation rows | **not** a planner/scan-order-dependent fixture — two `reserved`, expired reservations for one MO are locked directly by literal id: a test-only mutant that locks the pair in literal `[B, A]` order (mimicking a scan visiting them opposite to `id` order) run concurrently against a caller locking `[A, B]` (consume's real, ascending order), both through the same advisory-lock gate barrier already verified for the standalone `products` helper-order mutant (§7). Must reproduce a genuine `deadlock detected` (`40P01`), with both backends observed on their gate beforehand — confirmed empirically against a live PostgreSQL 17 instance before this row was written |
| New: Fix F, real-helper GREEN run | identical fixture, both sides using the real, unmodified bodies — consume's superset lock and Fix F's locking loop, both `ORDER BY id FOR NO KEY UPDATE`. Forced overlap (ordinary row-lock waiting, not a gate — both real bodies converge on the same ascending order so there is no mid-loop point to gate on, the same reasoning as the `products` standalone mutant's GREEN run) must **never deadlock or hang**, and must produce exactly one of two correct outcomes depending on which side reaches and locks the shared reservation row first (eighteenth correction — "consumption proceeds normally" is not true under every ordering): **if consumption's lock arrives first**, consumption proceeds and completes normally, and the subsequent (queued) `release_expired_reservations` call either finds the row no longer eligible (fully consumed) or expires it correctly afterward; **if `release_expired_reservations` locks and commits the row first** (marking it `'expired'`), consumption's own `status = 'reserved'` lookup then correctly finds no match and fails atomically with `ACTIVE_RESERVATION_NOT_FOUND` — no partial effects, no deadlock, a correct outcome for that ordering, not a test failure. Both orderings must be exercised, not only the first |
| New: Fix F business-correctness control | a reservation partially consumed by one line of an in-flight `rpc_consume_reserved_materials_v2` call remains `'reserved'` (uncommitted) for the duration of that call, so a concurrent `release_expired_reservations` call must not expire it out from under the consumption in progress — it either queues behind consumption's lock and finds the row no longer eligible (if consumption fully consumed it) or expires it correctly afterward (if consumption left it `'reserved'` with remaining quantity); run once, then run `release_expired_reservations` again after the first call commits to confirm anything still eligible is picked up on the next sweep — a release call is not required to catch a row that becomes eligible only after it has already locked and returned |
| New: `rpc_consume_reserved_materials_v2` per-line reservation lock-mode check (fifteenth/sixteenth/seventeenth corrections) | a **reservation-only** blocker session takes `SELECT id FROM material_reservations WHERE id = <R> FOR KEY SHARE;` and holds the transaction open — not a real `INSERT INTO material_consumption`, whose own FK set (`work_order_id`, `mo_id`, `product_id`, `reservation_id`, `stage_id`, at minimum) would take implicit `FOR KEY SHARE` on `manufacturing_orders` too, and consumption's own first statement is `manufacturing_orders ... FOR UPDATE` — an `INSERT`-based blocker risks the consumption backend blocking on the *MO* lock instead of ever reaching the reservation lock this check exists to test, a false attribution the fixture must not risk. The isolated `FOR KEY SHARE`-only blocker touches no other table. **Against a build with the per-line branches left as bare `FOR UPDATE`:** `pg_blocking_pids(<consumption's pid>)` must equal `{<the reservation-only blocker's pid>}` specifically — not merely `wait_event_type = 'Lock'` — confirmed empirically against a live PostgreSQL 17 instance. **Against real 191** (both branches `FOR NO KEY UPDATE`): the blocker is **never released during the test** (the seventeenth correction, below) — the primary success criterion is that the consumption call **returns successfully, with the expected business side effect (consumption row inserted / reservation `quantity_consumed` advanced) visible, while the blocker's `FOR KEY SHARE` transaction is still open and uncommitted**. A snapshot of `pg_blocking_pids(<consumption's pid>) = {}` taken at an arbitrary moment during the call does not by itself prove the per-line lock statement was ever reached — the harness could sample before the backend gets there and see an empty result regardless; only the call's own successful completion, observed before the blocker is released, is a race-free proof that the lock attempt did not conflict. `pg_blocking_pids() = {}` may still be recorded as corroborating information, not as the pass/fail criterion. Only after the completion is observed should the blocker be released, for cleanup. A real `INSERT INTO material_consumption` demonstrating that an FK-driven `FOR KEY SHARE` is a genuine, naturally-occurring lock in this schema (not just a test artifact) is worth keeping as separate supporting evidence, but is not itself this fixture |
| Static contract, both incoming overloads | product `FOR NO KEY UPDATE` appears before bins `FOR UPDATE`; a bare products `FOR UPDATE` is **absent**; `actual_qty = EXCLUDED.actual_qty` is **absent**; unlocked `SUM`→`UPDATE products` without a preceding products lock is **absent** |
| Static contract, both incoming overloads — **negative** bin-footprint boundary (twenty-fourth correction) | incoming must **not** acquire outgoing's all-existing-bins scan. An `ORDER BY warehouse_id, id`-style locking query over *every* existing bin row for the product — outgoing's function-specific footprint — is **absent** from both incoming bodies. The accepted incoming footprint is exactly: product prefix → **target bin only** (`FOR UPDATE` when the row exists, insert/retry from the locked snapshot when it does not) → fresh `SUM` projection under the product lock. This row exists because the shared §4 contract was once worded as though the all-bins scan were universal, and a future implementer reading that wording could "align" incoming to it — which would be a real, unreviewed behavior and performance change (locking every warehouse's bin row on every single-warehouse receipt), not a lock-order fix. Broadening the footprint requires its own design decision and its own evidence, not a prose alignment |
| Static contract, both outgoing overloads | product `FOR NO KEY UPDATE` appears before the all-bins `FOR UPDATE`; a bare products `FOR UPDATE` is **absent** |
| Static contract, `rpc_cancel_stock_adjustment` | a call to `wardah_lock_products_for_stock_write` (or an equivalent ordered multi-row `FOR NO KEY UPDATE`) appears before the first `UPDATE bins` in the function body |
| Static contract, `rpc_manual_stock_movement_v2` | a products `FOR NO KEY UPDATE` lock appears before the *first* `bins` reference in the function body — the unlocked warehouse-inference `SELECT ... FROM bins` when `warehouse_id` is omitted, not only the later `bins ... FOR UPDATE` |
| Static contract, `rpc_post_goods_receipt` / `rpc_post_delivery_note` / `rpc_submit_stock_adjustment` / `rpc_consume_reserved_materials_v2` | a call to `wardah_lock_products_for_stock_write` appears before the per-line `LOOP` in each function body; the resolved/locked product array is referenced later in the loop (the `PRODUCT_NOT_PRELOCKED` guard, see Fix E) |
| New: `rpc_post_delivery_note` duplicate-line-id regression (twenty-first correction) | one payload lists the *same* `sales_invoice_line_id` twice (e.g. an invoice line with `quantity = 10`, two payload entries each delivering `6`). Must hold identically before and after 191: the first occurrence sees `delivered = 0` and applies; the second occurrence's own `SELECT ... FOR UPDATE` must see the *updated* `delivered = 6` from the first occurrence within the same transaction (read-your-own-writes), not the upfront prelock's stale snapshot — so `6 + 6 > 10` correctly raises `OVER_DELIVERY` (or, with `v_allow_over` set, both apply and `unit_cost_at_sale` reflects the correct cumulative weighted average across both, not two independent computations against the same stale base). A build that caches the upfront prelock's read and reuses it in the loop (rather than re-querying every iteration) fails this row — both occurrences would compute against `delivered = 0`, silently under-recording total `delivered_quantity` and corrupting the weighted-average `unit_cost_at_sale` |
| New: `rpc_post_goods_receipt` / `rpc_post_delivery_note` line-error-ordering regression (twenty-second correction) | line 1 has an invalid `quality_status` (goods receipt) / a missing `sales_invoice_line_id` (delivery note); line 2 has a well-formed but nonexistent product/line reference. Must hold identically before and after 191: the error raised is line 1's own (`INVALID_QUALITY_STATUS: line=1` / `LINE_REQUIRED: line=1`), never a helper-level `PRODUCT_NOT_FOUND_OR_WRONG_ORG` or `INVALID_INVOICE_LINE` surfaced from line 2 ahead of it — the loop's existing per-line validation order is the sole source of which error a given payload produces, exactly as it is today; the pre-pass's own candidate resolution must never itself raise or preempt that order |
| New: `rpc_post_goods_receipt` / `rpc_post_delivery_note` malformed-later-line regression (twenty-second correction) | line 1 has an invalid `quality_status` / a missing `sales_invoice_line_id`; line 2's `product_id` / `sales_invoice_line_id` is a syntactically malformed (non-UUID-shaped) string. Must hold identically before and after 191: the error raised is still line 1's own; a pre-pass that casts every line's id to `uuid` in one query (`SELECT DISTINCT (value->>'product_id')::uuid FROM jsonb_array_elements(...)`, or an equivalent `ANY(ARRAY(...::uuid...))` for delivery note) fails this row — confirmed empirically to raise a raw `invalid input syntax for type uuid` before the loop ever runs, replacing line 1's own error with a Postgres-level exception that isn't even one of this RPC's own error codes |
| New: `rpc_post_goods_receipt` / `rpc_post_delivery_note` UUID-parser-parity regression (twenty-fourth correction) | a **full 2×2 matrix**, not one spelling per function: **both** PostgreSQL-valid non-canonical spellings — brace-wrapped (`{a0eebc99-…}`) and 32-hex hyphenless (`a0eebc999c0b…`) — must be exercised against **both** affected pre-passes, so all four cells (goods receipt × brace-wrapped, goods receipt × hyphenless, delivery note × brace-wrapped, delivery note × hyphenless) are `PASS`. Splitting coverage — "brace-wrapped for GR and hyphenless for DN" — does **not** satisfy this row: it leaves each function's parser untested against one of the two spellings its own unchanged `::uuid` cast accepts, which is the exact gap this correction exists to close. Each request must resolve, prelock, and succeed identically before and after 191 — never reach `PRODUCT_NOT_PRELOCKED`. A canonical `8-4-4-4-12` regex or other hand-written shape test fails this row even if the malformed-later-line regression passes. Confirmed empirically on PostgreSQL 17.6 for all four cells against disposable `products` / `sales_invoice_lines` fixtures (twenty-fourth correction's evidence block above) |
| New: `rpc_post_goods_receipt` / `rpc_post_delivery_note` missing-key / `NULL` candidate control (twenty-fourth correction) | a payload object with the id key **absent** (so `value->>'…'` is `NULL`). `pg_input_is_valid(NULL, 'uuid')` is `NULL`, not `false`, so the guard must fall to its `ELSE` branch: the pre-pass yields `NULL`, contributes nothing to the locked set, and raises nothing — leaving the business error to be decided by the unchanged loop, in the loop's own order, exactly as today. **The expected error differs per function and must be asserted per function:** goods receipt raises **`ITEM_NOT_FOUND`** (Migration 177 reserves `GR_LINE_OBJECT_REQUIRED` for an array element that is not a JSON object at all, line 201-203; an object with the key absent resolves `v_product = NULL` and falls to `ITEM_NOT_FOUND`, line 205-211), while delivery note raises **`LINE_REQUIRED`** (Migration 133's explicit `NULLIF(...) IS NULL` check, line 171). Asserting `GR_LINE_OBJECT_REQUIRED` for a goods-receipt payload whose line is a well-formed object missing `product_id` would make this row fail against correct, unchanged behavior. A build whose guard treats the three-valued condition as if it were two-valued, or that raises on the absent key, fails this row |
| Static contract, `rpc_post_delivery_note` Fix E pre-pass (twenty-fourth correction) | the upfront `sales_invoice_lines` pre-pass body matches the proven shape, asserted point by point: (a) the row-locking inner query carries **`ORDER BY sil.id`**, and the locking clause follows it — the reverse placement is a PostgreSQL syntax error, confirmed on 17.6; (b) the locking clause is **`FOR UPDATE OF sil`** — retained for explicitness about the lock target, *not* because a bare `FOR UPDATE` is invalid here: it is valid and genuinely locks, proven on 17.6, so **no gate may assert that a bare `FOR UPDATE` fails**; only naming the function alias (`FOR UPDATE OF line`) is rejected by PostgreSQL; (c) the lock mode is **`FOR UPDATE`**, matching the unchanged loop's own re-read — `FOR NO KEY UPDATE` in the pre-pass while the loop still takes `FOR UPDATE` is **absent**, since that turns the loop's re-acquisition into a mode upgrade (fifteenth correction's trap on a different table); (d) **`DISTINCT` is outside** the row-locking query, applied by an outer query over the already-locked rows — `DISTINCT` combined with a locking clause in one query is **absent** (PostgreSQL rejects it outright: "FOR UPDATE is not allowed with DISTINCT clause", re-confirmed on 17.6 against this exact shape); (e) the per-line loop's own fresh `SELECT ... FOR UPDATE` reading `quantity` / `unit_price` / `COALESCE(delivered_quantity, 0)` **remains present and unchanged** inside the loop; (f) the pre-pass selects **`product_id` only** — it must never be used as a business-state cache, and no `delivered_quantity`, `quantity`, `unit_price`, or other business column read by the loop may be sourced from it (twenty-first correction) |
| Static contract, canonical-UUID-regex absence — **scope is part of the contract** (twenty-fourth correction) | the check asserting that no canonical `8-4-4-4-12` UUID regex guards a candidate cast applies to exactly four targets and **no others**: (1) the current, live §4 Fix E pre-pass specification for `rpc_post_goods_receipt`; (2) the current, live §4 Fix E pre-pass specification for `rpc_post_delivery_note`; (3) the implemented `pg_get_functiondef()` body of `rpc_post_goods_receipt`; (4) the implemented `pg_get_functiondef()` body of `rpc_post_delivery_note`. A whole-document sweep such as `! rg '\\{8\\}-\\[0-9a-fA-F\\]\\{4\\}' docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md` is **rejected outright**, and so is any equivalent repo-wide grep over the design docs. Historical correction text **may and must** contain the superseded regex: the twenty-second correction preserves the exact guarded form that was empirically tested and later found too narrow, marked as superseded, and that record is the evidence trail. This scoping rule is itself a correction — a too-broad absence check is precisely what forced the historical evidence to be rewritten in place once already, destroying the record of what was actually tested. The evidence log must never again be edited to satisfy a grep whose scope was wrong |
| Static contract, `wardah_lock_products_for_stock_write` | uses `FOR NO KEY UPDATE`, not `FOR UPDATE`, on `products`; a bare `FOR UPDATE` on `products` anywhere in its body is **absent**; raises on a locked-row-count mismatch (`cardinality` comparison present); the query carrying `FOR NO KEY UPDATE` itself also carries `ORDER BY` on `id` (ascending) — not only the earlier `ARRAY(SELECT DISTINCT ... ORDER BY ...)` normalization step — since acquisition order, not just the deduplicated input set, is what the deadlock-avoidance argument in §6/§7 depends on |
| Static contract, `wardah_lock_products_for_stock_write` | exists, is not `SECURITY DEFINER`, has its own `SET search_path`, references `public.products` schema-qualified, and has no `EXECUTE` grant for `anon`/`authenticated`/`PUBLIC` |
| Static contract, `rpc_consume_reserved_materials_v2` | the pre-loop reservation lock filters only on `org_id`/`mo_id` (every row for the MO, any status), locks `ORDER BY id FOR NO KEY UPDATE` (not a bare `FOR UPDATE` — `material_consumption.reservation_id`'s FK to `material_reservations(id)` makes this the same lock-mode argument as `products`; see Fix F) and no `status` predicate in the locking query itself; the `status = 'reserved'` filter is applied afterward, reading from the already-locked rows, not before locking (locking a `status = 'reserved'`-filtered query is the earlier, wrong shape — it can miss a row that flips to `'reserved'` mid-transaction); the `PRODUCT_NOT_PRELOCKED` guard appears inside the per-line loop; **no bare `FOR UPDATE` on `material_reservations` appears anywhere in the function body** — this includes both per-line branches (`reservation_id` given, and `item_id`-derived `ORDER BY created_at, id LIMIT 1`), not only the pre-loop superset lock (the fifteenth correction: an earlier revision left these two as `FOR UPDATE`, wrongly reasoning the upgrade from the superset's `FOR NO KEY UPDATE` was a no-op) |
| Static contract, `release_expired_reservations` (Fix F) | locks `ORDER BY id FOR NO KEY UPDATE` in the same query, before any `UPDATE material_reservations`; a bare `FOR UPDATE` or an `UPDATE` with no preceding ordered lock is **absent**; `FOR UPDATE SKIP LOCKED` is **absent** (not adopted in 191 — see the thirteenth correction, point 1); `SECURITY INVOKER` and the existing `anon`/`authenticated`/`service_role` ACL are unchanged; `quantity_released = quantity_reserved - quantity_consumed` has no `COALESCE` added (unchanged from the live body — see the thirteenth correction, point 3) |
| Static contract, all four Fix E functions | the `PRODUCT_NOT_PRELOCKED` guard (or equivalent `= ANY(locked set)` assertion) appears at least once per function, after product resolution and before any `bins`/`products` write for that line |
| Static contract, `rpc_create_mo_with_reservation` (Fix G) | after existing validation and **before any stock lock**, one canonical resolved-demand snapshot is materialized (one entry per original material line: ordinal, item_id, quantity, captured `resolved_product_id`, plus fields the reservation INSERT needs); the distinct product prefix is derived **from that snapshot only** and `wardah_lock_products_for_stock_write` is invoked **before** the first `bins` lock — assert on statement order, not merely helper presence; **no path into the per-product bins loop can bypass the prefix**; **no later `wardah_resolve_product_id` call** may decide which product's bins are locked, which product's availability is summed, or which `product_id` is offered to INSERT; bins/availability aggregation is driven only from the snapshot; existing per-product bins lock retains `ORDER BY warehouse_id, id FOR UPDATE`; MO creation still follows availability; `material_reservations` inserts still follow MO creation, one per original line, driven from the same snapshot; `INSERT ... RETURNING product_id` (post-trigger) is compared to that line's captured identity — mismatch raises `ITEM_PRODUCT_MAPPING_DRIFT` and rolls back the whole RPC; a membership-only `= ANY(v_locked_products)` guard is **absent** as the drift check; no bins for an uncaptured/unprelocked product may be acquired; capture uses the body's existing `wardah_resolve_product_id(v_org, item_id, now())` semantics rather than a second parser; `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`, and the `authenticated` + `service_role` grants are unchanged; production 191 contains **no** advisory-lock gate — Mapping-drift A/B/C gates are test-only instrumentation; **no `wardah_resolve_product_id` call after capture may determine bins or availability identity**; the reservation INSERT's intended product comes from the captured line; the authoritative post-trigger product is compared exactly against that line; `ANY(prelocked_set)` is insufficient (re-asserted: these static source-shape checks and runtime Mapping-drift A/B/C are complementary, and neither replaces the other) |
| Static contract, `wardah_lock_products_for_stock_write` | still `FOR NO KEY UPDATE`, not `FOR UPDATE` — re-asserted here because Fix G adds a caller that performs FK inserts against the rows it locks, so an upgrade to `FOR UPDATE` would newly conflict with its own `material_reservations` inserts' implicit `FOR KEY SHARE` |

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

As the ninth correction above explains, cancellation-vs-cancellation cannot
be used to prove the shared helper's lock-acquisition order, in any
variant. Fix C's own array comes from "collect the distinct `product_id`s
referenced by the non-cancelled SLEs this call is about to reverse" — a
different table than `stock_adjustment_items`, gathered via an unordered
`DISTINCT`/array collection with no `ORDER BY` specified. Nothing ties SLE
scan order to item-insertion order, and nothing guarantees an unordered
`DISTINCT` collection returns a testable, controllable order at all —
trying to force it via item-insertion order (an earlier revision of this
design tried exactly that) can produce the same physical array order in
both adjustments by coincidence, in which case a mutant built on top of it
would pass GREEN without the helper's ordering ever having actually been
crossed.

The ordering proof is therefore split into two independent tests:

**1. Standalone helper-order mutant.** Call the ordering-removed
`wardah_lock_products_for_stock_write` mutant directly, as its own
test-only invocation — not through `rpc_cancel_stock_adjustment` or any
other RPC — with literal `ARRAY['<A>','<B>']` and `ARRAY['<B>','<A>']`. The
test harness supplies the crossed order itself, so there is no caller
collection step in between to lose it. The mutant is the same positional
loop verified in the eighth correction:
`FOR v_id IN SELECT u.id FROM unnest(p_product_ids) WITH ORDINALITY AS
u(id, ord) ORDER BY u.ord LOOP PERFORM 1 FROM public.products WHERE org_id =
p_org AND id = v_id FOR NO KEY UPDATE; ... END LOOP` — locks each element in
the exact order the literal array lists it, no de-duplication or re-sort.

The pause between the first and second lock must happen **inside** that
running PL/pgSQL call — a file-touch/poll rendezvous at the psql-client
level (the RED-A/RED-B mechanism, which pauses *between* a returned
`SELECT rpc(...)` and the client's next statement) cannot reach a point
mid-loop inside one function call. Use a session-level advisory-lock gate
instead, verified against a live PostgreSQL 17 instance to block exactly
where needed and to surface in `pg_stat_activity`: a third, coordinator
session takes `pg_advisory_lock(1)` and `pg_advisory_lock(2)` *before*
either mutant call starts. The mutant helper, immediately after locking its
first element, calls `PERFORM pg_advisory_lock(<its own gate id>)` — the
`ARRAY['<A>','<B>']` call uses gate `1`, the `ARRAY['<B>','<A>']` call uses
gate `2` — which blocks because the coordinator already holds it. The
coordinator polls `pg_stat_activity` for both backends showing
`wait_event_type = 'Lock'`, `wait_event = 'advisory'` (proving each has
locked its first element and reached the gate, not merely that some time
has passed), then calls `pg_advisory_unlock(1)` and `pg_advisory_unlock(2)`
from that same coordinator session (advisory locks are session-scoped: only
the session that took the lock can release it) — releasing both gates
together lets both mutant calls proceed to their second lock in the same
instant. Confirmed empirically: this reproduces a real `deadlock detected`
(`40P01`) from PostgreSQL's own detector, with both backends visibly
waiting on each other's row (`Process … waits for ShareLock on transaction
…; blocked by process …`, symmetric in both directions) immediately
beforehand. A "hang until timeout" without that live
`pg_stat_activity`/`40P01` proof is not sufficient evidence.

The GREEN (real-helper) run must **not** reuse this same gate — the real,
unmodified helper has no `pg_advisory_lock` call anywhere in its body (it is
production code, not the test mutant), so a coordinator waiting for two
`wait_event = 'advisory'` waiters would wait for one that can never appear
and simply hang forever (the tenth correction above).

It also must **not** hold both products in one blocking transaction (an
earlier revision of this design tried exactly that, per the eleventh
correction above): a transaction that already holds `A` *and* `B` blocks a
second caller regardless of which of the two that caller tries to lock
first, so `pg_blocking_pids()` against a single such blocker cannot tell a
correct helper (`A` then `B`, always) from a broken one that respects the
caller's own input order verbatim (`B` then `A`, when the input lists `B`
first) — both produce the identical observable blocking relationship.
Verified empirically: a helper mutated to lock its input array positionally
(no re-sort) was blocked by a single two-product-holding transaction exactly
as if it were the correct helper, even though its own log showed it
attempting `B`, not `A`, first.

Use two *independent* single-row blockers instead, the same primitive
RED-A/RED-B already use for genuine row-lock waiting: `blocker_A` locks only
`A` (`FOR NO KEY UPDATE`, its own transaction, held open); `blocker_B` locks
only `B`, independently and separately. This construction's "`A` first"
expectation only holds if `A`'s UUID genuinely sorts below `B`'s — the
fixture must assert that precondition explicitly (e.g. `SELECT 1 WHERE
'<A>'::uuid < '<B>'::uuid`) before running the scenario, rather than
assuming it from the labels alone (the twelfth correction above); this is a
fixture-specification gap, not an architectural one — a wrongly-ordered
pair would produce a false failure against a correct helper, not a false
pass. Transaction 2, started after both blockers are confirmed holding
their locks, calls the real helper with the literal `ARRAY['<B>','<A>']`.
Before releasing anything,
`pg_blocking_pids(<transaction 2's pid>)` must equal `{<blocker_A's pid>}`
**only** — proving transaction 2's first lock attempt landed on `A` despite
`B` being listed first in its input, which a same-input-order-respecting
helper could not produce (it would show `{<blocker_B's pid>}` instead).
Releasing `blocker_A` alone must move `pg_blocking_pids(<transaction 2's
pid>)` to `{<blocker_B's pid>}` — proving the acquisition sequence is
genuinely `A` then `B`, not merely "blocked by something on the first
check." Releasing `blocker_B` lets transaction 2 complete. Verified
empirically against a live PostgreSQL 17 instance, run both ways: the real
helper produced `{blocker_A}` then `{blocker_B}` in that order exactly as
specified; the same input-order-respecting mutant used to reproduce the
flaw produced `{blocker_B}` immediately, and releasing `blocker_A` had **no
effect** on it — confirming the two cases are now cleanly distinguishable.

**2. Cancellation-vs-cancellation real-path control.** Two `SUBMITTED`
adjustments, each with lines touching the *same* two products A and B, with
A and B on a *different* warehouse/bin per adjustment (adjustment 1's line
for product A in warehouse X, adjustment 2's line for product A in
warehouse Y, and similarly for B) — this keeps the two cancellations'
reversal `SLE` rows off each other's `(product_id, warehouse_id)` key, so
neither cancellation's own `LATER_STOCK_MOVEMENT_EXISTS` check can be
tripped by the other's reversal entries; without that separation, a run
that happens to abort one cancellation could look like a passing control
when it's actually the unrelated business-rule guard firing. Run the two
cancellations under genuine forced concurrency (an ordinary RED-A/RED-B
style rendezvous forcing real overlap is enough — there is no specific
lock-acquisition order to force or assert here) against the real,
unmodified Fix C and helper. Assert business correctness only: no deadlock
regardless of which adjustment's transaction starts first, and each
product's aggregate equals the sum of its own bins. This control does not
need an "ordering-removed" build or a pre-fix deadlock to be meaningful —
the ordering guarantee for Fix C comes entirely from the product prefix above
plus the
static contract requiring the helper call before the first `UPDATE bins`,
both of which hold regardless of what order Fix C's own array happens to be
built in.

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
> - Outgoing 8-arg and 9-arg take the same product-row lock first so
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
> - Fix F reorders `release_expired_reservations`'s locking to `ORDER BY id
>   FOR NO KEY UPDATE`, the same discipline the consumption superset lock
>   (Fix E) already applies to `material_reservations` — it has neither
>   RED-A nor RED-B and no `products`/`bins` involvement at all; this is a
>   same-table counter-ordering compatibility fix, found only once §6's edge
>   criterion was corrected to cover multi-row locks on a shared row set of
>   one table, not only table-to-table transitions.
> - Fix G adds the same shared product prefix to
>   `rpc_create_mo_with_reservation`, before its first `bins` lock — found
>   only once that same-table criterion was applied to `bins` as well as to
>   `products` and `material_reservations` (twenty-fifth correction). The
>   twenty-sixth correction requires that prefix to come from **one captured
>   resolved-demand snapshot** (no later resolver deciding bins/availability/
>   INSERT identity; exact post-trigger `RETURNING` check;
>   `ITEM_PRODUCT_MAPPING_DRIFT` on mismatch). It has neither RED-A nor
>   RED-B; it closes a multi-product `bins`↔`bins` cycle that FK
>   compatibility cannot reach. Incoming's target-bin-only footprint is
>   unchanged.
>
> This design's own review history is part of why the runbook states it this
> way: a first pass covered four functions, a second pass found a fifth after
> a systematic writer-sweep, a third pass found five more after a systematic
> *caller*-sweep the first sweep's methodology couldn't have found, a
> fourth pass found a twelfth object after the same-table counter-ordering
> criterion itself was corrected (but applied only to `material_reservations`
> and `products`), and a fifth pass (twenty-fifth correction) found a
> thirteenth object once that same criterion was finally applied to `bins`.
> State the full list and the sweep methodology that produced it, not just
> the fix, so a future reader auditing this migration can tell whether a
> sweep like this one was re-run before trusting the list is still complete.

It must also record:

- additive only; no history rewrite; no `ADJ-000001` repair
- rollback = restore the twelve previous bodies from Migrations 61
  (`release_expired_reservations`, plus its out-of-band `ALTER FUNCTION ...
  SET search_path` re-applied — that statement is not itself part of any
  numbered migration, so a rollback that only restores the Migration 61 body
  would silently drop a hardening 191 never added but must not remove
  either), 97 (incoming 9-arg), 124 (`rpc_cancel_stock_adjustment`), 133
  (`rpc_post_delivery_note`), 134 (`rpc_manual_stock_movement_v2`), 177
  (`rpc_post_goods_receipt`), 186 (outgoing 8-arg **and
  `rpc_create_mo_with_reservation`** — one file, two predecessor bodies),
  187 (incoming 10-arg,
  outgoing 9-arg, `rpc_submit_stock_adjustment`), and 190
  (`rpc_consume_reserved_materials_v2`) — nine distinct files for twelve
  functions — and drop the new `wardah_lock_products_for_stock_write`
  helper. The file count stays at nine because Fix G's predecessor comes from
  186, which the bundle already restores for outgoing 8-arg; the rollback must
  restore **both** of 186's bodies, not only the one it originally named.
  That restores every change together — RED-A, RED-B, and every
  lock-order/upfront-lock change on the other ten functions revert as one
  unit. There is no supported "roll back Fix A, keep Fix B" or "keep Fix
  C/D/E/F/G but not A/B"
- The *effective* permission on the four stock-write helpers
  (`service_role`-only) is unchanged by this migration, but 191 must still
  explicitly re-issue `REVOKE ALL ... FROM PUBLIC, anon, authenticated` +
  `GRANT EXECUTE ... TO service_role` for each of those four signatures, and
  verify with `has_function_privilege()` in postflight — per §5, this is not
  a grant change, it is re-proving an invariant that a prior `CREATE OR
  REPLACE` (97) already broke silently once. The eight other functions this
  migration touches (including `release_expired_reservations` and
  `rpc_create_mo_with_reservation`) keep their
  existing ACLs untouched (verified identical across all eight) — Fixes
  C/D/E/F remain body-only, lock-order-only; Fix G is body-only for lock
  order plus the captured-snapshot / `RETURNING` contract, still
  ACL-unchanged. **The `service_role`-only
  restatement above applies to the four stock-write helpers and to nothing
  else**: applying it to `rpc_create_mo_with_reservation` would revoke
  `authenticated` from a client-facing RPC
- Production apply requires a separate authorization, preflight (ledger
  head, all thirteen objects' signatures, ACLs on the four stock-write
  helpers **plus the exact-signature ACL/security/search_path evidence for
  `rpc_create_mo_with_reservation` required by §5**, search_path, the guarded
  `cron.job`/eligible-row informational
  checks for Fix F), apply-once, postflight (`pg_get_functiondef` contract on
  all thirteen), and **no** Production concurrency test against live vouchers
- Merging 191 onto `main` does not close the Production gap; 170 sat
  merged-but-unapplied (`PERMISSION_HARDENING_170_173_CHAIN.md` §6)

---

## 9. Implementation gate (still later; not this package)

Do not write SQL until this design is accepted. Then, in
`wardah-process-costing`, in a new tracking issue:

> **Read alongside this section:** `docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md`
> (added in [`f582669`](https://github.com/6thd/wardah-process-costing/commit/f5826697cb4789e5346825d8c1e746d91b50d1da),
> twenty-third correction above). It specifies the evidence the implementation PR
> must produce — valuation/queue integrity assertions beyond quantity-only checks,
> exact ACL/security evidence per function signature, a Fresh DB/Staging rollback
> rehearsal, throughput and lock-wait characterization, and the source-of-truth
> carry-forward matrix for all thirteen objects. Those gates are acceptance
> requirements for the implementation PR, not a second design: **this document
> remains authoritative** for lock order, function bodies, behavior preservation,
> and scope, and the companion must be corrected if it ever conflicts.

1. Open the issue (do not reopen #228 as if the proof were missing).
2. Add `sql/migrations/191_…sql` with preflight, **thirteen** replaces/additions
   (incoming 9/10-arg, outgoing 8/9-arg, `rpc_cancel_stock_adjustment`,
   `rpc_manual_stock_movement_v2`, `rpc_post_goods_receipt`,
   `rpc_post_delivery_note`, `rpc_submit_stock_adjustment`,
   `rpc_consume_reserved_materials_v2`, `release_expired_reservations` (Fix
   F, thirteenth correction), `rpc_create_mo_with_reservation` (Fix G,
   twenty-fifth correction), and the new `wardah_lock_products_for_stock_write`
   helper), explicit ACL restatement on the four stock-write helpers only
   (`REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO
   service_role` per signature — not granting anything new, but not silently
   inherited either; the other eight existing functions' ACLs are left alone,
   including `release_expired_reservations`'s current `anon`/`authenticated`/
   `service_role` grant — Fix F is lock-order only — and
   `rpc_create_mo_with_reservation`'s `authenticated` + `service_role` grant,
   which Fix G must not narrow; the new helper gets no
   client grant at all), and an in-migration postflight that asserts
   `has_function_privilege()` is `false` for `anon`/`authenticated` and
   `true` for `service_role` on the four stock-write signatures **and `true`
   for `authenticated` on `rpc_create_mo_with_reservation`'s exact
   signature**, plus a
   static lock-order assertion on each of the other eight per §7's contract
   rows. Preflight also records (not blocks on) how many rows are currently
   exposed to the pre-fix race and whether a scheduled job calls this
   function in Production, since neither is knowable from the repository
   alone:
   ```sql
   SELECT count(*) FROM material_reservations
     WHERE expires_at IS NOT NULL AND status = 'reserved';

   DO $$
   DECLARE r record;
   BEGIN
     IF to_regclass('cron.job') IS NOT NULL THEN
       FOR r IN EXECUTE
         $q$SELECT jobid, schedule, command FROM cron.job
            WHERE command ILIKE '%release_expired%'$q$
       LOOP
         RAISE NOTICE 'cron job: % % %', r.jobid, r.schedule, r.command;
       END LOOP;
     ELSE
       RAISE NOTICE 'pg_cron not installed; skipping cron.job check';
     END IF;
   END $$;
   ```
   A plain `SELECT ... FROM cron.job WHERE to_regclass('cron.job') IS NOT
   NULL AND ...` is **not** a guard — confirmed against a live PostgreSQL 17
   instance without `pg_cron`: PostgreSQL resolves the `FROM cron.job`
   relation reference before the `WHERE` clause is ever evaluated, so the
   query fails with `relation "cron.job" does not exist` regardless of the
   `to_regclass` condition. Only genuine control flow — a `DO` block that
   never reaches the dynamic `EXECUTE` unless the schema exists — actually
   skips the query (the fourteenth correction above).

   **Hard precondition: Migration 190 must already be applied and its
   invariants verified, before 191 may be applied to Production** (the
   fourteenth correction above). 191's replace of `rpc_consume_reserved_materials_v2`
   is built on top of the Migration 190 body (§5's rollback bullet already
   restores to that body) — it carries forward 190's
   `manufacturing.material_consumption.consume` permission-key guard (lines
   111–116 of the live 190 body) unconditionally. Applying 191 to a database
   still at cutoff 189 (190 unapplied — the actual state of Production as of
   this design) would deploy that guard's *code* without 190's own DML ever
   having inserted the permission-key row it checks, silently denying every
   non-org-admin caller of consumption with `MATERIAL_CONSUMPTION_PERMISSION_DENIED`
   the moment 191 lands (`has_permission()`'s org-admin override bypasses the
   key entirely — `CLAUDE.md`, "Security model", "عقد `has_permission()` الحي
   بعد 173" — but an ordinary granted role would not). 191's preflight must
   therefore assert, and refuse to proceed if any fails:
   - `190_material_consumption_authorization_boundary` appears in the
     Production migration ledger;
   - the permission row exists with the exact shape 190's own preflight
     requires: `permission_key = 'manufacturing.material_consumption.consume'`
     joined to a module named `manufacturing`, `resource = 'material_consumption'`,
     `action = 'consume'`;
   - the *current* (pre-191) body of `rpc_consume_reserved_materials_v2`
     already contains the M190 guard (`pg_get_functiondef` matched against
     the `has_permission(..., 'manufacturing.material_consumption.consume')`
     pattern) — proving 191 is replacing the M190 body, not the M189-or-earlier
     one;
   - M190's own quarantine invariants still hold: `backflush_materials` is
     still the retired, permission-gated stub (not reverted), and
     `trigger_auto_backflush` does not exist on `work_orders` — re-running
     190's own postflight checks (its file, lines ~350–390) rather than
     inventing new ones.
   This is the same "repository-first for the migration, DB-first for
   anything that depends on it" ordering `CLAUDE.md` already states
   generally, made an explicit, checked gate for this specific dependency
   rather than an assumed one — the same standard this design already holds
   itself to for its own sweeps (§9 item 3).
3. Before writing any of it, re-run **three** sweeps from this design against
   `main` at implementation time, not against this document's list: every
   direct writer of `products.stock_quantity`; every caller of
   `wardah_apply_stock_incoming`/`outgoing`; **and** the bounded multi-product
   `bins`-lock-retainer sweep in §6 (explicit plus implicit `bins` row locks,
   including post-cutoff migrations). If `main` moved between this design's
   acceptance and implementation, a further undiscovered function is not this
   design's problem to have predicted, but it is the implementation PR's
   problem to have checked for. A newly found multi-product `bins` locker that
   lacks a compatible prefix is a separate blocker, not a silent extra M191
   body.
4. Add the green acceptance script + workflow, including all the new
   controls in §6/§7 (cancellation, manual movement, and the two
   multi-line-caller-vs-multi-line-caller scenarios) with the fixtures
   specified there; leave the red proof intact. Test hygiene, non-blocking
   for this design but worth getting right at implementation: namespace the
   advisory-lock gate keys used by the §7 barriers (e.g. hash a
   script-specific string rather than bare `1`/`2`, to avoid collision with
   any other advisory lock use in the schema or test suite), and make sure
   every coordinator/mutant session that takes one is guaranteed to release
   or disconnect — session-level advisory locks (`pg_advisory_lock`, not the
   `_xact_` variant) survive a transaction `ROLLBACK`; only ending the
   session or an explicit `pg_advisory_unlock`/`pg_advisory_unlock_all()`
   releases them, so a script that aborts mid-fixture can leak a held gate
   into the next run.
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
- it omits `rpc_create_mo_with_reservation` (Fix G), or takes its shared
  product prefix anywhere **after** its first `bins` lock — the twenty-fifth
  correction reproduced the resulting crossed-`bins` cycle as a genuine
  `40P01`, and a prefix taken after the first bin lock does not serialize
  anything
- it re-runs `wardah_resolve_product_id` in the grouped bins/availability
  path or the final reservation loop so a later `item_product_map` change
  can lock uncaptured bins or insert a different product than was
  availability-checked — the twenty-sixth correction requires one captured
  snapshot to drive all three
- it treats `captured_product = ANY(v_locked_products)` as the mapping-drift
  check — set membership misses a swap among products already in the prefix
- it omits `INSERT ... RETURNING` (or equivalent post-trigger) comparison of
  exact per-line `product_id` to the captured identity, or omits the named
  fail-closed error `ITEM_PRODUCT_MAPPING_DRIFT`
- it derives Fix G's product set with a second, separately written extraction
  instead of the body's existing `wardah_resolve_product_id` semantics at
  capture time, or moves MO creation or the `material_reservations` inserts
  earlier to make the derivation convenient
- it classifies the pre-Fix-G external-bin incoming-vs-reservation
  choreography as real-M191 acceptance, or requires that choreography to run
  identically after Fix G — after Fix G the incoming `FOR UPDATE` mutant
  blocks at the product, so the old PID assertion can pass on the wrong edge
- it requires a `40P01` from the real-M191 lock-mode probe — that probe's
  discriminator is KEY SHARE compatibility versus blocking, not deadlock
- it omits mapping-drift acceptance A/B/C, especially C (swap among
  already-prelocked products)
- Mapping-drift A places the remap by sleep or timing inference, or remaps
  before observing the test-only gate wait (`wait_event_type = 'Lock'` and
  `pg_blocking_pids(reservation_pid) = {gate_holder_pid}`) — without that
  hold, the twenty-sixth window is not a window
- Mapping-drift B or C places the remap by sleep or timing inference, or
  remaps before observing `K_B` / `K_C` with the same
  `wait_event_type = 'Lock'` and
  `pg_blocking_pids(reservation_pid) = {gate_holder_pid}` requirement —
  "start updater around this time" is not acceptance
- Mapping-drift A, B, or C ships an advisory gate in production Migration
  191 — `K`, `K_B`, and `K_C` are test-only instrumentation, identical in
  discipline to the eighth-correction mutants, and must be absent from the
  production body
- Mapping-drift A treats `pg_blocking_pids(reservation_pid) =
  {blocker_Y_pid}` as success, or omits `blocker_X`/`blocker_Y` — blocking
  on `Y` means a later `wardah_resolve_product_id` chose the remapped
  product; the row must **fail** that case
- Mapping-drift B treats a committed INSERT of post-trigger `Y`, an ignored
  mismatch, or a reservation-only undo that leaves the MO persisted as
  success — whole-RPC rollback is required (`ITEM_PRODUCT_MAPPING_DRIFT`,
  no surviving MO, no surviving reservation)
- Mapping-drift C performs the X/Y swap with two direct `product_id`
  UPDATEs that would violate `uq_item_product_map_current_item` /
  `uq_item_product_map_current_product`, or omits proof that the legal
  mapper COMMIT finished while the candidate was still gated at `K_C`
- Mapping-drift A, B, or C is offered as a substitute for the static
  source-shape checks (no later resolver decides bins/availability
  identity; captured line is the intended INSERT product; exact
  post-trigger comparison; `ANY(prelocked_set)` is insufficient), or those
  static checks are offered as a substitute for the runtime gates — they
  are complementary
- it applies the four stock-write helpers' `service_role`-only ACL form to
  `rpc_create_mo_with_reservation` — that RPC is client-facing and must keep
  `authenticated`; narrowing it breaks every caller
- it offers the **single-product** reservation-vs-incoming control, or the
  **ascending-order** `[A,B]` vs `[A,B]` control, as evidence that Fix G
  works — both pass unchanged against the defective body, measured, not
  assumed
- it offers a timing-only or sleep-driven version of the multi-product
  reservation controls — the RED must be established through observed blocker
  PIDs, or it proves nothing about lock order
- it cites the passing GREEN runs as proof that no unrelated cycle exists
  anywhere in the lock graph; they establish only that the demonstrated
  crossed-`bins` cycle is removed and that the FK conflict is not reopened
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
  relies on "reversed line/traversal order" at any caller's level (including
  `rpc_cancel_stock_adjustment`/Fix C) instead of an explicit, standalone
  helper-order mutant invoked directly with literal opposite arrays — since
  Fix C (and Fix E) resolve the complete product set and call the helper
  once before any per-line work, caller-side ordering never reaches the
  helper's own locking query, so this cannot actually prove anything about
  lock acquisition order (the seventh correction above; this is the exact
  Codex finding on `64fdc35`)
- the standalone helper-order mutant's crossed input arrays are derived from
  a real RPC's own collection step (e.g. "insert `stock_adjustment_items` A
  then B" to try to control `rpc_cancel_stock_adjustment`'s array order)
  instead of literal, test-supplied arrays passed directly to the helper —
  Fix C's actual source is an unordered `DISTINCT` collection over the SLEs
  being reversed, a different table than `stock_adjustment_items`, with no
  `ORDER BY` specified anywhere in this design; nothing ties one to the
  other, so both calls could produce the same physical array order by
  coincidence and the mutant would pass GREEN without the helper's ordering
  ever having been genuinely crossed (the ninth correction above)
- the cancellation-vs-cancellation control is run against an
  "ordering-removed" build, or is expected to reproduce a pre-fix deadlock,
  instead of being a real-path business-correctness check against the real,
  unmodified Fix C and helper — the ordering guarantee for any caller of the
  shared helper, Fix C included, comes from the standalone helper-order
  mutant plus the static contract requiring `ORDER BY id` in the locking
  query, neither of which depends on that caller's own array order (the
  ninth correction above)
- the standalone helper-order mutant's GREEN (real-helper) run reuses the
  RED run's advisory-lock gate barrier instead of plain row-lock waiting —
  the real, unmodified helper has no `pg_advisory_lock` call in its body for
  a coordinator to detect, so a barrier built around it hangs waiting for a
  gate signal that never appears (the tenth correction above)
- the standalone helper-order mutant's GREEN (real-helper) run holds both
  products in a single blocking transaction and treats
  `pg_blocking_pids(<the caller under test>) = {<that one blocker>}` as proof
  of acquisition order — it isn't: a transaction holding both `A` and `B`
  blocks a second caller regardless of which product that caller tries to
  lock first, so this cannot distinguish the real, correctly-ordered helper
  from one that respects the caller's own (wrong) input order verbatim; use
  two *independent* single-product blockers instead, and require the
  blocked-pid to change from `{blocker_A}` to `{blocker_B}` specifically
  when `blocker_A` alone is released, not merely that some blocking exists
  (the eleventh correction above)
- the standalone helper-order mutant's GREEN fixture assumes `A` sorts below
  `B` by convention/labeling alone, without an explicit precondition assert
  (e.g. `SELECT 1 WHERE '<A>'::uuid < '<B>'::uuid`) or a documented literal
  UUID pair known to sort that way — a wrongly-ordered pair produces a false
  failure against a correct helper (the twelfth correction above)
- the static contract for `wardah_lock_products_for_stock_write` checks only
  that dedup/normalization is sorted (`ARRAY(SELECT DISTINCT ... ORDER BY
  ...)`) without also asserting `ORDER BY` on `id` in the query that carries
  `FOR NO KEY UPDATE` itself — a helper can satisfy the former and still lock
  rows in scan order, not id order, which is the property the whole
  deadlock-avoidance argument in §6/§7 actually depends on
- the standalone helper-order mutant or the consumption guard mutant-2
  "forced concurrency" fixture describes a pause between a mutant
  transaction's first and second lock as a "signal"/"rendezvous" with no
  concrete primitive, or reuses the RED-A/RED-B file-touch/poll rendezvous —
  that mechanism pauses *between* a returned `SELECT rpc(...)` and the
  client's next statement and cannot reach a point *inside* one running
  PL/pgSQL call; the pause must be an in-function session-level advisory-lock
  gate (`pg_advisory_lock`, held by a third coordinator session, released
  from that same session only after `pg_stat_activity` confirms both
  backends are waiting on it) — the eighth correction above verified this
  empirically against a live PostgreSQL 17 instance
- consumption guard mutant 2 uses a superset that already covers the
  complete product set (e.g. both MOs' narrowed prelocks contain `{A, B}`,
  just fed in opposite array order to a mutated ordering-helper) — removing
  `PRODUCT_NOT_PRELOCKED` is then irrelevant to any deadlock that follows,
  since the guard only fires on a product outside the locked set; this
  re-tests helper ordering under the guard mutant's name instead of guard
  completeness. The fixture must make each MO's superset genuinely narrower
  than what its own loop will need (MO 1 locks only `{A}` but its loop later
  needs `B`; MO 2 locks only `{B}` but needs `A`), using the real, unmodified
  helper — no positional-loop mutation belongs in this mutant at all
- §6's "edge" criterion for the lock graph checks only table-to-table
  lock-order reversal, without also checking a multi-row lock on a shared row
  set of the *same* table taken in a different order — this is exactly how
  `release_expired_reservations` was missed the first time (the thirteenth
  correction above); re-verify the corrected, broader criterion at
  implementation time, not only re-run the narrower one
- it ships the consumption superset lock on `material_reservations` (Fix E)
  without also bringing `release_expired_reservations` under the same
  ordered/`FOR NO KEY UPDATE` discipline (Fix F) — this reintroduces exactly
  the same-table counter-ordering deadlock Fix F exists to close, just on
  `material_reservations` instead of `products`
- Fix F or the consumption superset lock uses a bare `FOR UPDATE` on
  `material_reservations` instead of `FOR NO KEY UPDATE` — `material_consumption
  .reservation_id`'s FK to `material_reservations(id)` makes this the same
  lock-mode error a fourth review pass already found on `products`
- Fix F adds `FOR UPDATE SKIP LOCKED` (or any skip-locked variant) without
  explicitly relabeling it as a best-effort semantic change with its own
  retry/next-run acceptance criteria — the primary design is blocking,
  complete-sweep `ORDER BY id FOR NO KEY UPDATE`, matching the "lock-order
  only, no business-behavior change" standard already held for Fix C/D
- Fix F's GREEN/RED acceptance relies on `expires_at` index or heap scan
  order to force the counter-ordering condition instead of an explicit,
  literal-order test-only mutant with an advisory-lock gate (the same
  standard the tenth/eleventh corrections already established for the
  `products` standalone helper-order mutant) — a planner-dependent fixture
  can pass GREEN without the ordering fix ever being exercised
- Fix F wraps `quantity_released = quantity_reserved - quantity_consumed` in
  `COALESCE(quantity_consumed, 0)` or otherwise changes its `NULL`-propagation
  behavior — that is a data-semantics tightening independent of lock
  ordering and does not belong bundled into 191 (the thirteenth correction's
  point 3); it is a separate, explicitly named follow-up
- Fix F's preflight queries `cron.job` without guarding on
  `to_regclass('cron.job') IS NOT NULL` — this fails the whole preflight on
  any environment without `pg_cron` installed, for a check that is
  informational, not a gate
- the residual multi-row client-write risk on `products`/`material_reservations`
  is described only as a retryable `40P01` footnote instead of being recorded
  as an F1/write-surface-audit input — a direct client `PATCH` never goes
  through an RPC's atomicity guarantee at all, so "safe to retry" understates
  what is actually open here
- the `cron.job` preflight check is a plain `SELECT ... FROM cron.job WHERE
  to_regclass('cron.job') IS NOT NULL AND ...` instead of a `DO $$ ... $$`
  block that only reaches a dynamic `EXECUTE` of the `cron.job` query when
  the schema exists — PostgreSQL resolves the `FROM` clause before
  evaluating `WHERE`, so the former still fails outright on any environment
  without `pg_cron` installed (confirmed empirically; the fourteenth
  correction above)
- 191 is applied to Production, or its preflight omits asserting, without
  first confirming Migration 190 (`190_material_consumption_authorization_boundary`)
  is already in the Production ledger, its permission row exists with the
  exact shape 190's own preflight requires, the current
  `rpc_consume_reserved_materials_v2` body already contains the M190
  permission guard, and M190's quarantine postflight invariants
  (`backflush_materials` retired, `trigger_auto_backflush` absent) still
  hold — 191 silently carries the M190 guard's code regardless, and applying
  it to a database still at cutoff 189 would deny every non-org-admin
  consumption caller the moment 191 lands (the fourteenth correction above)
- any claim that `rpc_consume_reserved_materials_v2` is "the only writer of
  `material_consumption`" without qualifying "that populates
  `reservation_id`" — `mesService.consumeMaterial()` is a second, direct
  client-insert path Migration 190 deliberately left in place (the
  fourteenth correction above)
- `rpc_consume_reserved_materials_v2`'s per-line reservation lock (either
  the `reservation_id` branch or the `item_id`-derived branch) is left as a
  bare `FOR UPDATE`, on the reasoning that it "re-acquires" the superset
  lock's `FOR NO KEY UPDATE` as a no-op — a lock-mode *upgrade* is evaluated
  against every other transaction's currently-held locks at the moment it is
  requested, not only against what the same transaction already holds, and
  `FOR UPDATE` conflicts with `FOR KEY SHARE` where `FOR NO KEY UPDATE` does
  not; confirmed empirically that this upgrade genuinely blocks against a
  concurrent `FOR KEY SHARE` holder (the fifteenth correction above) — both
  branches must be `FOR NO KEY UPDATE`
- the per-line reservation lock-mode mutant's `FOR KEY SHARE` blocker is
  built via a real `INSERT INTO material_consumption` instead of a
  reservation-only `SELECT ... FOR KEY SHARE` — the `INSERT`'s own FK set
  (`work_order_id`, `mo_id`, `product_id`, `reservation_id`, `stage_id`)
  takes implicit `FOR KEY SHARE` on all of them at once, and since
  consumption's own first statement locks `manufacturing_orders FOR UPDATE`,
  a blocker referencing the same MO can make the consumption backend block
  on the *MO* lock before it ever reaches the reservation lock this mutant
  exists to test — real blocking, attributed to the wrong resource (the
  sixteenth correction above); the blocker must be isolated to the
  reservation row alone, and the assertion must check the exact blocking
  pid via `pg_blocking_pids()`, not merely that some lock wait occurred
- the per-line reservation lock-mode mutant's GREEN run treats a
  `pg_blocking_pids() = {}` snapshot as sufficient proof the per-line lock
  statement was reached and did not conflict — an empty result is equally
  consistent with the harness sampling before the backend ever got there;
  the GREEN run must instead hold the reservation-only blocker open for the
  entire call and require the consumption RPC to return successfully, with
  its expected business side effect visible, before the blocker is released
  — completion observed while the conflicting lock is still held is
  race-free proof; a point-in-time snapshot is not (the seventeenth
  correction above)
- the "Fix E omitted" multi-line-caller RED fixture or the "incoming vs
  `rpc_create_mo_with_reservation`" mutant is described as "start both
  concurrently, must deadlock" with no forcing mechanism — nothing prevents
  one side from completing, or from acquiring its second lock, before the
  other side reaches its first; both must instead use an external, test-only
  blocker on the second-needed shared resource, with the exact queue order
  proven via `pg_blocking_pids()` before releasing it — no instrumentation
  of either real function is needed, but a bare concurrent start is not
  sufficient (the eighteenth correction above)
- either of those two fixtures invokes an unqualified "documented FIFO
  ordering" instead of stating the exact `pg_blocking_pids()` value each
  waiter must show before the blocker is released, or assumes the
  second-arriving waiter's blocking set is transitive (`{blocker,
  first-arriving waiter}`) — verified empirically that it is not: PostgreSQL
  row-level locking is two-staged, so the second waiter blocks directly on
  the first waiter's held tuple lock (`{first-arriving waiter}` alone), not
  on the original holder; the fixture must assert this specific value, not
  a general ordering claim or an assumed transitive set (the nineteenth
  correction above)
- the Fix F real-helper GREEN run asserts "consumption proceeds normally" as
  the only correct outcome — if `release_expired_reservations` locks and
  commits the shared reservation first, consumption's own `status =
  'reserved'` lookup correctly finds nothing and fails atomically with
  `ACTIVE_RESERVATION_NOT_FOUND`; both orderings are correct and must both be
  exercised, not only the one where consumption wins the race (the
  eighteenth correction above)
- the multi-line-caller RED fixture's external product-B blocker takes a
  bare `FOR UPDATE` instead of `FOR NO KEY UPDATE` — `rpc_post_goods_receipt`
  does `INSERT INTO goods_receipt_lines` (FK to `products`, implicit `FOR
  KEY SHARE`) before calling `wardah_apply_stock_incoming` for that line, so
  a `FOR UPDATE` blocker can stop the call at that `INSERT`, before it ever
  reaches the helper-lock edge the mutant exists to test — the same
  false-attribution shape the sixteenth correction already fixed for
  `material_reservations`, recurring here (the twentieth correction above)
- `rpc_post_delivery_note`'s Fix E caches the upfront `sales_invoice_lines`
  prelock read and reuses it in the per-line loop instead of leaving the
  loop's own fresh `SELECT ... FOR UPDATE` (`delivered_quantity`,
  `unit_cost_at_sale`) untouched — the live body's cumulative
  weighted-average COGS and running `delivered_quantity` depend on each
  occurrence of a repeated `sales_invoice_line_id` seeing the *previous*
  occurrence's update within the same transaction; caching the prelock read
  makes every occurrence compute against the same stale base, silently
  under-recording delivered quantity, corrupting the weighted-average cost,
  and defeating `OVER_DELIVERY` for exactly the payload shape it exists to
  catch — a real business-behavior change, which Fix E must never be (the
  twenty-first correction above). The upfront lock supplies only `product_id`
  for the lock set; it must not replace anything else the loop reads
- `rpc_post_goods_receipt`'s or `rpc_post_delivery_note`'s Fix E pre-pass can
  raise a helper-level error (`PRODUCT_NOT_FOUND_OR_WRONG_ORG`,
  `INVALID_INVOICE_LINE`) for a later line before the loop's own unchanged,
  sequential validation reaches an earlier line's own error — confirmed
  against the live Migration 177 body, which decides `GR_LINE_OBJECT_REQUIRED`
  / `ITEM_NOT_FOUND` / `INVALID_QUALITY_STATUS` strictly in per-line order;
  the pre-pass must only extract non-throwing, silently-excludable candidates
  and never decide or preempt an error the loop itself owns (the
  twenty-second correction above)
- either Fix E pre-pass casts every payload line's id to `uuid` in one query
  (`SELECT DISTINCT (value->>'product_id')::uuid FROM jsonb_array_elements(...)`,
  or `ANY(ARRAY(...::uuid...))`) — the **eager, unguarded** form, confirmed
  empirically to raise a raw
  `invalid input syntax for type uuid` for a malformed
  later line before the loop ever runs, ahead of an earlier line's own
  validation error. The non-throwing, `CASE`-guarded shape is what replaced it
  (the twenty-second correction above, whose empirically tested guard was a
  canonical `8-4-4-4-12` regex — superseded, but its reject applies to the
  eager cast, which remains rejected on exactly these grounds)
- either Fix E pre-pass guards the cast with a hand-written UUID regex or shape
  test **narrower than PostgreSQL's own UUID parser** — including the canonical
  `8-4-4-4-12` regex the twenty-second correction originally specified — instead
  of `pg_input_is_valid(..., 'uuid')` with the cast confined to the matching
  `CASE` branch. This is a *different* defect from the eager cast above and must
  not be attributed to the twenty-second correction: the narrow guard does not
  throw, so every ordering test still passes, and it fails silently instead — a
  brace-wrapped or 32-hex hyphenless id that the unchanged loop's `::uuid` cast
  resolves is omitted from the locked set, after which the loop resolves the
  product and hits the fail-closed `PRODUCT_NOT_PRELOCKED` guard on a request
  that succeeds today. Both accepted non-canonical spellings must be covered
  against both pre-passes (the twenty-fourth correction above). Note the
  converse is equally rejected: a gate asserting the *absence* of a canonical
  regex must be scoped to the live §4 specifications and the implemented
  function bodies — never run across this whole document, whose historical
  correction text legitimately preserves the superseded regex as evidence
- it broadens incoming, cancellation, manual movement, or any Fix E caller to
  lock all bins merely to satisfy a shared prose contract. Only outgoing retains
  its existing ordered all-bins scan; every other object keeps the
  function-specific bin footprint stated in §4 unless an independent behavior
  and performance change is justified and reviewed separately (the twenty-fourth
  correction above: the universal invariant is the product prefix, and the bin
  footprint is function-specific)
- `rpc_post_delivery_note`'s corrected pre-pass combines `DISTINCT` with a
  locking clause in the same query (`SELECT DISTINCT sil.product_id ... FOR
  UPDATE OF sil`) — PostgreSQL rejects this outright ("FOR UPDATE is not
  allowed with DISTINCT clause", confirmed against a live PostgreSQL 17
  instance — the exact restriction this design already hit once for
  `rpc_submit_stock_adjustment`'s pre-pass); `DISTINCT` must be applied in an
  outer query over the already-locked rows an inner, unlocked-`DISTINCT`
  query produces (the twenty-second correction above)
