-- ==============================================================================
-- WAREHOUSE MANAGEMENT SYSTEM WITH FULL ACCOUNTING INTEGRATION
-- Based on Best Practices from SAP, Oracle EBS, and ERPNext
-- ==============================================================================

-- ==============================================================================
-- 1. WAREHOUSE TYPES ENUM
-- ==============================================================================
DO $$ BEGIN
    CREATE TYPE warehouse_type AS ENUM (
        'MAIN',           -- المخزن الرئيسي
        'BRANCH',         -- مخزن فرع
        'TRANSIT',        -- مخزن عبور/نقل
        'WORK_IN_PROCESS',-- مخزن تحت التشغيل (WIP)
        'FINISHED_GOODS', -- مخزن بضاعة تامة
        'RAW_MATERIALS',  -- مخزن مواد خام
        'QUARANTINE',     -- مخزن حجر صحي
        'SCRAP',          -- مخزن خردة
        'VIRTUAL'         -- مخزن افتراضي (للإدارة)
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==============================================================================
-- 2. WAREHOUSES TABLE (Enhanced)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Basic Information
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    
    -- Classification
    warehouse_type warehouse_type NOT NULL DEFAULT 'MAIN',
    parent_warehouse_id UUID REFERENCES warehouses(id),
    
    -- Location Details
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Saudi Arabia',
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Contact Information
    manager_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    
    -- Accounting Integration (Core Link to Chart of Accounts)
    -- Each warehouse has its own set of GL accounts
    inventory_account_id UUID REFERENCES accounts(id),      -- حساب المخزون (1400-series)
    expense_account_id UUID REFERENCES accounts(id),        -- حساب المصروفات (5000-series)
    cost_center_id UUID,                                    -- مركز التكلفة
    
    -- Operational Settings
    is_active BOOLEAN DEFAULT true,
    is_group BOOLEAN DEFAULT false,  -- هل هو مجموعة (لهيكل شجري)
    allow_negative_stock BOOLEAN DEFAULT false,
    auto_create_bins BOOLEAN DEFAULT false,
    
    -- Capacity Management
    total_capacity DECIMAL(15, 2),  -- السعة الإجمالية (متر مربع أو مكعب)
    capacity_unit VARCHAR(20),       -- الوحدة (sqm, cbm, pallets)
    
    -- Status and Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    UNIQUE(org_id, code),
    CHECK (code ~ '^[A-Z0-9-]+$')  -- Only uppercase alphanumeric and hyphens
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_warehouses_org ON warehouses(org_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_type ON warehouses(org_id, warehouse_type);
CREATE INDEX IF NOT EXISTS idx_warehouses_parent ON warehouses(parent_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_accounts ON warehouses(inventory_account_id, expense_account_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_active ON warehouses(org_id, is_active);

-- Tree structure support
CREATE INDEX IF NOT EXISTS idx_warehouses_tree ON warehouses(org_id, parent_warehouse_id, is_group);

-- Comments
COMMENT ON TABLE warehouses IS 'المخازن - مع ربط كامل بشجرة الحسابات ومراكز التكلفة';
COMMENT ON COLUMN warehouses.inventory_account_id IS 'حساب المخزون في شجرة الحسابات - يتم ربط كل حركة مخزنية به';
COMMENT ON COLUMN warehouses.expense_account_id IS 'حساب المصروفات المرتبط بالمخزن - للتسويات والخسائر';
COMMENT ON COLUMN warehouses.cost_center_id IS 'مركز التكلفة - لتحليل التكاليف حسب المخزن';

-- ==============================================================================
-- 3. STORAGE LOCATIONS (Zones within Warehouse)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS storage_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- Identification
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    
    -- Hierarchy (Optional - for multi-level zones)
    parent_location_id UUID REFERENCES storage_locations(id),
    
    -- Location Properties
    location_type VARCHAR(50),  -- 'RACK', 'SHELF', 'FLOOR', 'COLD_STORAGE', 'HAZMAT'
    temperature_controlled BOOLEAN DEFAULT false,
    temperature_min DECIMAL(5, 2),
    temperature_max DECIMAL(5, 2),
    
    -- Capacity
    capacity DECIMAL(15, 2),
    capacity_unit VARCHAR(20),
    current_utilization DECIMAL(5, 2) DEFAULT 0,  -- Percentage
    
    -- Physical Dimensions
    length DECIMAL(10, 2),
    width DECIMAL(10, 2),
    height DECIMAL(10, 2),
    dimension_unit VARCHAR(10) DEFAULT 'meter',
    
    -- Access Control
    restricted_access BOOLEAN DEFAULT false,
    access_roles TEXT[],  -- Array of role names that can access
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_pickable BOOLEAN DEFAULT true,  -- يمكن الصرف منه
    is_receivable BOOLEAN DEFAULT true, -- يمكن الاستلام فيه
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    UNIQUE(warehouse_id, code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_storage_locations_warehouse ON storage_locations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_storage_locations_type ON storage_locations(warehouse_id, location_type);
CREATE INDEX IF NOT EXISTS idx_storage_locations_active ON storage_locations(warehouse_id, is_active);

COMMENT ON TABLE storage_locations IS 'مواقع التخزين داخل المخزن - المناطق والأقسام';

-- ==============================================================================
-- 4. BINS (Specific Storage Bins/Slots)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS storage_bins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- Identification
    bin_code VARCHAR(50) NOT NULL,
    barcode VARCHAR(100),
    qr_code TEXT,
    
    -- Position (for warehouse mapping)
    aisle VARCHAR(20),
    rack VARCHAR(20),
    level VARCHAR(20),
    position VARCHAR(20),
    
    -- Bin Properties
    bin_type VARCHAR(50),  -- 'PALLET', 'SHELF', 'FLOOR', 'HANGING'
    dedicated_product_id UUID REFERENCES products(id),  -- خاص بمنتج معين (اختياري)
    
    -- Capacity
    max_weight DECIMAL(10, 2),
    weight_unit VARCHAR(10) DEFAULT 'kg',
    max_volume DECIMAL(10, 2),
    volume_unit VARCHAR(10) DEFAULT 'cbm',
    
    -- Current Status
    is_occupied BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    is_locked BOOLEAN DEFAULT false,  -- مقفل للجرد أو الصيانة
    lock_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(warehouse_id, bin_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bins_location ON storage_bins(location_id);
CREATE INDEX IF NOT EXISTS idx_bins_warehouse ON storage_bins(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_bins_barcode ON storage_bins(barcode);
CREATE INDEX IF NOT EXISTS idx_bins_product ON storage_bins(dedicated_product_id);
CREATE INDEX IF NOT EXISTS idx_bins_position ON storage_bins(warehouse_id, aisle, rack, level);

COMMENT ON TABLE storage_bins IS 'الصناديق والمواقع التفصيلية - أدق مستوى في التخزين';

-- ==============================================================================
-- 5. WAREHOUSE ACCOUNTING MAPPING
-- Automatic GL Account Creation for Each Warehouse
-- ==============================================================================
CREATE TABLE IF NOT EXISTS warehouse_gl_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id),
    
    -- GL Accounts (Based on ERPNext model)
    stock_account UUID NOT NULL REFERENCES accounts(id),              -- حساب المخزون
    stock_received_but_not_billed UUID REFERENCES accounts(id),       -- بضاعة مستلمة غير مفوترة
    stock_adjustment_account UUID REFERENCES accounts(id),            -- حساب تسويات المخزون
    expenses_included_in_valuation UUID REFERENCES accounts(id),      -- المصاريف المضمنة في التقييم
    cost_center UUID,                                                  -- مركز التكلفة
    
    -- Default Accounts for Transactions
    default_sales_account UUID REFERENCES accounts(id),               -- حساب المبيعات الافتراضي
    default_cogs_account UUID REFERENCES accounts(id),                -- حساب تكلفة المبيعات
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(warehouse_id)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_warehouse_gl_warehouse ON warehouse_gl_mapping(warehouse_id);

COMMENT ON TABLE warehouse_gl_mapping IS 'ربط المخازن بشجرة الحسابات - كل مخزن له حساباته الخاصة';

-- ==============================================================================
-- 6. WAREHOUSE CAPACITY TRACKING
-- ==============================================================================
CREATE TABLE IF NOT EXISTS warehouse_capacity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- Snapshot Data
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_capacity DECIMAL(15, 2),
    used_capacity DECIMAL(15, 2),
    available_capacity DECIMAL(15, 2),
    utilization_percentage DECIMAL(5, 2),
    
    -- Item Counts
    total_items INTEGER,
    total_products INTEGER,
    total_bins_occupied INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(warehouse_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_capacity_log_warehouse ON warehouse_capacity_log(warehouse_id, snapshot_date DESC);

-- ==============================================================================
-- 7. UPDATE EXISTING TABLES TO REFERENCE WAREHOUSES PROPERLY
-- ==============================================================================

-- Ensure stock_ledger_entries uses correct warehouse reference
DO $$ 
BEGIN
    -- Add warehouse_id if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_ledger_entries' AND column_name = 'warehouse_id'
    ) THEN
        ALTER TABLE stock_ledger_entries 
        ADD COLUMN warehouse_id UUID REFERENCES warehouses(id);
        
        CREATE INDEX idx_sle_warehouse_new ON stock_ledger_entries(warehouse_id);
    END IF;
END $$;

-- ==============================================================================
-- 8. VIEWS FOR REPORTING
-- ==============================================================================

-- Current Stock by Warehouse
CREATE OR REPLACE VIEW v_stock_by_warehouse AS
SELECT 
    w.id as warehouse_id,
    w.code as warehouse_code,
    w.name as warehouse_name,
    w.warehouse_type,
    p.id as product_id,
    p.name as product_name,
    p.code as product_code,
    COALESCE(SUM(sle.actual_qty), 0) as stock_qty,
    COALESCE(SUM(sle.stock_value), 0) as stock_value,
    MAX(sle.posting_date) as last_transaction_date
FROM warehouses w
CROSS JOIN products p
LEFT JOIN stock_ledger_entries sle ON sle.warehouse_id = w.id AND sle.product_id = p.id AND NOT sle.is_cancelled
WHERE w.is_active = true
GROUP BY w.id, w.code, w.name, w.warehouse_type, p.id, p.name, p.code
HAVING COALESCE(SUM(sle.actual_qty), 0) != 0;

COMMENT ON VIEW v_stock_by_warehouse IS 'عرض المخزون الحالي حسب المخزن والمنتج';

-- Warehouse Utilization Summary
CREATE OR REPLACE VIEW v_warehouse_utilization AS
SELECT 
    w.id,
    w.code,
    w.name,
    w.warehouse_type,
    w.total_capacity,
    w.capacity_unit,
    COUNT(DISTINCT sb.id) as total_bins,
    COUNT(DISTINCT CASE WHEN sb.is_occupied THEN sb.id END) as occupied_bins,
    ROUND(
        COUNT(DISTINCT CASE WHEN sb.is_occupied THEN sb.id END)::NUMERIC / 
        NULLIF(COUNT(DISTINCT sb.id), 0) * 100, 
        2
    ) as utilization_percentage
FROM warehouses w
LEFT JOIN storage_bins sb ON sb.warehouse_id = w.id AND sb.is_active = true
WHERE w.is_active = true
GROUP BY w.id, w.code, w.name, w.warehouse_type, w.total_capacity, w.capacity_unit;

COMMENT ON VIEW v_warehouse_utilization IS 'استخدام وسعة المخازن';

-- ==============================================================================
-- 9. TRIGGERS FOR AUTOMATIC UPDATES
-- ==============================================================================

-- Auto-update warehouse capacity when bins change
CREATE OR REPLACE FUNCTION update_warehouse_capacity()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE warehouses w
        SET updated_at = CURRENT_TIMESTAMP
        WHERE w.id = NEW.warehouse_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE warehouses w
        SET updated_at = CURRENT_TIMESTAMP
        WHERE w.id = OLD.warehouse_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_warehouse_capacity
AFTER INSERT OR UPDATE OR DELETE ON storage_bins
FOR EACH ROW
EXECUTE FUNCTION update_warehouse_capacity();

-- ==============================================================================
-- 10. RLS POLICIES
-- ==============================================================================

-- Warehouses
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY warehouses_org_isolation ON warehouses
    FOR ALL
    USING (org_id IN (
        SELECT org_id FROM user_organizations 
        WHERE user_id = auth.uid()
    ));

-- Storage Locations
ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY storage_locations_org_isolation ON storage_locations
    FOR ALL
    USING (warehouse_id IN (
        SELECT id FROM warehouses 
        WHERE org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    ));

-- Storage Bins
ALTER TABLE storage_bins ENABLE ROW LEVEL SECURITY;

CREATE POLICY storage_bins_org_isolation ON storage_bins
    FOR ALL
    USING (warehouse_id IN (
        SELECT id FROM warehouses 
        WHERE org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    ));

-- ==============================================================================
-- COMPLETE! Warehouse Management System with Full GL Integration
-- ==============================================================================
