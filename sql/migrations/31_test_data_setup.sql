-- ===================================================================
-- TEST DATA SETUP FOR PHASE 1 TESTING
-- إعداد بيانات الاختبار للمرحلة الأولى
-- ===================================================================
-- 
-- This script creates test data for comprehensive testing:
-- 1. Manufacturing Orders (if needed)
-- 2. Products (if needed)
-- 3. Sample WIP Log entries
-- 4. Sample Standard Costs
--
-- Run this script BEFORE testing to ensure test data exists
-- ===================================================================

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-0000-0000-000000000001';
  v_mo_id UUID;
  v_product_id UUID;
  v_stage_id UUID;
  v_wip_log_id UUID;
  v_standard_cost_id UUID;
BEGIN
  RAISE NOTICE '🧪 Starting test data setup...';

  -- ===================================================================
  -- 1. Get or Create a Product
  -- ===================================================================
  SELECT id INTO v_product_id
  FROM products
  WHERE org_id = v_org_id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    -- Create a test product
    INSERT INTO products (
      org_id,
      code,
      name,
      name_ar,
      description,
      is_active,
      created_at
    ) VALUES (
      v_org_id,
      'TEST-PROD-001',
      'Test Product',
      'منتج تجريبي',
      'Test product for Phase 1 testing',
      true,
      NOW()
    )
    RETURNING id INTO v_product_id;
    
    RAISE NOTICE '✅ Created test product: %', v_product_id;
  ELSE
    RAISE NOTICE '✅ Using existing product: %', v_product_id;
  END IF;

  -- ===================================================================
  -- 2. Get Manufacturing Stages
  -- ===================================================================
  SELECT id INTO v_stage_id
  FROM manufacturing_stages
  WHERE org_id = v_org_id
    AND code = 'MIX'
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RAISE WARNING '⚠️ Manufacturing stage MIX not found. Please run migration 25 first.';
    RETURN;
  END IF;

  RAISE NOTICE '✅ Using manufacturing stage: % (MIX)', v_stage_id;

  -- ===================================================================
  -- 3. Get or Create a Manufacturing Order
  -- ===================================================================
  SELECT id INTO v_mo_id
  FROM manufacturing_orders
  WHERE org_id = v_org_id
  LIMIT 1;

  IF v_mo_id IS NULL THEN
    -- Create a test manufacturing order
    INSERT INTO manufacturing_orders (
      org_id,
      order_number,
      product_id,
      quantity,
      status,
      created_at
    ) VALUES (
      v_org_id,
      'MO-TEST-001',
      v_product_id,
      100,
      'in_progress',
      NOW()
    )
    RETURNING id INTO v_mo_id;
    
    RAISE NOTICE '✅ Created test manufacturing order: %', v_mo_id;
  ELSE
    RAISE NOTICE '✅ Using existing manufacturing order: %', v_mo_id;
  END IF;

  -- ===================================================================
  -- 4. Create Sample WIP Log Entry
  -- ===================================================================
  INSERT INTO stage_wip_log (
    org_id,
    mo_id,
    stage_id,
    period_start,
    period_end,
    units_beginning_wip,
    units_started,
    units_completed,
    units_ending_wip,
    cost_material,
    cost_labor,
    cost_overhead,
    is_closed,
    created_at
  ) VALUES (
    v_org_id,
    v_mo_id,
    v_stage_id,
    CURRENT_DATE - INTERVAL '7 days',
    CURRENT_DATE,
    10,
    100,
    90,
    20,
    1000.00,
    500.00,
    300.00,
    false,
    NOW()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_wip_log_id;

  IF v_wip_log_id IS NOT NULL THEN
    RAISE NOTICE '✅ Created test WIP log entry: %', v_wip_log_id;
  ELSE
    RAISE NOTICE 'ℹ️ WIP log entry already exists or conflict occurred';
  END IF;

  -- ===================================================================
  -- 5. Create Sample Standard Cost
  -- ===================================================================
  INSERT INTO standard_costs (
    org_id,
    product_id,
    stage_id,
    material_cost_per_unit,
    labor_cost_per_unit,
    overhead_cost_per_unit,
    effective_from,
    is_active,
    created_at
  ) VALUES (
    v_org_id,
    v_product_id,
    v_stage_id,
    10.00,
    5.00,
    3.00,
    CURRENT_DATE,
    true,
    NOW()
  )
  ON CONFLICT (org_id, product_id, stage_id, effective_from) DO NOTHING
  RETURNING id INTO v_standard_cost_id;

  IF v_standard_cost_id IS NOT NULL THEN
    RAISE NOTICE '✅ Created test standard cost: %', v_standard_cost_id;
  ELSE
    RAISE NOTICE 'ℹ️ Standard cost already exists or conflict occurred';
  END IF;

  -- ===================================================================
  -- Summary
  -- ===================================================================
  RAISE NOTICE '';
  RAISE NOTICE '✅ Test data setup complete!';
  RAISE NOTICE '';
  RAISE NOTICE 'Test Data Summary:';
  RAISE NOTICE '  - Product ID: %', v_product_id;
  RAISE NOTICE '  - Manufacturing Order ID: %', v_mo_id;
  RAISE NOTICE '  - Stage ID: %', v_stage_id;
  RAISE NOTICE '  - WIP Log ID: %', COALESCE(v_wip_log_id::text, 'N/A');
  RAISE NOTICE '  - Standard Cost ID: %', COALESCE(v_standard_cost_id::text, 'N/A');
  RAISE NOTICE '';
  RAISE NOTICE 'You can now proceed with testing!';

END $$;

-- ===================================================================
-- Verification Queries
-- ===================================================================

-- Check test data
SELECT 
  'Products' as table_name,
  COUNT(*) as count
FROM products
WHERE org_id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 
  'Manufacturing Orders' as table_name,
  COUNT(*) as count
FROM manufacturing_orders
WHERE org_id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 
  'Manufacturing Stages' as table_name,
  COUNT(*) as count
FROM manufacturing_stages
WHERE org_id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 
  'WIP Logs' as table_name,
  COUNT(*) as count
FROM stage_wip_log
WHERE org_id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 
  'Standard Costs' as table_name,
  COUNT(*) as count
FROM standard_costs
WHERE org_id = '00000000-0000-0000-0000-000000000001';

