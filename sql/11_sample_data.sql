-- ===================================================================
-- Wardah ERP - Sample Data for Development and Testing
-- Manufacturing Process Costing Demo Data
-- ===================================================================

-- Note: Replace 'demo-tenant-uuid' with actual tenant UUID in production
-- This is sample data for development/testing purposes only

-- Sample tenant ID (replace with actual UUID)
DO $$
DECLARE
    demo_tenant UUID := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    admin_user UUID;
    cat_raw UUID;
    cat_wip UUID;
    cat_fg UUID;
    item_plastic UUID;
    item_ink UUID;
    item_roll UUID;
    wc_rolling UUID;
    wc_printing UUID;
    wc_cutting UUID;
    supplier_1 UUID;
    customer_1 UUID;
BEGIN

-- ===================================================================
-- 1. USERS
-- ===================================================================
INSERT INTO users (id, email, full_name, role, tenant_id) VALUES
(gen_random_uuid(), 'admin@wardah.sa', 'مدير النظام', 'admin', demo_tenant),
(gen_random_uuid(), 'manager@wardah.sa', 'مدير الإنتاج', 'manager', demo_tenant),
(gen_random_uuid(), 'operator@wardah.sa', 'مشغل الماكينة', 'employee', demo_tenant)
RETURNING id INTO admin_user;

-- ===================================================================
-- 2. CATEGORIES
-- ===================================================================
INSERT INTO categories (id, code, name, name_ar, tenant_id) VALUES
(gen_random_uuid(), 'RAW', 'Raw Materials', 'المواد الخام', demo_tenant),
(gen_random_uuid(), 'WIP', 'Work in Process', 'إنتاج تحت التشغيل', demo_tenant),
(gen_random_uuid(), 'FG', 'Finished Goods', 'منتجات تامة', demo_tenant),
(gen_random_uuid(), 'CONS', 'Consumables', 'مواد استهلاكية', demo_tenant)
RETURNING id INTO cat_raw, cat_wip, cat_fg;

-- ===================================================================
-- 3. WORK CENTERS (Manufacturing Stages)
-- ===================================================================
INSERT INTO work_centers (id, code, name, name_ar, seq, cost_base, default_rate, tenant_id) VALUES
(gen_random_uuid(), 'WC010', 'Rolling Station', 'محطة الرول', 10, 'labor_hours', 25.00, demo_tenant),
(gen_random_uuid(), 'WC020', 'Transparency Processing', 'معالجة الشفافية', 20, 'labor_hours', 30.00, demo_tenant),
(gen_random_uuid(), 'WC030', 'Lid Formation', 'تشكيل الأغطية', 30, 'machine_hours', 45.00, demo_tenant),
(gen_random_uuid(), 'WC040', 'Container Formation', 'تشكيل العلب', 40, 'machine_hours', 50.00, demo_tenant),
(gen_random_uuid(), 'WC050', 'Regrind Processing', 'معالجة الهالك', 50, 'units_produced', 2.50, demo_tenant)
RETURNING id INTO wc_rolling, wc_printing, wc_cutting;

-- ===================================================================
-- 4. LOCATIONS
-- ===================================================================
INSERT INTO locations (id, code, name, name_ar, location_type, tenant_id) VALUES
(gen_random_uuid(), 'WH-RM', 'Raw Materials Warehouse', 'مستودع المواد الخام', 'warehouse', demo_tenant),
(gen_random_uuid(), 'WH-FG', 'Finished Goods Warehouse', 'مستودع المنتجات التامة', 'warehouse', demo_tenant),
(gen_random_uuid(), 'PROD-01', 'Production Line 1', 'خط الإنتاج 1', 'production', demo_tenant),
(gen_random_uuid(), 'QC-01', 'Quality Control Area', 'منطقة مراقبة الجودة', 'quarantine', demo_tenant);

-- ===================================================================
-- 5. ITEMS
-- ===================================================================
INSERT INTO items (id, code, name, name_ar, category_id, unit, item_type, standard_cost, stock_quantity, minimum_stock, tenant_id) VALUES
-- Raw Materials
(gen_random_uuid(), 'RM-PLASTIC-001', 'Plastic Granules Type A', 'حبيبات بلاستيك نوع أ', cat_raw, 'KG', 'raw_material', 5.50, 1000.00, 100.00, demo_tenant),
(gen_random_uuid(), 'RM-INK-001', 'Printing Ink Blue', 'حبر طباعة أزرق', cat_raw, 'LTR', 'raw_material', 25.00, 50.00, 10.00, demo_tenant),
(gen_random_uuid(), 'RM-ADDITIVE-001', 'Plastic Additive', 'مادة مضافة للبلاستيك', cat_raw, 'KG', 'raw_material', 12.00, 200.00, 20.00, demo_tenant),

