-- =======================================
-- Wardah ERP - Enhanced Database Schema
-- Production-Ready for Manufacturing Costing
-- With Process Costing & AVCO Integration
-- =======================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- =======================================
-- 1. CORE TABLES
-- =======================================

-- Organizations (Multi-tenant support)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users and Organization Access
CREATE TABLE user_organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- References auth.users
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'manager', 'admin')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id)
);

-- Chart of Accounts (Enhanced)
CREATE TABLE gl_accounts (
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

-- =======================================
-- 2. MANUFACTURING TABLES
-- =======================================

-- Units of Measure
CREATE TABLE uoms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    factor DECIMAL(18,6) DEFAULT 1.0, -- Conversion factor to base unit
    is_base BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Products (Enhanced for Manufacturing)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    uom_id UUID NOT NULL REFERENCES uoms(id),
    product_type VARCHAR(50) DEFAULT 'raw_material' CHECK (product_type IN ('raw_material', 'semi_finished', 'finished_good', 'consumable', 'regrind')),
    is_stockable BOOLEAN DEFAULT true,
    is_purchasable BOOLEAN DEFAULT true,
    is_saleable BOOLEAN DEFAULT false,
    standard_cost DECIMAL(18,6) DEFAULT 0,
    list_price DECIMAL(18,6) DEFAULT 0,
    category VARCHAR(100),
    brand VARCHAR(100),
    specifications JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, sku)
);

-- Warehouses
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Locations
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    usage VARCHAR(50) DEFAULT 'stock' CHECK (usage IN ('stock', 'wip', 'supplier', 'customer', 'scrap', 'transit')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, warehouse_id, code)
);

-- BOM Headers
CREATE TABLE bom_headers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bom_number VARCHAR(100) NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id),
    version VARCHAR(20) DEFAULT '1.0',
    quantity DECIMAL(18,6) DEFAULT 1.0,
    uom_id UUID NOT NULL REFERENCES uoms(id),
    routing_json JSONB DEFAULT '[]'::jsonb, -- Routing operations
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, bom_number)
);

-- BOM Lines
CREATE TABLE bom_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    sequence INTEGER DEFAULT 1,
    component_product_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(18,6) NOT NULL,
    uom_id UUID NOT NULL REFERENCES uoms(id),
    scrap_percent DECIMAL(5,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manufacturing Orders
CREATE TABLE manufacturing_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mo_number VARCHAR(100) NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id),
    bom_id UUID REFERENCES bom_headers(id),
    qty_planned DECIMAL(18,6) NOT NULL,
    qty_produced DECIMAL(18,6) DEFAULT 0,
    uom_id UUID NOT NULL REFERENCES uoms(id),
    location_id UUID NOT NULL REFERENCES locations(id), -- WIP location
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'in_progress', 'done', 'cancelled')),
    work_center VARCHAR(100),
    priority INTEGER DEFAULT 3,
    date_planned TIMESTAMPTZ,
    date_started TIMESTAMPTZ,
    date_finished TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, mo_number)
);

-- Work Centers (Enhanced)
CREATE TABLE work_centers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    cost_center_account VARCHAR(20), -- GL Account for cost center
    hourly_rate DECIMAL(18,6) DEFAULT 0,
    capacity_per_hour DECIMAL(18,6) DEFAULT 1,
    efficiency_percent DECIMAL(5,2) DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Labor Entries (Enhanced)
CREATE TABLE labor_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    work_center_id UUID REFERENCES work_centers(id),
    employee_name VARCHAR(255),
    date_worked DATE NOT NULL,
    hours_worked DECIMAL(8,2) NOT NULL,
    hourly_rate DECIMAL(18,6) NOT NULL,
    total_amount DECIMAL(18,6) GENERATED ALWAYS AS (hours_worked * hourly_rate) STORED,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Overhead Rates (Enhanced)
CREATE TABLE overhead_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    cost_center VARCHAR(100) NOT NULL,
    rate_type VARCHAR(50) NOT NULL CHECK (rate_type IN ('per_hour', 'per_unit', 'percent_of_labor', 'fixed_monthly')),
    rate_value DECIMAL(18,6) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Overhead Allocations
CREATE TABLE overhead_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    allocation_base VARCHAR(50) NOT NULL, -- 'labor', 'machine_hours', 'direct_costs'
    base_amount DECIMAL(18,6) NOT NULL,
    overhead_rate DECIMAL(18,6) NOT NULL,
    total_overhead DECIMAL(18,6) GENERATED ALWAYS AS (base_amount * overhead_rate) STORED,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================
-- 3. INVENTORY & COSTING TABLES
-- =======================================

-- Stock Quants (AVCO Integration)
CREATE TABLE stock_quants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    location_id UUID NOT NULL REFERENCES locations(id),
    onhand_qty DECIMAL(18,6) DEFAULT 0,
    available_qty DECIMAL(18,6) DEFAULT 0, -- After reservations
    avg_cost DECIMAL(18,6) DEFAULT 0, -- AVCO unit cost
    total_value DECIMAL(18,6) GENERATED ALWAYS AS (onhand_qty * avg_cost) STORED,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, product_id, location_id)
);

