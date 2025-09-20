-- =======================================
-- Sample Transactions Test for Wardah ERP
-- =======================================

-- Set up JWT claims for testing as admin user
SET request.jwt.claims.sub TO '11111111-1111-1111-1111-111111111111';
SET request.jwt.claims.role TO 'authenticated';

\echo '🧪 Starting Sample Transactions Test...'

-- 1. Create a product (LDPE material)
INSERT INTO products (
    org_id, sku, name, uom_id, product_type, is_stockable, is_purchasable, standard_cost, list_price
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'LDPE-001',
    'LDPE Raw Material',
    (SELECT id FROM uoms WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'KG'),
    'raw_material',
    true,
    true,
    10.50,
    12.00
);

-- 2. Create a finished good product (Plastic Bags)
INSERT INTO products (
    org_id, sku, name, uom_id, product_type, is_stockable, is_saleable, standard_cost, list_price
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'BAG-001',
    'Plastic Shopping Bags',
    (SELECT id FROM uoms WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'PCS'),
    'finished_good',
    true,
    true,
    0.15,
    0.25
);

-- 3. Create a BOM for the plastic bags
INSERT INTO bom_headers (
    org_id, bom_number, product_id, quantity, uom_id
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'BOM-BAG-001',
    (SELECT id FROM products WHERE org_id = '00000000-0000-0000-0000-000000000001' AND sku = 'BAG-001'),
    1000,
    (SELECT id FROM uoms WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'PCS')
);

-- 4. Add BOM line for LDPE material
INSERT INTO bom_lines (
    org_id, bom_id, sequence, component_product_id, quantity, uom_id
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    (SELECT id FROM bom_headers WHERE org_id = '00000000-0000-0000-0000-000000000001' AND bom_number = 'BOM-BAG-001'),
    1,
    (SELECT id FROM products WHERE org_id = '00000000-0000-0000-0000-000000000001' AND sku = 'LDPE-001'),
    1.5,
    (SELECT id FROM uoms WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'KG')
);

-- 5. Create a manufacturing order
INSERT INTO manufacturing_orders (
    org_id, mo_number, product_id, bom_id, qty_planned, uom_id, location_id, status, work_center
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'MO-001',
    (SELECT id FROM products WHERE org_id = '00000000-0000-0000-0000-000000000001' AND sku = 'BAG-001'),
    (SELECT id FROM bom_headers WHERE org_id = '00000000-0000-0000-0000-000000000001' AND bom_number = 'BOM-BAG-001'),
    1000,
    (SELECT id FROM uoms WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'PCS'),
    (SELECT id FROM locations WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'WIP-MAIN'),
    'confirmed',
    'MIXING'
);

-- 6. Receive raw materials (purchase receipt)
SELECT apply_stock_move(
    '00000000-0000-0000-0000-000000000001',
    (SELECT id FROM products WHERE org_id = '00000000-0000-0000-0000-000000000001' AND sku = 'LDPE-001'),
    NULL,
    (SELECT id FROM locations WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'RM-STOCK'),
    2000,
    10.50,
    'purchase_receipt',
    'purchase_order',
    NULL,
    'PO-001'
);

-- 7. Issue materials to manufacturing order
SELECT issue_materials_to_mo(
    (SELECT id FROM manufacturing_orders WHERE org_id = '00000000-0000-0000-0000-000000000001' AND mo_number = 'MO-001'),
    jsonb_build_array(
        jsonb_build_object(
            'product_id', (SELECT id FROM products WHERE org_id = '00000000-0000-0000-0000-000000000001' AND sku = 'LDPE-001'),
            'quantity', 1500,
            'from_location_id', (SELECT id FROM locations WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'RM-STOCK')
        )
    )
);

-- 8. Add labor entry
INSERT INTO labor_entries (
    org_id, mo_id, work_center_id, employee_name, date_worked, hours_worked, hourly_rate
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    (SELECT id FROM manufacturing_orders WHERE org_id = '00000000-0000-0000-0000-000000000001' AND mo_number = 'MO-001'),
    (SELECT id FROM work_centers WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'MIXING'),
    'Ali Hassan',
    CURRENT_DATE,
    8.0,
    15.0
);

-- 9. Apply overhead to manufacturing order
SELECT apply_overhead_to_mo(
    (SELECT id FROM manufacturing_orders WHERE org_id = '00000000-0000-0000-0000-000000000001' AND mo_number = 'MO-001'),
    'labor',
    'MIXING'
);

-- 10. Complete manufacturing order (produce 1000 bags)
UPDATE manufacturing_orders 
SET qty_produced = 1000, status = 'done', date_finished = NOW()
WHERE org_id = '00000000-0000-0000-0000-000000000001' AND mo_number = 'MO-001';

-- 11. Complete the manufacturing order using the function
SELECT complete_manufacturing_order(
    (SELECT id FROM manufacturing_orders WHERE org_id = '00000000-0000-0000-0000-000000000001' AND mo_number = 'MO-001')
);

-- 12. Verify results
\echo '📋 Test Results:'

-- Check stock quants
SELECT 'Stock Quants' as section, product_id, location_id, onhand_qty, avg_cost 
FROM stock_quants 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- Check stock moves
SELECT 'Stock Moves' as section, product_id, move_type, quantity, unit_cost_in, unit_cost_out, total_cost
FROM stock_moves 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY created_at;

-- Check manufacturing orders
SELECT 'Manufacturing Orders' as section, mo_number, status, qty_planned, qty_produced
FROM manufacturing_orders 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- Check labor entries
SELECT 'Labor Entries' as section, mo_id, employee_name, hours_worked, hourly_rate, total_amount
FROM labor_entries 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- Check overhead allocations
SELECT 'Overhead Allocations' as section, mo_id, allocation_base, base_amount, overhead_rate, total_overhead
FROM overhead_allocations 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

\echo '✅ Sample Transactions Test Complete!'