-- =======================================
-- Wardah ERP - Complete Database Setup
-- =======================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- =======================================
-- 1. CORE TABLES
-- =======================================

-- Organizations (Multi-tenant support)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users and Organization Access
CREATE TABLE IF NOT EXISTS user_organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- References auth.users
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'manager', 'admin')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id)
);

-- Chart of Accounts (Enhanced)
CREATE TABLE IF NOT EXISTS gl_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    subtype VARCHAR(50) NOT NULL,
    parent_code VARCHAR(20),
    normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    allow_posting BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    currency VARCHAR(3) DEFAULT 'SAR',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- GL Mappings for Events (Enhanced for Manufacturing)
CREATE TABLE gl_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key_type VARCHAR(50) NOT NULL, -- 'EVENT', 'WORK_CENTER', 'PRODUCT_TYPE', etc.
    key_value VARCHAR(100) NOT NULL,
    debit_account_code VARCHAR(20) NOT NULL,
    credit_account_code VARCHAR(20) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, key_type, key_value)
);

-- Units of Measure
CREATE TABLE uoms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Products/Items
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    uom_id UUID REFERENCES uoms(id),
    category VARCHAR(100),
    cost_price DECIMAL(12,2) DEFAULT 0,
    selling_price DECIMAL(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Warehouses
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    location TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Storage Locations
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, warehouse_id, code)
);

-- Bill of Materials Headers
CREATE TABLE bom_headers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    version VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    effective_date DATE,
    expiry_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, product_id, version)
);

-- Bill of Materials Lines
CREATE TABLE bom_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(10,4) NOT NULL,
    uom_id UUID REFERENCES uoms(id),
    sequence INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manufacturing Orders
CREATE TABLE manufacturing_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_number VARCHAR(50) NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    start_date DATE,
    end_date DATE,
    total_cost DECIMAL(12,2) DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, order_number)
);

-- Work Centers
CREATE TABLE work_centers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description TEXT,
    hourly_rate DECIMAL(10,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Stage Costs (Process Costing)
CREATE TABLE stage_costs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    manufacturing_order_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    stage_number INTEGER NOT NULL,
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    good_quantity DECIMAL(12,2) NOT NULL,
    defective_quantity DECIMAL(12,2) DEFAULT 0,
    material_cost DECIMAL(12,2) DEFAULT 0,
    labor_cost DECIMAL(12,2) DEFAULT 0,
    overhead_cost DECIMAL(12,2) DEFAULT 0,
    total_cost DECIMAL(12,2) DEFAULT 0,
    unit_cost DECIMAL(12,4) DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'precosted' CHECK (status IN ('precosted', 'actual', 'completed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, manufacturing_order_id, stage_number)
);

-- Labor Time Logs
CREATE TABLE labor_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    manufacturing_order_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    stage_number INTEGER NOT NULL,
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    employee_id UUID,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    hours_worked DECIMAL(8,2),
    labor_rate DECIMAL(10,2) DEFAULT 0,
    total_cost DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Overhead Rates
CREATE TABLE overhead_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    rate_type VARCHAR(20) NOT NULL DEFAULT 'hourly' CHECK (rate_type IN ('hourly', 'machine_hour', 'unit')),
    rate_amount DECIMAL(10,2) NOT NULL,
    applicable_from DATE NOT NULL,
    applicable_to DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Overhead Allocations
CREATE TABLE overhead_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    manufacturing_order_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    stage_number INTEGER NOT NULL,
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    overhead_rate DECIMAL(10,2) NOT NULL,
    allocation_base DECIMAL(12,2) NOT NULL,
    total_applied DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock Quantities
CREATE TABLE stock_quants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    location_id UUID NOT NULL REFERENCES locations(id),
    quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
    cost DECIMAL(12,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, product_id, location_id)
);

-- Stock Movements
CREATE TABLE stock_moves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment')),
    quantity DECIMAL(12,2) NOT NULL,
    reference_type VARCHAR(50),
    reference_id UUID,
    unit_cost DECIMAL(12,4),
    total_cost DECIMAL(12,2),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost Settings
CREATE TABLE cost_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    costing_method VARCHAR(20) NOT NULL DEFAULT 'AVCO' CHECK (costing_method IN ('AVCO', 'FIFO', 'LIFO')),
    currency VARCHAR(3) DEFAULT 'SAR',
    precision INTEGER DEFAULT 4,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id)
);

