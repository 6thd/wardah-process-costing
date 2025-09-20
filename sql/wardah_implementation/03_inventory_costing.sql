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