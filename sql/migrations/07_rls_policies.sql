-- ===================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES FOR MULTI-TENANT ARCHITECTURE
-- JWT-based tenant isolation with comprehensive security
-- ===================================================================

-- ===================================================================
-- HELPER FUNCTIONS FOR JWT CLAIMS
-- ===================================================================

-- Function to extract tenant_id from JWT
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
DECLARE
  tenant_id UUID;
BEGIN
  -- Try to get tenant_id from JWT claims
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid INTO tenant_id;
  
  -- If not found in JWT, return null (will restrict to no rows)
  RETURN tenant_id;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function to get current user ID from JWT
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
DECLARE
  user_id UUID;
BEGIN
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid INTO user_id;
  RETURN user_id;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function to get current user role from JWT
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'role' INTO user_role;
  RETURN COALESCE(user_role, 'employee');
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'employee';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ===================================================================
-- ENABLE RLS ON ALL TABLES
-- ===================================================================
ALTER TABLE public.work_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moh_applied ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;

-- Enable RLS on existing tables if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manufacturing_orders') THEN
    ALTER TABLE public.manufacturing_orders ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
    ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'categories') THEN
    ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suppliers') THEN
    ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
    ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ===================================================================
-- WORK CENTERS POLICIES
-- ===================================================================
DROP POLICY IF EXISTS tenant_select_work_centers ON public.work_centers;
CREATE POLICY tenant_select_work_centers ON public.work_centers
  FOR SELECT 
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_work_centers ON public.work_centers;
CREATE POLICY tenant_insert_work_centers ON public.work_centers
  FOR INSERT 
  WITH CHECK (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_update_work_centers ON public.work_centers;
CREATE POLICY tenant_update_work_centers ON public.work_centers
  FOR UPDATE 
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_delete_work_centers ON public.work_centers;
CREATE POLICY tenant_delete_work_centers ON public.work_centers
  FOR DELETE 
  USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() = 'admin'
  );

-- ===================================================================
-- STAGE COSTS POLICIES
-- ===================================================================
DROP POLICY IF EXISTS tenant_select_stage_costs ON public.stage_costs;
CREATE POLICY tenant_select_stage_costs ON public.stage_costs
  FOR SELECT 
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_stage_costs ON public.stage_costs;
CREATE POLICY tenant_insert_stage_costs ON public.stage_costs
  FOR INSERT 
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_update_stage_costs ON public.stage_costs;
CREATE POLICY tenant_update_stage_costs ON public.stage_costs
  FOR UPDATE 
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_stage_costs ON public.stage_costs;
CREATE POLICY tenant_delete_stage_costs ON public.stage_costs
  FOR DELETE 
  USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

-- ===================================================================
-- LABOR TIME LOGS POLICIES
-- ===================================================================
DROP POLICY IF EXISTS tenant_select_labor_logs ON public.labor_time_logs;
CREATE POLICY tenant_select_labor_logs ON public.labor_time_logs
  FOR SELECT 
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_labor_logs ON public.labor_time_logs;
CREATE POLICY tenant_insert_labor_logs ON public.labor_time_logs
  FOR INSERT 
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_update_labor_logs ON public.labor_time_logs;
CREATE POLICY tenant_update_labor_logs ON public.labor_time_logs
  FOR UPDATE 
  USING (
    tenant_id = get_current_tenant_id() AND
    (employee_id = get_current_user_id() OR get_current_user_role() IN ('admin', 'manager'))
  )
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_labor_logs ON public.labor_time_logs;
CREATE POLICY tenant_delete_labor_logs ON public.labor_time_logs
  FOR DELETE 
  USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

-- ===================================================================
-- MOH APPLIED POLICIES
-- ===================================================================
DROP POLICY IF EXISTS tenant_select_moh_applied ON public.moh_applied;
CREATE POLICY tenant_select_moh_applied ON public.moh_applied
  FOR SELECT 
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_moh_applied ON public.moh_applied;
CREATE POLICY tenant_insert_moh_applied ON public.moh_applied
  FOR INSERT 
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_update_moh_applied ON public.moh_applied;
CREATE POLICY tenant_update_moh_applied ON public.moh_applied
  FOR UPDATE 
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_moh_applied ON public.moh_applied;
CREATE POLICY tenant_delete_moh_applied ON public.moh_applied
  FOR DELETE 
  USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

