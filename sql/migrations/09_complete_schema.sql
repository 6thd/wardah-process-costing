-- ===================================================================
-- Wardah ERP - Complete Database Schema with Process Costing
-- Advanced Manufacturing System with Multi-tenant RLS
-- ===================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===================================================================
-- 1. CORE TABLES
-- ===================================================================

-- Users and authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'manager', 'employee')),
    tenant_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categories for items
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- Items master data
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    unit TEXT NOT NULL DEFAULT 'KG',
    item_type TEXT NOT NULL DEFAULT 'raw_material' 
        CHECK (item_type IN ('raw_material', 'work_in_process', 'finished_good', 'consumable')),
    cost_price NUMERIC(18,6) DEFAULT 0,
    selling_price NUMERIC(18,6) DEFAULT 0,
    standard_cost NUMERIC(18,6) DEFAULT 0,
    current_avg_cost NUMERIC(18,6) DEFAULT 0,
    stock_quantity NUMERIC(14,4) DEFAULT 0,
    minimum_stock NUMERIC(14,4) DEFAULT 0,
    maximum_stock NUMERIC(14,4),
    reorder_point NUMERIC(14,4) DEFAULT 0,
    tenant_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- ===================================================================
-- 2. MANUFACTURING TABLES
-- ===================================================================

-- Work centers for manufacturing stages
CREATE TABLE IF NOT EXISTS work_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 10, -- 10, 20, 30, 40, 50
    description TEXT,
    cost_base TEXT NOT NULL DEFAULT 'labor_hours' 
        CHECK (cost_base IN ('labor_hours', 'machine_hours', 'units_produced', 'setup_time')),
    default_rate NUMERIC(18,6) DEFAULT 0,
    overhead_rate NUMERIC(18,6) DEFAULT 0,
    efficiency_factor NUMERIC(5,4) DEFAULT 1.0000,
    capacity_per_hour NUMERIC(14,4) DEFAULT 0,
    tenant_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- Bill of materials header
CREATE TABLE IF NOT EXISTS boms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    version TEXT NOT NULL DEFAULT '1.0',
    seq INTEGER NOT NULL DEFAULT 10,
    work_center_id UUID REFERENCES work_centers(id) ON DELETE SET NULL,
    description TEXT,
    quantity_per_unit NUMERIC(14,4) DEFAULT 1,
    setup_time_minutes NUMERIC(10,2) DEFAULT 0,
    cycle_time_minutes NUMERIC(10,2) DEFAULT 0,
    tenant_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    effective_date DATE DEFAULT CURRENT_DATE,
    expiry_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, item_id, version, seq)
);

-- Bill of materials lines
CREATE TABLE IF NOT EXISTS bom_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity NUMERIC(14,4) NOT NULL,
    waste_factor NUMERIC(5,4) DEFAULT 0,
    seq INTEGER NOT NULL DEFAULT 10,
    notes TEXT,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bom_id, seq)
);

-- Manufacturing orders
CREATE TABLE IF NOT EXISTS manufacturing_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    quantity NUMERIC(14,4) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'released', 'in_progress', 'completed', 'cancelled')),
    priority TEXT DEFAULT 'normal' 
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    start_date DATE,
    due_date DATE,
    completed_date DATE,
    completed_quantity NUMERIC(14,4) DEFAULT 0,
    scrap_quantity NUMERIC(14,4) DEFAULT 0,
    total_cost NUMERIC(18,4) DEFAULT 0,
    unit_cost NUMERIC(18,6) DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, order_number)
);

-- Stage costs for process costing
CREATE TABLE IF NOT EXISTS stage_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    stage_no INTEGER NOT NULL, -- 10, 20, 30, 40, 50
    work_center_id UUID NOT NULL REFERENCES work_centers(id) ON DELETE RESTRICT,
    good_qty NUMERIC(14,4) DEFAULT 0,
    scrap_qty NUMERIC(14,4) DEFAULT 0,
    rework_qty NUMERIC(14,4) DEFAULT 0,
    
    -- Cost components
    transferred_in_cost NUMERIC(18,4) DEFAULT 0,
    direct_materials_cost NUMERIC(18,4) DEFAULT 0,
    direct_labor_cost NUMERIC(18,4) DEFAULT 0,
    manufacturing_overhead_cost NUMERIC(18,4) DEFAULT 0,
    regrind_processing_cost NUMERIC(18,4) DEFAULT 0,
    waste_credit_value NUMERIC(18,4) DEFAULT 0,
    
    -- Calculated totals
    total_cost NUMERIC(18,4) DEFAULT 0,
    unit_cost NUMERIC(18,6) DEFAULT 0,
    
    -- Status and dates
    status TEXT DEFAULT 'planning' 
        CHECK (status IN ('planning', 'in_progress', 'completed', 'closed')),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    
    notes TEXT,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(mo_id, stage_no)
);

