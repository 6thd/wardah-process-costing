-- =======================================
-- تطبيق سياسات RLS على الجداول الموجودة فقط
-- =======================================

-- تفعيل RLS على الجداول الموجودة
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_mappings ENABLE ROW LEVEL SECURITY;

-- دالة مساعدة: الحصول على org_id للمستخدم الحالي
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
    SELECT uo.org_id 
    FROM user_organizations uo 
    WHERE uo.user_id = auth.uid() 
    AND uo.is_active = true 
    LIMIT 1;
$$;

-- سياسات GL Accounts
DROP POLICY IF EXISTS "Users can view org GL accounts" ON gl_accounts;
CREATE POLICY "Users can view org GL accounts" ON gl_accounts
    FOR SELECT USING (org_id = auth_org_id());

DROP POLICY IF EXISTS "Users can manage GL accounts" ON gl_accounts;
CREATE POLICY "Users can manage GL accounts" ON gl_accounts
    FOR ALL USING (org_id = auth_org_id());

-- سياسات GL Mappings  
DROP POLICY IF EXISTS "Users can view org GL mappings" ON gl_mappings;
CREATE POLICY "Users can view org GL mappings" ON gl_mappings
    FOR SELECT USING (org_id = auth_org_id());

DROP POLICY IF EXISTS "Users can manage GL mappings" ON gl_mappings;
CREATE POLICY "Users can manage GL mappings" ON gl_mappings
    FOR ALL USING (org_id = auth_org_id());

-- إنشاء indexes للأداء
CREATE INDEX IF NOT EXISTS idx_user_orgs_user_active ON user_organizations(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_user_orgs_org_role ON user_organizations(org_id, role, is_active);

SELECT '✅ تم تطبيق سياسات RLS بنجاح' as status;
