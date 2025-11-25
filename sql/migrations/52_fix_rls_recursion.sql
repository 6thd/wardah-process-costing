-- =====================================================
-- 52_fix_rls_recursion.sql
-- بسم الله الرحمن الرحيم
-- إصلاح مشكلة Infinite Recursion في RLS
-- =====================================================

-- ⚠️ المشكلة: السياسات تحاول قراءة user_organizations للتحقق
-- مما يسبب recursion لا نهائي

-- =====================================================
-- الخطوة 1: حذف جميع السياسات القديمة
-- =====================================================
DROP POLICY IF EXISTS "users_view_own_orgs" ON user_organizations;
DROP POLICY IF EXISTS "super_admins_view_all" ON user_organizations;
DROP POLICY IF EXISTS "super_admins_manage_all" ON user_organizations;
DROP POLICY IF EXISTS "org_admins_manage_org_users" ON user_organizations;
DROP POLICY IF EXISTS "users_view_org_colleagues" ON user_organizations;
DROP POLICY IF EXISTS "users_manage_own" ON user_organizations;

-- =====================================================
-- الخطوة 2: إنشاء دالة SECURITY DEFINER للتحقق من Super Admin
-- هذه الدالة تتجاوز RLS
-- =====================================================
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM super_admins 
    WHERE user_id = auth.uid() 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =====================================================
-- الخطوة 3: سياسات بسيطة لا تسبب recursion
-- =====================================================

-- السياسة 1: المستخدم يمكنه رؤية سجلاته فقط (بسيطة، لا recursion)
CREATE POLICY "user_orgs_select_own" ON user_organizations
FOR SELECT USING (
    user_id = auth.uid()
);

-- السياسة 2: Super Admin يمكنه رؤية الكل (باستخدام الدالة)
CREATE POLICY "user_orgs_super_admin_select" ON user_organizations
FOR SELECT USING (
    is_super_admin()
);

-- السياسة 3: Super Admin يمكنه إدارة الكل
CREATE POLICY "user_orgs_super_admin_all" ON user_organizations
FOR ALL USING (
    is_super_admin()
);

-- السياسة 4: المستخدم يمكنه تعديل سجله فقط
CREATE POLICY "user_orgs_update_own" ON user_organizations
FOR UPDATE USING (
    user_id = auth.uid()
);

-- =====================================================
-- الخطوة 4: دالة للتحقق من Org Admin (باستخدام SECURITY DEFINER)
-- =====================================================
CREATE OR REPLACE FUNCTION is_org_admin_for(check_org_id uuid)
RETURNS BOOLEAN AS $$
BEGIN
  -- Super Admin has access to all
  IF is_super_admin() THEN
    RETURN true;
  END IF;
  
  -- Check if user is org admin for this specific org
  RETURN EXISTS (
    SELECT 1 FROM user_organizations
    WHERE user_id = auth.uid()
    AND org_id = check_org_id
    AND is_org_admin = true
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =====================================================
-- الخطوة 5: إصلاح RLS لجدول organizations
-- =====================================================
DROP POLICY IF EXISTS "users_view_own_organizations" ON organizations;
DROP POLICY IF EXISTS "super_admins_manage_orgs" ON organizations;

-- المستخدم يمكنه رؤية منظماته فقط
CREATE POLICY "orgs_user_select" ON organizations
FOR SELECT USING (
    id IN (
        SELECT org_id FROM user_organizations 
        WHERE user_id = auth.uid() AND is_active = true
    )
    OR is_super_admin()
);

-- Super Admin يمكنه إدارة جميع المنظمات
CREATE POLICY "orgs_super_admin_all" ON organizations
FOR ALL USING (
    is_super_admin()
);

-- =====================================================
-- الخطوة 6: التأكد من تفعيل RLS
-- =====================================================
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- السماح للمستخدمين بالتحقق إذا كانوا super_admin
DROP POLICY IF EXISTS "super_admins_select_own" ON super_admins;
CREATE POLICY "super_admins_select_own" ON super_admins
FOR SELECT USING (
    user_id = auth.uid()
);

-- =====================================================
-- ✅ تم الانتهاء
-- =====================================================
-- ملاحظة: السياسات الآن بسيطة وتعتمد على:
-- 1. user_id = auth.uid() (مباشر، لا recursion)
-- 2. is_super_admin() (دالة SECURITY DEFINER)
-- =====================================================

