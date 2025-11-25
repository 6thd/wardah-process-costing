-- ===================================================================
-- FINAL VERIFICATION - Phase 1 Complete
-- ===================================================================
-- 
-- Run this to confirm all Phase 1 components are working
-- ===================================================================

DO $$
DECLARE
    v_table_count INTEGER;
    v_rls_enabled_count INTEGER;
    v_trigger_count INTEGER;
    v_index_count INTEGER;
    v_policy_count INTEGER;
    v_fk_count INTEGER;
    v_all_passed BOOLEAN := true;
    v_issue_count INTEGER := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '╔════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║        PHASE 1 - FINAL VERIFICATION                     ║';
    RAISE NOTICE '╚════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    
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
    
    -- Check each component
    RAISE NOTICE '📊 VERIFICATION RESULTS:';
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    
    -- Tables
    IF v_table_count = 3 THEN
        RAISE NOTICE '  Tables:          % / 3  ✅', v_table_count;
    ELSE
        RAISE WARNING '  Tables:          % / 3  ❌', v_table_count;
        v_all_passed := false;
        v_issue_count := v_issue_count + 1;
    END IF;
    
    -- RLS
    IF v_rls_enabled_count = 3 THEN
        RAISE NOTICE '  RLS Enabled:     % / 3  ✅', v_rls_enabled_count;
    ELSE
        RAISE WARNING '  RLS Enabled:     % / 3  ❌', v_rls_enabled_count;
        v_all_passed := false;
        v_issue_count := v_issue_count + 1;
    END IF;
    
    -- Triggers
    IF v_trigger_count > 0 THEN
        RAISE NOTICE '  Triggers:        %       ✅', v_trigger_count;
    ELSE
        RAISE WARNING '  Triggers:        %       ❌', v_trigger_count;
        v_all_passed := false;
        v_issue_count := v_issue_count + 1;
    END IF;
    
    -- Indexes
    IF v_index_count >= 15 THEN
        RAISE NOTICE '  Indexes:         %       ✅', v_index_count;
    ELSE
        RAISE WARNING '  Indexes:         %       ❌', v_index_count;
        v_all_passed := false;
        v_issue_count := v_issue_count + 1;
    END IF;
    
    -- Policies
    IF v_policy_count >= 3 THEN
        RAISE NOTICE '  RLS Policies:    %       ✅', v_policy_count;
    ELSE
        RAISE WARNING '  RLS Policies:    %       ❌', v_policy_count;
        v_all_passed := false;
        v_issue_count := v_issue_count + 1;
    END IF;
    
    -- Foreign Keys
    IF v_fk_count > 0 THEN
        RAISE NOTICE '  Foreign Keys:    %       ✅', v_fk_count;
    ELSE
        RAISE WARNING '  Foreign Keys:    %       ❌', v_fk_count;
        v_all_passed := false;
        v_issue_count := v_issue_count + 1;
    END IF;
    
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '';
    
    -- Final result
    IF v_all_passed THEN
        RAISE NOTICE '╔════════════════════════════════════════════════════════╗';
        RAISE NOTICE '║  ✅ PHASE 1 COMPLETE - ALL CHECKS PASSED!             ║';
        RAISE NOTICE '╚════════════════════════════════════════════════════════╝';
        RAISE NOTICE '';
        RAISE NOTICE '🎉 SUCCESS! All components are properly configured.';
        RAISE NOTICE '';
        RAISE NOTICE '📋 CREATED COMPONENTS:';
        RAISE NOTICE '   ✅ manufacturing_stages table';
        RAISE NOTICE '   ✅ stage_wip_log table';
        RAISE NOTICE '   ✅ standard_costs table';
        RAISE NOTICE '   ✅ RLS enabled on all tables';
        RAISE NOTICE '   ✅ RLS policies configured';
        RAISE NOTICE '   ✅ Triggers created';
        RAISE NOTICE '   ✅ Indexes created';
        RAISE NOTICE '   ✅ Foreign keys configured';
        RAISE NOTICE '';
        RAISE NOTICE '🎯 NEXT STEPS:';
        RAISE NOTICE '─────────────────────────────────────────────────────────';
        RAISE NOTICE '  1. Create initial manufacturing_stages';
        RAISE NOTICE '     INSERT INTO manufacturing_stages (org_id, code, name, order_sequence)';
        RAISE NOTICE '     VALUES (...);';
        RAISE NOTICE '';
        RAISE NOTICE '  2. Test services in supabase-service.ts';
        RAISE NOTICE '     - manufacturingStagesService';
        RAISE NOTICE '     - stageWipLogService';
        RAISE NOTICE '     - standardCostsService';
        RAISE NOTICE '';
        RAISE NOTICE '  3. Start using new structure for new Manufacturing Orders';
        RAISE NOTICE '';
        RAISE NOTICE '════════════════════════════════════════════════════════';
    ELSE
        RAISE WARNING '╔════════════════════════════════════════════════════════╗';
        RAISE WARNING '║  ⚠️  SOME ISSUES REMAIN - % ISSUE(S) FOUND           ║', v_issue_count;
        RAISE WARNING '╚════════════════════════════════════════════════════════╝';
        RAISE NOTICE '';
        RAISE NOTICE 'Review the warnings above and run fix script again:';
        RAISE NOTICE '  File: sql/migrations/22_fix_missing_components.sql';
        RAISE NOTICE '';
    END IF;
    
END $$;

