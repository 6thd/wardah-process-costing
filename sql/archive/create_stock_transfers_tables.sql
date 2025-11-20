-- Stock Transfers System Tables
-- نظام تحويلات البضاعة بين المستودعات

-- Stock Transfers Header Table
CREATE TABLE IF NOT EXISTS stock_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Transfer Information
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_number VARCHAR(100) NOT NULL,
  
  -- Warehouses
  from_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  to_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED')),
  
  -- Additional Info
  notes TEXT,
  total_items INTEGER DEFAULT 0,
  
  -- Audit Fields
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  submitted_at TIMESTAMP,
  submitted_by UUID,
  
  -- Constraints
  CONSTRAINT different_warehouses CHECK (from_warehouse_id != to_warehouse_id),
  CONSTRAINT unique_reference_per_org UNIQUE (organization_id, reference_number)
);

-- Stock Transfer Items Table
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  
  -- Product Information
  product_id UUID NOT NULL REFERENCES products(id),
  
  -- Quantities
  quantity DECIMAL(15, 4) NOT NULL CHECK (quantity > 0),
  available_qty_at_transfer DECIMAL(15, 4) DEFAULT 0, -- Historical record
  
  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_stock_transfers_org ON stock_transfers(organization_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_warehouse ON stock_transfers(from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_warehouse ON stock_transfers(to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_reference ON stock_transfers(reference_number);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_date ON stock_transfers(transfer_date);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product ON stock_transfer_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_org ON stock_transfer_items(organization_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_stock_transfer_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_stock_transfers_timestamp
  BEFORE UPDATE ON stock_transfers
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_transfer_timestamp();

CREATE TRIGGER update_stock_transfer_items_timestamp
  BEFORE UPDATE ON stock_transfer_items
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_transfer_timestamp();

-- Enable Row Level Security (RLS)
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for stock_transfers
CREATE POLICY stock_transfers_org_policy ON stock_transfers
  FOR ALL
  USING (
    organization_id IN (
      SELECT org_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for stock_transfer_items
CREATE POLICY stock_transfer_items_org_policy ON stock_transfer_items
  FOR ALL
  USING (
    organization_id IN (
      SELECT org_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

-- Grant Permissions
GRANT ALL ON stock_transfers TO authenticated;
GRANT ALL ON stock_transfer_items TO authenticated;

-- Comments for Documentation
COMMENT ON TABLE stock_transfers IS 'نظام تحويلات البضاعة بين المستودعات - Transfer goods between warehouses';
COMMENT ON COLUMN stock_transfers.status IS 'DRAFT: مسودة، SUBMITTED: مؤكد ومنفذ';
COMMENT ON COLUMN stock_transfers.from_warehouse_id IS 'المستودع المصدر - Source warehouse';
COMMENT ON COLUMN stock_transfers.to_warehouse_id IS 'المستودع الوجهة - Destination warehouse';

COMMENT ON TABLE stock_transfer_items IS 'بنود تحويلات البضاعة - Stock transfer line items';
COMMENT ON COLUMN stock_transfer_items.available_qty_at_transfer IS 'الكمية المتاحة وقت التحويل للتوثيق';
