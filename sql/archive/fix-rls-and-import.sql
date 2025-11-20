-- حل مشكلة RLS وإضافة البيانات
-- =======================================

-- 1. تعطيل RLS مؤقتاً للاستيراد
ALTER TABLE gl_accounts DISABLE ROW LEVEL SECURITY;

-- 2. إضافة البيانات مباشرة
INSERT INTO gl_accounts (org_id, code, name, category, subtype, parent_code, normal_balance, allow_posting, is_active, currency, notes) VALUES
('00000000-0000-0000-0000-000000000001', '1000', 'الأصول', 'ASSET', NULL, NULL, 'DEBIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '1100', 'الأصول المتداولة', 'ASSET', 'CURRENT', '1000', 'DEBIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '1110', 'النقدية', 'ASSET', 'CASH', '1100', 'DEBIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '1120', 'البنوك', 'ASSET', 'BANK', '1100', 'DEBIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '1200', 'المدينون', 'ASSET', 'RECEIVABLE', '1100', 'DEBIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '1300', 'المخزون', 'ASSET', 'INVENTORY', '1100', 'DEBIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '2000', 'الخصوم', 'LIABILITY', NULL, NULL, 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '2100', 'الخصوم المتداولة', 'LIABILITY', 'CURRENT', '2000', 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '2110', 'الدائنون', 'LIABILITY', 'PAYABLE', '2100', 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '3000', 'حقوق الملكية', 'EQUITY', NULL, NULL, 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '3100', 'رأس المال', 'EQUITY', 'CAPITAL', '3000', 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '3200', 'احتياطيات', 'EQUITY', 'RESERVE', '3000', 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '4000', 'الإيرادات', 'INCOME', NULL, NULL, 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '4100', 'مبيعات', 'INCOME', 'SALES', '4000', 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '4200', 'إيرادات أخرى', 'INCOME', 'OTHER', '4000', 'CREDIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '5000', 'المصروفات', 'EXPENSE', NULL, NULL, 'DEBIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '5100', 'تكلفة البضاعة المباعة', 'EXPENSE', 'COGS', '5000', 'DEBIT', true, true, 'SAR', NULL),
('00000000-0000-0000-0000-000000000001', '5200', 'مصروفات تشغيلية', 'EXPENSE', 'OPERATING', '5000', 'DEBIT', true, true, 'SAR', NULL);

-- 3. إعادة تفعيل RLS مع سياسة صحيحة
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;

-- 4. إنشاء سياسة RLS للقراءة
CREATE POLICY "Allow read access to gl_accounts" ON gl_accounts
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
        )
    );

-- 5. إنشاء سياسة RLS للكتابة
CREATE POLICY "Allow insert access to gl_accounts" ON gl_accounts
    FOR INSERT WITH CHECK (
        org_id IN (
            SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
        )
    );

-- 6. إنشاء سياسة RLS للتحديث
CREATE POLICY "Allow update access to gl_accounts" ON gl_accounts
    FOR UPDATE USING (
        org_id IN (
            SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
        )
    );

-- 7. إنشاء سياسة RLS للحذف
CREATE POLICY "Allow delete access to gl_accounts" ON gl_accounts
    FOR DELETE USING (
        org_id IN (
            SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
        )
    );

-- 8. التأكد من وجود المستخدم في user_orgs
INSERT INTO user_orgs (user_id, org_id, role)
VALUES ('d9bbbe5f-d564-4492-a90d-470836052c88', '00000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT (user_id, org_id) DO NOTHING;

-- 9. عرض النتائج
SELECT 'Data imported successfully!' as status;
SELECT COUNT(*) as total_accounts FROM gl_accounts WHERE org_id = '00000000-0000-0000-0000-000000000001';