-- Vendors/Suppliers
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    contact_person VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Customers
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    contact_person VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Purchase Orders
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_number VARCHAR(50) NOT NULL,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'received', 'cancelled')),
    order_date DATE NOT NULL,
    delivery_date DATE,
    total_amount DECIMAL(12,2) DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, order_number)
);

-- Purchase Order Lines
CREATE TABLE purchase_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(12,2) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    received_quantity DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Goods Receipt Notes
CREATE TABLE grns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    grn_number VARCHAR(50) NOT NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    receipt_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
    total_amount DECIMAL(12,2) DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, grn_number)
);

-- Sales Orders
CREATE TABLE sales_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_number VARCHAR(50) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'delivered', 'cancelled')),
    order_date DATE NOT NULL,
    delivery_date DATE,
    total_amount DECIMAL(12,2) DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, order_number)
);

-- Sales Order Lines
CREATE TABLE sales_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(12,2) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    delivered_quantity DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================
-- 2. INDEXES AND CONSTRAINTS
-- =======================================

-- Indexes for performance
CREATE INDEX idx_org_products ON products(org_id);
CREATE INDEX idx_org_bom_headers ON bom_headers(org_id);
CREATE INDEX idx_org_manufacturing_orders ON manufacturing_orders(org_id);
CREATE INDEX idx_org_stage_costs ON stage_costs(org_id);
CREATE INDEX idx_org_stock_quants ON stock_quants(org_id);
CREATE INDEX idx_org_stock_moves ON stock_moves(org_id);
CREATE INDEX idx_org_purchase_orders ON purchase_orders(org_id);
CREATE INDEX idx_org_sales_orders ON sales_orders(org_id);

-- =======================================
-- 3. RLS POLICIES
-- =======================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE overhead_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE overhead_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_quants ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE grns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_lines ENABLE ROW LEVEL SECURITY;

-- Helper Functions
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

-- RLS Policies
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

CREATE POLICY "Users can view org GL mappings" ON gl_mappings
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage GL mappings" ON gl_mappings
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- Apply similar policies to all other tables
CREATE POLICY "Users can view org UOMs" ON uoms
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage UOMs" ON uoms
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

CREATE POLICY "Users can view org products" ON products
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage products" ON products
    FOR ALL USING (org_id = auth_org_id());

CREATE POLICY "Users can view org warehouses" ON warehouses
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage warehouses" ON warehouses
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

CREATE POLICY "Users can view org locations" ON locations
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Users can manage locations" ON locations
    FOR ALL USING (org_id = auth_org_id());

-- Continue with policies for all other tables...

-- =======================================
-- 4. SAMPLE DATA
-- =======================================

-- Insert a default organization
INSERT INTO organizations (id, name, code) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Wardah Manufacturing', 'WARD');

-- Insert sample user-organization mappings
-- Note: These will need to be updated with actual user IDs from your auth system
INSERT INTO user_organizations (user_id, org_id, role) VALUES
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'admin'),
('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'manager'),
('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'user');

-- Success Message
DO $$
BEGIN
    RAISE NOTICE '✅ Wardah ERP Database Setup Complete!';
    RAISE NOTICE '📋 Next steps:';
    RAISE NOTICE '1. Update your config.json with your Supabase credentials';
    RAISE NOTICE '2. Import Chart of Accounts using the import functions';
    RAISE NOTICE '3. Import GL Mappings using the import functions';
    RAISE NOTICE '4. Configure users and organizations in your auth system';
END $$;