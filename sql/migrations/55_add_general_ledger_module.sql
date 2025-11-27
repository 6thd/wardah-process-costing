-- =====================================
-- بسم الله الرحمن الرحيم
-- إضافة موديول الأستاذ العام (General Ledger)
-- تاريخ: نوفمبر 2025
-- =====================================

-- إضافة الموديول إذا لم يكن موجوداً
INSERT INTO modules (name, name_ar, description, description_ar, icon, display_order, is_active)
VALUES 
    ('general_ledger', 'الأستاذ العام', 'General Ledger and Chart of Accounts', 'دليل الحسابات وكشوف الحسابات', '📚', 5, true)
ON CONFLICT (name) DO UPDATE SET
    name_ar = EXCLUDED.name_ar,
    description = EXCLUDED.description,
    description_ar = EXCLUDED.description_ar,
    icon = EXCLUDED.icon;

-- إضافة صلاحيات الموديول
DO $$
DECLARE
    v_module_id UUID;
BEGIN
    -- الحصول على معرف الموديول
    SELECT id INTO v_module_id FROM modules WHERE name = 'general_ledger';
    
    IF v_module_id IS NOT NULL THEN
        -- إضافة صلاحيات الموديول
        INSERT INTO permissions (module_id, resource, resource_ar, action, action_ar, permission_key, description_ar)
        VALUES 
            (v_module_id, 'chart_of_accounts', 'دليل الحسابات', 'view', 'عرض', 'general_ledger.chart_of_accounts.view', 'عرض دليل الحسابات'),
            (v_module_id, 'chart_of_accounts', 'دليل الحسابات', 'create', 'إنشاء', 'general_ledger.chart_of_accounts.create', 'إنشاء حسابات جديدة'),
            (v_module_id, 'chart_of_accounts', 'دليل الحسابات', 'edit', 'تعديل', 'general_ledger.chart_of_accounts.edit', 'تعديل الحسابات'),
            (v_module_id, 'chart_of_accounts', 'دليل الحسابات', 'delete', 'حذف', 'general_ledger.chart_of_accounts.delete', 'حذف الحسابات'),
            (v_module_id, 'account_statement', 'كشف حساب', 'view', 'عرض', 'general_ledger.account_statement.view', 'عرض كشوف الحسابات'),
            (v_module_id, 'account_statement', 'كشف حساب', 'export', 'تصدير', 'general_ledger.account_statement.export', 'تصدير كشوف الحسابات')
        ON CONFLICT (permission_key) DO NOTHING;
    END IF;
END $$;

-- تأكيد النجاح
SELECT 'Module general_ledger added successfully' as result;

