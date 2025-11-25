-- =====================================================
-- 51_fix_rls_user_organizations.sql
-- بسم الله الرحمن الرحيم
-- إصلاح RLS Policies لجدول user_organizations
-- =====================================================

-- 1. حذف السياسات القديمة
DROP POLICY IF EXISTS "users_view_own_orgs" ON user_organizations;
DROP POLICY IF EXISTS "users_manage_own" ON user_organizations;
DROP POLICY IF EXISTS "org_admins_manage_users" ON user_organizations;
DROP POLICY IF EXISTS "super_admins_all_access" ON user_organizations;

-- 2. التأكد من تفعيل RLS
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;

-- 3. سياسة: المستخدم يمكنه رؤية ربطه بالمنظمات الخاصة به
CREATE POLICY "users_view_own_orgs" ON user_organizations
FOR SELECT USING (
    user_id = auth.uid()
);

-- 4. سياسة: Super Admins يمكنهم رؤية الكل
CREATE POLICY "super_admins_view_all" ON user_organizations
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM super_admins 
        WHERE user_id = auth.uid() 
        AND is_active = true
    )
);

-- 5. سياسة: Super Admins يمكنهم إدارة الكل
CREATE POLICY "super_admins_manage_all" ON user_organizations
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM super_admins 
        WHERE user_id = auth.uid() 
        AND is_active = true
    )
);

-- 6. سياسة: Org Admins يمكنهم إدارة مستخدمي منظمتهم
CREATE POLICY "org_admins_manage_org_users" ON user_organizations
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_organizations uo 
        WHERE uo.user_id = auth.uid() 
        AND uo.org_id = user_organizations.org_id
        AND uo.is_org_admin = true
        AND uo.is_active = true
    )
);

-- 7. سياسة للقراءة: المستخدمون يمكنهم رؤية زملائهم في نفس المنظمة
CREATE POLICY "users_view_org_colleagues" ON user_organizations
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM user_organizations uo 
        WHERE uo.user_id = auth.uid() 
        AND uo.org_id = user_organizations.org_id
        AND uo.is_active = true
    )
);

-- =====================================================
-- إصلاح RLS لجدول organizations
-- =====================================================

DROP POLICY IF EXISTS "users_view_own_organizations" ON organizations;
DROP POLICY IF EXISTS "super_admins_all_orgs" ON organizations;

-- المستخدمون يمكنهم رؤية منظماتهم فقط
CREATE POLICY "users_view_own_organizations" ON organizations
FOR SELECT USING (
    id IN (
        SELECT org_id FROM user_organizations 
        WHERE user_id = auth.uid() AND is_active = true
    )
    OR
    EXISTS (
        SELECT 1 FROM super_admins 
        WHERE user_id = auth.uid() AND is_active = true
    )
);

-- Super Admins يمكنهم إدارة جميع المنظمات
CREATE POLICY "super_admins_manage_orgs" ON organizations
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM super_admins 
        WHERE user_id = auth.uid() AND is_active = true
    )
);

-- =====================================================
-- ✅ تم الانتهاء
-- =====================================================

