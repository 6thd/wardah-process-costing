-- Fix supplier_invoice_lines table structure
-- Drop and recreate to ensure correct structure

DROP TABLE IF EXISTS supplier_invoice_lines CASCADE;

CREATE TABLE supplier_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  
  quantity DECIMAL(15,3) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  
  -- Generated column for line total
  line_total DECIMAL(15,2) GENERATED ALWAYS AS (
    (quantity * unit_price) - discount_amount + tax_amount
  ) STORED,
  
  description TEXT,
  
  CONSTRAINT positive_quantity CHECK (quantity > 0),
  CONSTRAINT positive_unit_price CHECK (unit_price >= 0)
);

-- Create indexes
CREATE INDEX idx_supplier_invoice_lines_invoice ON supplier_invoice_lines(invoice_id);
CREATE INDEX idx_supplier_invoice_lines_product ON supplier_invoice_lines(product_id);

-- Grant permissions
GRANT ALL ON supplier_invoice_lines TO authenticated;
GRANT ALL ON supplier_invoice_lines TO anon;

COMMENT ON TABLE supplier_invoice_lines IS 'Line items for supplier invoices';
COMMENT ON COLUMN supplier_invoice_lines.line_total IS 'Calculated: (quantity × unit_price) - discount + tax';
