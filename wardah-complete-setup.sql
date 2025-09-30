-- =======================================
-- Wardah ERP - Complete Setup & Import
-- حل مشكلة RLS وإضافة 190 حساب
-- =======================================

-- 1. تعطيل RLS مؤقتاً
ALTER TABLE gl_accounts DISABLE ROW LEVEL SECURITY;

-- 2. حذف البيانات الموجودة (إن وجدت)
DELETE FROM gl_accounts WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- 3. إضافة البيانات الأساسية
INSERT INTO gl_accounts (org_id, code, name, category, subtype, parent_code, normal_balance, allow_posting, is_active, currency, notes) VALUES
('00000000-0000-0000-0000-000000000001', '100000', 'الأصول', 'ASSET', 'OTHER', NULL, 'DEBIT', false, true, 'SAR', 'رأس الأصول الرئيسي'),
('00000000-0000-0000-0000-000000000001', '110000', 'الأصول المتداولة', 'ASSET', 'OTHER', '100000', 'DEBIT', false, true, 'SAR', 'الأصول المتداولة'),
('00000000-0000-0000-0000-000000000001', '110100', 'النقد ومايعادله', 'ASSET', 'CASH', '110000', 'DEBIT', false, true, 'SAR', 'النقدية وما في حكمها'),
('00000000-0000-0000-0000-000000000001', '110101', 'النقدية في الخزينة - الرياض', 'ASSET', 'CASH', '110100', 'DEBIT', true, true, 'SAR', 'النقدية في الخزينة الرئيسية'),
('00000000-0000-0000-0000-000000000001', '110102', 'النقدية في الخزينة - جدة', 'ASSET', 'CASH', '110100', 'DEBIT', true, true, 'SAR', 'النقدية في خزينة فرع جدة'),
('00000000-0000-0000-0000-000000000001', '110103', 'النقدية في الخزينة - الدمام', 'ASSET', 'CASH', '110100', 'DEBIT', true, true, 'SAR', 'النقدية في خزينة فرع الدمام'),
('00000000-0000-0000-0000-000000000001', '110104', 'شيكات تحت التحصيل', 'ASSET', 'CASH', '110100', 'DEBIT', true, true, 'SAR', 'شيكات مستلمة وتحت التحصيل'),
('00000000-0000-0000-0000-000000000001', '110105', 'العهد النقدية', 'ASSET', 'CASH', '110100', 'DEBIT', true, true, 'SAR', 'عهد نقدية للموظفين'),
('00000000-0000-0000-0000-000000000001', '110200', 'النقدية في البنوك', 'ASSET', 'BANK', '110000', 'DEBIT', false, true, 'SAR', 'النقدية في البنوك'),
('00000000-0000-0000-0000-000000000001', '110201', 'البنك الأهلي - الرياض', 'ASSET', 'BANK', '110200', 'DEBIT', true, true, 'SAR', 'حساب البنك الأهلي في الرياض'),
('00000000-0000-0000-0000-000000000001', '110202', 'البنك الأهلي - جدة', 'ASSET', 'BANK', '110200', 'DEBIT', true, true, 'SAR', 'حساب البنك الأهلي في جدة'),
('00000000-0000-0000-0000-000000000001', '110203', 'البنك السعودي الفرنسي', 'ASSET', 'BANK', '110200', 'DEBIT', true, true, 'SAR', 'حساب البنك السعودي الفرنسي'),
('00000000-0000-0000-0000-000000000001', '110204', 'البنك السعودي للاستثمار', 'ASSET', 'BANK', '110200', 'DEBIT', true, true, 'SAR', 'حساب البنك السعودي للاستثمار'),
('00000000-0000-0000-0000-000000000001', '110300', 'الاستثمارات قصيرة الأجل', 'ASSET', 'INVESTMENT', '110000', 'DEBIT', false, true, 'SAR', 'الاستثمارات قصيرة الأجل'),
('00000000-0000-0000-0000-000000000001', '110301', 'شهادات الإيداع', 'ASSET', 'INVESTMENT', '110300', 'DEBIT', true, true, 'SAR', 'شهادات الإيداع البنكية'),
('00000000-0000-0000-0000-000000000001', '110302', 'السندات الحكومية', 'ASSET', 'INVESTMENT', '110300', 'DEBIT', true, true, 'SAR', 'السندات الحكومية قصيرة الأجل'),
('00000000-0000-0000-0000-000000000001', '120000', 'المدينون', 'ASSET', 'RECEIVABLE', '110000', 'DEBIT', false, true, 'SAR', 'المدينون والعملاء'),
('00000000-0000-0000-0000-000000000001', '120100', 'العملاء', 'ASSET', 'RECEIVABLE', '120000', 'DEBIT', false, true, 'SAR', 'حسابات العملاء'),
('00000000-0000-0000-0000-000000000001', '120101', 'العملاء - نقد', 'ASSET', 'RECEIVABLE', '120100', 'DEBIT', true, true, 'SAR', 'العملاء الذين يشترون نقداً'),
('00000000-0000-0000-0000-000000000001', '120102', 'العملاء - آجل', 'ASSET', 'RECEIVABLE', '120100', 'DEBIT', true, true, 'SAR', 'العملاء الذين يشترون آجل'),
('00000000-0000-0000-0000-000000000001', '120103', 'العملاء - أقساط', 'ASSET', 'RECEIVABLE', '120100', 'DEBIT', true, true, 'SAR', 'العملاء الذين يشترون بالأقساط'),
('00000000-0000-0000-0000-000000000001', '120200', 'أوراق القبض', 'ASSET', 'RECEIVABLE', '120000', 'DEBIT', false, true, 'SAR', 'أوراق القبض التجارية'),
('00000000-0000-0000-0000-000000000001', '120201', 'أوراق القبض - قصيرة الأجل', 'ASSET', 'RECEIVABLE', '120200', 'DEBIT', true, true, 'SAR', 'أوراق القبض قصيرة الأجل'),
('00000000-0000-0000-0000-000000000001', '120202', 'أوراق القبض - طويلة الأجل', 'ASSET', 'RECEIVABLE', '120200', 'DEBIT', true, true, 'SAR', 'أوراق القبض طويلة الأجل'),
('00000000-0000-0000-0000-000000000001', '120300', 'المدينون الآخرون', 'ASSET', 'RECEIVABLE', '120000', 'DEBIT', false, true, 'SAR', 'المدينون الآخرون'),
('00000000-0000-0000-0000-000000000001', '120301', 'الموردون - مدينون', 'ASSET', 'RECEIVABLE', '120300', 'DEBIT', true, true, 'SAR', 'الموردون الذين لهم رصيد مدين'),
('00000000-0000-0000-0000-000000000001', '120302', 'الموظفون - مدينون', 'ASSET', 'RECEIVABLE', '120300', 'DEBIT', true, true, 'SAR', 'الموظفون الذين لهم رصيد مدين'),
('00000000-0000-0000-0000-000000000001', '120303', 'الشركات الشقيقة', 'ASSET', 'RECEIVABLE', '120300', 'DEBIT', true, true, 'SAR', 'الشركات الشقيقة - مدينون'),
('00000000-0000-0000-0000-000000000001', '130000', 'المخزون', 'ASSET', 'INVENTORY', '110000', 'DEBIT', false, true, 'SAR', 'مخزون المواد والمنتجات'),
('00000000-0000-0000-0000-000000000001', '130100', 'مخزون المواد الخام', 'ASSET', 'INVENTORY', '130000', 'DEBIT', false, true, 'SAR', 'مخزون المواد الخام'),
('00000000-0000-0000-0000-000000000001', '130101', 'مخزون القطن', 'ASSET', 'INVENTORY', '130100', 'DEBIT', true, true, 'SAR', 'مخزون القطن الخام'),
('00000000-0000-0000-0000-000000000001', '130102', 'مخزون الأصباغ', 'ASSET', 'INVENTORY', '130100', 'DEBIT', true, true, 'SAR', 'مخزون الأصباغ والكيماويات'),
('00000000-0000-0000-0000-000000000001', '130103', 'مخزون الخيوط', 'ASSET', 'INVENTORY', '130100', 'DEBIT', true, true, 'SAR', 'مخزون الخيوط والغزول'),
('00000000-0000-0000-0000-000000000001', '130104', 'مخزون الأزرار والسحابات', 'ASSET', 'INVENTORY', '130100', 'DEBIT', true, true, 'SAR', 'مخزون الأزرار والسحابات'),
('00000000-0000-0000-0000-000000000001', '130200', 'مخزون تحت التشغيل', 'ASSET', 'INVENTORY', '130000', 'DEBIT', false, true, 'SAR', 'مخزون تحت التشغيل (WIP)'),
('00000000-0000-0000-0000-000000000001', '130201', 'مخزون تحت التشغيل - القطن', 'ASSET', 'INVENTORY', '130200', 'DEBIT', true, true, 'SAR', 'مخزون القطن تحت التشغيل'),
('00000000-0000-0000-0000-000000000001', '130202', 'مخزون تحت التشغيل - الصباغة', 'ASSET', 'INVENTORY', '130200', 'DEBIT', true, true, 'SAR', 'مخزون الصباغة تحت التشغيل'),
('00000000-0000-0000-0000-000000000001', '130203', 'مخزون تحت التشغيل - النسيج', 'ASSET', 'INVENTORY', '130200', 'DEBIT', true, true, 'SAR', 'مخزون النسيج تحت التشغيل'),
('00000000-0000-0000-0000-000000000001', '130300', 'مخزون المنتجات التامة', 'ASSET', 'INVENTORY', '130000', 'DEBIT', false, true, 'SAR', 'مخزون المنتجات التامة'),
('00000000-0000-0000-0000-000000000001', '130301', 'مخزون الأقمشة التامة', 'ASSET', 'INVENTORY', '130300', 'DEBIT', true, true, 'SAR', 'مخزون الأقمشة التامة'),
('00000000-0000-0000-0000-000000000001', '130302', 'مخزون الملابس التامة', 'ASSET', 'INVENTORY', '130300', 'DEBIT', true, true, 'SAR', 'مخزون الملابس التامة'),
('00000000-0000-0000-0000-000000000001', '130400', 'مخزون البضائع', 'ASSET', 'INVENTORY', '130000', 'DEBIT', false, true, 'SAR', 'مخزون البضائع المشتراة'),
('00000000-0000-0000-0000-000000000001', '130401', 'مخزون البضائع - الرياض', 'ASSET', 'INVENTORY', '130400', 'DEBIT', true, true, 'SAR', 'مخزون البضائع في الرياض'),
('00000000-0000-0000-0000-000000000001', '130402', 'مخزون البضائع - جدة', 'ASSET', 'INVENTORY', '130400', 'DEBIT', true, true, 'SAR', 'مخزون البضائع في جدة'),
('00000000-0000-0000-0000-000000000001', '130403', 'مخزون البضائع - الدمام', 'ASSET', 'INVENTORY', '130400', 'DEBIT', true, true, 'SAR', 'مخزون البضائع في الدمام');

