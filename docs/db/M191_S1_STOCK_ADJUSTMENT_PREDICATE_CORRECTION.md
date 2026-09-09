# M191 S1 Design Correction — Stock Adjustment Predicate Expansion

Status: authoritative correction addendum for PR #241 implementation review.
Scope: `rpc_submit_stock_adjustment(uuid)` / Fix E only.
No SQL or Production/Staging change is authorized by this note.

## Correction

The current wording in `docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md` overstates the
stability of the `stock_adjustment_items` set selected by
`adjustment_id = v_adj.id`.

The incorrect claim is that locking the existing matching rows up front makes
the row set structurally fixed for the rest of the call. Under PostgreSQL
READ COMMITTED, `SELECT ... FOR UPDATE` locks rows that currently satisfy the
predicate; it does not predicate-lock that condition against a concurrent
`INSERT` of another row with the same `adjustment_id`.

Therefore the M191 contract for this caller is narrower:

1. The pre-pass freezes the identities and mutable product/warehouse fields of
   the `stock_adjustment_items` rows that already exist when the pre-pass runs.
2. A concurrent UPDATE of those rows is blocked behind the pre-pass locks.
3. The predicate `adjustment_id = v_adj.id` remains insert-expandable.
4. A later inserted row whose product is outside the already-prelocked product
   set is caught by the uniform `PRODUCT_NOT_PRELOCKED` guard and the submission
   fails closed.
5. A later inserted row whose product is already in the prelocked set can still
   be visible to the later M187 count/loop snapshots and can therefore expose the
   pre-existing M187 document-membership race, including a same-product / same-
   warehouse duplicate inserted after the duplicate-count validation.

This residual is not introduced by Slice 07. The live M187 body already
re-queries `stock_adjustment_items` for validation and again for processing,
so membership can expand between those statements. Slice 07 narrows the risk
by freezing existing rows and adding a fail-closed product-set guard; it does
not freeze predicate membership.

## M191 decision

Do not change Slice 07 SQL solely to claim full document-membership freezing.
In particular, do not derive only the count/duplicate validation from the
upfront locked-row snapshot while leaving the existing loop as a fresh table
query: that would make validation intentionally older than processing.

A complete document-membership fix requires one consistent semantic choice
across validation and processing, such as freezing an exact item-id set and
processing only that set, or otherwise preventing item insertion once
submission begins. That is a separate M187 workflow/write-boundary decision,
not a lock-order-only Fix E change, and is outside M191 unless explicitly
re-scoped.

## Acceptance consequences

The final M191 acceptance suite must include both facts:

- natural concurrent INSERT with a new product outside the prefix ->
  `PRODUCT_NOT_PRELOCKED`, full rollback;
- natural concurrent INSERT with an already-prelocked product -> documented
  M187 residual; M191 must not claim this predicate is frozen or that the
  duplicate-count invariant is closed against this timing window.

For GR and Delivery Note, `PRODUCT_NOT_PRELOCKED` still requires a deliberate
mutant/fixture to become reachable. Stock Adjustment is different: concurrent
predicate expansion supplies a natural real-path trigger for the guard.

## Related carried items

- Standalone `parse_plpgsql` is not a required gate for catalog-dependent
  `%rowtype` bodies; actual `CREATE FUNCTION` / Fresh DB execution is the
  authoritative executable gate.
- PostgreSQL >= 16 applies to the GR/DN pre-passes using
  `pg_input_is_valid`; Slice 07 adds no such dependency.
- The broad `stock_adjustment_items` table grant / latent anon privilege is a
  separate write-surface hardening concern, not part of M191.
- The Fix D §7 wording mismatch remains to be corrected before final static
  acceptance work.

Before M191 execution item 11, reconcile the corresponding paragraph in
`docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md` to this addendum so there is one final
canonical wording rather than two competing descriptions.
