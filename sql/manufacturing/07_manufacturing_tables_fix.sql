-- =============================================
-- Manufacturing Tables Fix
-- إصلاح وإنشاء جداول التصنيع المفقودة
-- =============================================

-- 1. إنشاء جدول manufacturing_orders إذا لم يكن موجوداً
-- =============================================
CREATE TABLE IF NOT EXISTS manufacturing_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL,
    order_number VARCHAR(100) NOT NULL,
    item_id UUID,
    product_id UUID,
    quantity NUMERIC(18,6) NOT NULL DEFAULT 0,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'confirmed', 'in_progress', 'completed', 'cancelled')),
    start_date DATE,
    due_date DATE,
    completed_date DATE,
    completed_quantity NUMERIC(18,6) DEFAULT 0,
    scrap_quantity NUMERIC(18,6) DEFAULT 0,
    total_cost NUMERIC(18,4) DEFAULT 0,
    unit_cost NUMERIC(18,6) DEFAULT 0,
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(org_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_orders_org ON manufacturing_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_orders_status ON manufacturing_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_manufacturing_orders_date ON manufacturing_orders(org_id, start_date);

COMMENT ON TABLE manufacturing_orders IS 'أوامر التصنيع';

-- 2. إنشاء جدول work_centers إذا لم يكن موجوداً
-- =============================================
CREATE TABLE IF NOT EXISTS work_centers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    description TEXT,
    hourly_rate NUMERIC(18,6) DEFAULT 0 CHECK (hourly_rate >= 0),
    capacity_per_hour NUMERIC(18,6) DEFAULT 1,
    efficiency_percent NUMERIC(5,2) DEFAULT 100 CHECK (efficiency_percent >= 0 AND efficiency_percent <= 100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_work_centers_org ON work_centers(org_id);
CREATE INDEX IF NOT EXISTS idx_work_centers_active ON work_centers(org_id, is_active);

COMMENT ON TABLE work_centers IS 'مراكز العمل';

-- 3. إنشاء جدول stage_costs إذا لم يكن موجوداً
-- =============================================
CREATE TABLE IF NOT EXISTS stage_costs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL,
    manufacturing_order_id UUID NOT NULL,
    stage_number INTEGER NOT NULL CHECK (stage_number > 0),
    work_center_id UUID,
    
    -- Quantities
    input_qty NUMERIC(18,6) DEFAULT 0 CHECK (input_qty >= 0),
    good_qty NUMERIC(18,6) DEFAULT 0 CHECK (good_qty >= 0),
    scrap_qty NUMERIC(18,6) DEFAULT 0 CHECK (scrap_qty >= 0),
    rework_qty NUMERIC(18,6) DEFAULT 0 CHECK (rework_qty >= 0),
    
    -- Cost Components
    transferred_in NUMERIC(18,6) DEFAULT 0,
    dm_cost NUMERIC(18,6) DEFAULT 0,
    dl_cost NUMERIC(18,6) DEFAULT 0,
    moh_cost NUMERIC(18,6) DEFAULT 0,
    regrind_proc_cost NUMERIC(18,6) DEFAULT 0,
    waste_credit NUMERIC(18,6) DEFAULT 0,
    
    -- Calculated totals
    total_cost NUMERIC(18,6) DEFAULT 0,
    unit_cost NUMERIC(18,6) DEFAULT 0,
    
    -- Status
    mode TEXT DEFAULT 'precosted' CHECK (mode IN ('precosted', 'actual', 'completed')),
    is_final BOOLEAN DEFAULT false,
    
    -- Notes
    notes TEXT,
    batch_id TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    
    UNIQUE(org_id, manufacturing_order_id, stage_number)
);

CREATE INDEX IF NOT EXISTS idx_stage_costs_org_mo ON stage_costs(org_id, manufacturing_order_id);
CREATE INDEX IF NOT EXISTS idx_stage_costs_wc ON stage_costs(org_id, work_center_id);
CREATE INDEX IF NOT EXISTS idx_stage_costs_mode ON stage_costs(org_id, mode);

COMMENT ON TABLE stage_costs IS 'تكاليف المراحل';

-- 4. إضافة org_id إلى manufacturing_orders إذا لم يكن موجوداً
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'manufacturing_orders' 
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE manufacturing_orders ADD COLUMN org_id UUID;
    END IF;
END $$;

-- 5. إضافة org_id إلى work_centers إذا لم يكن موجوداً
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'work_centers' 
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE work_centers ADD COLUMN org_id UUID;
    END IF;
END $$;

-- 6. إضافة org_id إلى stage_costs إذا لم يكن موجوداً
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stage_costs' 
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE stage_costs ADD COLUMN org_id UUID;
    END IF;
END $$;

-- 7. إضافة tenant_id كبديل لـ org_id إذا لزم الأمر
-- =============================================
DO $$
BEGIN
    -- manufacturing_orders
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'manufacturing_orders' 
        AND column_name = 'tenant_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'manufacturing_orders' 
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE manufacturing_orders ADD COLUMN org_id UUID;
        UPDATE manufacturing_orders SET org_id = tenant_id WHERE org_id IS NULL;
    END IF;
    
    -- work_centers
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'work_centers' 
        AND column_name = 'tenant_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'work_centers' 
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE work_centers ADD COLUMN org_id UUID;
        UPDATE work_centers SET org_id = tenant_id WHERE org_id IS NULL;
    END IF;
    
    -- stage_costs
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stage_costs' 
        AND column_name = 'tenant_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stage_costs' 
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE stage_costs ADD COLUMN org_id UUID;
        UPDATE stage_costs SET org_id = tenant_id WHERE org_id IS NULL;
    END IF;
END $$;

SELECT 'Manufacturing tables fix completed successfully' AS status;