-- Stock Moves (Enhanced for Manufacturing)
CREATE TABLE stock_moves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(18,6) NOT NULL,
    uom_id UUID NOT NULL REFERENCES uoms(id),
    from_location_id UUID REFERENCES locations(id),
    to_location_id UUID REFERENCES locations(id),
    move_type VARCHAR(50) NOT NULL CHECK (move_type IN ('purchase_receipt', 'material_issue', 'production_receipt', 'sales_delivery', 'adjustment', 'transfer', 'scrap', 'regrind')),
    unit_cost_in DECIMAL(18,6) DEFAULT 0, -- Cost when entering
    unit_cost_out DECIMAL(18,6) DEFAULT 0, -- Cost when leaving (AVCO)
    total_cost DECIMAL(18,6) GENERATED ALWAYS AS (quantity * COALESCE(unit_cost_out, unit_cost_in, 0)) STORED,
    reference_type VARCHAR(50), -- 'manufacturing_order', 'purchase_order', 'sales_order', etc.
    reference_id UUID,
    reference_number VARCHAR(100),
    date_planned TIMESTAMPTZ,
    date_done TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'done', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost Settings (AVCO Configuration)
CREATE TABLE cost_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    costing_method VARCHAR(50) DEFAULT 'avco' CHECK (costing_method IN ('avco', 'fifo', 'standard')),
    avg_cost_precision INTEGER DEFAULT 6,
    currency_code VARCHAR(3) DEFAULT 'SAR',
    allow_negative_qty BOOLEAN DEFAULT false,
    regrind_processing_cost DECIMAL(18,6) DEFAULT 0,
    auto_recompute_costs BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id)
);

-- =======================================
-- 4. SALES & PURCHASING TABLES
-- =======================================

-- Vendors
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    tax_number VARCHAR(50),
    payment_terms VARCHAR(100),
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
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    tax_number VARCHAR(50),
    payment_terms VARCHAR(100),
    credit_limit DECIMAL(18,6) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Purchase Orders
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    po_number VARCHAR(100) NOT NULL,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    order_date DATE NOT NULL,
    delivery_date DATE,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'received', 'cancelled')),
    subtotal DECIMAL(18,6) DEFAULT 0,
    tax_amount DECIMAL(18,6) DEFAULT 0,
    total_amount DECIMAL(18,6) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, po_number)
);

-- Purchase Order Lines
CREATE TABLE purchase_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(18,6) NOT NULL,
    uom_id UUID NOT NULL REFERENCES uoms(id),
    unit_price DECIMAL(18,6) NOT NULL,
    line_total DECIMAL(18,6) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    qty_received DECIMAL(18,6) DEFAULT 0,
    delivery_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Goods Receipt Notes
CREATE TABLE grns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    grn_number VARCHAR(100) NOT NULL,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    po_id UUID REFERENCES purchase_orders(id),
    receipt_date DATE NOT NULL,
    location_id UUID NOT NULL REFERENCES locations(id),
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, grn_number)
);

-- Sales Orders
CREATE TABLE sales_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    so_number VARCHAR(100) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    order_date DATE NOT NULL,
    delivery_date DATE,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'delivered', 'invoiced', 'cancelled')),
    subtotal DECIMAL(18,6) DEFAULT 0,
    tax_amount DECIMAL(18,6) DEFAULT 0,
    total_amount DECIMAL(18,6) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, so_number)
);

-- Sales Order Lines
CREATE TABLE sales_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    so_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity DECIMAL(18,6) NOT NULL,
    uom_id UUID NOT NULL REFERENCES uoms(id),
    unit_price DECIMAL(18,6) NOT NULL,
    line_total DECIMAL(18,6) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    qty_delivered DECIMAL(18,6) DEFAULT 0,
    unit_cost DECIMAL(18,6) DEFAULT 0, -- COGS calculation
    delivery_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================
-- 5. INDEXES FOR PERFORMANCE
-- =======================================

-- Core indexes
CREATE INDEX idx_gl_accounts_org_code ON gl_accounts(org_id, code);
CREATE INDEX idx_gl_accounts_category ON gl_accounts(category, subtype);
CREATE INDEX idx_gl_mappings_lookup ON gl_mappings(org_id, key_type, key_value);

-- Manufacturing indexes
CREATE INDEX idx_products_org_sku ON products(org_id, sku);
CREATE INDEX idx_products_type ON products(product_type, is_active);
CREATE INDEX idx_bom_headers_product ON bom_headers(product_id, is_active);
CREATE INDEX idx_mo_status ON manufacturing_orders(org_id, status);
CREATE INDEX idx_mo_product ON manufacturing_orders(product_id, status);

