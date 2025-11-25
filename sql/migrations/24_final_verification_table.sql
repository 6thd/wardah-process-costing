-- ===================================================================
-- FINAL VERIFICATION - Phase 1 Complete (Table Output)
-- ===================================================================
-- 
-- This version returns results as a table for easy viewing
-- ===================================================================

-- Create a temporary table to store results
CREATE TEMP TABLE IF NOT EXISTS verification_results (
    check_name TEXT,
    expected TEXT,
    actual TEXT,
    status TEXT
);

-- Clear previous results
TRUNCATE TABLE verification_results;

-- Insert verification results
INSERT INTO verification_results (check_name, expected, actual, status)
SELECT 
    'Tables' as check_name,
    '3' as expected,
    COUNT(*)::TEXT as actual,
    CASE WHEN COUNT(*) = 3 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM information_schema.tables
WHERE table_schema = 'public' 
AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')

UNION ALL

SELECT 
    'RLS Enabled' as check_name,
    '3' as expected,
    COUNT(*)::TEXT as actual,
    CASE WHEN COUNT(*) = 3 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
AND rowsecurity = true

UNION ALL

SELECT 
    'Triggers' as check_name,
    'At least 1' as expected,
    COUNT(*)::TEXT as actual,
    CASE WHEN COUNT(*) > 0 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM information_schema.triggers
WHERE event_object_schema = 'public'
AND event_object_table IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')

UNION ALL

SELECT 
    'Indexes' as check_name,
    'At least 15' as expected,
    COUNT(*)::TEXT as actual,
    CASE WHEN COUNT(*) >= 15 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')

UNION ALL

SELECT 
    'RLS Policies' as check_name,
    'At least 3' as expected,
    COUNT(*)::TEXT as actual,
    CASE WHEN COUNT(*) >= 3 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')

UNION ALL

SELECT 
    'Foreign Keys' as check_name,
    'At least 1' as expected,
    COUNT(*)::TEXT as actual,
    CASE WHEN COUNT(*) > 0 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM information_schema.table_constraints
WHERE constraint_type = 'FOREIGN KEY'
AND table_schema = 'public'
AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');

-- Display results
SELECT 
    check_name as "Check",
    expected as "Expected",
    actual as "Actual",
    status as "Status"
FROM verification_results
ORDER BY 
    CASE 
        WHEN status LIKE '✅%' THEN 1 
        ELSE 2 
    END,
    check_name;

-- Summary
DO $$
DECLARE
    v_pass_count INTEGER;
    v_fail_count INTEGER;
BEGIN
    SELECT 
        COUNT(*) FILTER (WHERE status LIKE '✅%'),
        COUNT(*) FILTER (WHERE status LIKE '❌%')
    INTO v_pass_count, v_fail_count
    FROM verification_results;
    
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'VERIFICATION SUMMARY:';
    RAISE NOTICE '  ✅ Passed: %', v_pass_count;
    RAISE NOTICE '  ❌ Failed: %', v_fail_count;
    RAISE NOTICE '';
    
    IF v_fail_count = 0 THEN
        RAISE NOTICE '🎉 PHASE 1 COMPLETE - ALL CHECKS PASSED!';
        RAISE NOTICE '';
        RAISE NOTICE 'Next steps:';
        RAISE NOTICE '  1. Create initial manufacturing_stages';
        RAISE NOTICE '  2. Test services in supabase-service.ts';
        RAISE NOTICE '  3. Start using new structure';
    ELSE
        RAISE WARNING '⚠️ Some checks failed - review the table above';
    END IF;
    
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

