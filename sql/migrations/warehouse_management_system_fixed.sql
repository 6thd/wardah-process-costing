-- ==============================================================================
-- WAREHOUSE MANAGEMENT SYSTEM - FIXED VERSION
-- Compatible with existing database structure
-- ==============================================================================

-- ==============================================================================
-- 1. CHECK AND ADD MISSING COLUMNS TO WAREHOUSES
-- ==============================================================================

DO $$ 
BEGIN
    -- Add inventory_account_id if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'inventory_account_id'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN inventory_account_id UUID REFERENCES accounts(id);
        RAISE NOTICE 'Added inventory_account_id column';
    END IF;

    -- Add expense_account_id if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'expense_account_id'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN expense_account_id UUID REFERENCES accounts(id);
        RAISE NOTICE 'Added expense_account_id column';
    END IF;

    -- Add cost_center_id if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'cost_center_id'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN cost_center_id UUID;
        RAISE NOTICE 'Added cost_center_id column';
    END IF;

    -- Add warehouse_type if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'warehouse_type'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN warehouse_type VARCHAR(50) DEFAULT 'main';
        RAISE NOTICE 'Added warehouse_type column';
    END IF;

    -- Add parent_warehouse_id if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'parent_warehouse_id'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN parent_warehouse_id UUID REFERENCES warehouses(id);
        RAISE NOTICE 'Added parent_warehouse_id column';
    END IF;

    -- Add is_group if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'is_group'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN is_group BOOLEAN DEFAULT false;
        RAISE NOTICE 'Added is_group column';
    END IF;

    -- Add other essential columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'address'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN address TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'city'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN city VARCHAR(100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'manager_name'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN manager_name VARCHAR(255);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'contact_email'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN contact_email VARCHAR(255);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'contact_phone'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN contact_phone VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'total_capacity'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN total_capacity DECIMAL(15, 2);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'capacity_unit'
    ) THEN
        ALTER TABLE warehouses ADD COLUMN capacity_unit VARCHAR(20);
    END IF;

END $$;

-- ==============================================================================
-- 2. CREATE STORAGE LOCATIONS TABLE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS storage_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- Identification
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    
    -- Hierarchy
    parent_location_id UUID REFERENCES storage_locations(id),
    
    -- Location Properties
    location_type VARCHAR(50),
    temperature_controlled BOOLEAN DEFAULT false,
    temperature_min DECIMAL(5, 2),
    temperature_max DECIMAL(5, 2),
    
    -- Capacity
    capacity DECIMAL(15, 2),
    capacity_unit VARCHAR(20),
    current_utilization DECIMAL(5, 2) DEFAULT 0,
    
    -- Physical Dimensions
    length DECIMAL(10, 2),
    width DECIMAL(10, 2),
    height DECIMAL(10, 2),
    dimension_unit VARCHAR(10) DEFAULT 'meter',
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_pickable BOOLEAN DEFAULT true,
    is_receivable BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    UNIQUE(warehouse_id, code)
);

-- Indexes for storage_locations
CREATE INDEX IF NOT EXISTS idx_storage_locations_warehouse ON storage_locations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_storage_locations_type ON storage_locations(warehouse_id, location_type);
CREATE INDEX IF NOT EXISTS idx_storage_locations_active ON storage_locations(warehouse_id, is_active);

COMMENT ON TABLE storage_locations IS 'مواقع التخزين داخل المخزن - المناطق والأقسام';

-- ==============================================================================
-- 3. CREATE STORAGE BINS TABLE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS storage_bins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- Identification
    bin_code VARCHAR(50) NOT NULL,
    barcode VARCHAR(100),
    qr_code TEXT,
    
    -- Position
    aisle VARCHAR(20),
    rack VARCHAR(20),
    level VARCHAR(20),
    position VARCHAR(20),
    
    -- Bin Properties
    bin_type VARCHAR(50),
    dedicated_product_id UUID REFERENCES products(id),
    
    -- Capacity
    max_weight DECIMAL(10, 2),
    weight_unit VARCHAR(10) DEFAULT 'kg',
    max_volume DECIMAL(10, 2),
    volume_unit VARCHAR(10) DEFAULT 'cbm',
    
    -- Current Status
    is_occupied BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    is_locked BOOLEAN DEFAULT false,
    lock_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(warehouse_id, bin_code)
);

