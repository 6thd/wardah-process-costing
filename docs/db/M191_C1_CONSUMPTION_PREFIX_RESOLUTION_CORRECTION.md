# M191 — C1: the consumption prefix must resolve without raising

**Status:** correction to `docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md` §4 (Fix E,
`rpc_consume_reserved_materials_v2`) and to slice
`docs/db/m191-slices/08_consume_reserved_materials_fix_e.sql`.
Found by independent review; every claim below was reproduced on a live
PostgreSQL 16.13 instance with a positive control.

## 1. The defect

§4's reject-list requires the consumption superset to derive its product set
"using the identical `COALESCE(...)` expression the loop uses". Read literally
— and the first implementation did read it literally — that means calling
`public.wardah_resolve_product_id(v_org, item_id, now())` inside the superset.

`wardah_resolve_product_id` (Migration 132) **never returns `NULL`**. Its
contract is:

1. active, time-valid `item_product_map` row, newest `valid_from` first;
2. otherwise a same-org compatibility product where `products.id = item_id`;
3. otherwise `RAISE EXCEPTION 'ITEM_PRODUCT_MAP_MISSING'`.

The superset deliberately covers **every** `reserved` row of the MO, including
reservations the caller never named. So a single unrelated reservation with
`product_id IS NULL` and an unresolvable `item_id` aborted **every** consumption
call for that manufacturing order — and did so from the superset, before any
per-line validation, so `ACTIVE_RESERVATION_NOT_FOUND` and the rest of
Migration 190's error order became unreachable.

`material_reservations.product_id` is nullable and item-only resolution is an
explicitly supported case, so this is ordinary data, not a corrupt edge case.

Reproduced, with the control:

| fixture | result |
|---|---|
| unrelated `reserved` row, `product_id IS NULL`, unresolvable `item_id`; caller names a healthy reservation | `ERROR: ITEM_PRODUCT_MAP_MISSING` raised at the superset |
| identical call, that row absent | succeeds |

Note the asymmetry this creates with the rest of Fix E: the goods-receipt
pre-pass is built around `pg_input_is_valid` precisely so that it **cannot**
raise and cannot reorder the loop's errors. The consumption superset had the
opposite property.

## 2. The correction

The superset stays exactly as wide as before — every `material_reservations`
row for the MO, every status, `ORDER BY id FOR NO KEY UPDATE`, locked before
anything else. It is **not** narrowed; the narrowing mutant is what §7's guard
fixture exists to reject.

What changes is only how the prefix resolves a `reserved` row whose
`product_id` is `NULL`. Instead of calling the raising resolver, the superset
mirrors Migration 132's own two lookups, in its order and with its predicates,
and contributes nothing when neither matches:

```sql
SELECT m.product_id INTO v_prefix_product
FROM public.item_product_map m
WHERE m.org_id = v_org AND m.item_id = v_lock_res.item_id AND m.is_active
  AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now())
ORDER BY m.valid_from DESC
LIMIT 1;

IF NOT FOUND THEN
  SELECT p.id INTO v_prefix_product
  FROM public.products p
  WHERE p.id = v_lock_res.item_id AND p.org_id = v_org;
END IF;

IF FOUND THEN
  v_products := array_append(v_products, v_prefix_product);
END IF;
```

`EXCEPTION WHEN OTHERS` was rejected as the alternative: it would also swallow
`ITEM_PRODUCT_CONTEXT_REQUIRED` and any unrelated failure.

The per-line loop is left exactly as Migration 190 wrote it —
`COALESCE(v_res.product_id, wardah_resolve_product_id(...))` — so the resolver
still raises `ITEM_PRODUCT_MAP_MISSING`, at its original call site, in its
original position relative to every other per-line error.

A mapping that appears **after** the prefix is taken leaves the newly resolvable
product outside the locked set, and the per-line guard raises
`PRODUCT_NOT_PRELOCKED`. That is deliberate and consistent with the M191
concurrency contract: fail closed rather than admit a product with no prefix.

## 3. Verification

Against the corrected slice:

| check | result |
|---|---|
| unrelated unresolvable reservation present, healthy reservation consumed | succeeds |
| that reservation named by the caller | `ITEM_PRODUCT_MAP_MISSING`, raised inside the loop |
| released reservation named, unresolvable row also present | `ACTIVE_RESERVATION_NOT_FOUND` — original order restored |
| `product_id IS NULL` with a valid mapping | resolves, enters the prefix, consumes |
| `item_id` is itself a same-org product | compatibility branch resolves |
| mapping present but `is_active = false` | excluded from the prefix; naming that reservation gives `PRODUCT_NOT_PRELOCKED` |
| two lines, same `item_id`, different effective products | both prelocked, both consumed |
| narrowed-prefix mutant | `PRODUCT_NOT_PRELOCKED` — guard still reachable |
| crossed product order across two MOs, narrowed prefix, guard removed | genuine `deadlock detected` (40P01) on `products` |
| same fixture, complete prefix | both transactions complete |
| full green run | unchanged COGS, WIP and reservation transitions |

## 4. Data-health evidence (not an application gate)

M191's read-only evidence should count reservations that the prefix cannot
resolve, so the runbook records them:

```sql
SELECT count(*)
FROM public.material_reservations r
WHERE r.status = 'reserved'
  AND r.product_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.item_product_map m
    WHERE m.org_id = r.org_id AND m.item_id = r.item_id AND m.is_active
      AND m.valid_from <= now() AND (m.valid_to IS NULL OR m.valid_to > now())
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = r.item_id AND p.org_id = r.org_id
  );
```

This is a metric, **not** a "must be zero" precondition. Requiring zero would
reimpose, from the preflight, exactly the strictness §2 removes. A non-zero
count is reported in the runbook, and the acceptance suite must contain the
fixture proving such a reservation does not block consumption of a healthy one.