-- Inventory indexes
CREATE INDEX idx_stock_quants_product_location ON stock_quants(product_id, location_id);
CREATE INDEX idx_stock_moves_product ON stock_moves(product_id, move_type);
CREATE INDEX idx_stock_moves_reference ON stock_moves(reference_type, reference_id);
CREATE INDEX idx_stock_moves_date ON stock_moves(created_at, org_id);

-- Sales & Purchase indexes
CREATE INDEX idx_po_vendor_date ON purchase_orders(vendor_id, order_date);
CREATE INDEX idx_so_customer_date ON sales_orders(customer_id, order_date);

-- =======================================
-- 6. CONSTRAINTS
-- =======================================

-- Ensure valid parent relationships in GL accounts
ALTER TABLE gl_accounts 
ADD CONSTRAINT chk_gl_parent_exists 
CHECK (parent_code IS NULL OR EXISTS (
    SELECT 1 FROM gl_accounts parent 
    WHERE parent.code = gl_accounts.parent_code 
    AND parent.org_id = gl_accounts.org_id
));

-- Ensure quantity constraints
ALTER TABLE stock_moves 
ADD CONSTRAINT chk_quantity_not_zero 
CHECK (quantity != 0);

ALTER TABLE stock_quants 
ADD CONSTRAINT chk_onhand_qty_valid 
CHECK (onhand_qty >= 0 OR (SELECT allow_negative_qty FROM cost_settings WHERE org_id = stock_quants.org_id));

-- Ensure cost constraints
ALTER TABLE stock_moves 
ADD CONSTRAINT chk_costs_non_negative 
CHECK (unit_cost_in >= 0 AND unit_cost_out >= 0);

-- =======================================
-- SAMPLE DATA FOR TESTING
-- =======================================

-- Insert sample organization
INSERT INTO organizations (id, name, code, settings) 
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'وردة البيان للصناعات البلاستيكية',
    'WRD001',
    '{"currency": "SAR", "timezone": "Asia/Riyadh", "fiscal_year_start": "01-01"}'::jsonb
);

-- Insert sample UOMs
INSERT INTO uoms (org_id, code, name, factor, is_base) VALUES
('00000000-0000-0000-0000-000000000001', 'KG', 'كيلوجرام', 1.0, true),
('00000000-0000-0000-0000-000000000001', 'PCS', 'قطعة', 1.0, false),
('00000000-0000-0000-0000-000000000001', 'M', 'متر', 1.0, false),
('00000000-0000-0000-0000-000000000001', 'TON', 'طن', 1000.0, false);

-- Insert sample warehouse and locations
INSERT INTO warehouses (org_id, code, name) VALUES
('00000000-0000-0000-0000-000000000001', 'WH01', 'المستودع الرئيسي');

INSERT INTO locations (org_id, warehouse_id, code, name, usage) VALUES
('00000000-0000-0000-0000-000000000001', (SELECT id FROM warehouses WHERE code = 'WH01'), 'RM-STOCK', 'مخزن المواد الخام', 'stock'),
('00000000-0000-0000-0000-000000000001', (SELECT id FROM warehouses WHERE code = 'WH01'), 'WIP-MAIN', 'منطقة الإنتاج الرئيسية', 'wip'),
('00000000-0000-0000-0000-000000000001', (SELECT id FROM warehouses WHERE code = 'WH01'), 'FG-STOCK', 'مخزن المنتجات التامة', 'stock'),
('00000000-0000-0000-0000-000000000001', (SELECT id FROM warehouses WHERE code = 'WH01'), 'SCRAP', 'منطقة السكراب', 'scrap');

-- Insert cost settings
INSERT INTO cost_settings (org_id, costing_method, avg_cost_precision, currency_code, allow_negative_qty, auto_recompute_costs) 
VALUES ('00000000-0000-0000-0000-000000000001', 'avco', 6, 'SAR', false, true);

-- =======================================
-- COMMENTS
-- =======================================

COMMENT ON TABLE organizations IS 'Organizations for multi-tenant support';
COMMENT ON TABLE gl_accounts IS 'Chart of Accounts with enhanced manufacturing support';
COMMENT ON TABLE gl_mappings IS 'GL account mappings for automated journal entries';
COMMENT ON TABLE stock_quants IS 'Current stock quantities with AVCO costing';
COMMENT ON TABLE stock_moves IS 'All inventory movements with cost tracking';
COMMENT ON TABLE manufacturing_orders IS 'Manufacturing orders with process costing support';
COMMENT ON TABLE cost_settings IS 'AVCO and costing method configuration';

-- =======================================
-- SUCCESS MESSAGE
-- =======================================

DO $$
BEGIN
    RAISE NOTICE '✅ Wardah ERP Database Schema Created Successfully!';
    RAISE NOTICE '🏭 Manufacturing & Process Costing Ready';
    RAISE NOTICE '💰 AVCO Integration Configured';
    RAISE NOTICE '🔒 Multi-tenant RLS Ready (enable in next step)';
    RAISE NOTICE '📊 Enhanced GL Accounts Structure';
    RAISE NOTICE '🚀 Production-Ready Schema Complete!';
END $$;