-- Work in Process
(gen_random_uuid(), 'WIP-ROLL-001', 'Plastic Roll 30cm', 'رول بلاستيك 30 سم', cat_wip, 'MTR', 'work_in_process', 0.00, 0.00, 0.00, demo_tenant),
(gen_random_uuid(), 'WIP-SHEET-001', 'Processed Plastic Sheet', 'ورقة بلاستيك معالجة', cat_wip, 'PCS', 'work_in_process', 0.00, 0.00, 0.00, demo_tenant),

-- Finished Goods
(gen_random_uuid(), 'FG-LID-001', 'Food Container Lid 500ml', 'غطاء علبة طعام 500 مل', cat_fg, 'PCS', 'finished_good', 0.00, 0.00, 50.00, demo_tenant),
(gen_random_uuid(), 'FG-CONT-001', 'Food Container 500ml', 'علبة طعام 500 مل', cat_fg, 'PCS', 'finished_good', 0.00, 0.00, 50.00, demo_tenant)
RETURNING id INTO item_plastic, item_ink, item_roll;

-- ===================================================================
-- 6. SUPPLIERS
-- ===================================================================
INSERT INTO suppliers (id, code, name, name_ar, contact_person, email, phone, payment_terms, tenant_id) VALUES
(gen_random_uuid(), 'SUP-001', 'Saudi Plastic Industries', 'الصناعات البلاستيكية السعودية', 'أحمد محمد', 'ahmed@spi.com.sa', '+966501234567', 'Net 30', demo_tenant),
(gen_random_uuid(), 'SUP-002', 'Chemical Solutions Co.', 'شركة الحلول الكيميائية', 'فاطمة أحمد', 'fatima@chemico.com.sa', '+966502345678', 'Net 45', demo_tenant),
(gen_random_uuid(), 'SUP-003', 'Riyadh Additives Ltd.', 'شركة الرياض للمواد المضافة', 'محمد علي', 'mohammed@radditives.sa', '+966503456789', 'Net 30', demo_tenant)
RETURNING id INTO supplier_1;

-- ===================================================================
-- 7. CUSTOMERS
-- ===================================================================
INSERT INTO customers (id, code, name, name_ar, contact_person, email, phone, payment_terms, tenant_id) VALUES
(gen_random_uuid(), 'CUST-001', 'Al-Rashid Food Services', 'خدمات الراشد الغذائية', 'عبدالله الراشد', 'abdullah@rashid-food.sa', '+966511234567', 'Net 30', demo_tenant),
(gen_random_uuid(), 'CUST-002', 'Jeddah Catering Solutions', 'حلول التموين بجدة', 'نورا السلمان', 'nora@jeddah-catering.sa', '+966512345678', 'Net 45', demo_tenant),
(gen_random_uuid(), 'CUST-003', 'Modern Restaurant Supplies', 'توريدات المطاعم الحديثة', 'خالد العمر', 'khalid@modern-rest.sa', '+966513456789', 'Net 15', demo_tenant)
RETURNING id INTO customer_1;

-- ===================================================================
-- 8. BILL OF MATERIALS (BOM)
-- ===================================================================

-- BOM for Food Container Lid (Multi-stage process)
DO $$
DECLARE
    lid_item UUID;
    bom_stage_10 UUID;
    bom_stage_20 UUID;
    bom_stage_30 UUID;
    plastic_item UUID;
    ink_item UUID;
    additive_item UUID;
