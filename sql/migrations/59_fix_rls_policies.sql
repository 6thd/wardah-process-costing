-- =====================================
-- Fix and Verify RLS Policies
-- =====================================
-- This migration ensures all tables have proper RLS policies
-- Run after security audit to fix any issues

BEGIN;

-- =====================================
-- 1. Verify RLS is enabled on all critical tables
-- =====================================

DO $$
DECLARE
    table_record RECORD;
    critical_tables TEXT[] := ARRAY[
        'manufacturing_orders',
        'manufacturing_stages',
        'stage_costs',
        'labor_time_logs',
        'moh_applied',
        'inventory_items',
        'stock_moves',
        'stock_quants',
        'gl_accounts',
        'journal_entries',
        'journal_entry_lines',
        'sales_orders',
        'sales_order_lines',
        'purchase_orders',
        'purchase_order_lines',
        'customers',
        'suppliers',
        'products',
        'work_centers',
        'overhead_rates'
    ];
    v_table_name TEXT;
    rls_enabled BOOLEAN;
BEGIN
    RAISE NOTICE '=== Verifying RLS on Critical Tables ===';
    
    FOREACH v_table_name IN ARRAY critical_tables
    LOOP
        -- Check if table exists
        IF EXISTS (
            SELECT 1 FROM information_schema.tables t
            WHERE t.table_schema = 'public' 
            AND t.table_name = v_table_name
        ) THEN
            -- Check if RLS is enabled
            SELECT relrowsecurity INTO rls_enabled
            FROM pg_class
            WHERE relname = v_table_name
            AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
            
            IF NOT rls_enabled THEN
                RAISE NOTICE 'Enabling RLS on %', v_table_name;
                EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table_name);
            ELSE
                RAISE NOTICE '✓ RLS already enabled on %', v_table_name;
            END IF;
        ELSE
            RAISE NOTICE '⚠ Table % does not exist, skipping', v_table_name;
        END IF;
    END LOOP;
END $$;

-- =====================================
-- 2. Ensure helper functions exist
-- =====================================

-- Function to get current user's org_id
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT uo.org_id 
    FROM user_organizations uo 
    WHERE uo.user_id = auth.uid() 
    AND uo.is_active = true 
    LIMIT 1;
$$;

-- Function to check if user is super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM super_admins 
        WHERE user_id = auth.uid() 
        AND is_active = true
    );
$$;

-- =====================================
-- 3. Create/Update RLS policies for manufacturing_orders
-- =====================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "manufacturing_orders_tenant_isolation" ON manufacturing_orders;
DROP POLICY IF EXISTS "manufacturing_orders_select" ON manufacturing_orders;
DROP POLICY IF EXISTS "manufacturing_orders_insert" ON manufacturing_orders;
DROP POLICY IF EXISTS "manufacturing_orders_update" ON manufacturing_orders;
DROP POLICY IF EXISTS "manufacturing_orders_delete" ON manufacturing_orders;

-- SELECT policy
CREATE POLICY "manufacturing_orders_select" ON manufacturing_orders
    FOR SELECT USING (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- INSERT policy
CREATE POLICY "manufacturing_orders_insert" ON manufacturing_orders
    FOR INSERT WITH CHECK (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- UPDATE policy
CREATE POLICY "manufacturing_orders_update" ON manufacturing_orders
    FOR UPDATE USING (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- DELETE policy
CREATE POLICY "manufacturing_orders_delete" ON manufacturing_orders
    FOR DELETE USING (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- =====================================
-- 4. Create/Update RLS policies for inventory_items
-- =====================================

-- Only if table exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'inventory_items'
    ) THEN
        -- Drop existing policies
        DROP POLICY IF EXISTS "inventory_items_tenant_isolation" ON inventory_items;
        DROP POLICY IF EXISTS "inventory_items_select" ON inventory_items;
        DROP POLICY IF EXISTS "inventory_items_insert" ON inventory_items;
        DROP POLICY IF EXISTS "inventory_items_update" ON inventory_items;
        DROP POLICY IF EXISTS "inventory_items_delete" ON inventory_items;
        
        -- Enable RLS
        ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
        
        -- Create policies
        CREATE POLICY "inventory_items_select" ON inventory_items
            FOR SELECT USING (
                org_id = auth_org_id()
                OR tenant_id = auth_org_id()
                OR is_super_admin()
            );
        
        CREATE POLICY "inventory_items_insert" ON inventory_items
            FOR INSERT WITH CHECK (
                org_id = auth_org_id()
                OR tenant_id = auth_org_id()
                OR is_super_admin()
            );
        
        CREATE POLICY "inventory_items_update" ON inventory_items
            FOR UPDATE USING (
                org_id = auth_org_id()
                OR tenant_id = auth_org_id()
                OR is_super_admin()
            );
        
        CREATE POLICY "inventory_items_delete" ON inventory_items
            FOR DELETE USING (
                org_id = auth_org_id()
                OR tenant_id = auth_org_id()
                OR is_super_admin()
            );
        
        RAISE NOTICE '✓ RLS policies created for inventory_items';
    END IF;
END $$;

-- =====================================
-- 5. Create/Update RLS policies for stock_moves
-- =====================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'stock_moves'
    ) THEN
        DROP POLICY IF EXISTS "stock_moves_tenant_isolation" ON stock_moves;
        DROP POLICY IF EXISTS "stock_moves_select" ON stock_moves;
        DROP POLICY IF EXISTS "stock_moves_insert" ON stock_moves;
        DROP POLICY IF EXISTS "stock_moves_update" ON stock_moves;
        
        ALTER TABLE stock_moves ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY "stock_moves_select" ON stock_moves
            FOR SELECT USING (
                org_id = auth_org_id()
                OR tenant_id = auth_org_id()
                OR is_super_admin()
            );
        
        CREATE POLICY "stock_moves_insert" ON stock_moves
            FOR INSERT WITH CHECK (
                org_id = auth_org_id()
                OR tenant_id = auth_org_id()
                OR is_super_admin()
            );
        
        CREATE POLICY "stock_moves_update" ON stock_moves
            FOR UPDATE USING (
                org_id = auth_org_id()
                OR tenant_id = auth_org_id()
                OR is_super_admin()
            );
        
        RAISE NOTICE '✓ RLS policies created for stock_moves';
    END IF;
END $$;

-- =====================================
-- 6. Verify all policies are working
-- =====================================

DO $$
DECLARE
    table_record RECORD;
    policy_count INTEGER;
    issues_found INTEGER := 0;
    v_tablename TEXT;
BEGIN
    RAISE NOTICE E'\n=== Policy Verification ===';
    
    FOR table_record IN 
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT LIKE 'pg_%'
        ORDER BY tablename
    LOOP
        v_tablename := table_record.tablename;
        
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = v_tablename;
        
        IF policy_count = 0 THEN
            -- Check if RLS is enabled
            IF EXISTS (
                SELECT 1 FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = v_tablename
                AND n.nspname = 'public'
                AND c.relrowsecurity = true
            ) THEN
                RAISE WARNING '⚠ Table % has RLS enabled but no policies!', v_tablename;
                issues_found := issues_found + 1;
            END IF;
        END IF;
    END LOOP;
    
    IF issues_found = 0 THEN
        RAISE NOTICE '✓ All tables have proper RLS policies';
    ELSE
        RAISE WARNING '⚠ Found % tables with RLS issues', issues_found;
    END IF;
    
    RAISE NOTICE E'\nRLS policy fixes completed. Review the output above for any warnings.';
END $$;

COMMIT;

