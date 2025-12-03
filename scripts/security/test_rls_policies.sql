-- =====================================
-- RLS Policies Test Script
-- =====================================
-- This script tests RLS policies to ensure tenant isolation works correctly

-- Test 1: Verify RLS is enabled on critical tables
DO $$
DECLARE
    critical_tables TEXT[] := ARRAY[
        'manufacturing_orders',
        'manufacturing_stages',
        'inventory_items',
        'stock_moves',
        'gl_accounts',
        'journal_entries',
        'sales_orders',
        'purchase_orders',
        'customers',
        'suppliers'
    ];
    table_name TEXT;
    rls_enabled BOOLEAN;
BEGIN
    RAISE NOTICE '=== Test 1: RLS Enabled Check ===';
    
    FOREACH table_name IN ARRAY critical_tables
    LOOP
        SELECT relrowsecurity INTO rls_enabled
        FROM pg_class
        WHERE relname = table_name
        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
        
        IF rls_enabled THEN
            RAISE NOTICE '✓ %: RLS enabled', table_name;
        ELSE
            RAISE WARNING '✗ %: RLS NOT enabled!', table_name;
        END IF;
    END LOOP;
END $$;

-- Test 2: Verify policies exist for critical tables
DO $$
DECLARE
    critical_tables TEXT[] := ARRAY[
        'manufacturing_orders',
        'manufacturing_stages',
        'inventory_items',
        'stock_moves',
        'gl_accounts',
        'journal_entries'
    ];
    table_name TEXT;
    policy_count INTEGER;
BEGIN
    RAISE NOTICE E'\n=== Test 2: Policies Existence Check ===';
    
    FOREACH table_name IN ARRAY critical_tables
    LOOP
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = table_name;
        
        IF policy_count > 0 THEN
            RAISE NOTICE '✓ %: % policies found', table_name, policy_count;
        ELSE
            RAISE WARNING '✗ %: NO policies found!', table_name;
        END IF;
    END LOOP;
END $$;

-- Test 3: Verify tenant isolation in policies
DO $$
DECLARE
    table_record RECORD;
    has_tenant_policy BOOLEAN;
BEGIN
    RAISE NOTICE E'\n=== Test 3: Tenant Isolation Policy Check ===';
    
    FOR table_record IN 
        SELECT DISTINCT tablename
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
            AND tablename = table_record.tablename
            AND (
                policyname LIKE '%tenant%' 
                OR policyname LIKE '%org%' 
                OR policyname LIKE '%isolation%'
                OR qual::TEXT LIKE '%tenant_id%'
                OR qual::TEXT LIKE '%org_id%'
            )
        ) INTO has_tenant_policy;
        
        IF has_tenant_policy THEN
            RAISE NOTICE '✓ %: Has tenant isolation policy', table_record.tablename;
        ELSE
            RAISE WARNING '⚠ %: Tenant isolation policy not clearly identified', table_record.tablename;
        END IF;
    END LOOP;
END $$;

-- Test 4: Check for SELECT policies (read access)
DO $$
DECLARE
    table_record RECORD;
    has_select_policy BOOLEAN;
BEGIN
    RAISE NOTICE E'\n=== Test 4: SELECT Policies Check ===';
    
    FOR table_record IN 
        SELECT DISTINCT tablename
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
            AND tablename = table_record.tablename
            AND cmd = 'SELECT'
        ) INTO has_select_policy;
        
        IF has_select_policy THEN
            RAISE NOTICE '✓ %: Has SELECT policy', table_record.tablename;
        ELSE
            RAISE WARNING '✗ %: NO SELECT policy!', table_record.tablename;
        END IF;
    END LOOP;
END $$;

-- Test 5: Check for INSERT policies
DO $$
DECLARE
    table_record RECORD;
    has_insert_policy BOOLEAN;
BEGIN
    RAISE NOTICE E'\n=== Test 5: INSERT Policies Check ===';
    
    FOR table_record IN 
        SELECT DISTINCT tablename
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
            AND tablename = table_record.tablename
            AND cmd = 'INSERT'
        ) INTO has_insert_policy;
        
        IF has_insert_policy THEN
            RAISE NOTICE '✓ %: Has INSERT policy', table_record.tablename;
        ELSE
            RAISE WARNING '⚠ %: NO INSERT policy (may be intentional)', table_record.tablename;
        END IF;
    END LOOP;
END $$;

-- Test 6: Check for UPDATE policies
DO $$
DECLARE
    table_record RECORD;
    has_update_policy BOOLEAN;
BEGIN
    RAISE NOTICE E'\n=== Test 6: UPDATE Policies Check ===';
    
    FOR table_record IN 
        SELECT DISTINCT tablename
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
            AND tablename = table_record.tablename
            AND cmd = 'UPDATE'
        ) INTO has_update_policy;
        
        IF has_update_policy THEN
            RAISE NOTICE '✓ %: Has UPDATE policy', table_record.tablename;
        ELSE
            RAISE WARNING '⚠ %: NO UPDATE policy (may be intentional)', table_record.tablename;
        END IF;
    END LOOP;
END $$;

-- Test 7: Check for DELETE policies
DO $$
DECLARE
    table_record RECORD;
    has_delete_policy BOOLEAN;
BEGIN
    RAISE NOTICE E'\n=== Test 7: DELETE Policies Check ===';
    
    FOR table_record IN 
        SELECT DISTINCT tablename
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
            AND tablename = table_record.tablename
            AND cmd = 'DELETE'
        ) INTO has_delete_policy;
        
        IF has_delete_policy THEN
            RAISE NOTICE '✓ %: Has DELETE policy', table_record.tablename;
        ELSE
            RAISE WARNING '⚠ %: NO DELETE policy (may be intentional)', table_record.tablename;
        END IF;
    END LOOP;
END $$;

RAISE NOTICE E'\n=== Tests Complete ===';
RAISE NOTICE 'Review the warnings above and fix any issues found.';

