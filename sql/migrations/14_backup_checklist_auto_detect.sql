-- ===================================================================
-- BACKUP & SAFETY CHECKLIST - Auto-Detect Version
-- ===================================================================
-- 
-- هذا الملف يكتشف بنية الجدول تلقائياً ويعمل مع أي بنية
-- ===================================================================

-- ===================================================================
-- STEP 0: Detect Table Structure - Complete Detection
-- ===================================================================

DO $$
DECLARE
    v_table_exists BOOLEAN;
    v_columns_info TEXT;
    v_mo_column TEXT;
    v_stage_column TEXT;
    v_org_column TEXT;
    v_dm_column TEXT;
    v_dl_column TEXT;
    v_moh_column TEXT;
    v_total_column TEXT;
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
    
    -- Get all column names for reference
    SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
    INTO v_columns_info
    FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = 'stage_costs';
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'STAGE_COSTS TABLE STRUCTURE';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Available columns: %', v_columns_info;
    RAISE NOTICE '========================================';
    
    -- Detect MO column
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'mo_id') THEN
        v_mo_column := 'mo_id';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'manufacturing_order_id') THEN
        v_mo_column := 'manufacturing_order_id';
    ELSE
        RAISE EXCEPTION '❌ Cannot find manufacturing order ID column. Available columns: %', v_columns_info;
    END IF;
    
    -- Detect Stage column
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'stage_no') THEN
        v_stage_column := 'stage_no';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'stage_number') THEN
        v_stage_column := 'stage_number';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'stage_id') THEN
        v_stage_column := 'stage_id';
    ELSE
        -- If no stage column found, show available columns and continue with warnings
        RAISE WARNING '⚠️ Cannot find stage column (stage_no, stage_number, or stage_id). Available columns: %', v_columns_info;
        RAISE WARNING '⚠️ Migration may not work correctly without a stage column!';
        v_stage_column := NULL; -- Set to NULL to handle gracefully
    END IF;
    
    -- Detect Org/Tenant column
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'tenant_id') THEN
        v_org_column := 'tenant_id';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'org_id') THEN
        v_org_column := 'org_id';
    ELSE
        RAISE WARNING '⚠️ Cannot find org/tenant column - some checks will be skipped';
        v_org_column := NULL;
    END IF;
    
    -- Detect cost columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'dm_cost') THEN
        v_dm_column := 'dm_cost';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'direct_materials_cost') THEN
        v_dm_column := 'direct_materials_cost';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'material_cost') THEN
        v_dm_column := 'material_cost';
    ELSE
        v_dm_column := NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'dl_cost') THEN
        v_dl_column := 'dl_cost';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'direct_labor_cost') THEN
        v_dl_column := 'direct_labor_cost';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'labor_cost') THEN
        v_dl_column := 'labor_cost';
    ELSE
        v_dl_column := NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'moh_cost') THEN
        v_moh_column := 'moh_cost';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'manufacturing_overhead_cost') THEN
        v_moh_column := 'manufacturing_overhead_cost';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'overhead_cost') THEN
        v_moh_column := 'overhead_cost';
    ELSE
        v_moh_column := NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stage_costs' AND column_name = 'total_cost') THEN
        v_total_column := 'total_cost';
    ELSE
        v_total_column := NULL;
    END IF;
    
    RAISE NOTICE 'Detected column mappings:';
    RAISE NOTICE '  MO Column: %', v_mo_column;
    RAISE NOTICE '  Stage Column: %', v_stage_column;
    RAISE NOTICE '  Org/Tenant Column: %', COALESCE(v_org_column, 'NOT FOUND');
    RAISE NOTICE '  DM Cost Column: %', COALESCE(v_dm_column, 'NOT FOUND');
    RAISE NOTICE '  DL Cost Column: %', COALESCE(v_dl_column, 'NOT FOUND');
    RAISE NOTICE '  MOH Cost Column: %', COALESCE(v_moh_column, 'NOT FOUND');
    RAISE NOTICE '  Total Cost Column: %', COALESCE(v_total_column, 'NOT FOUND');
    RAISE NOTICE '========================================';
    
    -- Store in temp table for use in other blocks
    CREATE TEMP TABLE IF NOT EXISTS stage_costs_column_mapping (
        mo_column TEXT,
        stage_column TEXT,
        org_column TEXT,
        dm_column TEXT,
        dl_column TEXT,
        moh_column TEXT,
        total_column TEXT
    );
    
    -- Clear temp table before insert (safe: temporary table, session-scoped)
    TRUNCATE TABLE stage_costs_column_mapping;
    INSERT INTO stage_costs_column_mapping VALUES (
        v_mo_column, v_stage_column, v_org_column, 
        v_dm_column, v_dl_column, v_moh_column, v_total_column
    );
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
    v_stage_column TEXT;
    v_dm_column TEXT;
    v_dl_column TEXT;
    v_moh_column TEXT;
    v_total_column TEXT;
    v_cost_check_sql TEXT;
