-- ===================================================================
-- QUICK VERIFICATION SUMMARY - Phase 1
-- ===================================================================
-- 
-- Run this to get a quick summary of all verification checks
-- ===================================================================

-- ============================================
-- SUMMARY REPORT
-- ============================================
DO $$
DECLARE
    v_table_count INTEGER;
    v_rls_enabled_count INTEGER;
    v_trigger_count INTEGER;
    v_index_count INTEGER;
    v_policy_count INTEGER;
    v_fk_count INTEGER;
    v_all_passed BOOLEAN := true;
BEGIN
    -- Count tables
    SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
    WHERE table_schema = 'public' 
    AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    -- Count RLS enabled
    SELECT COUNT(*) INTO v_rls_enabled_count
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
    AND rowsecurity = true;
    
    -- Count triggers
    SELECT COUNT(*) INTO v_trigger_count
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
    AND event_object_table IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    -- Count indexes
    SELECT COUNT(*) INTO v_index_count
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    -- Count policies
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    -- Count foreign keys
    SELECT COUNT(*) INTO v_fk_count
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
    AND table_schema = 'public'
    AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    RAISE NOTICE '';
    RAISE NOTICE '╔════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║        PHASE 1 VERIFICATION SUMMARY                    ║';
    RAISE NOTICE '╚════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '📊 COMPONENT STATUS:';
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '  Tables:          % / 3  %', 
        v_table_count, 
        CASE WHEN v_table_count = 3 THEN '✅' ELSE '❌' END;
    RAISE NOTICE '  RLS Enabled:     % / 3  %', 
        v_rls_enabled_count, 
        CASE WHEN v_rls_enabled_count = 3 THEN '✅' ELSE '❌' END;
    RAISE NOTICE '  Triggers:        %       %', 
        v_trigger_count, 
        CASE WHEN v_trigger_count > 0 THEN '✅' ELSE '❌' END;
    RAISE NOTICE '  Indexes:         %       %', 
        v_index_count, 
        CASE WHEN v_index_count >= 15 THEN '✅' ELSE '❌' END;
    RAISE NOTICE '  RLS Policies:    %       %', 
        v_policy_count, 
        CASE WHEN v_policy_count >= 3 THEN '✅' ELSE '❌' END;
    RAISE NOTICE '  Foreign Keys:    %       %', 
        v_fk_count, 
        CASE WHEN v_fk_count > 0 THEN '✅' ELSE '❌' END;
    RAISE NOTICE '';
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    
    -- Check if all passed
    IF v_table_count != 3 THEN
        v_all_passed := false;
        RAISE WARNING '  ❌ Tables: Expected 3, found %', v_table_count;
    END IF;
    
    IF v_rls_enabled_count != 3 THEN
        v_all_passed := false;
        RAISE WARNING '  ❌ RLS: Expected 3 enabled, found %', v_rls_enabled_count;
    END IF;
    
    IF v_trigger_count = 0 THEN
        v_all_passed := false;
        RAISE WARNING '  ❌ Triggers: No triggers found';
    END IF;
    
    IF v_index_count < 15 THEN
        v_all_passed := false;
        RAISE WARNING '  ❌ Indexes: Expected at least 15, found %', v_index_count;
    END IF;
    
    IF v_policy_count < 3 THEN
        v_all_passed := false;
        RAISE WARNING '  ❌ RLS Policies: Expected at least 3, found %', v_policy_count;
    END IF;
    
    IF v_fk_count = 0 THEN
        v_all_passed := false;
        RAISE WARNING '  ❌ Foreign Keys: No foreign keys found';
    END IF;
    
    RAISE NOTICE '';
    
    IF v_all_passed THEN
        RAISE NOTICE '╔════════════════════════════════════════════════════════╗';
        RAISE NOTICE '║  ✅ PHASE 1 COMPLETE - ALL CHECKS PASSED!             ║';
        RAISE NOTICE '╚════════════════════════════════════════════════════════╝';
        RAISE NOTICE '';
        RAISE NOTICE '🎯 NEXT STEPS:';
        RAISE NOTICE '─────────────────────────────────────────────────────────';
        RAISE NOTICE '  1. Create initial manufacturing_stages';
        RAISE NOTICE '  2. Test services in supabase-service.ts';
        RAISE NOTICE '  3. Start using new structure for new MOs';
        RAISE NOTICE '';
    ELSE
        RAISE WARNING '╔════════════════════════════════════════════════════════╗';
        RAISE WARNING '║  ⚠️  SOME CHECKS FAILED - REVIEW WARNINGS ABOVE        ║';
        RAISE WARNING '╚════════════════════════════════════════════════════════╝';
        RAISE NOTICE '';
        RAISE NOTICE 'Run detailed verification:';
        RAISE NOTICE '  File: sql/migrations/19_complete_verification.sql';
        RAISE NOTICE '';
    END IF;
    
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

