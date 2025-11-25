-- ===================================================================
-- CREATE SAMPLE MANUFACTURING STAGES - Phase 1
-- ===================================================================
-- 
-- This script creates sample manufacturing stages
-- Replace 'your-org-id' with your actual organization ID
-- ===================================================================

-- ===================================================================
-- STEP 1: Get your org_id first
-- ===================================================================
-- Run this query first to get your org_id:
-- SELECT id, name FROM organizations LIMIT 1;

-- ===================================================================
-- STEP 2: Update the org_id in the INSERT statements below
-- ===================================================================

-- Replace 'your-org-id' with your actual org_id from Step 1
DO $$
DECLARE
    v_org_id UUID;
    v_stage_count INTEGER;
    rec RECORD;
BEGIN
    -- Get the first organization ID (replace with your actual logic)
    SELECT id INTO v_org_id FROM organizations LIMIT 1;
    
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization found. Please create an organization first.';
    END IF;
    
    RAISE NOTICE 'Using org_id: %', v_org_id;
    
    -- Check if stages already exist
    SELECT COUNT(*) INTO v_stage_count
    FROM manufacturing_stages
    WHERE org_id = v_org_id;
    
    IF v_stage_count > 0 THEN
        RAISE NOTICE 'Manufacturing stages already exist for this organization.';
    RAISE NOTICE 'Current stages:';
    
    FOR rec IN 
        SELECT code, name, name_ar, order_sequence, is_active
        FROM manufacturing_stages
        WHERE org_id = v_org_id
        ORDER BY order_sequence
    LOOP
        RAISE NOTICE '  - % (%): % - Sequence: % - Active: %', 
            rec.code, 
            COALESCE(rec.name_ar, ''), 
            rec.name, 
            rec.order_sequence,
            rec.is_active;
    END LOOP;
        
        RAISE NOTICE '';
        RAISE NOTICE 'To create new stages, run the INSERT statements manually or delete existing ones first.';
        RETURN;
    END IF;
    
    -- Create sample manufacturing stages
    INSERT INTO manufacturing_stages (
        org_id,
        code,
        name,
        name_ar,
        description,
        order_sequence,
        is_active
    ) VALUES
    (
        v_org_id,
        'MIX',
        'Mixing',
        'الخلط',
        'Initial mixing stage for raw materials',
        1,
        true
    ),
    (
        v_org_id,
        'MOLD',
        'Molding',
        'القولبة',
        'Molding stage for shaping the product',
        2,
        true
    ),
    (
        v_org_id,
        'ASSEMBLY',
        'Assembly',
        'التجميع',
        'Final assembly stage',
        3,
        true
    ),
    (
        v_org_id,
        'QC',
        'Quality Control',
        'مراقبة الجودة',
        'Quality control and inspection stage',
        4,
        true
    ),
    (
        v_org_id,
        'PACK',
        'Packing',
        'التعبئة',
        'Final packing stage',
        5,
        true
    )
    ON CONFLICT (org_id, code) DO NOTHING;
    
    RAISE NOTICE '';
    RAISE NOTICE '✅ Successfully created % manufacturing stages:', 
        (SELECT COUNT(*) FROM manufacturing_stages WHERE org_id = v_org_id);
    RAISE NOTICE '';
    RAISE NOTICE 'Created stages:';
    
    FOR rec IN 
        SELECT code, name, name_ar, order_sequence
        FROM manufacturing_stages
        WHERE org_id = v_org_id
        ORDER BY order_sequence
    LOOP
        RAISE NOTICE '  ✅ % - % (%) - Sequence: %', 
            rec.code, 
            rec.name, 
            COALESCE(rec.name_ar, ''), 
            rec.order_sequence;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Link work centers to stages (optional)';
    RAISE NOTICE '  2. Link GL accounts to stages (optional)';
    RAISE NOTICE '  3. Create standard costs for products';
    RAISE NOTICE '  4. Start using stages in manufacturing orders';
    RAISE NOTICE '';
END $$;

-- ===================================================================
-- OPTIONAL: View all manufacturing stages
-- ===================================================================
SELECT 
    code,
    name,
    name_ar,
    order_sequence,
    is_active,
    created_at
FROM manufacturing_stages
ORDER BY order_sequence;

