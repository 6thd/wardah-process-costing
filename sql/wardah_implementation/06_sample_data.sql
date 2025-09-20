-- =======================================
-- SAMPLE DATA FOR TESTING
-- =======================================

-- Insert sample organization
INSERT INTO organizations (id, name, code, settings) 
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'وردة البيان للصناعات البلاستيكية',
    'WRD001',
    '{"currency": "SAR", "timezone": "Asia/Riyadh", "fiscal_year_start": "01-01"}'::jsonb
);

-- Insert sample UOMs
INSERT INTO uoms (org_id, code, name, factor, is_base) VALUES
('00000000-0000-0000-0000-000000000001', 'KG', 'كيلوجرام', 1.0, true),
('00000000-0000-0000-0000-000000000001', 'PCS', 'قطعة', 1.0, false),
('00000000-0000-0000-0000-000000000001', 'M', 'متر', 1.0, false),
('00000000-0000-0000-0000-000000000001', 'TON', 'طن', 1000.0, false);

-- Insert sample warehouse and locations
INSERT INTO warehouses (org_id, code, name) VALUES
('00000000-0000-0000-0000-000000000001', 'WH01', 'المستودع الرئيسي');

INSERT INTO locations (org_id, warehouse_id, code, name, usage) VALUES
('00000000-0000-0000-0000-000000000001', (SELECT id FROM warehouses WHERE code = 'WH01'), 'RM-STOCK', 'مخزن المواد الخام', 'stock'),
('00000000-0000-0000-0000-000000000001', (SELECT id FROM warehouses WHERE code = 'WH01'), 'WIP-MAIN', 'منطقة الإنتاج الرئيسية', 'wip'),
('00000000-0000-0000-0000-000000000001', (SELECT id FROM warehouses WHERE code = 'WH01'), 'FG-STOCK', 'مخزن المنتجات التامة', 'stock'),
('00000000-0000-0000-0000-000000000001', (SELECT id FROM warehouses WHERE code = 'WH01'), 'SCRAP', 'منطقة السكراب', 'scrap');

-- Insert cost settings
INSERT INTO cost_settings (org_id, costing_method, avg_cost_precision, currency_code, allow_negative_qty, auto_recompute_costs) 
VALUES ('00000000-0000-0000-0000-000000000001', 'avco', 6, 'SAR', false, true);

-- =======================================
-- COMMENTS
-- =======================================

COMMENT ON TABLE organizations IS 'Organizations for multi-tenant support';
COMMENT ON TABLE gl_accounts IS 'Chart of Accounts with enhanced manufacturing support';
COMMENT ON TABLE gl_mappings IS 'GL account mappings for automated journal entries';
COMMENT ON TABLE stock_quants IS 'Current stock quantities with AVCO costing';
COMMENT ON TABLE stock_moves IS 'All inventory movements with cost tracking';
COMMENT ON TABLE manufacturing_orders IS 'Manufacturing orders with process costing support';
COMMENT ON TABLE cost_settings IS 'AVCO and costing method configuration';

-- =======================================
-- SUCCESS MESSAGE
-- =======================================

DO $$
BEGIN
    RAISE NOTICE '✅ Wardah ERP Database Schema Created Successfully!';
    RAISE NOTICE '🏭 Manufacturing & Process Costing Ready';
    RAISE NOTICE '💰 AVCO Integration Configured';
    RAISE NOTICE '🔒 Multi-tenant RLS Ready (enable in next step)';
    RAISE NOTICE '📊 Enhanced GL Accounts Structure';
    RAISE NOTICE '🚀 Production-Ready Schema Complete!';
END $$;