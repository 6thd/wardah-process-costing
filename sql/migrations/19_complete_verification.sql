-- ===================================================================
-- COMPLETE VERIFICATION: Phase 1 - All Components
-- ===================================================================
-- 
-- Run this to get a complete verification report
-- ===================================================================

-- ============================================
-- 1. TABLES EXISTENCE CHECK
-- ============================================
SELECT 
    'Tables Check' as check_type,
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

-- ============================================
-- 2. RLS (Row Level Security) CHECK
-- ============================================
SELECT 
    'RLS Check' as check_type,
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

-- ============================================
-- 3. RLS POLICIES CHECK
-- ============================================
SELECT 
    'RLS Policies' as check_type,
    schemaname,
    tablename,
    policyname,
    CASE 
        WHEN policyname LIKE '%tenant_isolation%' THEN '✅ Tenant Isolation'
        ELSE '⚠️ Other Policy'
    END as policy_type
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
ORDER BY tablename, policyname;

-- ============================================
-- 4. TRIGGERS CHECK
-- ============================================
SELECT 
    'Triggers Check' as check_type,
    trigger_name,
    event_object_table,
    action_timing,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
AND event_object_table IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
ORDER BY event_object_table, trigger_name;

-- ============================================
-- 5. INDEXES SUMMARY (Already Verified ✅)
-- ============================================
SELECT 
    'Indexes Summary' as check_type,
    tablename,
    COUNT(*) as index_count
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
GROUP BY tablename
ORDER BY tablename;

-- ============================================
-- 6. FOREIGN KEYS CHECK
-- ============================================
SELECT 
    'Foreign Keys' as check_type,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_name
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
ORDER BY tc.table_name, kcu.column_name;

-- ============================================
-- 7. COLUMNS CHECK (Key Columns)
-- ============================================
SELECT 
    'Key Columns' as check_type,
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
AND column_name IN ('id', 'org_id', 'created_at', 'updated_at')
ORDER BY table_name, column_name;

-- ============================================
-- 8. FINAL SUMMARY
-- ============================================
DO $$
DECLARE
    v_table_count INTEGER;
    v_rls_enabled_count INTEGER;
    v_trigger_count INTEGER;
    v_index_count INTEGER;
    v_policy_count INTEGER;
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
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'PHASE 1 VERIFICATION SUMMARY';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Tables:          % / 3', v_table_count;
    RAISE NOTICE 'RLS Enabled:    % / 3', v_rls_enabled_count;
    RAISE NOTICE 'Triggers:       %', v_trigger_count;
    RAISE NOTICE 'Indexes:        %', v_index_count;
    RAISE NOTICE 'RLS Policies:   %', v_policy_count;
    RAISE NOTICE '';
    
    IF v_table_count = 3 AND v_rls_enabled_count = 3 AND v_trigger_count > 0 AND v_index_count >= 15 THEN
        RAISE NOTICE '✅ PHASE 1 COMPLETE - All checks passed!';
        RAISE NOTICE '';
        RAISE NOTICE 'Next Steps:';
        RAISE NOTICE '  1. Create initial manufacturing_stages';
        RAISE NOTICE '  2. Test services in supabase-service.ts';
        RAISE NOTICE '  3. Start using new structure';
    ELSE
        RAISE WARNING '⚠️ Some checks failed - review results above';
    END IF;
    
    RAISE NOTICE '========================================';
END $$;

