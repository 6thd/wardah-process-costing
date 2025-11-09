-- =====================================================
-- Phase 2: Stock Ledger System - Database Schema
-- ERPNext-inspired Stock Ledger Entry (SLE) pattern
-- =====================================================

-- =====================================================
-- STEP 1: Create Warehouses Table FIRST
-- =====================================================

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    warehouse_type VARCHAR(50) DEFAULT 'Stores',  -- 'Stores', 'Work-In-Progress', 'Finished Goods', 'Transit'
    parent_warehouse_id UUID REFERENCES warehouses(id),
    is_group BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Saudi Arabia',
    
    -- Audit fields
    org_id UUID REFERENCES organizations(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warehouses_org 
    ON warehouses(org_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_code 
    ON warehouses(code);

COMMENT ON TABLE warehouses IS 'Warehouse master data';

-- Insert default warehouses
INSERT INTO warehouses (code, name, name_ar, warehouse_type, is_active)
VALUES 
    ('WH-001', 'Main Stores', 'المخزن الرئيسي', 'Stores', TRUE),
    ('WH-002', 'Secondary Stores', 'المخزن الفرعي', 'Stores', TRUE),
    ('WH-TRANSIT', 'Transit Warehouse', 'مخزن النقل', 'Transit', TRUE),
    ('WH-SCRAP', 'Scrap Warehouse', 'مخزن المرفوضات', 'Scrap', TRUE)
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- STEP 2: Stock Ledger Entries (SLE)
-- =====================================================
-- This is the CORE of ERPNext's inventory system
-- Every stock movement creates an SLE
-- Running balance is maintained through qty_after_transaction

CREATE TABLE IF NOT EXISTS stock_ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Document Reference
    voucher_type VARCHAR(50) NOT NULL,  -- 'Goods Receipt', 'Delivery Note', 'Stock Entry', etc.
    voucher_id UUID NOT NULL,           -- Reference to source document
    voucher_number VARCHAR(100),        -- Document number for easy reference
    
    -- Product and Warehouse
    product_id UUID NOT NULL REFERENCES products(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    
    -- Posting Details
    posting_date DATE NOT NULL,
    posting_time TIME NOT NULL DEFAULT CURRENT_TIME,
    posting_datetime TIMESTAMP GENERATED ALWAYS AS (posting_date + posting_time) STORED,
    
    -- Quantity Movement
    actual_qty DECIMAL(15, 4) NOT NULL,              -- Change in quantity (+ve for IN, -ve for OUT)
    qty_after_transaction DECIMAL(15, 4) NOT NULL,   -- Running balance after this transaction
    
    -- Valuation
    incoming_rate DECIMAL(15, 4) DEFAULT 0,          -- Rate for incoming stock
    outgoing_rate DECIMAL(15, 4) DEFAULT 0,          -- Rate for outgoing stock
    valuation_rate DECIMAL(15, 4) NOT NULL,          -- Weighted average rate after transaction
    stock_value DECIMAL(20, 4) NOT NULL,             -- qty_after_transaction * valuation_rate
    stock_value_difference DECIMAL(20, 4) NOT NULL,  -- Change in stock value
    
    -- FIFO/LIFO Queue (stored as JSONB for flexibility)
    stock_queue JSONB,                               -- Array of [qty, rate] pairs
    
    -- Batch and Serial Number tracking
    batch_no VARCHAR(100),
    serial_nos TEXT[],                               -- Array of serial numbers
    
    -- Status
    is_cancelled BOOLEAN DEFAULT FALSE,
    docstatus INTEGER DEFAULT 1 CHECK (docstatus IN (0, 1, 2)),
    
    -- Audit fields
    org_id UUID REFERENCES organizations(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modified_by UUID
);

-- Indexes for performance (critical for large datasets)
CREATE INDEX IF NOT EXISTS idx_sle_product_warehouse 
    ON stock_ledger_entries(product_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_sle_posting_datetime 
    ON stock_ledger_entries(posting_date, posting_time);

CREATE INDEX IF NOT EXISTS idx_sle_voucher 
    ON stock_ledger_entries(voucher_type, voucher_id);

CREATE INDEX IF NOT EXISTS idx_sle_warehouse 
    ON stock_ledger_entries(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_sle_product 
    ON stock_ledger_entries(product_id);

-- Composite index for balance queries (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_sle_balance_query 
    ON stock_ledger_entries(product_id, warehouse_id, posting_date DESC, posting_time DESC);

-- Comments
COMMENT ON TABLE stock_ledger_entries IS 'ERPNext Stock Ledger Entry - Core of inventory system. Every stock movement creates an entry.';
COMMENT ON COLUMN stock_ledger_entries.actual_qty IS 'Change in quantity: +ve for incoming, -ve for outgoing';
COMMENT ON COLUMN stock_ledger_entries.qty_after_transaction IS 'Running balance after this transaction';
COMMENT ON COLUMN stock_ledger_entries.valuation_rate IS 'Weighted average rate at this point in time';
COMMENT ON COLUMN stock_ledger_entries.stock_queue IS 'FIFO/LIFO queue as array of [qty, rate] pairs';

-- =====================================================
-- Bins Table
-- Stores aggregated stock balances per warehouse
-- =====================================================

CREATE TABLE IF NOT EXISTS bins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Product and Warehouse (unique combination)
    product_id UUID NOT NULL REFERENCES products(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    
    -- Stock Quantities
    actual_qty DECIMAL(15, 4) DEFAULT 0,     -- Available stock
    reserved_qty DECIMAL(15, 4) DEFAULT 0,   -- Reserved for Sales Orders
    ordered_qty DECIMAL(15, 4) DEFAULT 0,    -- On order from Purchase Orders
    planned_qty DECIMAL(15, 4) DEFAULT 0,    -- Planned for production
    projected_qty DECIMAL(15, 4) GENERATED ALWAYS AS 
        (actual_qty - reserved_qty + ordered_qty + planned_qty) STORED,
    
    -- Valuation
    valuation_rate DECIMAL(15, 4) DEFAULT 0,
    stock_value DECIMAL(20, 4) DEFAULT 0,    -- actual_qty * valuation_rate
    
    -- Stock Queue (for FIFO/LIFO)
    stock_queue JSONB,                        -- Array of [qty, rate] pairs
    
    -- Audit fields
    org_id UUID REFERENCES organizations(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: one bin per product-warehouse combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_bins_product_warehouse 
    ON bins(product_id, warehouse_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bins_warehouse 
    ON bins(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_bins_product 
    ON bins(product_id);

-- Comments
COMMENT ON TABLE bins IS 'ERPNext Bin - Aggregated stock balance per product-warehouse';
COMMENT ON COLUMN bins.actual_qty IS 'Current available stock';
COMMENT ON COLUMN bins.reserved_qty IS 'Stock reserved for confirmed sales orders';
COMMENT ON COLUMN bins.ordered_qty IS 'Stock on order from purchase orders';
COMMENT ON COLUMN bins.projected_qty IS 'Projected available: actual - reserved + ordered + planned';

-- =====================================================
-- Stock Reposting Queue
-- For recalculating valuations when rates change
-- =====================================================

CREATE TABLE IF NOT EXISTS stock_reposting_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- What to repost
    product_id UUID REFERENCES products(id),
    warehouse_id UUID REFERENCES warehouses(id),
    from_date DATE NOT NULL,
    
    -- Status
    status VARCHAR(50) DEFAULT 'Queued',  -- 'Queued', 'In Progress', 'Completed', 'Failed'
    error_message TEXT,
    
    -- Processing info
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    entries_processed INTEGER DEFAULT 0,
    
    -- Audit
    org_id UUID REFERENCES organizations(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_repost_status 
    ON stock_reposting_queue(status, created_at);

COMMENT ON TABLE stock_reposting_queue IS 'Queue for stock valuation reposting when rates change';

-- =====================================================
-- Functions
-- =====================================================

-- Function to get current stock balance
CREATE OR REPLACE FUNCTION get_stock_balance(
    p_product_id UUID,
    p_warehouse_id UUID,
    p_posting_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    quantity DECIMAL(15, 4),
    valuation_rate DECIMAL(15, 4),
    stock_value DECIMAL(20, 4)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(b.actual_qty, 0) as quantity,
        COALESCE(b.valuation_rate, 0) as valuation_rate,
        COALESCE(b.stock_value, 0) as stock_value
    FROM bins b
    WHERE b.product_id = p_product_id
      AND b.warehouse_id = p_warehouse_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get stock balance at a specific date
CREATE OR REPLACE FUNCTION get_stock_balance_at_date(
    p_product_id UUID,
    p_warehouse_id UUID,
    p_posting_date DATE
)
RETURNS TABLE (
    quantity DECIMAL(15, 4),
    valuation_rate DECIMAL(15, 4),
    stock_value DECIMAL(20, 4)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(sle.qty_after_transaction, 0) as quantity,
        COALESCE(sle.valuation_rate, 0) as valuation_rate,
        COALESCE(sle.stock_value, 0) as stock_value
    FROM stock_ledger_entries sle
    WHERE sle.product_id = p_product_id
      AND sle.warehouse_id = p_warehouse_id
      AND sle.posting_date <= p_posting_date
      AND sle.is_cancelled = FALSE
    ORDER BY sle.posting_date DESC, sle.posting_time DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate stock aging
CREATE OR REPLACE FUNCTION get_stock_aging(
    p_warehouse_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL
)
RETURNS TABLE (
    product_id UUID,
    product_code VARCHAR,
    product_name VARCHAR,
    quantity DECIMAL(15, 4),
    valuation_rate DECIMAL(15, 4),
    stock_value DECIMAL(20, 4),
    first_receipt_date DATE,
    days_in_stock INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id as product_id,
        p.code as product_code,
        p.name as product_name,
        b.actual_qty as quantity,
        b.valuation_rate,
        b.stock_value,
        (
            SELECT MIN(sle.posting_date)
            FROM stock_ledger_entries sle
            WHERE sle.product_id = p.id
              AND sle.warehouse_id = b.warehouse_id
              AND sle.actual_qty > 0
              AND sle.is_cancelled = FALSE
        ) as first_receipt_date,
        (
            CURRENT_DATE - (
                SELECT MIN(sle.posting_date)
                FROM stock_ledger_entries sle
                WHERE sle.product_id = p.id
                  AND sle.warehouse_id = b.warehouse_id
                  AND sle.actual_qty > 0
                  AND sle.is_cancelled = FALSE
            )
        )::INTEGER as days_in_stock
    FROM products p
    JOIN bins b ON b.product_id = p.id
    WHERE b.actual_qty > 0
      AND (p_warehouse_id IS NULL OR b.warehouse_id = p_warehouse_id)
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
    ORDER BY days_in_stock DESC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Grants (RLS will be handled separately)
-- =====================================================

-- Grant permissions
GRANT ALL ON stock_ledger_entries TO authenticated;
GRANT ALL ON bins TO authenticated;
GRANT ALL ON warehouses TO authenticated;
GRANT ALL ON stock_reposting_queue TO authenticated;

-- =====================================================
-- Verification Queries
-- =====================================================

-- Verify tables created
DO $$
BEGIN
    RAISE NOTICE 'Stock Ledger System tables created successfully';
    RAISE NOTICE 'Tables: stock_ledger_entries, bins, warehouses, stock_reposting_queue';
    RAISE NOTICE 'Functions: get_stock_balance, get_stock_balance_at_date, get_stock_aging';
END $$;
