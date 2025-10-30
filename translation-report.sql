-- تقرير نهائي عن حالة الترجمة
SELECT 
    '📊 إحصائيات الترجمة' as التقرير;

-- إجمالي الحسابات
SELECT 
    'إجمالي الحسابات' as البيان,
    COUNT(*) as العدد
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- الحسابات المُترجمة
SELECT 
    'حسابات مُترجمة' as البيان,
    COUNT(*) as العدد
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND name_en IS NOT NULL
AND name_en != name;

-- الحسابات غير المُترجمة
SELECT 
    'حسابات بحاجة ترجمة' as البيان,
    COUNT(*) as العدد
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND (name_en IS NULL OR name_en = name);

-- عينة من الحسابات المُترجمة
SELECT '✅ عينة من الحسابات المُترجمة:' as العنوان;

SELECT 
    code as الكود,
    name as العربي,
    name_en as English,
    category as الفئة
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND name_en IS NOT NULL
AND name_en != name
ORDER BY code
LIMIT 20;

-- الحسابات التي تحتاج ترجمة (إن وجدت)
SELECT '⚠️ حسابات تحتاج ترجمة:' as العنوان;

SELECT 
    code as الكود,
    name as الاسم,
    category as الفئة
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND (name_en IS NULL OR name_en = name)
ORDER BY code;
