-- Create Supplier Invoices table
CREATE TABLE IF NOT EXISTS supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE,
  
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  
  paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending, paid, partial, overdue, cancelled
  
  notes TEXT,
  
  CONSTRAINT valid_status CHECK (status IN ('pending', 'paid', 'partial', 'overdue', 'cancelled'))
);

-- Create Supplier Invoice Lines table
CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  
  quantity DECIMAL(15,3) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(15,2) NOT NULL,
  
  description TEXT,
  
  CONSTRAINT positive_quantity CHECK (quantity > 0),
  CONSTRAINT positive_unit_price CHECK (unit_price >= 0)
);

-- Add invoiced_quantity column to purchase_order_lines if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'purchase_order_lines' 
    AND column_name = 'invoiced_quantity'
  ) THEN
    ALTER TABLE purchase_order_lines 
    ADD COLUMN invoiced_quantity DECIMAL(15,3) DEFAULT 0;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_vendor ON supplier_invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_po ON supplier_invoices(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_date ON supplier_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status ON supplier_invoices(status);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_invoice ON supplier_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_product ON supplier_invoice_lines(product_id);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_supplier_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_supplier_invoices_updated_at ON supplier_invoices;
CREATE TRIGGER trigger_supplier_invoices_updated_at
  BEFORE UPDATE ON supplier_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_supplier_invoices_updated_at();

-- Grant permissions
GRANT ALL ON supplier_invoices TO authenticated;
GRANT ALL ON supplier_invoice_lines TO authenticated;
GRANT ALL ON supplier_invoices TO anon;
GRANT ALL ON supplier_invoice_lines TO anon;

COMMENT ON TABLE supplier_invoices IS 'Supplier invoices for purchases';
COMMENT ON TABLE supplier_invoice_lines IS 'Line items for supplier invoices';
