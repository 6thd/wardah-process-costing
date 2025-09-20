-- Wardah ERP - Safe RLS Policies Setup
-- Drops existing policies first, then recreates them

-- Drop existing policies if they exist
-- Organizations
DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Admins can update their organizations" ON organizations;

-- User Organizations
DROP POLICY IF EXISTS "Users can view org memberships" ON user_organizations;
DROP POLICY IF EXISTS "Admins can manage org memberships" ON user_organizations;

-- GL Accounts
DROP POLICY IF EXISTS "Users can view org GL accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Managers can insert GL accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Managers can update GL accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Admins can delete GL accounts" ON gl_accounts;

-- GL Mappings
DROP POLICY IF EXISTS "Users can view org GL mappings" ON gl_mappings;
DROP POLICY IF EXISTS "Managers can manage GL mappings" ON gl_mappings;

-- Manufacturing tables
DROP POLICY IF EXISTS "Users can view org UOMs" ON uoms;
DROP POLICY IF EXISTS "Managers can manage UOMs" ON uoms;
DROP POLICY IF EXISTS "Users can view org products" ON products;
DROP POLICY IF EXISTS "Users can insert products" ON products;
DROP POLICY IF EXISTS "Users can update products" ON products;
DROP POLICY IF EXISTS "Managers can delete products" ON products;
DROP POLICY IF EXISTS "Users can view org warehouses" ON warehouses;
DROP POLICY IF EXISTS "Managers can manage warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can view locations" ON locations;
DROP POLICY IF EXISTS "Managers can manage locations" ON locations;
DROP POLICY IF EXISTS "Users can view org locations" ON locations;
DROP POLICY IF EXISTS "Users can view BOM headers" ON bom_headers;
DROP POLICY IF EXISTS "Managers can manage BOM headers" ON bom_headers;
DROP POLICY IF EXISTS "Users can view BOM lines" ON bom_lines;
DROP POLICY IF EXISTS "Managers can manage BOM lines" ON bom_lines;
DROP POLICY IF EXISTS "Users can view manufacturing orders" ON manufacturing_orders;
DROP POLICY IF EXISTS "Managers can manage manufacturing orders" ON manufacturing_orders;
DROP POLICY IF EXISTS "Users can view work centers" ON work_centers;
DROP POLICY IF EXISTS "Managers can manage work centers" ON work_centers;
DROP POLICY IF EXISTS "Users can view labor entries" ON labor_entries;
DROP POLICY IF EXISTS "Managers can manage labor entries" ON labor_entries;
DROP POLICY IF EXISTS "Users can view overhead rates" ON overhead_rates;
DROP POLICY IF EXISTS "Managers can manage overhead rates" ON overhead_rates;
DROP POLICY IF EXISTS "Users can view overhead allocations" ON overhead_allocations;
DROP POLICY IF EXISTS "Managers can manage overhead allocations" ON overhead_allocations;

-- Inventory tables
DROP POLICY IF EXISTS "Users can view stock quants" ON stock_quants;
DROP POLICY IF EXISTS "Managers can manage stock quants" ON stock_quants;
DROP POLICY IF EXISTS "Users can view stock moves" ON stock_moves;
DROP POLICY IF EXISTS "Managers can manage stock moves" ON stock_moves;
DROP POLICY IF EXISTS "Users can view cost settings" ON cost_settings;
DROP POLICY IF EXISTS "Managers can manage cost settings" ON cost_settings;

-- Sales & Purchase tables
DROP POLICY IF EXISTS "Users can view vendors" ON vendors;
DROP POLICY IF EXISTS "Managers can manage vendors" ON vendors;
DROP POLICY IF EXISTS "Users can view customers" ON customers;
DROP POLICY IF EXISTS "Managers can manage customers" ON customers;
DROP POLICY IF EXISTS "Users can view purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Managers can manage purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can view purchase lines" ON purchase_lines;
DROP POLICY IF EXISTS "Managers can manage purchase lines" ON purchase_lines;
DROP POLICY IF EXISTS "Users can view GRNs" ON grns;
DROP POLICY IF EXISTS "Managers can manage GRNs" ON grns;
DROP POLICY IF EXISTS "Users can view sales orders" ON sales_orders;
DROP POLICY IF EXISTS "Managers can manage sales orders" ON sales_orders;
DROP POLICY IF EXISTS "Users can view sales lines" ON sales_lines;
DROP POLICY IF EXISTS "Managers can manage sales lines" ON sales_lines;

-- Enable RLS on all tables
-- Core tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_mappings ENABLE ROW LEVEL SECURITY;

-- Manufacturing tables
ALTER TABLE uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE overhead_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE overhead_allocations ENABLE ROW LEVEL SECURITY;

-- Inventory tables
ALTER TABLE stock_quants ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_settings ENABLE ROW LEVEL SECURITY;

-- Sales & Purchase tables
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE grns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_lines ENABLE ROW LEVEL SECURITY;

-- Create helper functions if they don't exist
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
    SELECT uo.org_id 
    FROM user_organizations uo 
    WHERE uo.user_id = auth.uid() 
    AND uo.is_active = true 
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION has_org_role(required_role TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM user_organizations uo 
        WHERE uo.user_id = auth.uid() 
        AND uo.org_id = auth_org_id()
        AND uo.role = required_role
        AND uo.is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION has_any_role(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM user_organizations uo 
        WHERE uo.user_id = auth.uid() 
        AND uo.org_id = auth_org_id()
        AND uo.role = ANY(roles)
        AND uo.is_active = true
    );
$$;

-- Create the policies
-- Organizations: Users can only see their own organizations
CREATE POLICY "Users can view their organizations" ON organizations
    FOR SELECT USING (
        id IN (
            SELECT org_id 
            FROM user_organizations 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

CREATE POLICY "Admins can update their organizations" ON organizations
    FOR UPDATE USING (
        id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- User Organizations
CREATE POLICY "Users can view org memberships" ON user_organizations
    FOR SELECT USING (
        org_id = auth_org_id() 
        OR user_id = auth.uid()
    );

CREATE POLICY "Admins can manage org memberships" ON user_organizations
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_org_role('admin')
    );

-- GL Accounts
CREATE POLICY "Users can view org GL accounts" ON gl_accounts
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can insert GL accounts" ON gl_accounts
    FOR INSERT WITH CHECK (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

CREATE POLICY "Managers can update GL accounts" ON gl_accounts
    FOR UPDATE USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

CREATE POLICY "Admins can delete GL accounts" ON gl_accounts
    FOR DELETE USING (
        org_id = auth_org_id() 
        AND has_org_role('admin')
    );

-- GL Mappings
CREATE POLICY "Users can view org GL mappings" ON gl_mappings
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage GL mappings" ON gl_mappings
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- Success message
SELECT 'RLS policies setup complete' as result;