BEGIN
    -- Get column names
    SELECT mo_column, stage_column, dm_column, dl_column, moh_column, total_column
    INTO v_mo_column, v_stage_column, v_dm_column, v_dl_column, v_moh_column, v_total_column
    FROM stage_costs_column_mapping;
    
    -- Count records with NULL mo_id
    EXECUTE format('SELECT COUNT(*) FROM public.stage_costs WHERE %I IS NULL', v_mo_column) INTO v_null_mo_count;
    
    -- Count records with NULL stage (if column exists)
    IF v_stage_column IS NOT NULL THEN
        EXECUTE format('SELECT COUNT(*) FROM public.stage_costs WHERE %I IS NULL', v_stage_column) INTO v_null_stage_count;
    ELSE
        v_null_stage_count := 0;
        RAISE WARNING '⚠️ Stage column not found - skipping stage NULL check';
    END IF;
    
    -- Count records with negative costs (build dynamic query)
    v_cost_check_sql := 'SELECT COUNT(*) FROM public.stage_costs WHERE (';
    IF v_dm_column IS NOT NULL THEN
        v_cost_check_sql := v_cost_check_sql || format('%I < 0', v_dm_column);
    END IF;
    IF v_dl_column IS NOT NULL THEN
        IF v_cost_check_sql LIKE '%< 0%' THEN
            v_cost_check_sql := v_cost_check_sql || ' OR ';
        END IF;
        v_cost_check_sql := v_cost_check_sql || format('%I < 0', v_dl_column);
    END IF;
    IF v_moh_column IS NOT NULL THEN
        IF v_cost_check_sql LIKE '%< 0%' THEN
            v_cost_check_sql := v_cost_check_sql || ' OR ';
        END IF;
        v_cost_check_sql := v_cost_check_sql || format('%I < 0', v_moh_column);
    END IF;
    IF v_total_column IS NOT NULL THEN
        IF v_cost_check_sql LIKE '%< 0%' THEN
            v_cost_check_sql := v_cost_check_sql || ' OR ';
        END IF;
        v_cost_check_sql := v_cost_check_sql || format('%I < 0', v_total_column);
    END IF;
    v_cost_check_sql := v_cost_check_sql || ')';
    
    IF v_cost_check_sql != 'SELECT COUNT(*) FROM public.stage_costs WHERE ()' THEN
        EXECUTE v_cost_check_sql INTO v_negative_cost_count;
    ELSE
        v_negative_cost_count := 0;
    END IF;
    
    -- Total count
    SELECT COUNT(*) INTO v_total_count FROM public.stage_costs;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'DATA INTEGRITY CHECK RESULTS';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Total stage_costs records: %', v_total_count;
    RAISE NOTICE 'Records with NULL %: %', v_mo_column, v_null_mo_count;
    IF v_stage_column IS NOT NULL THEN
        RAISE NOTICE 'Records with NULL %: %', v_stage_column, v_null_stage_count;
    ELSE
        RAISE NOTICE 'Stage column: NOT FOUND (cannot check NULL values)';
    END IF;
    RAISE NOTICE 'Records with negative costs: %', v_negative_cost_count;
    RAISE NOTICE '========================================';
    
    IF v_null_mo_count > 0 THEN
        RAISE WARNING '⚠️ Found % records with NULL % - these will be skipped!', v_null_mo_count, v_mo_column;
    END IF;
    
    IF v_stage_column IS NOT NULL AND v_null_stage_count > 0 THEN
        RAISE WARNING '⚠️ Found % records with NULL % - these will be skipped!', v_null_stage_count, v_stage_column;
    END IF;
    
    IF v_negative_cost_count > 0 THEN
        RAISE WARNING '⚠️ Found % records with negative costs - please review!', v_negative_cost_count;
    END IF;
    
    IF v_null_mo_count = 0 AND v_null_stage_count = 0 AND v_negative_cost_count = 0 THEN
        RAISE NOTICE '✅ All data integrity checks passed!';
    END IF;
