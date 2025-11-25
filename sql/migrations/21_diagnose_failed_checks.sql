-- ===================================================================
-- DIAGNOSE FAILED CHECKS - Phase 1
-- ===================================================================
-- 
-- This script will identify exactly which checks failed
-- ===================================================================

DO $$
DECLARE
    v_table_count INTEGER;
    v_rls_enabled_count INTEGER;
    v_trigger_count INTEGER;
    v_index_count INTEGER;
    v_policy_count INTEGER;
    v_fk_count INTEGER;
    v_issue_count INTEGER := 0;
    rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '╔════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║        DIAGNOSING FAILED CHECKS                        ║';
    RAISE NOTICE '╚════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    
    -- ============================================
    -- 1. CHECK TABLES
    -- ============================================
    SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
    WHERE table_schema = 'public' 
    AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    RAISE NOTICE '1️⃣  TABLES CHECK:';
    RAISE NOTICE '   Expected: 3 tables';
    RAISE NOTICE '   Found:    % tables', v_table_count;
    
    IF v_table_count = 3 THEN
        RAISE NOTICE '   Status:   ✅ PASS';
    ELSE
        RAISE WARNING '   Status:   ❌ FAIL - Missing % table(s)', (3 - v_table_count);
        v_issue_count := v_issue_count + 1;
        
        -- Show which tables are missing
        RAISE NOTICE '   Missing tables:';
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manufacturing_stages') THEN
            RAISE WARNING '     - manufacturing_stages';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_wip_log') THEN
            RAISE WARNING '     - stage_wip_log';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'standard_costs') THEN
            RAISE WARNING '     - standard_costs';
        END IF;
    END IF;
    RAISE NOTICE '';
    
    -- ============================================
    -- 2. CHECK RLS ENABLED
    -- ============================================
    SELECT COUNT(*) INTO v_rls_enabled_count
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
    AND rowsecurity = true;
    
    RAISE NOTICE '2️⃣  RLS ENABLED CHECK:';
    RAISE NOTICE '   Expected: 3 tables with RLS enabled';
    RAISE NOTICE '   Found:    % tables with RLS enabled', v_rls_enabled_count;
    
    IF v_rls_enabled_count = 3 THEN
        RAISE NOTICE '   Status:   ✅ PASS';
    ELSE
        RAISE WARNING '   Status:   ❌ FAIL - % table(s) missing RLS', (3 - v_rls_enabled_count);
        v_issue_count := v_issue_count + 1;
        
        -- Show which tables don't have RLS
        RAISE NOTICE '   Tables without RLS:';
        IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'manufacturing_stages' AND rowsecurity = true) THEN
            RAISE WARNING '     - manufacturing_stages';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stage_wip_log' AND rowsecurity = true) THEN
            RAISE WARNING '     - stage_wip_log';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'standard_costs' AND rowsecurity = true) THEN
            RAISE WARNING '     - standard_costs';
        END IF;
    END IF;
    RAISE NOTICE '';
    
    -- ============================================
    -- 3. CHECK TRIGGERS
    -- ============================================
    SELECT COUNT(*) INTO v_trigger_count
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
    AND event_object_table IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    RAISE NOTICE '3️⃣  TRIGGERS CHECK:';
    RAISE NOTICE '   Expected: At least 1 trigger';
    RAISE NOTICE '   Found:    % trigger(s)', v_trigger_count;
    
    IF v_trigger_count > 0 THEN
        RAISE NOTICE '   Status:   ✅ PASS';
        RAISE NOTICE '   Triggers found:';
        FOR rec IN 
            SELECT trigger_name, event_object_table 
            FROM information_schema.triggers
            WHERE event_object_schema = 'public'
            AND event_object_table IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
        LOOP
            RAISE NOTICE '     - % on %', rec.trigger_name, rec.event_object_table;
        END LOOP;
    ELSE
        RAISE WARNING '   Status:   ❌ FAIL - No triggers found';
        v_issue_count := v_issue_count + 1;
        RAISE NOTICE '   Expected trigger: trigger_calculate_wip_eu on stage_wip_log';
    END IF;
    RAISE NOTICE '';
    
    -- ============================================
    -- 4. CHECK INDEXES
    -- ============================================
    SELECT COUNT(*) INTO v_index_count
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    RAISE NOTICE '4️⃣  INDEXES CHECK:';
    RAISE NOTICE '   Expected: At least 15 indexes';
    RAISE NOTICE '   Found:    % index(es)', v_index_count;
    
    IF v_index_count >= 15 THEN
        RAISE NOTICE '   Status:   ✅ PASS';
    ELSE
        RAISE WARNING '   Status:   ❌ FAIL - Expected at least 15, found %', v_index_count;
        v_issue_count := v_issue_count + 1;
    END IF;
    RAISE NOTICE '';
    
    -- ============================================
    -- 5. CHECK RLS POLICIES
    -- ============================================
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    RAISE NOTICE '5️⃣  RLS POLICIES CHECK:';
    RAISE NOTICE '   Expected: At least 3 policies';
    RAISE NOTICE '   Found:    % polic(ies)', v_policy_count;
    
    IF v_policy_count >= 3 THEN
        RAISE NOTICE '   Status:   ✅ PASS';
        RAISE NOTICE '   Policies found:';
        FOR rec IN 
            SELECT tablename, policyname 
            FROM pg_policies
            WHERE schemaname = 'public'
            AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
            ORDER BY tablename, policyname
        LOOP
            RAISE NOTICE '     - % on %', rec.policyname, rec.tablename;
        END LOOP;
    ELSE
        RAISE WARNING '   Status:   ❌ FAIL - Expected at least 3, found %', v_policy_count;
        v_issue_count := v_issue_count + 1;
        
        -- Show which tables are missing policies
        RAISE NOTICE '   Tables missing policies:';
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'manufacturing_stages') THEN
            RAISE WARNING '     - manufacturing_stages';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stage_wip_log') THEN
            RAISE WARNING '     - stage_wip_log';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'standard_costs') THEN
            RAISE WARNING '     - standard_costs';
        END IF;
    END IF;
    RAISE NOTICE '';
    
    -- ============================================
    -- 6. CHECK FOREIGN KEYS
    -- ============================================
    SELECT COUNT(*) INTO v_fk_count
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
    AND table_schema = 'public'
    AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');
    
    RAISE NOTICE '6️⃣  FOREIGN KEYS CHECK:';
    RAISE NOTICE '   Expected: At least 1 foreign key';
    RAISE NOTICE '   Found:    % foreign key(s)', v_fk_count;
    
    IF v_fk_count > 0 THEN
        RAISE NOTICE '   Status:   ✅ PASS';
        RAISE NOTICE '   Foreign keys found:';
        FOR rec IN 
            SELECT 
                tc.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
            ORDER BY tc.table_name, kcu.column_name
            LIMIT 10
        LOOP
            RAISE NOTICE '     - %.% -> %', rec.table_name, rec.column_name, rec.foreign_table_name;
        END LOOP;
    ELSE
        RAISE WARNING '   Status:   ❌ FAIL - No foreign keys found';
        v_issue_count := v_issue_count + 1;
    END IF;
    RAISE NOTICE '';
    
    -- ============================================
    -- SUMMARY
    -- ============================================
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'DIAGNOSIS SUMMARY:';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    
    IF v_issue_count = 0 THEN
        RAISE NOTICE '✅ ALL CHECKS PASSED!';
        RAISE NOTICE '';
        RAISE NOTICE 'Phase 1 is complete and ready to use.';
    ELSE
        RAISE WARNING '❌ % ISSUE(S) FOUND', v_issue_count;
        RAISE NOTICE '';
        RAISE NOTICE 'Review the warnings above to identify what needs to be fixed.';
        RAISE NOTICE '';
        RAISE NOTICE 'Common fixes:';
        RAISE NOTICE '  - If RLS disabled: Run ALTER TABLE ... ENABLE ROW LEVEL SECURITY;';
        RAISE NOTICE '  - If policies missing: Re-run CREATE POLICY statements;';
        RAISE NOTICE '  - If triggers missing: Re-run CREATE TRIGGER statements;';
        RAISE NOTICE '';
        RAISE NOTICE 'Fix script: sql/migrations/22_fix_missing_components.sql';
    END IF;
    
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