BEGIN
    -- Get item IDs
    SELECT id INTO lid_item FROM items WHERE code = 'FG-LID-001' AND tenant_id = demo_tenant;
    SELECT id INTO plastic_item FROM items WHERE code = 'RM-PLASTIC-001' AND tenant_id = demo_tenant;
    SELECT id INTO ink_item FROM items WHERE code = 'RM-INK-001' AND tenant_id = demo_tenant;
    SELECT id INTO additive_item FROM items WHERE code = 'RM-ADDITIVE-001' AND tenant_id = demo_tenant;
    
    -- Stage 10: Rolling (Materials entry point)
    INSERT INTO boms (id, item_id, version, seq, work_center_id, description, quantity_per_unit, tenant_id)
    VALUES (gen_random_uuid(), lid_item, '1.0', 10, wc_rolling, 'Rolling plastic into sheets', 1.0, demo_tenant)
    RETURNING id INTO bom_stage_10;
    
    -- BOM lines for Stage 10 (Direct materials)
    INSERT INTO bom_lines (bom_id, item_id, quantity, waste_factor, seq, tenant_id) VALUES
    (bom_stage_10, plastic_item, 0.025, 0.05, 10, demo_tenant), -- 25g plastic + 5% waste
    (bom_stage_10, additive_item, 0.002, 0.02, 20, demo_tenant); -- 2g additive + 2% waste
    
    -- Stage 20: Transparency Processing  
    INSERT INTO boms (id, item_id, version, seq, work_center_id, description, quantity_per_unit, tenant_id)
    VALUES (gen_random_uuid(), lid_item, '1.0', 20, wc_printing, 'Surface treatment and transparency', 1.0, demo_tenant)
    RETURNING id INTO bom_stage_20;
    
    -- Stage 30: Lid Formation
    INSERT INTO boms (id, item_id, version, seq, work_center_id, description, quantity_per_unit, tenant_id)
    VALUES (gen_random_uuid(), lid_item, '1.0', 30, wc_cutting, 'Final lid shaping and cutting', 1.0, demo_tenant)
    RETURNING id INTO bom_stage_30;
END $$;

-- ===================================================================
-- 9. SAMPLE PURCHASE ORDERS
-- ===================================================================

-- Sample Purchase Order for Raw Materials
DO $$
DECLARE
    po_id UUID;
    plastic_item UUID;
    ink_item UUID;
    additive_item UUID;
BEGIN
    SELECT id INTO plastic_item FROM items WHERE code = 'RM-PLASTIC-001' AND tenant_id = demo_tenant;
    SELECT id INTO ink_item FROM items WHERE code = 'RM-INK-001' AND tenant_id = demo_tenant; 
    SELECT id INTO additive_item FROM items WHERE code = 'RM-ADDITIVE-001' AND tenant_id = demo_tenant;
    
    INSERT INTO purchase_orders (id, po_number, supplier_id, po_date, status, total_amount, tenant_id)
    VALUES (gen_random_uuid(), 'PO-2024-001', supplier_1, CURRENT_DATE, 'received', 15750.00, demo_tenant)
    RETURNING id INTO po_id;
    
    INSERT INTO purchase_order_lines (po_id, item_id, line_number, quantity, unit_price, tenant_id) VALUES
    (po_id, plastic_item, 10, 500.00, 5.50, demo_tenant), -- 500 KG plastic
    (po_id, ink_item, 20, 25.00, 25.00, demo_tenant),     -- 25 LTR ink
    (po_id, additive_item, 30, 100.00, 12.00, demo_tenant); -- 100 KG additives
END $$;

-- ===================================================================
-- 10. SAMPLE INVENTORY TRANSACTIONS (AVCO Setup)
-- ===================================================================

-- Initialize inventory with AVCO costs
DO $$
DECLARE
    plastic_item UUID;
    ink_item UUID;
    additive_item UUID;
