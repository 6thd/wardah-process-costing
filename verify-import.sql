-- التحقق من نجاح الاستيراد
SELECT 
    '✅ نظام وردة البيان ERP' as status,
    '' as separator;

-- عد الحسابات
SELECT 
    'إجمالي الحسابات' as item,
    COUNT(*) as count
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- عد الحسابات حسب الفئة
SELECT 
    category as فئة,
    COUNT(*) as عدد_الحسابات
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY category
ORDER BY category;

-- عد خرائط الأحداث
SELECT 
    'إجمالي خرائط الأحداث' as item,
    COUNT(*) as count
FROM gl_mappings
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- عرض بعض الأمثلة
SELECT 
    'أمثلة من شجرة الحسابات:' as title;

SELECT 
    code as رمز,
    name as اسم,
    category as فئة,
    subtype as نوع_فرعي
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code
LIMIT 10;