END $$;

-- Check 2: Verify manufacturing_orders exist
DO $$
DECLARE
    v_orphan_count INTEGER;
    v_mo_column TEXT;
BEGIN
    SELECT mo_column INTO v_mo_column FROM stage_costs_column_mapping;
    
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

-- Check 3: Count distinct stages
DO $$
DECLARE
    v_total_stages INTEGER;
    v_stage_column TEXT;
BEGIN
    SELECT stage_column INTO v_stage_column FROM stage_costs_column_mapping;
    
    IF v_stage_column IS NULL THEN
        RAISE WARNING '⚠️ Stage column not found - cannot count distinct stages';
        RETURN;
    END IF;
    
    EXECUTE format('
        SELECT COUNT(DISTINCT %I) 
        FROM public.stage_costs
        WHERE %I IS NOT NULL
    ', v_stage_column, v_stage_column) INTO v_total_stages;
    
    RAISE NOTICE 'Total distinct stages found: %', v_total_stages;
    RAISE NOTICE 'Note: work_center_id linking is optional - stages will be created even if no work center matches';
END $$;

-- ===================================================================
-- STEP 2: Foreign Key Constraints Check
-- ===================================================================

DO $$
DECLARE
    v_org_count INTEGER;
    v_org_column TEXT;
    v_table_name TEXT;
BEGIN
    SELECT org_column INTO v_org_column FROM stage_costs_column_mapping;
    
    IF v_org_column IS NULL THEN
        RAISE WARNING '⚠️ No org/tenant column found - skipping FK check';
        RETURN;
    END IF;
    
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

-- Check gl_accounts
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
    v_stage_column TEXT;
    v_mo_column TEXT;
BEGIN
    SELECT mo_column, stage_column, org_column 
    INTO v_mo_column, v_stage_column, v_org_column 
    FROM stage_costs_column_mapping;
    
    IF v_org_column IS NULL THEN
        RAISE WARNING '⚠️ Cannot estimate - org/tenant column not found';
        RETURN;
    END IF;
    
    IF v_stage_column IS NULL THEN
        RAISE WARNING '⚠️ Cannot estimate - stage column not found';
        RETURN;
    END IF;
    
    -- Count distinct org + stage combinations
    EXECUTE format('
        SELECT COUNT(DISTINCT (%I, %I)) 
        FROM public.stage_costs
        WHERE %I IS NOT NULL
    ', v_org_column, v_stage_column, v_stage_column) INTO v_stages_to_create;
    
    -- Count records to migrate
    EXECUTE format('
        SELECT COUNT(*) 
        FROM public.stage_costs
        WHERE %I IS NOT NULL
        AND %I IS NOT NULL
    ', v_mo_column, v_stage_column) INTO v_wip_logs_to_create;
    
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
    SELECT pg_size_pretty(pg_database_size(current_database())) INTO v_db_size;
    SELECT pg_size_pretty(pg_total_relation_size('public.stage_costs')) INTO v_table_size;
    
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

-- Cleanup
DROP TABLE IF EXISTS stage_costs_column_mapping;

