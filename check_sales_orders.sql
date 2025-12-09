-- ========================================
-- استعلامات فحص أوامر البيع في Supabase
-- ========================================
-- NOSONAR - This is a SQL query file for database inspection, not production code

-- 1. فحص بنية جدول sales_orders
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'sales_orders' -- NOSONAR
ORDER BY ordinal_position;

-- 2. عدد أوامر البيع الإجمالي
SELECT COUNT(*) as total_orders
FROM sales_orders;

-- 3. عرض جميع أوامر البيع مع معلومات العميل
SELECT 
    so.id,
    so.so_number,
    so.so_date,
    so.delivery_date,
    so.status,
    so.currency,
    so.total_amount,
    so.tax_amount,
    so.discount_amount,
    so.final_amount,
    so.cogs_amount,
    so.org_id,
    c.name as customer_name,
    c.code as customer_code,
    so.created_at,
    so.updated_at
FROM sales_orders so
LEFT JOIN customers c ON so.customer_id = c.id
ORDER BY so.so_date DESC
LIMIT 50;

-- 4. إحصائيات أوامر البيع حسب الحالة
SELECT 
    status,
    COUNT(*) as count,
    SUM(total_amount) as total_value,
    AVG(total_amount) as avg_value
FROM sales_orders
GROUP BY status
ORDER BY count DESC;

-- 5. أوامر البيع حسب المنظمة
SELECT 
    o.name as organization_name,
    COUNT(so.id) as orders_count,
    SUM(so.total_amount) as total_value
FROM sales_orders so
LEFT JOIN organizations o ON so.org_id = o.id
GROUP BY o.id, o.name
ORDER BY orders_count DESC;

-- 6. أوامر البيع حسب العميل
SELECT 
    c.name as customer_name,
    c.code as customer_code,
    COUNT(so.id) as orders_count,
    SUM(so.total_amount) as total_value
FROM sales_orders so
LEFT JOIN customers c ON so.customer_id = c.id
GROUP BY c.id, c.name, c.code
ORDER BY total_value DESC
LIMIT 20;

-- 7. أوامر البيع في آخر 30 يوم
SELECT 
    DATE(so_date) as date,
    COUNT(*) as orders_count,
    SUM(total_amount) as daily_total
FROM sales_orders
WHERE so_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(so_date)
ORDER BY date DESC;

-- 8. فحص الأعمدة المتاحة في sales_orders
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'sales_orders' -- NOSONAR
ORDER BY ordinal_position;

-- 9. فحص العلاقات (Foreign Keys)
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'sales_orders'; -- NOSONAR

-- 10. عينة من البيانات (5 سجلات)
SELECT *
FROM sales_orders
ORDER BY created_at DESC
LIMIT 5;


