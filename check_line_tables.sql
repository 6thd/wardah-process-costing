-- Check structure of line tables
SELECT column_name, data_type, is_generated, generation_expression
FROM information_schema.columns 
WHERE table_name IN ('purchase_order_lines', 'sales_invoice_lines', 'supplier_invoice_lines')
  AND table_schema = 'public'
ORDER BY table_name, ordinal_position;
