-- =======================================
-- التحقق من نظام AVCO - Perpetual Inventory
-- Verification Script for Weighted Average Costing
-- =======================================

-- 1️⃣ التحقق من جدول stock_quants (أرصدة المخزون بطريقة AVCO)
SELECT 
    'stock_quants Table Structure' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = 'stock_quants'
        ) THEN '✅ موجود'
        ELSE '❌ غير موجود'
    END as status;

-- 2️⃣ التحقق من عمود avg_cost في stock_quants
SELECT 
    'avg_cost Column in stock_quants' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'stock_quants' 
            AND column_name = 'avg_cost'
        ) THEN '✅ موجود'
        ELSE '❌ غير موجود'
    END as status;

-- 3️⃣ التحقق من جدول stock_moves (حركات المخزون)
SELECT 
    'stock_moves Table Structure' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = 'stock_moves'
        ) THEN '✅ موجود'
        ELSE '❌ غير موجود'
    END as status;

-- 4️⃣ التحقق من أعمدة التكلفة في stock_moves
SELECT 
    column_name,
    data_type,
    CASE 
        WHEN column_name IN ('unit_cost_in', 'unit_cost_out', 'unit_cost') THEN '✅ عمود تكلفة'
        ELSE 'عمود آخر'
    END as cost_column
FROM information_schema.columns 
WHERE table_name = 'stock_moves'
AND column_name LIKE '%cost%'
ORDER BY column_name;

-- 5️⃣ التحقق من جدول cost_settings (إعدادات طريقة التكلفة)
SELECT 
    'cost_settings Table' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = 'cost_settings'
        ) THEN '✅ موجود'
        ELSE '❌ غير موجود'
    END as status;

-- 6️⃣ التحقق من قيم costing_method المسموحة
SELECT 
    'Costing Method Constraint' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 
            FROM information_schema.check_constraints cc
            JOIN information_schema.constraint_column_usage ccu 
                ON cc.constraint_name = ccu.constraint_name
            WHERE ccu.table_name = 'cost_settings'
            AND ccu.column_name = 'costing_method'
            AND cc.check_clause LIKE '%avco%'
        ) THEN '✅ AVCO مدعوم في القيود'
        ELSE '⚠️ لم يتم العثور على القيد'
    END as status;

-- 7️⃣ التحقق من الإعدادات الحالية للمؤسسة
SELECT 
    org_id,
    costing_method,
    avg_cost_precision,
    currency_code,
    allow_negative_qty,
    auto_recompute_costs,
    CASE 
        WHEN costing_method = 'AVCO' OR costing_method = 'avco' THEN '✅ AVCO مفعل'
        ELSE '⚠️ طريقة أخرى: ' || costing_method
    END as method_status
FROM cost_settings
LIMIT 5;

-- 8️⃣ التحقق من وجود دالة apply_stock_move
SELECT 
    'apply_stock_move Function' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.routines 
            WHERE routine_name = 'apply_stock_move'
            AND routine_type = 'FUNCTION'
        ) THEN '✅ الدالة موجودة'
        ELSE '❌ الدالة غير موجودة'
    END as status;

-- 9️⃣ التحقق من دالة get_inventory_valuation
SELECT 
    'get_inventory_valuation Function' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.routines 
            WHERE routine_name = 'get_inventory_valuation'
            AND routine_type = 'FUNCTION'
        ) THEN '✅ الدالة موجودة'
        ELSE '❌ الدالة غير موجودة'
    END as status;

-- 🔟 عرض أنواع الحركات المدعومة في stock_moves
SELECT DISTINCT 
    movement_type,
    COUNT(*) as count
FROM stock_moves
GROUP BY movement_type
ORDER BY count DESC;

-- 1️⃣1️⃣ إحصائيات المخزون الحالي
SELECT 
    'Total Products in Stock' as metric,
    COUNT(DISTINCT product_id) as value
FROM products
WHERE stock_quantity > 0;

-- 1️⃣2️⃣ إحصائيات حركات المخزون
SELECT 
    'Total Stock Movements' as metric,
    COUNT(*) as value
FROM stock_moves
WHERE created_at >= NOW() - INTERVAL '30 days';

-- 1️⃣3️⃣ عرض عينة من أرصدة المخزون مع AVCO
SELECT 
    p.code as product_code,
    p.name as product_name,
    p.stock_quantity,
    p.cost_price,
    CASE 
        WHEN p.stock_quantity > 0 
        THEN ROUND(p.stock_quantity * p.cost_price, 2)
        ELSE 0
    END as inventory_value,
    p.unit
FROM products p
WHERE p.stock_quantity > 0
ORDER BY p.stock_quantity * p.cost_price DESC
LIMIT 10;

-- 1️⃣4️⃣ التحقق من أعمدة التكلفة في جدول products
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'products'
AND (column_name LIKE '%cost%' OR column_name LIKE '%price%')
ORDER BY column_name;

-- 1️⃣5️⃣ ملخص شامل للنظام
SELECT 
    '========== AVCO SYSTEM STATUS ==========' as summary;

SELECT 
    'Database Tables' as component,
    COUNT(*) as count,
    '✅' as status
FROM information_schema.tables 
WHERE table_name IN ('stock_quants', 'stock_moves', 'cost_settings', 'products');

SELECT 
    'AVCO Functions' as component,
    COUNT(*) as count,
    CASE 
        WHEN COUNT(*) >= 2 THEN '✅'
        ELSE '⚠️'
    END as status
FROM information_schema.routines 
WHERE routine_name IN ('apply_stock_move', 'get_inventory_valuation', 'complete_manufacturing_order');

SELECT 
    'Stock Movements (Last 30 Days)' as component,
    COUNT(*) as count,
    '📊' as status
FROM stock_moves
WHERE created_at >= NOW() - INTERVAL '30 days';

SELECT 
    'Products with Stock' as component,
    COUNT(*) as count,
    '📦' as status
FROM products
WHERE stock_quantity > 0;

-- 1️⃣6️⃣ معلومات تفصيلية عن دالة apply_stock_move
SELECT 
    routine_name,
    routine_type,
    data_type,
    routine_definition
FROM information_schema.routines 
WHERE routine_name = 'apply_stock_move'
LIMIT 1;

-- =======================================
-- النتيجة المتوقعة:
-- ✅ جميع الجداول الأساسية موجودة
-- ✅ طريقة AVCO مفعلة في cost_settings
-- ✅ دوال الحساب موجودة
-- ✅ حركات المخزون مسجلة
-- =======================================
