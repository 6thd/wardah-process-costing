-- ===================================================================
-- VERIFICATION: Phase 1 Tables Created
-- ===================================================================
-- 
-- Run this to verify all tables were created successfully
-- ===================================================================

-- Check if all 3 tables exist
SELECT 
    table_name,
    CASE 
        WHEN table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs') 
        THEN '✅ Created'
        ELSE '❌ Missing'
    END as status
FROM information_schema.tables
WHERE table_schema = 'public' 
AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
ORDER BY table_name;

-- Count expected vs actual
DO $$
DECLARE
    v_expected_count INTEGER := 3;
    v_actual_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_actual_count
    FROM information_schema.tables
    WHERE table_schema = 'public' 
    AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    IF v_actual_count = v_expected_count THEN
        RAISE NOTICE '✅ All % tables created successfully!', v_expected_count;
    ELSE
        RAISE WARNING '⚠️ Expected % tables, found %', v_expected_count, v_actual_count;
    END IF;
END $$;

-- Check triggers
SELECT 
    trigger_name,
    event_object_table,
    action_timing,
    event_manipulation
FROM information_schema.triggers
WHERE trigger_name = 'trigger_calculate_wip_eu'
AND event_object_schema = 'public';

-- Check RLS is enabled
SELECT 
    tablename,
    rowsecurity,
    CASE 
        WHEN rowsecurity THEN '✅ Enabled'
        ELSE '❌ Disabled'
    END as rls_status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
ORDER BY tablename;

-- Check indexes
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
ORDER BY tablename, indexname;

-- Summary
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'VERIFICATION SUMMARY';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ Run the queries above to verify:';
    RAISE NOTICE '   - Tables created';
    RAISE NOTICE '   - Triggers working';
    RAISE NOTICE '   - RLS enabled';
    RAISE NOTICE '   - Indexes created';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Create initial manufacturing_stages';
    RAISE NOTICE '  2. Test services';
    RAISE NOTICE '  3. Start using new structure';
    RAISE NOTICE '========================================';
END $$;