-- ===================================================================
-- INVENTORY LEDGER POLICIES
-- ===================================================================
DROP POLICY IF EXISTS tenant_select_inventory_ledger ON public.inventory_ledger;
CREATE POLICY tenant_select_inventory_ledger ON public.inventory_ledger
  FOR SELECT 
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_inventory_ledger ON public.inventory_ledger;
CREATE POLICY tenant_insert_inventory_ledger ON public.inventory_ledger
  FOR INSERT 
  WITH CHECK (tenant_id = get_current_tenant_id());

-- Inventory ledger should be append-only (no updates/deletes for audit integrity)
DROP POLICY IF EXISTS tenant_update_inventory_ledger ON public.inventory_ledger;
CREATE POLICY tenant_update_inventory_ledger ON public.inventory_ledger
  FOR UPDATE 
  USING (false); -- No updates allowed

DROP POLICY IF EXISTS tenant_delete_inventory_ledger ON public.inventory_ledger;
CREATE POLICY tenant_delete_inventory_ledger ON public.inventory_ledger
  FOR DELETE 
  USING (false); -- No deletes allowed

-- ===================================================================
-- BOMS POLICIES
-- ===================================================================
DROP POLICY IF EXISTS tenant_select_boms ON public.boms;
CREATE POLICY tenant_select_boms ON public.boms
  FOR SELECT 
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_boms ON public.boms;
CREATE POLICY tenant_insert_boms ON public.boms
  FOR INSERT 
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_update_boms ON public.boms;
CREATE POLICY tenant_update_boms ON public.boms
  FOR UPDATE 
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_boms ON public.boms;
CREATE POLICY tenant_delete_boms ON public.boms
  FOR DELETE 
  USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

-- ===================================================================
-- BOM LINES POLICIES
-- ===================================================================
DROP POLICY IF EXISTS tenant_select_bom_lines ON public.bom_lines;
CREATE POLICY tenant_select_bom_lines ON public.bom_lines
  FOR SELECT 
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_bom_lines ON public.bom_lines;
CREATE POLICY tenant_insert_bom_lines ON public.bom_lines
  FOR INSERT 
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_update_bom_lines ON public.bom_lines;
CREATE POLICY tenant_update_bom_lines ON public.bom_lines
  FOR UPDATE 
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_bom_lines ON public.bom_lines;
CREATE POLICY tenant_delete_bom_lines ON public.bom_lines
  FOR DELETE 
  USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

-- ===================================================================
-- AUDIT TRAIL POLICIES
-- ===================================================================
DROP POLICY IF EXISTS tenant_select_audit_trail ON public.audit_trail;
CREATE POLICY tenant_select_audit_trail ON public.audit_trail
  FOR SELECT 
  USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_insert_audit_trail ON public.audit_trail;
CREATE POLICY tenant_insert_audit_trail ON public.audit_trail
  FOR INSERT 
  WITH CHECK (tenant_id = get_current_tenant_id());

-- Audit trail should be append-only (no updates/deletes)
DROP POLICY IF EXISTS tenant_update_audit_trail ON public.audit_trail;
CREATE POLICY tenant_update_audit_trail ON public.audit_trail
  FOR UPDATE 
  USING (false); -- No updates allowed

DROP POLICY IF EXISTS tenant_delete_audit_trail ON public.audit_trail;
CREATE POLICY tenant_delete_audit_trail ON public.audit_trail
  FOR DELETE 
  USING (false); -- No deletes allowed

-- ===================================================================
-- EXISTING TABLES POLICIES (if they exist)
-- ===================================================================

-- Manufacturing Orders
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manufacturing_orders') THEN
    DROP POLICY IF EXISTS tenant_select_manufacturing_orders ON public.manufacturing_orders;
    CREATE POLICY tenant_select_manufacturing_orders ON public.manufacturing_orders
      FOR SELECT USING (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true  -- If no tenant_id column, allow all (backward compatibility)
        END
      );
    
    DROP POLICY IF EXISTS tenant_insert_manufacturing_orders ON public.manufacturing_orders;
    CREATE POLICY tenant_insert_manufacturing_orders ON public.manufacturing_orders
      FOR INSERT WITH CHECK (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true
        END
      );
    
    DROP POLICY IF EXISTS tenant_update_manufacturing_orders ON public.manufacturing_orders;
    CREATE POLICY tenant_update_manufacturing_orders ON public.manufacturing_orders
      FOR UPDATE USING (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true
        END
      ) WITH CHECK (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true
        END
      );
  END IF;
