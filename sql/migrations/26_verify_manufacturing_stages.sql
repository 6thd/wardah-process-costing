-- ===================================================================
-- VERIFY MANUFACTURING STAGES - Phase 1
-- ===================================================================
-- 
-- This script verifies that manufacturing stages were created correctly
-- ===================================================================

-- ===================================================================
-- 1. CHECK STAGES COUNT AND DATA
-- ===================================================================
SELECT 
    'Stages Created' as check_type,
    COUNT(*)::TEXT as count,
    COUNT(DISTINCT org_id)::TEXT as orgs,
    CASE 
        WHEN COUNT(*) >= 1 THEN '✅ PASS'
        ELSE '❌ FAIL - No stages found'
    END as status
FROM manufacturing_stages;

-- ===================================================================
-- 2. DISPLAY ALL STAGES
-- ===================================================================
SELECT 
    code,
    name,
    name_ar,
    order_sequence,
    is_active,
    CASE 
        WHEN work_center_id IS NOT NULL THEN '✅ Linked'
        ELSE '⚠️ Not Linked'
    END as work_center_status,
    CASE 
        WHEN wip_gl_account_id IS NOT NULL THEN '✅ Linked'
        ELSE '⚠️ Not Linked'
    END as gl_account_status,
    created_at
FROM manufacturing_stages
ORDER BY order_sequence;

-- ===================================================================
-- 3. CHECK FOR DUPLICATES
-- ===================================================================
SELECT 
    'Duplicate Check' as check_type,
    org_id,
    code,
    COUNT(*)::TEXT as count,
    CASE 
        WHEN COUNT(*) > 1 THEN '❌ DUPLICATE'
        ELSE '✅ UNIQUE'
    END as status
FROM manufacturing_stages
GROUP BY org_id, code
HAVING COUNT(*) > 1;

-- ===================================================================
-- 4. CHECK SEQUENCE GAPS
-- ===================================================================
SELECT 
    'Sequence Check' as check_type,
    MIN(order_sequence)::TEXT as min_sequence,
    MAX(order_sequence)::TEXT as max_sequence,
    COUNT(DISTINCT order_sequence)::TEXT as unique_sequences,
    COUNT(*)::TEXT as total_stages,
    CASE 
        WHEN COUNT(DISTINCT order_sequence) = COUNT(*) 
        AND MIN(order_sequence) = 1 
        THEN '✅ PASS - No gaps, starts at 1'
        WHEN COUNT(DISTINCT order_sequence) = COUNT(*) 
        THEN '⚠️ WARN - No gaps but doesn''t start at 1'
        ELSE '⚠️ WARN - Sequence gaps found'
    END as status
FROM manufacturing_stages;

-- ===================================================================
-- 5. CHECK RLS IS WORKING
-- ===================================================================
SELECT 
    'RLS Check' as check_type,
    tablename,
    rowsecurity,
    CASE 
        WHEN rowsecurity THEN '✅ Enabled'
        ELSE '❌ Disabled'
    END as status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'manufacturing_stages';

-- ===================================================================
-- 6. CHECK RELATIONSHIPS (Foreign Keys)
-- ===================================================================
SELECT 
    'Foreign Keys' as check_type,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table,
    CASE 
        WHEN ccu.table_name IS NOT NULL THEN '✅ Linked'
        ELSE '❌ Not Linked'
    END as status
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema = 'public'
AND tc.table_name = 'manufacturing_stages'
AND kcu.column_name IN ('work_center_id', 'wip_gl_account_id');

-- ===================================================================
-- 7. SUMMARY REPORT
-- ===================================================================
DO $$
DECLARE
    v_total_stages INTEGER;
    v_active_stages INTEGER;
    v_orgs_count INTEGER;
    v_work_centers_linked INTEGER;
    v_gl_accounts_linked INTEGER;
BEGIN
    -- Count stages
    SELECT COUNT(*), COUNT(*) FILTER (WHERE is_active = true)
    INTO v_total_stages, v_active_stages
    FROM manufacturing_stages;
    
    -- Count organizations
    SELECT COUNT(DISTINCT org_id) INTO v_orgs_count
    FROM manufacturing_stages;
    
    -- Count linked work centers
    SELECT COUNT(*) INTO v_work_centers_linked
    FROM manufacturing_stages
    WHERE work_center_id IS NOT NULL;
    
    -- Count linked GL accounts
    SELECT COUNT(*) INTO v_gl_accounts_linked
    FROM manufacturing_stages
    WHERE wip_gl_account_id IS NOT NULL;
    
    RAISE NOTICE '';
    RAISE NOTICE '╔════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║     MANUFACTURING STAGES VERIFICATION SUMMARY          ║';
    RAISE NOTICE '╚════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '📊 STATISTICS:';
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '  Total Stages:        %', v_total_stages;
    RAISE NOTICE '  Active Stages:       %', v_active_stages;
    RAISE NOTICE '  Organizations:       %', v_orgs_count;
    RAISE NOTICE '  Work Centers Linked: % / %', v_work_centers_linked, v_total_stages;
    RAISE NOTICE '  GL Accounts Linked:  % / %', v_gl_accounts_linked, v_total_stages;
    RAISE NOTICE '';
    
    IF v_total_stages > 0 THEN
        RAISE NOTICE '✅ SUCCESS: Manufacturing stages are configured!';
        RAISE NOTICE '';
        
        IF v_work_centers_linked < v_total_stages THEN
            RAISE NOTICE '💡 TIP: You can link work centers to stages:';
            RAISE NOTICE '   UPDATE manufacturing_stages SET work_center_id = ''...'' WHERE code = ''...'';';
        END IF;
        
        IF v_gl_accounts_linked < v_total_stages THEN
            RAISE NOTICE '💡 TIP: You can link GL accounts to stages:';
            RAISE NOTICE '   UPDATE manufacturing_stages SET wip_gl_account_id = ''...'' WHERE code = ''...'';';
        END IF;
        
        RAISE NOTICE '';
        RAISE NOTICE '🎯 NEXT STEPS:';
        RAISE NOTICE '  1. Test services in application';
        RAISE NOTICE '  2. Link work centers (optional)';
        RAISE NOTICE '  3. Link GL accounts (optional)';
        RAISE NOTICE '  4. Create standard costs for products';
        RAISE NOTICE '  5. Start using stages in manufacturing orders';
    ELSE
        RAISE WARNING '❌ NO STAGES FOUND: Run 25_create_sample_manufacturing_stages.sql first';
    END IF;
    
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

