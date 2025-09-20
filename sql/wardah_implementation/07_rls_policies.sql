-- =======================================
-- Wardah ERP - Row Level Security (RLS)
-- Multi-Tenant Security Implementation
-- =======================================

-- Enable RLS on all tables
-- =======================================

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

-- =======================================
-- Helper Functions
-- =======================================

-- Get current user's organization ID
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

-- Check if user has role in organization
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

-- Check if user has any of the specified roles
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

-- =======================================
-- RLS Policies - Organizations
-- =======================================

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

-- =======================================
-- RLS Policies - User Organizations
-- =======================================

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

-- =======================================
-- RLS Policies - GL Accounts
-- =======================================

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

-- =======================================
-- RLS Policies - GL Mappings
-- =======================================

CREATE POLICY "Users can view org GL mappings" ON gl_mappings
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage GL mappings" ON gl_mappings
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- =======================================
-- RLS Policies - Manufacturing Data
-- =======================================

-- UOMs
CREATE POLICY "Users can view org UOMs" ON uoms
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage UOMs" ON uoms
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- Products
CREATE POLICY "Users can view org products" ON products
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can insert products" ON products
    FOR INSERT WITH CHECK (org_id = auth_org_id());

CREATE POLICY "Users can update products" ON products
    FOR UPDATE USING (org_id = auth_org_id());

CREATE POLICY "Managers can delete products" ON products
    FOR DELETE USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- Warehouses
CREATE POLICY "Users can view org warehouses" ON warehouses
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage warehouses" ON warehouses
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- Locations
CREATE POLICY "Users can view org locations" ON locations
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage locations" ON locations
    FOR ALL USING (org_id = auth_org_id());

-- BOM Headers
CREATE POLICY "Users can view org BOMs" ON bom_headers
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage BOMs" ON bom_headers
    FOR ALL USING (org_id = auth_org_id());

-- BOM Lines
CREATE POLICY "Users can view org BOM lines" ON bom_lines
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage BOM lines" ON bom_lines
    FOR ALL USING (org_id = auth_org_id());

-- Manufacturing Orders
CREATE POLICY "Users can view org MOs" ON manufacturing_orders
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage MOs" ON manufacturing_orders
    FOR ALL USING (org_id = auth_org_id());

-- Work Centers
CREATE POLICY "Users can view org work centers" ON work_centers
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage work centers" ON work_centers
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- Labor Entries
CREATE POLICY "Users can view org labor entries" ON labor_entries
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage labor entries" ON labor_entries
    FOR ALL USING (org_id = auth_org_id());

-- Overhead Rates
CREATE POLICY "Users can view org overhead rates" ON overhead_rates
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage overhead rates" ON overhead_rates
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- Overhead Allocations
CREATE POLICY "Users can view org overhead allocations" ON overhead_allocations
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage overhead allocations" ON overhead_allocations
    FOR ALL USING (org_id = auth_org_id());

-- =======================================
-- RLS Policies - Inventory Data
-- =======================================

-- Stock Quants - Read-only for regular users
CREATE POLICY "Users can view org stock quants" ON stock_quants
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "System can manage stock quants" ON stock_quants
    FOR ALL USING (org_id = auth_org_id());

-- Stock Moves
CREATE POLICY "Users can view org stock moves" ON stock_moves
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can create stock moves" ON stock_moves
    FOR INSERT WITH CHECK (org_id = auth_org_id());

CREATE POLICY "Users can update stock moves" ON stock_moves
    FOR UPDATE USING (org_id = auth_org_id());

CREATE POLICY "Managers can delete stock moves" ON stock_moves
    FOR DELETE USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- Cost Settings
CREATE POLICY "Users can view org cost settings" ON cost_settings
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Admins can manage cost settings" ON cost_settings
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_org_role('admin')
    );

-- =======================================
-- RLS Policies - Sales & Purchase Data
-- =======================================

-- Vendors
CREATE POLICY "Users can view org vendors" ON vendors
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage vendors" ON vendors
    FOR ALL USING (org_id = auth_org_id());

-- Customers
CREATE POLICY "Users can view org customers" ON customers
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage customers" ON customers
    FOR ALL USING (org_id = auth_org_id());

-- Purchase Orders
CREATE POLICY "Users can view org purchase orders" ON purchase_orders
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage purchase orders" ON purchase_orders
    FOR ALL USING (org_id = auth_org_id());

-- Purchase Lines
CREATE POLICY "Users can view org purchase lines" ON purchase_lines
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage purchase lines" ON purchase_lines
    FOR ALL USING (org_id = auth_org_id());

-- GRNs
CREATE POLICY "Users can view org GRNs" ON grns
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage GRNs" ON grns
    FOR ALL USING (org_id = auth_org_id());

-- Sales Orders
CREATE POLICY "Users can view org sales orders" ON sales_orders
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage sales orders" ON sales_orders
    FOR ALL USING (org_id = auth_org_id());

-- Sales Lines
CREATE POLICY "Users can view org sales lines" ON sales_lines
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage sales lines" ON sales_lines
    FOR ALL USING (org_id = auth_org_id());