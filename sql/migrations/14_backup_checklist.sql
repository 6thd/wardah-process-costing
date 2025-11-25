-- ===================================================================
-- BACKUP & SAFETY CHECKLIST - قبل تنفيذ Phase 1 Migration
-- ===================================================================
-- 
-- هذا الملف يحتوي على استعلامات للتحقق من سلامة البيانات
-- قبل تنفيذ Migration
-- 
-- NOTE: This script has been updated to handle both tenant_id and org_id
-- If you get column errors, use: sql/migrations/14_backup_checklist_fixed.sql
-- ===================================================================

-- ===================================================================
-- STEP 1: Data Integrity Checks
-- ===================================================================

-- Check 1: Verify stage_costs data quality
-- First, check what columns actually exist
DO $$
DECLARE
    v_has_mo_id BOOLEAN;
    v_has_tenant_id BOOLEAN;
    v_has_org_id BOOLEAN;
    v_null_mo_count INTEGER;
    v_null_stage_count INTEGER;
    v_negative_cost_count INTEGER;
    v_total_count INTEGER;
    v_mo_column_name TEXT;
    v_org_column_name TEXT;
BEGIN
    -- Check which columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'mo_id'
    ) INTO v_has_mo_id;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'tenant_id'
    ) INTO v_has_tenant_id;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'org_id'
    ) INTO v_has_org_id;
    
    -- Determine column names
    IF v_has_mo_id THEN
        v_mo_column_name := 'mo_id';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'manufacturing_order_id') THEN
        v_mo_column_name := 'manufacturing_order_id';
    ELSE
        RAISE EXCEPTION '❌ Cannot find manufacturing order ID column in stage_costs table. Please check table structure.';
    END IF;
    
    IF v_has_tenant_id THEN
        v_org_column_name := 'tenant_id';
    ELSIF v_has_org_id THEN
        v_org_column_name := 'org_id';
    ELSE
        RAISE EXCEPTION '❌ Cannot find organization/tenant ID column in stage_costs table. Please check table structure.';
    END IF;
    
    RAISE NOTICE 'Detected columns: mo_id=% (using: %), org/tenant=% (using: %)', 
        v_has_mo_id, v_mo_column_name, (v_has_tenant_id OR v_has_org_id), v_org_column_name;
    
    -- Count records with NULL mo_id (using dynamic column name)
    EXECUTE format('SELECT COUNT(*) FROM public.stage_costs WHERE %I IS NULL', v_mo_column_name) INTO v_null_mo_count;
    
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
    RAISE NOTICE 'Records with NULL mo_id: %', v_null_mo_count;
    RAISE NOTICE 'Records with NULL stage_no: %', v_null_stage_count;
    RAISE NOTICE 'Records with negative costs: %', v_negative_cost_count;
    RAISE NOTICE '========================================';
    
    IF v_null_mo_count > 0 THEN
        RAISE WARNING '⚠️ Found % records with NULL mo_id - these will be skipped!', v_null_mo_count;
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
    v_mo_column_name TEXT;
    v_has_mo_id BOOLEAN;
BEGIN
    -- Check which column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'mo_id'
    ) INTO v_has_mo_id;
    
    IF v_has_mo_id THEN
        v_mo_column_name := 'mo_id';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'manufacturing_order_id') THEN
        v_mo_column_name := 'manufacturing_order_id';
    ELSE
        RAISE WARNING '⚠️ Cannot find manufacturing order ID column - skipping orphan check';
        RETURN;
    END IF;
    
    EXECUTE format('
        SELECT COUNT(*) 
        FROM public.stage_costs sc
        LEFT JOIN public.manufacturing_orders mo ON mo.id = sc.%I
        WHERE mo.id IS NULL
        AND sc.%I IS NOT NULL
    ', v_mo_column_name, v_mo_column_name) INTO v_orphan_count;
    
    IF v_orphan_count > 0 THEN
        RAISE WARNING '⚠️ Found % orphan stage_costs (mo_id not found in manufacturing_orders)', v_orphan_count;
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
BEGIN
    SELECT COUNT(*) INTO v_org_count
    FROM public.organizations;
    
    IF v_org_count = 0 THEN
        RAISE EXCEPTION '❌ No organizations found! Please create at least one organization first.';
    ELSE
        RAISE NOTICE '✅ Found % organization(s)', v_org_count;
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

-- Estimate how many records will be created
DO $$
DECLARE
    v_stages_to_create INTEGER;
    v_wip_logs_to_create INTEGER;
    v_orgs_count INTEGER;
    v_org_column_name TEXT;
    v_mo_column_name TEXT;
    v_has_tenant_id BOOLEAN;
    v_has_org_id BOOLEAN;
    v_has_mo_id BOOLEAN;
BEGIN
    -- Detect column names
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'tenant_id'
    ) INTO v_has_tenant_id;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'org_id'
    ) INTO v_has_org_id;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'mo_id'
    ) INTO v_has_mo_id;
    
    IF v_has_tenant_id THEN
        v_org_column_name := 'tenant_id';
    ELSIF v_has_org_id THEN
        v_org_column_name := 'org_id';
    ELSE
        RAISE WARNING '⚠️ Cannot find org/tenant column - using default estimate';
        v_org_column_name := 'tenant_id'; -- Default, will fail gracefully if doesn't exist
    END IF;
    
    IF v_has_mo_id THEN
        v_mo_column_name := 'mo_id';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'manufacturing_order_id') THEN
        v_mo_column_name := 'manufacturing_order_id';
    ELSE
        RAISE WARNING '⚠️ Cannot find MO column - using default estimate';
        v_mo_column_name := 'mo_id'; -- Default
    END IF;
    
    -- Count distinct org_id/tenant_id + stage_no combinations
    EXECUTE format('
        SELECT COUNT(DISTINCT (%I, stage_no)) 
        FROM public.stage_costs
        WHERE stage_no IS NOT NULL
    ', v_org_column_name) INTO v_stages_to_create;
    
    -- Count stage_costs records to migrate
    EXECUTE format('
        SELECT COUNT(*) 
        FROM public.stage_costs
        WHERE %I IS NOT NULL
        AND stage_no IS NOT NULL
    ', v_mo_column_name) INTO v_wip_logs_to_create;
    
    -- Count organizations
    EXECUTE format('
        SELECT COUNT(DISTINCT %I) 
        FROM public.stage_costs
    ', v_org_column_name) INTO v_orgs_count;
    
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

-- Check if we can safely rollback (by checking if new tables exist)
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
    v_free_space TEXT;
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