-- Labor time logs
CREATE TABLE IF NOT EXISTS labor_time_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    stage_no INTEGER NOT NULL,
    work_center_id UUID NOT NULL REFERENCES work_centers(id) ON DELETE RESTRICT,
    worker_name TEXT,
    employee_id TEXT,
    hours_worked NUMERIC(8,2) NOT NULL,
    hourly_rate NUMERIC(18,6) NOT NULL,
    total_cost NUMERIC(18,4) GENERATED ALWAYS AS (hours_worked * hourly_rate) STORED,
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift TEXT,
    notes TEXT,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manufacturing overhead applied
CREATE TABLE IF NOT EXISTS moh_applied (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    stage_no INTEGER NOT NULL,
    work_center_id UUID NOT NULL REFERENCES work_centers(id) ON DELETE RESTRICT,
    basis TEXT NOT NULL 
        CHECK (basis IN ('labor_hours', 'machine_hours', 'labor_cost', 'units_produced')),
    base_quantity NUMERIC(14,4) NOT NULL,
    overhead_rate NUMERIC(18,6) NOT NULL,
    applied_amount NUMERIC(18,4) GENERATED ALWAYS AS (base_quantity * overhead_rate) STORED,
    application_date DATE DEFAULT CURRENT_DATE,
    notes TEXT,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================================
-- 3. INVENTORY TABLES
-- ===================================================================

-- Storage locations
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    location_type TEXT DEFAULT 'warehouse' 
        CHECK (location_type IN ('warehouse', 'production', 'quarantine', 'transit')),
    parent_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- Stock movements
CREATE TABLE IF NOT EXISTS stock_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    move_type TEXT NOT NULL 
        CHECK (move_type IN ('in', 'out', 'transfer', 'adjustment', 'production', 'consumption')),
    quantity NUMERIC(14,4) NOT NULL,
    unit_cost NUMERIC(18,6) DEFAULT 0,
    total_cost NUMERIC(18,4) DEFAULT 0,
    reference_type TEXT, -- 'po', 'mo', 'so', 'adjustment'
    reference_id UUID,
    reference_number TEXT,
    notes TEXT,
    move_date DATE DEFAULT CURRENT_DATE,
    tenant_id UUID NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventory ledger for AVCO calculation
CREATE TABLE IF NOT EXISTS inventory_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    move_type TEXT NOT NULL 
        CHECK (move_type IN ('purchase', 'issue', 'receipt', 'adjustment', 'sale', 'transfer')),
    quantity NUMERIC(14,4) NOT NULL,
    unit_cost NUMERIC(18,6) NOT NULL,
    total_cost NUMERIC(18,4) NOT NULL,
    running_quantity NUMERIC(14,4) NOT NULL,
    running_value NUMERIC(18,4) NOT NULL,
    avg_cost_after NUMERIC(18,6) NOT NULL,
    reference_type TEXT,
    reference_id UUID,
    reference_number TEXT,
    transaction_date TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================================
-- 4. PURCHASING TABLES
-- ===================================================================

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    country TEXT DEFAULT 'Saudi Arabia',
    payment_terms TEXT,
    currency TEXT DEFAULT 'SAR',
    tax_number TEXT,
    credit_limit NUMERIC(18,4) DEFAULT 0,
    tenant_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- Purchase orders
CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number TEXT NOT NULL,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    po_date DATE DEFAULT CURRENT_DATE,
    delivery_date DATE,
    status TEXT DEFAULT 'draft' 
        CHECK (status IN ('draft', 'sent', 'confirmed', 'partially_received', 'received', 'cancelled')),
    currency TEXT DEFAULT 'SAR',
    total_amount NUMERIC(18,4) DEFAULT 0,
    tax_amount NUMERIC(18,4) DEFAULT 0,
    discount_amount NUMERIC(18,4) DEFAULT 0,
    final_amount NUMERIC(18,4) DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, po_number)
);

-- Purchase order lines
CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    line_number INTEGER NOT NULL,
    quantity NUMERIC(14,4) NOT NULL,
    unit_price NUMERIC(18,6) NOT NULL,
    total_price NUMERIC(18,4) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    received_quantity NUMERIC(14,4) DEFAULT 0,
    delivery_date DATE,
    notes TEXT,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(po_id, line_number)
);