BEGIN
    SELECT id INTO plastic_item FROM items WHERE code = 'RM-PLASTIC-001' AND tenant_id = demo_tenant;
    SELECT id INTO ink_item FROM items WHERE code = 'RM-INK-001' AND tenant_id = demo_tenant;
    SELECT id INTO additive_item FROM items WHERE code = 'RM-ADDITIVE-001' AND tenant_id = demo_tenant;
    
    -- Initial inventory receipts (simulating purchase receipts)
    INSERT INTO inventory_ledger (
        item_id, move_type, quantity, unit_cost, total_cost,
        running_quantity, running_value, avg_cost_after,
        reference_type, reference_number, tenant_id
    ) VALUES
    -- Plastic granules
    (plastic_item, 'purchase', 500.00, 5.50, 2750.00, 500.00, 2750.00, 5.50, 'po', 'PO-2024-001', demo_tenant),
    (plastic_item, 'purchase', 300.00, 5.75, 1725.00, 800.00, 4475.00, 5.59375, 'po', 'PO-2024-002', demo_tenant),
    
    -- Printing ink
    (ink_item, 'purchase', 25.00, 25.00, 625.00, 25.00, 625.00, 25.00, 'po', 'PO-2024-001', demo_tenant),
    (ink_item, 'purchase', 15.00, 26.50, 397.50, 40.00, 1022.50, 25.5625, 'po', 'PO-2024-003', demo_tenant),
    
    -- Additives
    (additive_item, 'purchase', 100.00, 12.00, 1200.00, 100.00, 1200.00, 12.00, 'po', 'PO-2024-001', demo_tenant),
    (additive_item, 'purchase', 75.00, 11.80, 885.00, 175.00, 2085.00, 11.91428, 'po', 'PO-2024-004', demo_tenant);
    
    -- Update item current average costs
    UPDATE items SET 
        current_avg_cost = 5.59375,
        stock_quantity = 800.00
    WHERE id = plastic_item;
    
    UPDATE items SET 
        current_avg_cost = 25.5625,
        stock_quantity = 40.00 
    WHERE id = ink_item;
    
    UPDATE items SET 
        current_avg_cost = 11.91428,
        stock_quantity = 175.00
    WHERE id = additive_item;
END $$;

-- ===================================================================
-- 11. SAMPLE MANUFACTURING ORDER
-- ===================================================================

-- Create a sample manufacturing order for lids
DO $$
DECLARE
    mo_id UUID;
    lid_item UUID;
    stage_10_id UUID;
    stage_20_id UUID;
    stage_30_id UUID;
BEGIN
    SELECT id INTO lid_item FROM items WHERE code = 'FG-LID-001' AND tenant_id = demo_tenant;
    
    INSERT INTO manufacturing_orders (
        id, order_number, item_id, quantity, status, start_date, due_date, tenant_id
    ) VALUES (
        gen_random_uuid(), 'MO-20240101-0001', lid_item, 1000.00, 'in_progress', 
        CURRENT_DATE, CURRENT_DATE + 7, demo_tenant
    ) RETURNING id INTO mo_id;
    
    -- Create stage costs for the MO
    INSERT INTO stage_costs (id, mo_id, stage_no, work_center_id, status, tenant_id) VALUES
    (gen_random_uuid(), mo_id, 10, wc_rolling, 'completed', demo_tenant),
    (gen_random_uuid(), mo_id, 20, wc_printing, 'in_progress', demo_tenant),
    (gen_random_uuid(), mo_id, 30, wc_cutting, 'planning', demo_tenant)
    RETURNING id INTO stage_10_id, stage_20_id, stage_30_id;
    
    -- Sample labor time logs
    INSERT INTO labor_time_logs (mo_id, stage_no, work_center_id, worker_name, hours_worked, hourly_rate, tenant_id) VALUES
    (mo_id, 10, wc_rolling, 'أحمد محمد', 4.5, 25.00, demo_tenant),
    (mo_id, 10, wc_rolling, 'محمد علي', 3.0, 25.00, demo_tenant),
    (mo_id, 20, wc_printing, 'فاطمة أحمد', 2.5, 30.00, demo_tenant);
    
    -- Sample overhead applications
    INSERT INTO moh_applied (mo_id, stage_no, work_center_id, basis, base_quantity, overhead_rate, tenant_id) VALUES
    (mo_id, 10, wc_rolling, 'labor_hours', 7.5, 15.00, demo_tenant),
    (mo_id, 20, wc_printing, 'labor_hours', 2.5, 20.00, demo_tenant);
END $$;

END $$;

-- ===================================================================
-- VERIFICATION QUERIES
-- ===================================================================

-- Check sample data creation
DO $$
BEGIN
    RAISE NOTICE 'Sample data created successfully!';
    RAISE NOTICE 'Items: %', (SELECT COUNT(*) FROM items WHERE tenant_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    RAISE NOTICE 'Work Centers: %', (SELECT COUNT(*) FROM work_centers WHERE tenant_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    RAISE NOTICE 'BOMs: %', (SELECT COUNT(*) FROM boms WHERE tenant_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    RAISE NOTICE 'Manufacturing Orders: %', (SELECT COUNT(*) FROM manufacturing_orders WHERE tenant_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    RAISE NOTICE 'Inventory Ledger Records: %', (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
END $$;