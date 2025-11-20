-- التحقق الكامل من عدد الحسابات
SELECT 
    'إجمالي الحسابات المستوردة' as البيان,
    COUNT(*) as العدد
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- التفصيل حسب الفئة
SELECT 
    category as الفئة,
    COUNT(*) as عدد_الحسابات,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as النسبة_المئوية
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY category
ORDER BY category;

-- عدد الحسابات الرئيسية vs الفرعية
SELECT 
    CASE 
        WHEN parent_code IS NULL THEN 'حسابات رئيسية'
        ELSE 'حسابات فرعية'
    END as النوع,
    COUNT(*) as العدد
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY CASE WHEN parent_code IS NULL THEN 'حسابات رئيسية' ELSE 'حسابات فرعية' END;

-- خرائط الأحداث
SELECT 
    'إجمالي خرائط الأحداث' as البيان,
    COUNT(*) as العدد
FROM gl_mappings
WHERE org_id = '00000000-0000-0000-0000-000000000001';
