# M191 S1 — Predicate-bounded pre-passes: corrected finding and the invariant it creates

Status: authoritative note for PR #241 implementation review. **This file
replaces, in place, the earlier S1 addendum of the same name**, whose operative
conclusion was wrong. Nothing else refers to a separate retraction document —
this is the single source of truth for the topic.
Scope: `rpc_submit_stock_adjustment(uuid)` and
`rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` — the two Fix E callers
whose pre-pass is bounded by a predicate rather than by the call's own payload.
No SQL or Production/Staging change is authorized by this note.

## 1. What the earlier version of this file claimed, and why it was wrong

It claimed that because `SELECT ... FOR UPDATE` locks the rows that currently
satisfy a predicate rather than predicate-locking the condition itself, a
concurrent `INSERT` of another `stock_adjustment_items` row with the same
`adjustment_id` could land after the pre-pass, be picked up by the unchanged
loop, and bypass `DUPLICATE_PRODUCT_WAREHOUSE_LINES` — producing two ledger
rows for one product/warehouse pair in a single adjustment. That was
demonstrated on a test fixture.

**The fixture was wrong.** It created `stock_adjustment_items` without its
foreign key to `stock_adjustments`. The live schema has one:

```
stock_adjustment_items_adjustment_id_fkey
  FOREIGN KEY (adjustment_id) REFERENCES public.stock_adjustments(id) ON DELETE CASCADE
```

An `INSERT` into the child takes an implicit `FOR KEY SHARE` on the referenced
parent row. `rpc_submit_stock_adjustment` holds that parent row `FOR UPDATE`
from its first statement, and `FOR UPDATE` conflicts with `FOR KEY SHARE`. The
phantom `INSERT` therefore blocks for the duration of the call, and the bypass
cannot occur.

Re-tested on PostgreSQL 16.13 with the foreign key present:

| scenario | result |
|---|---|
| parent held `FOR UPDATE`, child `INSERT` | **blocked** (lock timeout) |
| parent held `FOR NO KEY UPDATE`, child `INSERT` | succeeds |
| `stock_adjustments` held `FOR UPDATE`, `stock_adjustment_items` `INSERT` | **blocked** |
| `manufacturing_orders` held `FOR UPDATE`, `material_reservations` `INSERT` | **blocked** |

## 2. What survives

The mechanical statement remains true and worth keeping: a row lock freezes the
rows it matched, not the predicate that matched them. What the earlier version
got wrong was the consequence — it treated the pre-pass row locks as the only
thing standing between the loop and a phantom row, when the header lock taken
several statements earlier already excludes one.

The corrected rule, which replaces the planned "payload-bounded vs
predicate-bounded means safe vs unsafe" split:

- **Payload-bounded pre-passes** (`rpc_post_goods_receipt`,
  `rpc_post_delivery_note`): membership is fixed by the call's own argument.
  Nothing can enter the set.
- **Predicate-bounded pre-passes** (`rpc_submit_stock_adjustment`,
  `rpc_consume_reserved_materials_v2`): membership is fixed by the parent
  header row being held `FOR UPDATE` **plus** the child's foreign key to that
  header. Row locks alone would not be enough; the header lock is what closes
  it.

Both categories are sound. Neither may be described as sound *because the
pre-pass locked the rows* — for the second category that is not the reason, and
an acceptance step that asserts it for that reason is asserting the wrong thing.

## 3. Reject-list invariant (new)

> **Do not weaken the document-header locks from `FOR UPDATE` to
> `FOR NO KEY UPDATE` in `rpc_submit_stock_adjustment` or
> `rpc_consume_reserved_materials_v2`.**
> There, the conflict between `FOR UPDATE` and the FK-driven `FOR KEY SHARE` is
> deliberate and required: it is what prevents phantom child `INSERT`s while the
> adjustment is being submitted or the consumption posted.

This is the opposite of the choice M191 makes everywhere else, and that is the
point. On `products` and on `material_reservations` the migration deliberately
moves to `FOR NO KEY UPDATE` precisely to stop conflicting with FK-driven
`FOR KEY SHARE` locks. On `stock_adjustments` and `manufacturing_orders` that
same conflict is the mechanism being relied on. A future contributor applying
the migration's general rule uniformly would reopen the phantom-insert window
on exactly these two functions; row 2 of the table in §1 shows the regression
directly.

The invariant depends on two facts, both of which an acceptance step should
check rather than assume:

1. the function still holds its parent header `FOR UPDATE`;
2. `stock_adjustment_items.adjustment_id` and `material_reservations.mo_id`
   still carry their foreign keys to that header.

## 4. Disposition

- No code change follows from this correction. Slice 07 is unchanged and
  remains correct as written.
- The §9 reject-list entry in `docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md` still has
  to be added when the parallel notes are unified into the design proper; until
  then §3 above is the authoritative wording.
- The four-row table in §1 should be carried into the acceptance evidence, so
  the dependency in §3 is verified rather than assumed.
