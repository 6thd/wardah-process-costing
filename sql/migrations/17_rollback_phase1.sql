-- ===================================================================
-- ROLLBACK SCRIPT - Phase 1 Migration
-- ===================================================================
-- 
-- ⚠️ WARNING: This script will remove Phase 1 tables and data!
-- Use only if you need to rollback the migration.
-- 
-- This script:
-- 1. Drops new tables (stage_wip_log, standard_costs, manufacturing_stages)
-- 2. Removes migration flag from stage_costs
-- 3. Drops backward compatibility view
-- 4. Restores stage_costs to original state
-- ===================================================================

-- ===================================================================
-- STEP 1: Safety Check - Confirm Rollback
-- ===================================================================

DO $$
DECLARE
    v_wip_log_count INTEGER;
    v_stages_count INTEGER;
    v_std_costs_count INTEGER;
BEGIN
    -- Count records in new tables
    SELECT COUNT(*) INTO v_wip_log_count FROM public.stage_wip_log;
    SELECT COUNT(*) INTO v_stages_count FROM public.manufacturing_stages;
    SELECT COUNT(*) INTO v_std_costs_count FROM public.standard_costs;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'ROLLBACK WARNING';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'This will delete:';
    RAISE NOTICE '  - % stage_wip_log records', v_wip_log_count;
    RAISE NOTICE '  - % manufacturing_stages records', v_stages_count;
    RAISE NOTICE '  - % standard_costs records', v_std_costs_count;
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ Original stage_costs data will be preserved';
    RAISE NOTICE '⚠️ But migrated data in new tables will be lost!';
    RAISE NOTICE '';
    RAISE NOTICE 'To proceed, uncomment the rollback steps below.';
    RAISE NOTICE '========================================';
END $$;

-- ===================================================================
-- ROLLBACK STEPS (Uncomment to execute)
-- ===================================================================

-- STEP 1.5: Save snapshot before rollback (RECOMMENDED)
-- Uncomment to create backup tables before rollback:
-- CREATE TABLE IF NOT EXISTS manufacturing_stages_rollback_backup AS SELECT * FROM manufacturing_stages;
-- CREATE TABLE IF NOT EXISTS stage_wip_log_rollback_backup AS SELECT * FROM stage_wip_log;
-- CREATE TABLE IF NOT EXISTS standard_costs_rollback_backup AS SELECT * FROM standard_costs;
-- 
-- RAISE NOTICE '✅ Snapshots created before rollback';

-- STEP 2: Drop backward compatibility view
-- DROP VIEW IF EXISTS public.stage_costs_legacy;

-- STEP 3: Remove migration flag from stage_costs
-- ALTER TABLE public.stage_costs DROP COLUMN IF EXISTS migrated_to_wip_log;

-- STEP 4: Drop new tables (in reverse dependency order)
-- DROP TABLE IF EXISTS public.stage_wip_log CASCADE;
-- DROP TABLE IF EXISTS public.standard_costs CASCADE;
-- DROP TABLE IF EXISTS public.manufacturing_stages CASCADE;

-- STEP 5: Drop triggers (if they exist)
-- DROP TRIGGER IF EXISTS trigger_calculate_wip_eu ON public.stage_wip_log;
-- DROP FUNCTION IF EXISTS calculate_wip_equivalent_units();

-- STEP 6: Verification
-- DO $$
-- BEGIN
--     IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manufacturing_stages') THEN
--         RAISE NOTICE '✅ Rollback complete - new tables removed';
--     ELSE
--         RAISE WARNING '⚠️ Some tables still exist - check manually';
--     END IF;
-- END $$;

-- ===================================================================
-- NOTES:
-- ===================================================================
-- 
-- 1. This rollback preserves original stage_costs data
-- 2. If you need to restore from backup, use:
--    psql -h host -U user -d database < backup.sql
-- 
-- 3. After rollback, you can re-run migration if needed
-- 
-- ===================================================================