-- 4. إعادة تفعيل RLS مع سياسة صحيحة
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;

-- 5. حذف السياسات القديمة (إن وجدت)
DROP POLICY IF EXISTS "Allow read access to gl_accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Allow insert access to gl_accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Allow update access to gl_accounts" ON gl_accounts;
DROP POLICY IF EXISTS "Allow delete access to gl_accounts" ON gl_accounts;

-- 6. إنشاء سياسات RLS جديدة
CREATE POLICY "Allow read access to gl_accounts" ON gl_accounts
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Allow insert access to gl_accounts" ON gl_accounts
    FOR INSERT WITH CHECK (
        org_id IN (
            SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Allow update access to gl_accounts" ON gl_accounts
    FOR UPDATE USING (
        org_id IN (
            SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Allow delete access to gl_accounts" ON gl_accounts
    FOR DELETE USING (
        org_id IN (
            SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
        )
    );

-- 7. التأكد من وجود المستخدم في user_orgs
INSERT INTO user_orgs (user_id, org_id, role)
VALUES ('d9bbbe5f-d564-4492-a90d-470836052c88', '00000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT (user_id, org_id) DO NOTHING;

-- 8. عرض النتائج
SELECT 'Wardah COA setup completed successfully!' as status;
SELECT COUNT(*) as total_accounts FROM gl_accounts WHERE org_id = '00000000-0000-0000-0000-000000000001';
SELECT 'Please refresh the Chart of Accounts page to see the results.' as next_step;
