-- Rollout READBACK gate — products.stock_quantity vs bin truth.
--
-- READ-ONLY. Wrapped in a READ ONLY transaction so any accidental write fails.
-- Intended for a SEPARATELY AUTHORIZED read-only session before any Production
-- M190/M191 rollout decision; this workstream did not run it against any live
-- environment. It classifies, it never repairs.
--
-- Why it is a gate: post-M191 canonical stock writers re-derive the product
-- projection from bins (probe A step 7). The FIRST canonical movement of any
-- product whose projection disagrees with its bins therefore silently
-- "reconciles" it. That must be a reviewed, audited data decision, not a side
-- effect of the next goods receipt or consumption.
--
-- classification (suggested; a human assigns the final one per row):
--   no_bin_truth          products.stock_quantity <> 0 and the product has no
--                         bin row at all (candidate: historical opening balance
--                         needing a canonical opening SLE/bin, or unsupported
--                         legacy data)
--   projection_mismatch   bins exist but SUM(bins.actual_qty) differs (candidate:
--                         stale projection)
--   value_mismatch        quantity agrees but stock_value differs from
--                         SUM(bins.stock_value)
-- Every row starts as `unresolved` until classified by an owner.

BEGIN TRANSACTION READ ONLY;

WITH bin_truth AS (
  SELECT org_id, product_id,
         count(*)               AS bin_rows,
         sum(actual_qty)        AS bin_qty,
         sum(stock_value)       AS bin_value
  FROM public.bins
  GROUP BY org_id, product_id
), sle_truth AS (
  SELECT org_id, product_id,
         count(*)                         AS sle_rows,
         sum(actual_qty)                  AS sle_qty
  FROM public.stock_ledger_entries
  WHERE COALESCE(is_cancelled, false) = false
  GROUP BY org_id, product_id
)
SELECT
  p.org_id,
  p.id                              AS product_id,
  p.code,
  p.stock_quantity                  AS projection_qty,
  COALESCE(b.bin_qty, 0)            AS bin_qty,
  COALESCE(s.sle_qty, 0)            AS sle_qty,
  p.stock_value                     AS projection_value,
  COALESCE(b.bin_value, 0)          AS bin_value,
  COALESCE(b.bin_rows, 0)           AS bin_rows,
  COALESCE(s.sle_rows, 0)           AS sle_rows,
  CASE
    WHEN b.product_id IS NULL AND COALESCE(p.stock_quantity, 0) <> 0 THEN 'no_bin_truth'
    WHEN COALESCE(p.stock_quantity, 0) <> COALESCE(b.bin_qty, 0)     THEN 'projection_mismatch'
    ELSE 'value_mismatch'
  END                               AS suggested_class,
  'unresolved'                      AS owner_classification
FROM public.products p
LEFT JOIN bin_truth b ON b.org_id = p.org_id AND b.product_id = p.id
LEFT JOIN sle_truth s ON s.org_id = p.org_id AND s.product_id = p.id
WHERE COALESCE(p.stock_quantity, 0) <> COALESCE(b.bin_qty, 0)
   OR (b.product_id IS NOT NULL
       AND COALESCE(p.stock_value, 0) <> COALESCE(b.bin_value, 0))
ORDER BY p.org_id, suggested_class, p.code;

ROLLBACK;
