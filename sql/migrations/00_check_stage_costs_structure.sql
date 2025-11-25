-- ===================================================================
-- QUICK CHECK: stage_costs Table Structure
-- ===================================================================
-- 
-- Run this FIRST to see the actual structure of your stage_costs table
-- This will help us understand what columns exist
-- ===================================================================

-- Show all columns in stage_costs table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'stage_costs'
ORDER BY ordinal_position;

-- Count total records
SELECT COUNT(*) as total_records FROM public.stage_costs;

-- Check if table is empty
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM public.stage_costs;
    
    IF v_count = 0 THEN
        RAISE NOTICE '========================================';
        RAISE NOTICE '⚠️ IMPORTANT: stage_costs table is EMPTY!';
        RAISE NOTICE '========================================';
        RAISE NOTICE 'Total records: %', v_count;
        RAISE NOTICE '';
        RAISE NOTICE 'This means:';
        RAISE NOTICE '  - No data migration needed';
        RAISE NOTICE '  - We can proceed directly to creating new tables';
        RAISE NOTICE '  - Migration script (16) will be skipped';
        RAISE NOTICE '';
        RAISE NOTICE 'Next steps:';
        RAISE NOTICE '  1. Create new tables (15_process_costing_enhancement.sql)';
        RAISE NOTICE '  2. Skip data migration (no data to migrate)';
        RAISE NOTICE '  3. Start using new structure directly';
        RAISE NOTICE '========================================';
    ELSE
        RAISE NOTICE '✅ Found % records in stage_costs - migration will proceed', v_count;
    END IF;
END $$;
