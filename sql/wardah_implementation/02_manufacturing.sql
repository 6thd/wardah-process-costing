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