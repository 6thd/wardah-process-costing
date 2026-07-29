-- migration_number: 142
-- description: Fix invoker-context EXECUTE denials caused by internal-helper
--              revocations. UoM normalization triggers become SECURITY DEFINER
--              so direct client DML keeps working while the helpers stay locked,
--              and the nested-BOM divisor guard becomes executable by the
--              authenticated callers of the invoker-security explode_bom.
-- safety: privilege/attribute changes only. No table or data rewrite.

-- EXECUTE privilege is checked against current_user at every call site.
-- Inside SECURITY DEFINER RPCs current_user is the owner, so locked helpers
-- work there. Inside SECURITY INVOKER contexts (explode_bom, trigger functions
-- fired by direct client DML) current_user is the client role, so a helper
-- revoked from authenticated raises "permission denied" at runtime.

-- 1) explode_bom is SECURITY INVOKER and called directly by clients.
--    Its divisor guard is a pure IMMUTABLE validator with no table access,
--    so granting it to authenticated exposes nothing.
GRANT EXECUTE ON FUNCTION public.wardah_require_positive_bom_quantity(uuid,numeric) TO authenticated;

-- explode_bom itself still carried the default PUBLIC EXECUTE from the baseline.
REVOKE EXECUTE ON FUNCTION public.explode_bom(uuid,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.explode_bom(uuid,numeric,uuid) TO authenticated;

-- 2) BEFORE-triggers on client-writable tables run their trigger functions with
--    the DML user's privileges. These functions call locked internal helpers
--    (wardah_uom_factor, wardah_resolve_product_id), so direct client
--    INSERT/UPDATE on purchase_order_lines, sales_invoice_lines,
--    stock_adjustment_items, bom_lines and material_reservations would fail.
--    Run them as definer: the helpers remain revoked from client roles, every
--    function already pins search_path, and org scoping still comes from the
--    row's org_id which the target table's RLS policies validate.
ALTER FUNCTION public.trg_resolve_item_product_reference() SECURITY DEFINER;
ALTER FUNCTION public.trg_normalize_stock_adjustment_uom() SECURITY DEFINER;
ALTER FUNCTION public.trg_normalize_bom_line_uom() SECURITY DEFINER;
ALTER FUNCTION public.trg_normalize_purchase_order_line_uom() SECURITY DEFINER;
ALTER FUNCTION public.trg_normalize_sales_invoice_line_uom() SECURITY DEFINER;

-- Trigger functions are never client-callable; re-assert the lockout now that
-- they execute with owner privileges.
REVOKE EXECUTE ON FUNCTION public.trg_resolve_item_product_reference() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_stock_adjustment_uom() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_bom_line_uom() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_purchase_order_line_uom() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_sales_invoice_line_uom() FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION public.wardah_require_positive_bom_quantity(uuid,numeric) IS
  'Nested-BOM divisor guard. Raises BOM_CHILD_QUANTITY_INVALID instead of raw division-by-zero. Executable by authenticated because explode_bom is SECURITY INVOKER.';
COMMENT ON FUNCTION public.explode_bom(uuid,numeric,uuid) IS
  'Base-UoM recursive BOM explosion. SECURITY INVOKER under caller RLS; authenticated-only since 142.';