-- ===================================================================
-- 5. SALES TABLES
-- ===================================================================

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    country TEXT DEFAULT 'Saudi Arabia',
    payment_terms TEXT,
    currency TEXT DEFAULT 'SAR',
    tax_number TEXT,
    credit_limit NUMERIC(18,4) DEFAULT 0,
    tenant_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- Sales orders
CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    so_number TEXT NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    so_date DATE DEFAULT CURRENT_DATE,
    delivery_date DATE,
    status TEXT DEFAULT 'draft' 
        CHECK (status IN ('draft', 'confirmed', 'in_production', 'ready', 'delivered', 'cancelled')),
    currency TEXT DEFAULT 'SAR',
    total_amount NUMERIC(18,4) DEFAULT 0,
    tax_amount NUMERIC(18,4) DEFAULT 0,
    discount_amount NUMERIC(18,4) DEFAULT 0,
    final_amount NUMERIC(18,4) DEFAULT 0,
    cogs_amount NUMERIC(18,4) DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, so_number)
);

-- Sales order lines
CREATE TABLE IF NOT EXISTS sales_order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    so_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    line_number INTEGER NOT NULL,
    quantity NUMERIC(14,4) NOT NULL,
    unit_price NUMERIC(18,6) NOT NULL,
    total_price NUMERIC(18,4) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    delivered_quantity NUMERIC(14,4) DEFAULT 0,
    unit_cost NUMERIC(18,6) DEFAULT 0,
    total_cogs NUMERIC(18,4) DEFAULT 0,
    delivery_date DATE,
    notes TEXT,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(so_id, line_number)
);

-- ===================================================================
-- 6. INDEXES FOR PERFORMANCE
-- ===================================================================

-- Primary lookup indexes
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_items_tenant_code ON items(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id) WHERE is_active = true;

-- Manufacturing indexes
CREATE INDEX IF NOT EXISTS idx_manufacturing_orders_tenant_status ON manufacturing_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_stage_costs_mo_stage ON stage_costs(mo_id, stage_no);
CREATE INDEX IF NOT EXISTS idx_labor_time_logs_mo_stage ON labor_time_logs(mo_id, stage_no);
CREATE INDEX IF NOT EXISTS idx_moh_applied_mo_stage ON moh_applied(mo_id, stage_no);

-- Inventory indexes
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_item_date ON inventory_ledger(item_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_moves_item_date ON stock_moves(item_id, move_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_moves_reference ON stock_moves(reference_type, reference_id);

-- Purchase/Sales indexes
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_status ON purchase_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_tenant_status ON sales_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_po_lines_po_id ON purchase_order_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_so_lines_so_id ON sales_order_lines(so_id);

-- Tenant-wide indexes for RLS performance
CREATE INDEX IF NOT EXISTS idx_all_tables_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_items_tenant ON items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_centers_tenant ON work_centers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_boms_tenant ON boms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_orders_tenant ON manufacturing_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stage_costs_tenant ON stage_costs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_labor_time_logs_tenant ON labor_time_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_tenant ON inventory_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);

-- ===================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ===================================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE moh_applied ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;

-- Generic tenant-based policies (using JWT extraction)
DO $$
DECLARE
    table_name TEXT;
    table_names TEXT[] := ARRAY[
        'users', 'categories', 'items', 'work_centers', 'boms', 'bom_lines',
        'manufacturing_orders', 'stage_costs', 'labor_time_logs', 'moh_applied',
        'locations', 'stock_moves', 'inventory_ledger', 'suppliers', 
        'purchase_orders', 'purchase_order_lines', 'customers', 
        'sales_orders', 'sales_order_lines'
    ];
BEGIN
    FOREACH table_name IN ARRAY table_names
    LOOP
        -- SELECT policy
        EXECUTE format('
            CREATE POLICY "tenant_select_%s" ON %s
            FOR SELECT USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)
        ', table_name, table_name);
        
        -- INSERT policy  
        EXECUTE format('
            CREATE POLICY "tenant_insert_%s" ON %s
            FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)
        ', table_name, table_name);
        
        -- UPDATE policy
        EXECUTE format('
            CREATE POLICY "tenant_update_%s" ON %s
            FOR UPDATE USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)
            WITH CHECK (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)
        ', table_name, table_name);
        
        -- DELETE policy
        EXECUTE format('
            CREATE POLICY "tenant_delete_%s" ON %s
            FOR DELETE USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::uuid)
        ', table_name, table_name);
    END LOOP;
END $$;