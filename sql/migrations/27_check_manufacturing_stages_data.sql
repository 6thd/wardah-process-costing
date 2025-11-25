-- ===================================================================
-- CHECK MANUFACTURING STAGES DATA
-- ===================================================================
-- 
-- Run this to check if manufacturing stages exist and their org_id
-- ===================================================================

-- Check all manufacturing stages
SELECT 
    id,
    code,
    name,
    name_ar,
    org_id,
    order_sequence,
    is_active,
    created_at
FROM manufacturing_stages
ORDER BY order_sequence;

-- Count by org_id
SELECT 
    org_id,
    COUNT(*) as stage_count
FROM manufacturing_stages
GROUP BY org_id;

-- Check if org_id matches config
SELECT 
    'Expected org_id from config' as check_type,
    '00000000-0000-0000-0000-000000000001'::uuid as expected_org_id,
    COUNT(*) FILTER (WHERE org_id = '00000000-0000-0000-0000-000000000001'::uuid) as matching_count,
    COUNT(*) as total_count
FROM manufacturing_stages;

-- Summary
DO $$
DECLARE
    v_total_count INTEGER;
    v_expected_org_id UUID := '00000000-0000-0000-0000-000000000001'::uuid;
    v_matching_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_count FROM manufacturing_stages;
    SELECT COUNT(*) INTO v_matching_count 
    FROM manufacturing_stages 
    WHERE org_id = v_expected_org_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'MANUFACTURING STAGES DATA CHECK';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'Total stages: %', v_total_count;
    RAISE NOTICE 'Stages with expected org_id (%): %', v_expected_org_id, v_matching_count;
    RAISE NOTICE '';
    
    IF v_total_count = 0 THEN
        RAISE WARNING '❌ NO STAGES FOUND!';
        RAISE NOTICE 'Run: sql/migrations/25_create_sample_manufacturing_stages.sql';
    ELSIF v_matching_count = 0 THEN
        RAISE WARNING '⚠️ Stages exist but org_id does not match!';
        RAISE NOTICE 'Expected org_id: %', v_expected_org_id;
        RAISE NOTICE 'You may need to update org_id or use correct org_id in application';
    ELSE
        RAISE NOTICE '✅ Stages found with correct org_id!';
    END IF;
    
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