END $$;

-- Items
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
    DROP POLICY IF EXISTS tenant_select_items ON public.items;
    CREATE POLICY tenant_select_items ON public.items
      FOR SELECT USING (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true
        END
      );
    
    DROP POLICY IF EXISTS tenant_insert_items ON public.items;
    CREATE POLICY tenant_insert_items ON public.items
      FOR INSERT WITH CHECK (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true
        END
      );
    
    DROP POLICY IF EXISTS tenant_update_items ON public.items;
    CREATE POLICY tenant_update_items ON public.items
      FOR UPDATE USING (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true
        END
      ) WITH CHECK (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true
        END
      );
  END IF;
END $$;

-- Categories
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'categories') THEN
    DROP POLICY IF EXISTS tenant_select_categories ON public.categories;
    CREATE POLICY tenant_select_categories ON public.categories
      FOR SELECT USING (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id()
          ELSE
            true
        END
      );
    
    DROP POLICY IF EXISTS tenant_insert_categories ON public.categories;
    CREATE POLICY tenant_insert_categories ON public.categories
      FOR INSERT WITH CHECK (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id() AND
            get_current_user_role() IN ('admin', 'manager')
          ELSE
            true
        END
      );
    
    DROP POLICY IF EXISTS tenant_update_categories ON public.categories;
    CREATE POLICY tenant_update_categories ON public.categories
      FOR UPDATE USING (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id() AND
            get_current_user_role() IN ('admin', 'manager')
          ELSE
            true
        END
      ) WITH CHECK (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id() AND
            get_current_user_role() IN ('admin', 'manager')
          ELSE
            true
        END
      );
    
    DROP POLICY IF EXISTS tenant_delete_categories ON public.categories;
    CREATE POLICY tenant_delete_categories ON public.categories
      FOR DELETE USING (
        CASE 
          WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'tenant_id') THEN
            tenant_id = get_current_tenant_id() AND
            get_current_user_role() = 'admin'
          ELSE
            true
        END
      );
  END IF;
END $$;

-- ===================================================================
-- BYPASS POLICIES FOR SERVICE ROLE (Admin Operations)
-- ===================================================================

-- Grant bypass permissions to service_role for admin operations
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Grant appropriate permissions to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Grant permissions to anon role for public access (if needed)
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.work_centers TO anon;

-- ===================================================================
-- SECURITY DEFINER FUNCTIONS FOR BYPASSING RLS WHEN NEEDED
-- ===================================================================

-- Function to get work centers without RLS (for system operations)
CREATE OR REPLACE FUNCTION get_work_centers_system(p_tenant_id UUID)
RETURNS TABLE (
  id UUID,
  code TEXT,
  name TEXT,
  seq INTEGER,
  cost_base TEXT,
  default_rate NUMERIC
) 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT wc.id, wc.code, wc.name, wc.seq, wc.cost_base, wc.default_rate
  FROM public.work_centers wc
  WHERE wc.tenant_id = p_tenant_id AND wc.is_active = true
  ORDER BY wc.seq;
END;
$$ LANGUAGE plpgsql;

-- Grant execute to service_role
GRANT EXECUTE ON FUNCTION get_work_centers_system(UUID) TO service_role;

-- ===================================================================
-- COMMENTS AND DOCUMENTATION
-- ===================================================================
COMMENT ON FUNCTION get_current_tenant_id() IS 'Extract tenant_id from JWT claims for RLS policies';
COMMENT ON FUNCTION get_current_user_id() IS 'Extract user_id from JWT claims for RLS policies';
COMMENT ON FUNCTION get_current_user_role() IS 'Extract user role from JWT claims for RLS policies';

-- ===================================================================
-- VERIFICATION QUERIES (for testing)
-- ===================================================================
/*
-- Test queries to verify RLS is working:

-- 1. Set a test JWT context
SELECT set_config('request.jwt.claims', '{"sub":"test-user-id","tenant_id":"test-tenant-id","role":"manager"}', false);

-- 2. Test tenant isolation
SELECT * FROM work_centers; -- Should only return records for test-tenant-id

-- 3. Test role-based access
INSERT INTO work_centers (code, name, seq, tenant_id) 
VALUES ('TEST001', 'Test Work Center', 1, 'test-tenant-id'); -- Should work for manager role

-- 4. Reset context
SELECT set_config('request.jwt.claims', '', false);
*/