-- =======================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- =======================================

-- Trigger: Auto-update stock_quants.available_qty
CREATE OR REPLACE FUNCTION update_available_qty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Simple implementation: available = onhand (can be enhanced with reservations)
    NEW.available_qty := NEW.onhand_qty;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER tr_stock_quants_available_qty
    BEFORE UPDATE ON stock_quants
    FOR EACH ROW
    EXECUTE FUNCTION update_available_qty();

-- =======================================
-- SAMPLE USAGE EXAMPLES
-- =======================================

/*
-- Example 1: Issue materials to MO
SELECT issue_materials_to_mo(
    '12345678-1234-1234-1234-123456789012',
    '[
        {"product_id": "11111111-1111-1111-1111-111111111111", "quantity": 100.5, "from_location_id": "22222222-2222-2222-2222-222222222222"},
        {"product_id": "33333333-3333-3333-3333-333333333333", "quantity": 25.0, "from_location_id": "22222222-2222-2222-2222-222222222222"}
    ]'::jsonb
);

-- Example 2: Apply overhead to MO
SELECT apply_overhead_to_mo(
    '12345678-1234-1234-1234-123456789012',
    'labor',
    'EXTRUSION'
);

-- Example 3: Complete MO
SELECT complete_manufacturing_order('12345678-1234-1234-1234-123456789012');

-- Example 4: Get inventory valuation
SELECT * FROM get_inventory_valuation('00000000-0000-0000-0000-000000000001');

-- Example 5: Get WIP analysis
SELECT * FROM get_wip_analysis('00000000-0000-0000-0000-000000000001');

-- Example 6: Calculate overhead variances
SELECT calculate_overhead_variances(
    '00000000-0000-0000-0000-000000000001',
    '2024-01-01',
    '2024-01-31'
);
*/

-- =======================================
-- SUCCESS MESSAGE
-- =======================================

DO $$
BEGIN
    RAISE NOTICE '⚡ AVCO & Manufacturing Functions Created Successfully!';
    RAISE NOTICE '📦 Stock Movement with AVCO: apply_stock_move()';
    RAISE NOTICE '🏭 Manufacturing Order Completion: complete_manufacturing_order()';
    RAISE NOTICE '📋 Material Issue: issue_materials_to_mo()';
    RAISE NOTICE '🔧 Overhead Application: apply_overhead_to_mo()';
    RAISE NOTICE '📊 Variance Analysis: calculate_overhead_variances()';
    RAISE NOTICE '📈 Inventory Valuation: get_inventory_valuation()';
    RAISE NOTICE '🎯 WIP Analysis: get_wip_analysis()';
    RAISE NOTICE '✅ Production-Ready Process Costing Complete!';
END $$;