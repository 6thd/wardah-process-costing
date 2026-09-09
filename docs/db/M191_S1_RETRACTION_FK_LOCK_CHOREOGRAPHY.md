# M191 — S1 retraction: phantom INSERT is already blocked, by the header lock

**Status:** retracts the operative conclusion of
`docs/db/M191_S1_STOCK_ADJUSTMENT_PREDICATE_CORRECTION.md` and replaces the
planned C2 generalization. Raised by the same independent review that raised
S1, after the FK choreography was actually tested rather than assumed.

## 1. What was wrong

S1 concluded that, because `FOR UPDATE` freezes rows rather than a predicate, a
concurrent `INSERT` into `stock_adjustment_items` could land after
`rpc_submit_stock_adjustment`'s pre-pass and be processed by the loop —
bypassing `DUPLICATE_PRODUCT_WAREHOUSE_LINES` and producing two ledger rows for
one product/warehouse pair. That was demonstrated on a test fixture.

**The fixture was wrong.** It created `stock_adjustment_items` without its
foreign key to `stock_adjustments`. The live schema has one:

```
stock_adjustment_items_adjustment_id_fkey
  FOREIGN KEY (adjustment_id) REFERENCES public.stock_adjustments(id) ON DELETE CASCADE
```

An `INSERT` into the child takes an implicit `FOR KEY SHARE` on the parent row.
`rpc_submit_stock_adjustment`'s first statement holds that parent row
`FOR UPDATE`, and `FOR UPDATE` conflicts with `FOR KEY SHARE`. The phantom
`INSERT` therefore blocks for the whole call.

Re-tested with the foreign key present:

| scenario | result |
|---|---|
| parent held `FOR UPDATE`, child `INSERT` | **blocked** (lock timeout) |
| parent held `FOR NO KEY UPDATE`, child `INSERT` | succeeds |
| `stock_adjustments` held `FOR UPDATE`, `stock_adjustment_items` INSERT | **blocked** |
| `manufacturing_orders` held `FOR UPDATE`, `material_reservations` INSERT | **blocked** |

So the duplicate-check bypass S1 described **cannot occur**, in either
predicate-bounded function.

## 2. What survives

The mechanical statement is still true and still worth keeping: a row lock
freezes the rows it matched, not the predicate that matched them. What S1 got
wrong was the consequence — it treated the pre-pass row locks as the only thing
standing between the loop and a phantom row, when the header lock taken several
statements earlier already excludes one.

The correct rule, replacing the planned payload-bounded / predicate-bounded
split:

- **Payload-bounded pre-passes** (`rpc_post_goods_receipt`,
  `rpc_post_delivery_note`): membership is fixed by the call's own argument.
  Nothing can enter the set.
- **Predicate-bounded pre-passes** (`rpc_submit_stock_adjustment`,
  `rpc_consume_reserved_materials_v2`): membership is fixed by the parent
  header row being held `FOR UPDATE` plus the child's foreign key to it. Row
  locks alone would not be enough; the header lock is what closes it.

Both categories are sound. Neither may be described as sound *because the
pre-pass locked the rows* — for the second category that is not the reason.

## 3. The dependency this creates, and why it matters for M191 specifically

The second category holds only while **both** of these remain true:

1. the function holds the parent header `FOR UPDATE` — not
   `FOR NO KEY UPDATE`;
2. the child table keeps its foreign key to that header.

Point 1 is a live hazard in this migration. M191 is systematically converting
`FOR UPDATE` to `FOR NO KEY UPDATE` — correctly, for `products` and for
`material_reservations`, where the goal is to stop conflicting with FK-driven
`FOR KEY SHARE` locks. The header locks on `stock_adjustments` and
`manufacturing_orders` must **not** be converted the same way: there, the
conflict with `FOR KEY SHARE` is exactly the mechanism that excludes phantom
child rows. The table above shows the difference directly — the same `INSERT`
that blocks under `FOR UPDATE` succeeds under `FOR NO KEY UPDATE`.

This belongs in §9's reject-list: **a build that weakens
`stock_adjustments ... FOR UPDATE` or `manufacturing_orders ... FOR UPDATE` to
`FOR NO KEY UPDATE` reopens the phantom-insert window that these two functions
depend on being closed**, even though every other `FOR UPDATE` → `FOR NO KEY
UPDATE` change in M191 is correct.

## 4. Disposition

- `M191_S1_STOCK_ADJUSTMENT_PREDICATE_CORRECTION.md` should be superseded by
  this file rather than merged into the design as written; its ban on claiming
  closure of the same-product concurrent INSERT no longer reflects the schema.
- No code change follows from this retraction. Slice 07 is unchanged and
  remains correct.
- The acceptance suite should carry the four-row table in §1 as evidence, so
  the dependency in §3 is checked rather than assumed.
