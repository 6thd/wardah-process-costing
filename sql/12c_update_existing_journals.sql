-- تحديث أنواع القيود الموجودة + إضافة الناقصة

DO $$
DECLARE
    v_org_id uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- تحديث GJ إلى GEN (قيد عام)
    UPDATE journals 
    SET code = 'GEN', 
        name = 'General Journal', 
        name_ar = 'قيد عام',
        journal_type = 'general',
        sequence_prefix = 'JE-',
        is_active = true
    WHERE org_id = v_org_id AND code = 'GJ';

    -- تحديث SI إلى SALES (قيد المبيعات)
    UPDATE journals 
    SET code = 'SALES', 
        name = 'Sales Journal', 
        name_ar = 'قيد المبيعات',
        journal_type = 'sales',
        sequence_prefix = 'SJ-',
        is_active = true
    WHERE org_id = v_org_id AND code = 'SI';

    -- تحديث PI إلى PURCH (قيد المشتريات)
    UPDATE journals 
    SET code = 'PURCH', 
        name = 'Purchase Journal', 
        name_ar = 'قيد المشتريات',
        journal_type = 'purchase',
        sequence_prefix = 'PJ-',
        is_active = true
    WHERE org_id = v_org_id AND code = 'PI';

    -- تحديث BR إلى BANK (قيد البنك)
    UPDATE journals 
    SET code = 'BANK', 
        name = 'Bank Journal', 
        name_ar = 'قيد البنك',
        journal_type = 'bank',
        sequence_prefix = 'BJ-',
        is_active = true
    WHERE org_id = v_org_id AND code = 'BR';

    -- إضافة CASH إذا لم يكن موجوداً (قيد الصندوق)
    INSERT INTO journals (code, name, name_ar, journal_type, sequence_prefix, is_active, org_id)
    SELECT 'CASH', 'Cash Journal', 'قيد الصندوق', 'cash', 'CJ-', true, v_org_id
    WHERE NOT EXISTS (
        SELECT 1 FROM journals 
        WHERE org_id = v_org_id AND (code = 'CASH' OR code = 'CP')
    );

    -- حذف CR و CP (مكررات)
    DELETE FROM journals 
    WHERE org_id = v_org_id 
    AND code IN ('CR', 'CP')
    AND NOT EXISTS (
        SELECT 1 FROM journal_entries je 
        WHERE je.journal_id = journals.id
    );

    RAISE NOTICE '✅ تم تحديث أنواع القيود بنجاح';
END $$;

-- عرض النتيجة النهائية
SELECT code, name, name_ar, sequence_prefix 
FROM journals 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code;

