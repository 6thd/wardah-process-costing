-- ===================================================================
-- BACKUP & SAFETY CHECKLIST - قبل تنفيذ Phase 1 Migration (FIXED)
-- ===================================================================
-- 
-- هذا الملف يحتوي على استعلامات للتحقق من سلامة البيانات
-- قبل تنفيذ Migration
-- 
-- FIXED: Handles both tenant_id and org_id column names
-- ===================================================================

-- ===================================================================
-- STEP 0: Detect Table Structure
-- ===================================================================

DO $$
DECLARE
    v_table_exists BOOLEAN;
    v_has_mo_id BOOLEAN;
    v_has_tenant_id BOOLEAN;
    v_has_org_id BOOLEAN;
    v_mo_column TEXT;
    v_org_column TEXT;
BEGIN
    -- Check if table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs'
    ) INTO v_table_exists;
    
    IF NOT v_table_exists THEN
        RAISE EXCEPTION '❌ stage_costs table does not exist!';
    END IF;
    
    -- Check for mo_id column
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'mo_id'
    ) INTO v_has_mo_id;
    
    -- Check for tenant_id column
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'tenant_id'
    ) INTO v_has_tenant_id;
    
    -- Check for org_id column
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'org_id'
    ) INTO v_has_org_id;
    
    -- Determine column names
    IF v_has_mo_id THEN
        v_mo_column := 'mo_id';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'manufacturing_order_id'
    ) THEN
        v_mo_column := 'manufacturing_order_id';
    ELSE
        RAISE EXCEPTION '❌ Cannot find manufacturing order ID column in stage_costs. Available columns: %', 
            (SELECT string_agg(column_name, ', ') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs');
    END IF;
    
    IF v_has_tenant_id THEN
        v_org_column := 'tenant_id';
    ELSIF v_has_org_id THEN
        v_org_column := 'org_id';
    ELSE
        RAISE EXCEPTION '❌ Cannot find organization/tenant ID column in stage_costs. Available columns: %', 
            (SELECT string_agg(column_name, ', ') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs');
    END IF;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'TABLE STRUCTURE DETECTED';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'MO Column: %', v_mo_column;
    RAISE NOTICE 'Org/Tenant Column: %', v_org_column;
    RAISE NOTICE '========================================';
    
    -- Store column names in a temporary table for use in other blocks
    CREATE TEMP TABLE IF NOT EXISTS stage_costs_columns (
        mo_column TEXT,
        org_column TEXT
    );
    
    DELETE FROM stage_costs_columns;
    INSERT INTO stage_costs_columns VALUES (v_mo_column, v_org_column);
END $$;

-- ===================================================================
-- STEP 1: Data Integrity Checks
-- ===================================================================

DO $$
DECLARE
    v_null_mo_count INTEGER;
    v_null_stage_count INTEGER;
    v_negative_cost_count INTEGER;
    v_total_count INTEGER;
    v_mo_column TEXT;
    v_org_column TEXT;
BEGIN
    -- Get column names from temp table
    SELECT mo_column, org_column INTO v_mo_column, v_org_column
    FROM stage_costs_columns;
    
    -- Count records with NULL mo_id
    EXECUTE format('SELECT COUNT(*) FROM public.stage_costs WHERE %I IS NULL', v_mo_column) INTO v_null_mo_count;
    
    -- Count records with NULL stage_no
    SELECT COUNT(*) INTO v_null_stage_count
    FROM public.stage_costs
    WHERE stage_no IS NULL;
    
    -- Count records with negative costs
    SELECT COUNT(*) INTO v_negative_cost_count
    FROM public.stage_costs
    WHERE (dm_cost < 0 OR dl_cost < 0 OR moh_cost < 0 OR total_cost < 0);
    
    -- Total count
    SELECT COUNT(*) INTO v_total_count
    FROM public.stage_costs;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'DATA INTEGRITY CHECK RESULTS';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Total stage_costs records: %', v_total_count;
    RAISE NOTICE 'Records with NULL %: %', v_mo_column, v_null_mo_count;
    RAISE NOTICE 'Records with NULL stage_no: %', v_null_stage_count;
    RAISE NOTICE 'Records with negative costs: %', v_negative_cost_count;
    RAISE NOTICE '========================================';
    
    IF v_null_mo_count > 0 THEN
        RAISE WARNING '⚠️ Found % records with NULL % - these will be skipped!', v_null_mo_count, v_mo_column;
    END IF;
    
    IF v_null_stage_count > 0 THEN
        RAISE WARNING '⚠️ Found % records with NULL stage_no - these will be skipped!', v_null_stage_count;
    END IF;
    
    IF v_negative_cost_count > 0 THEN
        RAISE WARNING '⚠️ Found % records with negative costs - please review!', v_negative_cost_count;
    END IF;
    
    IF v_null_mo_count = 0 AND v_null_stage_count = 0 AND v_negative_cost_count = 0 THEN
        RAISE NOTICE '✅ All data integrity checks passed!';
    END IF;
END $$;

-- Check 2: Verify manufacturing_orders exist for all stage_costs
DO $$
DECLARE
    v_orphan_count INTEGER;
    v_mo_column TEXT;
BEGIN
    -- Get column name
    SELECT mo_column INTO v_mo_column FROM stage_costs_columns;
    
    EXECUTE format('
        SELECT COUNT(*) 
        FROM public.stage_costs sc
        LEFT JOIN public.manufacturing_orders mo ON mo.id = sc.%I
        WHERE mo.id IS NULL
        AND sc.%I IS NOT NULL
    ', v_mo_column, v_mo_column) INTO v_orphan_count;
    
    IF v_orphan_count > 0 THEN
        RAISE WARNING '⚠️ Found % orphan stage_costs (% not found in manufacturing_orders)', v_orphan_count, v_mo_column;
    ELSE
        RAISE NOTICE '✅ All stage_costs have valid manufacturing_orders';
    END IF;
END $$;

-- Check 3: Verify work_centers exist (optional, for linking)
DO $$
DECLARE
    v_stages_without_wc INTEGER;
    v_total_stages INTEGER;
BEGIN
    -- Count distinct stage_no values
    SELECT COUNT(DISTINCT stage_no) INTO v_total_stages
    FROM public.stage_costs
    WHERE stage_no IS NOT NULL;
    
    -- This is informational only (work_center_id is optional)
    RAISE NOTICE 'Total distinct stages found: %', v_total_stages;
    RAISE NOTICE 'Note: work_center_id linking is optional - stages will be created even if no work center matches';
END $$;

-- ===================================================================
-- STEP 2: Foreign Key Constraints Check
-- ===================================================================

-- Check if organizations table exists and has data
DO $$
DECLARE
    v_org_count INTEGER;
    v_org_column TEXT;
    v_table_name TEXT;
BEGIN
    -- Get org column name
    SELECT org_column INTO v_org_column FROM stage_costs_columns;
    
    -- Check if organizations table exists (try both names)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'organizations') THEN
        v_table_name := 'organizations';
        EXECUTE format('SELECT COUNT(*) FROM public.%I', v_table_name) INTO v_org_count;
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenants') THEN
        v_table_name := 'tenants';
        EXECUTE format('SELECT COUNT(*) FROM public.%I', v_table_name) INTO v_org_count;
    ELSE
        RAISE WARNING '⚠️ No organizations or tenants table found - FK check skipped';
        RETURN;
    END IF;
    
    IF v_org_count = 0 THEN
        RAISE WARNING '⚠️ No organizations found in % table!', v_table_name;
    ELSE
        RAISE NOTICE '✅ Found % organization(s) in %', v_org_count, v_table_name;
    END IF;
END $$;

-- Check if gl_accounts table exists (for wip_gl_account_id FK)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') THEN
        RAISE NOTICE '✅ gl_accounts table exists - WIP GL account linking will be available';
    ELSE
        RAISE NOTICE '⚠️ gl_accounts table not found - wip_gl_account_id will be NULL (can be set later)';
    END IF;
END $$;

-- ===================================================================
-- STEP 3: Estimate Migration Impact
-- ===================================================================

DO $$
DECLARE
    v_stages_to_create INTEGER;
    v_wip_logs_to_create INTEGER;
    v_orgs_count INTEGER;
    v_org_column TEXT;
    v_mo_column TEXT;
BEGIN
    -- Get column names
    SELECT mo_column, org_column INTO v_mo_column, v_org_column FROM stage_costs_columns;
    
    -- Count distinct org_id/tenant_id + stage_no combinations
    EXECUTE format('
        SELECT COUNT(DISTINCT (%I, stage_no)) 
        FROM public.stage_costs
        WHERE stage_no IS NOT NULL
    ', v_org_column) INTO v_stages_to_create;
    
    -- Count stage_costs records to migrate
    EXECUTE format('
        SELECT COUNT(*) 
        FROM public.stage_costs
        WHERE %I IS NOT NULL
        AND stage_no IS NOT NULL
    ', v_mo_column) INTO v_wip_logs_to_create;
    
    -- Count organizations
    EXECUTE format('
        SELECT COUNT(DISTINCT %I) 
        FROM public.stage_costs
    ', v_org_column) INTO v_orgs_count;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'MIGRATION ESTIMATE';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Organizations affected: %', v_orgs_count;
    RAISE NOTICE 'Manufacturing stages to create: %', v_stages_to_create;
    RAISE NOTICE 'WIP log entries to create: %', v_wip_logs_to_create;
    RAISE NOTICE '========================================';
    
    IF v_wip_logs_to_create > 10000 THEN
        RAISE WARNING '⚠️ Large migration (% records) - consider running during off-hours', v_wip_logs_to_create;
    END IF;
END $$;

-- ===================================================================
-- STEP 4: Backup Recommendations
-- ===================================================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'BACKUP RECOMMENDATIONS';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Before running migration, backup these tables:';
    RAISE NOTICE '  - stage_costs';
    RAISE NOTICE '  - manufacturing_orders';
    RAISE NOTICE '  - work_centers (if exists)';
    RAISE NOTICE '  - gl_accounts (if exists)';
    RAISE NOTICE '';
    RAISE NOTICE 'Backup command:';
    RAISE NOTICE '  pg_dump -h host -U user -d database -t stage_costs -t manufacturing_orders > backup.sql';
    RAISE NOTICE '';
    RAISE NOTICE 'Or use Supabase dashboard:';
    RAISE NOTICE '  Settings > Database > Backups > Create Backup';
    RAISE NOTICE '========================================';
END $$;

-- ===================================================================
-- STEP 5: Rollback Plan Check
-- ===================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manufacturing_stages') THEN
        RAISE WARNING '⚠️ manufacturing_stages table already exists!';
        RAISE WARNING '   If this is a re-run, you may need to drop tables first:';
        RAISE WARNING '   DROP TABLE IF EXISTS stage_wip_log CASCADE;';
        RAISE WARNING '   DROP TABLE IF EXISTS standard_costs CASCADE;';
        RAISE WARNING '   DROP TABLE IF EXISTS manufacturing_stages CASCADE;';
    ELSE
        RAISE NOTICE '✅ New tables do not exist - safe to proceed';
    END IF;
END $$;

-- ===================================================================
-- STEP 6: Disk Space Check
-- ===================================================================

DO $$
DECLARE
    v_db_size TEXT;
    v_table_size TEXT;
BEGIN
    -- Get database size
    SELECT pg_size_pretty(pg_database_size(current_database())) 
    INTO v_db_size;
    
    -- Get stage_costs table size
    SELECT pg_size_pretty(pg_total_relation_size('public.stage_costs'))
    INTO v_table_size;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'DISK SPACE INFORMATION';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Current database size: %', v_db_size;
    RAISE NOTICE 'stage_costs table size: %', v_table_size;
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ Ensure sufficient disk space for:';
    RAISE NOTICE '   - Database backup (recommended: 2x current size)';
    RAISE NOTICE '   - New tables (estimated: ~30%% of stage_costs size)';
    RAISE NOTICE '   - Migration overhead (estimated: ~10%% of stage_costs size)';
    RAISE NOTICE '========================================';
END $$;

-- ===================================================================
-- SUMMARY: Pre-Migration Checklist
-- ===================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'PRE-MIGRATION CHECKLIST';
    RAISE NOTICE '========================================';
    RAISE NOTICE '□ Backup database';
    RAISE NOTICE '□ Review data integrity check results above';
    RAISE NOTICE '□ Fix any data issues found';
    RAISE NOTICE '□ Verify organizations exist';
    RAISE NOTICE '□ Check migration estimate';
    RAISE NOTICE '□ Verify sufficient disk space';
    RAISE NOTICE '□ Plan maintenance window (if large migration)';
    RAISE NOTICE '□ Inform team/users';
    RAISE NOTICE '□ Have rollback plan ready';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'If all checks pass, proceed with:';
    RAISE NOTICE '  1. sql/migrations/15_process_costing_enhancement.sql';
    RAISE NOTICE '  2. sql/migrations/16_migrate_stage_costs_to_wip_log.sql';
    RAISE NOTICE '';
END $$;

-- Cleanup temp table
DROP TABLE IF EXISTS stage_costs_columns;

