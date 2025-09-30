-- =======================================
-- 5. INDEXES FOR PERFORMANCE
-- =======================================

-- Core indexes
CREATE INDEX idx_gl_accounts_org_code ON gl_accounts(org_id, code);
CREATE INDEX idx_gl_accounts_category ON gl_accounts(category, subtype);
CREATE INDEX idx_gl_mappings_lookup ON gl_mappings(org_id, key_type, key_value);

-- Manufacturing indexes
CREATE INDEX idx_products_org_sku ON products(org_id, sku);
CREATE INDEX idx_products_type ON products(product_type, is_active);
CREATE INDEX idx_bom_headers_product ON bom_headers(product_id, is_active);
CREATE INDEX idx_mo_status ON manufacturing_orders(org_id, status);
CREATE INDEX idx_mo_product ON manufacturing_orders(product_id, status);

-- Inventory indexes
CREATE INDEX idx_stock_quants_product_location ON stock_quants(product_id, location_id);
CREATE INDEX idx_stock_moves_product ON stock_moves(product_id, move_type);
CREATE INDEX idx_stock_moves_reference ON stock_moves(reference_type, reference_id);
CREATE INDEX idx_stock_moves_date ON stock_moves(created_at, org_id);

-- Sales & Purchase indexes
CREATE INDEX idx_po_vendor_date ON purchase_orders(vendor_id, order_date);
CREATE INDEX idx_so_customer_date ON sales_orders(customer_id, order_date);

-- =======================================
-- 6. CONSTRAINTS
-- =======================================

-- Ensure valid parent relationships in GL accounts
ALTER TABLE gl_accounts 
ADD CONSTRAINT chk_gl_parent_exists 
CHECK (parent_code IS NULL OR EXISTS (
    SELECT 1 FROM gl_accounts parent 
    WHERE parent.code = gl_accounts.parent_code 
    AND parent.org_id = gl_accounts.org_id
));

-- Ensure quantity constraints
ALTER TABLE stock_moves 
ADD CONSTRAINT chk_quantity_not_zero 
CHECK (quantity != 0);

ALTER TABLE stock_quants 
ADD CONSTRAINT chk_onhand_qty_valid 
CHECK (onhand_qty >= 0 OR (SELECT allow_negative_qty FROM cost_settings WHERE org_id = stock_quants.org_id));

-- Ensure cost constraints
ALTER TABLE stock_moves 
ADD CONSTRAINT chk_costs_non_negative 
CHECK (unit_cost_in >= 0 AND unit_cost_out >= 0);