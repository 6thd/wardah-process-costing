-- إنشاء أنواع القيود الافتراضية (ذكي - يحدّث الموجود أو يضيف الجديد)

DO $$
DECLARE
    v_org_id uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- قيد عام
    IF EXISTS (SELECT 1 FROM journals WHERE org_id = v_org_id AND code = 'GEN') THEN
        UPDATE journals SET name = 'General Journal', name_ar = 'قيد عام', is_active = true 
        WHERE org_id = v_org_id AND code = 'GEN';
    ELSE
        INSERT INTO journals (code, name, name_ar, journal_type, sequence_prefix, is_active, org_id)
        VALUES ('GEN', 'General Journal', 'قيد عام', 'general', 'JE-', true, v_org_id);
    END IF;

    -- قيد المبيعات
    IF EXISTS (SELECT 1 FROM journals WHERE org_id = v_org_id AND code = 'SALES') THEN
        UPDATE journals SET name = 'Sales Journal', name_ar = 'قيد المبيعات', is_active = true 
        WHERE org_id = v_org_id AND code = 'SALES';
    ELSE
        INSERT INTO journals (code, name, name_ar, journal_type, sequence_prefix, is_active, org_id)
        VALUES ('SALES', 'Sales Journal', 'قيد المبيعات', 'sales', 'SJ-', true, v_org_id);
    END IF;

    -- قيد المشتريات
    IF EXISTS (SELECT 1 FROM journals WHERE org_id = v_org_id AND code = 'PURCH') THEN
        UPDATE journals SET name = 'Purchase Journal', name_ar = 'قيد المشتريات', is_active = true 
        WHERE org_id = v_org_id AND code = 'PURCH';
    ELSE
        INSERT INTO journals (code, name, name_ar, journal_type, sequence_prefix, is_active, org_id)
        VALUES ('PURCH', 'Purchase Journal', 'قيد المشتريات', 'purchase', 'PJ-', true, v_org_id);
    END IF;

    -- قيد البنك
    IF EXISTS (SELECT 1 FROM journals WHERE org_id = v_org_id AND code = 'BANK') THEN
        UPDATE journals SET name = 'Bank Journal', name_ar = 'قيد البنك', is_active = true 
        WHERE org_id = v_org_id AND code = 'BANK';
    ELSE
        INSERT INTO journals (code, name, name_ar, journal_type, sequence_prefix, is_active, org_id)
        VALUES ('BANK', 'Bank Journal', 'قيد البنك', 'bank', 'BJ-', true, v_org_id);
    END IF;

    -- قيد الصندوق
    IF EXISTS (SELECT 1 FROM journals WHERE org_id = v_org_id AND code = 'CASH') THEN
        UPDATE journals SET name = 'Cash Journal', name_ar = 'قيد الصندوق', is_active = true 
        WHERE org_id = v_org_id AND code = 'CASH';
    ELSE
        INSERT INTO journals (code, name, name_ar, journal_type, sequence_prefix, is_active, org_id)
        VALUES ('CASH', 'Cash Journal', 'قيد الصندوق', 'cash', 'CJ-', true, v_org_id);
    END IF;

    RAISE NOTICE '✅ تم إنشاء/تحديث أنواع القيود بنجاح';
END $$;

-- Verify
SELECT code, name, name_ar, sequence_prefix 
FROM journals 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code;

