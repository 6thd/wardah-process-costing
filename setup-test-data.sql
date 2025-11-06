-- =======================================
-- إعداد بيانات اختبارية
-- Setup Test Data for Procurement & Sales Testing
-- =======================================

-- ملاحظة: استبدل 'YOUR_ORG_ID' بمعرف المنظمة الفعلي من جدول organizations
-- Note: Replace 'YOUR_ORG_ID' with actual org_id from organizations table

-- للحصول على org_id:
-- SELECT id, name FROM organizations LIMIT 1;

DO $$
DECLARE
    v_org_id UUID;
    v_vendor_id UUID;
    v_customer_id UUID;
    v_product_id UUID;
BEGIN
    -- الحصول على أول org_id متاح
    SELECT id INTO v_org_id FROM organizations LIMIT 1;
    
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'لا توجد منظمات في الجدول. يجب إنشاء منظمة أولاً.';
    END IF;
    
    RAISE NOTICE 'استخدام المنظمة: %', v_org_id;

    -- =======================================
    -- 1. إنشاء مورد تجريبي
    -- =======================================
    
    INSERT INTO vendors (
        id,
        org_id,
        code,
        name,
        contact_person,
        phone,
        email,
        address,
        tax_number,
        is_active
    ) VALUES (
        gen_random_uuid(),
        v_org_id,
        'V001',
        'شركة المواد الخام المحدودة',
        'أحمد محمد',
        '0551234567',
        'supplier@materials.com',
        'الرياض، المملكة العربية السعودية',
        '300123456700003',
        true
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name
    RETURNING id INTO v_vendor_id;
    
    RAISE NOTICE 'تم إنشاء المورد: % (ID: %)', 'V001', v_vendor_id;

    -- =======================================
    -- 2. إنشاء عميل تجريبي
    -- =======================================
    
    INSERT INTO customers (
        id,
        org_id,
        code,
        name,
        contact_person,
        phone,
        email,
        address,
        tax_number,
        credit_limit,
        is_active
    ) VALUES (
        gen_random_uuid(),
        v_org_id,
        'C001',
        'مؤسسة التجارة الكبرى',
        'خالد أحمد',
        '0557654321',
        'customer@trading.com',
        'جدة، المملكة العربية السعودية',
        '300234567800003',
        50000.00,
        true
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name
    RETURNING id INTO v_customer_id;
    
    RAISE NOTICE 'تم إنشاء العميل: % (ID: %)', 'C001', v_customer_id;

    -- =======================================
    -- 3. إنشاء منتج تجريبي
    -- =======================================
    
    -- التحقق من وجود جدول products
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        INSERT INTO products (
            id,
            org_id,
            code,
            name,
            unit_of_measure,
            category,
            quantity_on_hand,
            cost_price,
            selling_price,
            reorder_level,
            is_active
        ) VALUES (
            gen_random_uuid(),
            v_org_id,
            'P001',
            'مادة خام - نوع A',
            'kg',
            'raw_materials',
            500.00,
            5.00,
            7.00,
            200.00,
            true
        )
        ON CONFLICT (org_id, code) DO UPDATE
        SET 
            quantity_on_hand = EXCLUDED.quantity_on_hand,
            cost_price = EXCLUDED.cost_price
        RETURNING id INTO v_product_id;
        
        RAISE NOTICE 'تم إنشاء المنتج: % (ID: %)', 'P001', v_product_id;
        RAISE NOTICE 'المخزون المبدئي: 500 kg @ 5.00 SAR';
    ELSE
        RAISE NOTICE 'جدول products غير موجود. تخطي إنشاء المنتج.';
    END IF;

    -- =======================================
    -- 4. عرض المعرفات للاستخدام في الاختبار
    -- =======================================
    
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE '✅ تم إعداد بيانات الاختبار بنجاح!';
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '📋 استخدم هذه المعرفات في الاختبار:';
    RAISE NOTICE '';
    RAISE NOTICE 'Organization ID: %', v_org_id;
    RAISE NOTICE 'Vendor ID: %', v_vendor_id;
    RAISE NOTICE 'Customer ID: %', v_customer_id;
    IF v_product_id IS NOT NULL THEN
        RAISE NOTICE 'Product ID: %', v_product_id;
    END IF;
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════';
END $$;

-- =======================================
-- 5. التحقق من البيانات المنشأة
-- =======================================

-- عرض الموردين
SELECT 
    '🏢 الموردين:' as title,
    code,
    name,
    phone,
    is_active
FROM vendors
WHERE code = 'V001';

-- عرض العملاء
SELECT 
    '👥 العملاء:' as title,
    code,
    name,
    phone,
    credit_limit,
    is_active
FROM customers
WHERE code = 'C001';

-- عرض المنتجات (إذا كان الجدول موجوداً)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        PERFORM 1;
        -- سيتم عرض النتيجة من الاستعلام التالي
    END IF;
END $$;

SELECT 
    '📦 المنتجات:' as title,
    code,
    name,
    quantity_on_hand || ' ' || unit_of_measure as stock,
    cost_price,
    selling_price
FROM products
WHERE code = 'P001' AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products');

-- =======================================
-- 6. ملاحظات مهمة
-- =======================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '📝 ملاحظات مهمة:';
    RAISE NOTICE '';
    RAISE NOTICE '1. احفظ المعرفات المعروضة أعلاه';
    RAISE NOTICE '2. استخدمها في ملف run-real-test.cjs';
    RAISE NOTICE '3. تأكد من وجود الحسابات المحاسبية في gl_accounts:';
    RAISE NOTICE '   - 1110 (نقدية)';
    RAISE NOTICE '   - 1120 (عملاء)';
    RAISE NOTICE '   - 1130 (مخزون)';
    RAISE NOTICE '   - 1161 (ضريبة مدخلات)';
    RAISE NOTICE '   - 2101 (موردين)';
    RAISE NOTICE '   - 2162 (ضريبة مخرجات)';
    RAISE NOTICE '   - 4001 (مبيعات)';
    RAISE NOTICE '   - 5001 (تكلفة المبيعات)';
    RAISE NOTICE '';
    RAISE NOTICE '4. يمكنك الآن تشغيل: node run-real-test.cjs';
    RAISE NOTICE '';
END $$;