-- Indexes for storage_bins
CREATE INDEX IF NOT EXISTS idx_bins_location ON storage_bins(location_id);
CREATE INDEX IF NOT EXISTS idx_bins_warehouse ON storage_bins(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_bins_barcode ON storage_bins(barcode);
CREATE INDEX IF NOT EXISTS idx_bins_product ON storage_bins(dedicated_product_id);

COMMENT ON TABLE storage_bins IS 'الصناديق والمواقع التفصيلية - أدق مستوى في التخزين';

-- ==============================================================================
-- 4. CREATE WAREHOUSE GL MAPPING TABLE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS warehouse_gl_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id),
    
    -- GL Accounts
    stock_account UUID REFERENCES accounts(id),
    stock_received_but_not_billed UUID REFERENCES accounts(id),
    stock_adjustment_account UUID REFERENCES accounts(id),
    expenses_included_in_valuation UUID REFERENCES accounts(id),
    cost_center UUID,
    default_sales_account UUID REFERENCES accounts(id),
    default_cogs_account UUID REFERENCES accounts(id),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_gl_warehouse ON warehouse_gl_mapping(warehouse_id);

COMMENT ON TABLE warehouse_gl_mapping IS 'ربط المخازن بشجرة الحسابات - كل مخزن له حساباته الخاصة';

-- ==============================================================================
-- 5. ADD INDEXES TO WAREHOUSES
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_warehouses_accounts ON warehouses(inventory_account_id, expense_account_id) WHERE inventory_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warehouses_parent ON warehouses(parent_warehouse_id) WHERE parent_warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warehouses_type ON warehouses(org_id, warehouse_type);

-- ==============================================================================
-- 6. CREATE VIEWS FOR REPORTING
-- ==============================================================================

-- Stock by Warehouse View
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
WHERE w.is_active
GROUP BY w.id, w.code, w.name, w.warehouse_type, p.id, p.name, p.code
HAVING COALESCE(SUM(sle.actual_qty), 0) != 0;

COMMENT ON VIEW v_stock_by_warehouse IS 'عرض المخزون الحالي حسب المخزن والمنتج';

-- Warehouse Utilization View
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
        COALESCE(
            COUNT(DISTINCT CASE WHEN sb.is_occupied THEN sb.id END)::NUMERIC / 
            NULLIF(COUNT(DISTINCT sb.id), 0) * 100,
            0
        ), 
        2
    ) as utilization_percentage
FROM warehouses w
LEFT JOIN storage_bins sb ON sb.warehouse_id = w.id AND sb.is_active
WHERE w.is_active
GROUP BY w.id, w.code, w.name, w.warehouse_type, w.total_capacity, w.capacity_unit;

COMMENT ON VIEW v_warehouse_utilization IS 'استخدام وسعة المخازن';

-- ==============================================================================
-- 7. RLS POLICIES
-- ==============================================================================

-- Storage Locations
ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'storage_locations' AND policyname = 'storage_locations_org_isolation'
    ) THEN
        CREATE POLICY storage_locations_org_isolation ON storage_locations
            FOR ALL
            USING (warehouse_id IN (
                SELECT id FROM warehouses 
                WHERE org_id IN (
                    SELECT org_id FROM user_organizations 
                    WHERE user_id = auth.uid()
                )
            ));
    END IF;
END $$;

-- Storage Bins
ALTER TABLE storage_bins ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'storage_bins' AND policyname = 'storage_bins_org_isolation'
    ) THEN
        CREATE POLICY storage_bins_org_isolation ON storage_bins
            FOR ALL
            USING (warehouse_id IN (
                SELECT id FROM warehouses 
                WHERE org_id IN (
                    SELECT org_id FROM user_organizations 
                    WHERE user_id = auth.uid()
                )
            ));
    END IF;
END $$;

-- Warehouse GL Mapping
ALTER TABLE warehouse_gl_mapping ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'warehouse_gl_mapping' AND policyname = 'warehouse_gl_mapping_org_isolation'
    ) THEN
        CREATE POLICY warehouse_gl_mapping_org_isolation ON warehouse_gl_mapping
            FOR ALL
            USING (org_id IN (
                SELECT org_id FROM user_organizations 
                WHERE user_id = auth.uid()
            ));
    END IF;
END $$;

-- ==============================================================================
-- 8. SUCCESS MESSAGE
-- ==============================================================================

DO $$ 
BEGIN
    RAISE NOTICE '✅ Warehouse Management System installed successfully!';
    RAISE NOTICE '✅ Tables created: storage_locations, storage_bins, warehouse_gl_mapping';
    RAISE NOTICE '✅ Columns added to warehouses table';
    RAISE NOTICE '✅ Views created: v_stock_by_warehouse, v_warehouse_utilization';
    RAISE NOTICE '✅ RLS Policies applied';
    RAISE NOTICE '';
    RAISE NOTICE '📝 Next step: Run warehouse_accounting_integration.sql';
END $$;
