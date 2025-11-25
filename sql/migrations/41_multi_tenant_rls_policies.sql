-- =====================================
-- بسم الله الرحمن الرحيم
-- RLS POLICIES - Row Level Security
-- تاريخ الإنشاء: نوفمبر 2025
-- =====================================

-- ملاحظة: نفّذ هذا الملف بعد 40_multi_tenant_rbac_schema.sql

BEGIN;

-- =====================================
-- 1. تفعيل RLS على جميع الجداول
-- =====================================

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_templates ENABLE ROW LEVEL SECURITY;

-- =====================================
-- 2. دالة مساعدة: التحقق من Super Admin
-- =====================================

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

-- =====================================
-- 3. دالة مساعدة: التحقق من Org Admin
-- =====================================

CREATE OR REPLACE FUNCTION is_org_admin(p_org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_organizations 
        WHERE user_id = auth.uid() 
        AND org_id = p_org_id
        AND is_active = true 
        AND is_org_admin = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =====================================
-- 4. دالة مساعدة: الحصول على منظمات المستخدم
-- =====================================

CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS UUID[] AS $$
BEGIN
    RETURN ARRAY(
        SELECT org_id FROM user_organizations
        WHERE user_id = auth.uid() 
        AND is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =====================================
-- 5. POLICIES - super_admins
-- =====================================

DROP POLICY IF EXISTS "super_admins_select" ON super_admins;
CREATE POLICY "super_admins_select" ON super_admins
    FOR SELECT USING (is_super_admin());

DROP POLICY IF EXISTS "super_admins_all" ON super_admins;
CREATE POLICY "super_admins_all" ON super_admins
    FOR ALL USING (is_super_admin());

-- =====================================
-- 6. POLICIES - organizations
-- =====================================

-- Super Admin يرى كل الشركات
DROP POLICY IF EXISTS "orgs_super_admin" ON organizations;
CREATE POLICY "orgs_super_admin" ON organizations
    FOR ALL USING (is_super_admin());

-- المستخدمين يرون منظماتهم فقط
DROP POLICY IF EXISTS "orgs_users_select" ON organizations;
CREATE POLICY "orgs_users_select" ON organizations
    FOR SELECT USING (
        id = ANY(get_user_org_ids())
    );

-- Org Admin يمكنه تعديل منظمته
DROP POLICY IF EXISTS "orgs_admin_update" ON organizations;
CREATE POLICY "orgs_admin_update" ON organizations
    FOR UPDATE USING (is_org_admin(id));

-- =====================================
-- 7. POLICIES - user_profiles
-- =====================================

-- كل مستخدم يرى ملفه فقط
DROP POLICY IF EXISTS "profiles_own" ON user_profiles;
CREATE POLICY "profiles_own" ON user_profiles
    FOR ALL USING (user_id = auth.uid());

-- Super Admin يرى الكل
DROP POLICY IF EXISTS "profiles_super_admin" ON user_profiles;
CREATE POLICY "profiles_super_admin" ON user_profiles
    FOR ALL USING (is_super_admin());

-- Org Admin يرى مستخدمي منظمته
DROP POLICY IF EXISTS "profiles_org_admin" ON user_profiles;
CREATE POLICY "profiles_org_admin" ON user_profiles
    FOR SELECT USING (
        user_id IN (
            SELECT uo.user_id 
            FROM user_organizations uo
            WHERE uo.org_id = ANY(get_user_org_ids())
        )
    );

-- =====================================
-- 8. POLICIES - user_organizations
-- =====================================

-- Super Admin
DROP POLICY IF EXISTS "user_orgs_super_admin" ON user_organizations;
CREATE POLICY "user_orgs_super_admin" ON user_organizations
    FOR ALL USING (is_super_admin());

-- المستخدم يرى ربطه بالمنظمات
DROP POLICY IF EXISTS "user_orgs_own" ON user_organizations;
CREATE POLICY "user_orgs_own" ON user_organizations
    FOR SELECT USING (user_id = auth.uid());

-- Org Admin يدير مستخدمي منظمته
DROP POLICY IF EXISTS "user_orgs_admin" ON user_organizations;
CREATE POLICY "user_orgs_admin" ON user_organizations
    FOR ALL USING (is_org_admin(org_id));

-- =====================================
-- 9. POLICIES - modules (للقراءة فقط)
-- =====================================

DROP POLICY IF EXISTS "modules_public_read" ON modules;
CREATE POLICY "modules_public_read" ON modules
    FOR SELECT USING (is_active = true);

-- Super Admin يمكنه التعديل
DROP POLICY IF EXISTS "modules_super_admin" ON modules;
CREATE POLICY "modules_super_admin" ON modules
    FOR ALL USING (is_super_admin());

-- =====================================
-- 10. POLICIES - permissions (للقراءة فقط)
-- =====================================

DROP POLICY IF EXISTS "permissions_public_read" ON permissions;
CREATE POLICY "permissions_public_read" ON permissions
    FOR SELECT USING (true);

-- Super Admin فقط يعدل
DROP POLICY IF EXISTS "permissions_super_admin" ON permissions;
CREATE POLICY "permissions_super_admin" ON permissions
    FOR ALL USING (is_super_admin());

-- =====================================
-- 11. POLICIES - roles
-- =====================================

-- Super Admin
DROP POLICY IF EXISTS "roles_super_admin" ON roles;
CREATE POLICY "roles_super_admin" ON roles
    FOR ALL USING (is_super_admin());

-- المستخدمين يرون أدوار منظماتهم
DROP POLICY IF EXISTS "roles_users_select" ON roles;
CREATE POLICY "roles_users_select" ON roles
    FOR SELECT USING (org_id = ANY(get_user_org_ids()));

-- Org Admin يدير أدوار منظمته
DROP POLICY IF EXISTS "roles_org_admin" ON roles;
CREATE POLICY "roles_org_admin" ON roles
    FOR ALL USING (is_org_admin(org_id));

-- =====================================
-- 12. POLICIES - role_permissions
-- =====================================

-- Super Admin
DROP POLICY IF EXISTS "role_perms_super_admin" ON role_permissions;
CREATE POLICY "role_perms_super_admin" ON role_permissions
    FOR ALL USING (is_super_admin());

-- المستخدمين يرون صلاحيات الأدوار في منظماتهم
DROP POLICY IF EXISTS "role_perms_users_select" ON role_permissions;
CREATE POLICY "role_perms_users_select" ON role_permissions
    FOR SELECT USING (
        role_id IN (SELECT id FROM roles WHERE org_id = ANY(get_user_org_ids()))
    );

-- Org Admin يدير صلاحيات أدوار منظمته
DROP POLICY IF EXISTS "role_perms_org_admin" ON role_permissions;
CREATE POLICY "role_perms_org_admin" ON role_permissions
    FOR ALL USING (
        role_id IN (
            SELECT id FROM roles 
            WHERE org_id IN (
                SELECT org_id FROM user_organizations
                WHERE user_id = auth.uid() AND is_org_admin = true
            )
        )
    );

-- =====================================
-- 13. POLICIES - user_roles
-- =====================================

-- Super Admin
DROP POLICY IF EXISTS "user_roles_super_admin" ON user_roles;
CREATE POLICY "user_roles_super_admin" ON user_roles
    FOR ALL USING (is_super_admin());

-- المستخدم يرى أدواره
DROP POLICY IF EXISTS "user_roles_own" ON user_roles;
CREATE POLICY "user_roles_own" ON user_roles
    FOR SELECT USING (user_id = auth.uid());

-- Org Admin يدير أدوار مستخدمي منظمته
DROP POLICY IF EXISTS "user_roles_org_admin" ON user_roles;
CREATE POLICY "user_roles_org_admin" ON user_roles
    FOR ALL USING (is_org_admin(org_id));

-- =====================================
-- 14. POLICIES - invitations
-- =====================================

-- Super Admin
DROP POLICY IF EXISTS "invitations_super_admin" ON invitations;
CREATE POLICY "invitations_super_admin" ON invitations
    FOR ALL USING (is_super_admin());

-- Org Admin يدير دعوات منظمته
DROP POLICY IF EXISTS "invitations_org_admin" ON invitations;
CREATE POLICY "invitations_org_admin" ON invitations
    FOR ALL USING (is_org_admin(org_id));

-- المدعو يمكنه قراءة دعوته بالـ token (سيتم التحقق في الـ API)
DROP POLICY IF EXISTS "invitations_by_token" ON invitations;
CREATE POLICY "invitations_by_token" ON invitations
    FOR SELECT USING (true); -- التحقق يتم في الـ API

-- =====================================
-- 15. POLICIES - audit_logs
-- =====================================

-- Super Admin يرى الكل
DROP POLICY IF EXISTS "audit_super_admin" ON audit_logs;
CREATE POLICY "audit_super_admin" ON audit_logs
    FOR SELECT USING (is_super_admin());

-- Org Admin يرى سجلات منظمته
DROP POLICY IF EXISTS "audit_org_admin" ON audit_logs;
CREATE POLICY "audit_org_admin" ON audit_logs
    FOR SELECT USING (is_org_admin(org_id));

-- المستخدم يرى سجلاته فقط
DROP POLICY IF EXISTS "audit_own" ON audit_logs;
CREATE POLICY "audit_own" ON audit_logs
    FOR SELECT USING (user_id = auth.uid());

-- إدراج السجلات (للجميع - التحقق في التطبيق)
DROP POLICY IF EXISTS "audit_insert" ON audit_logs;
CREATE POLICY "audit_insert" ON audit_logs
    FOR INSERT WITH CHECK (true);

-- =====================================
-- 16. POLICIES - role_templates
-- =====================================

-- الجميع يقرأ القوالب
DROP POLICY IF EXISTS "templates_public_read" ON role_templates;
CREATE POLICY "templates_public_read" ON role_templates
    FOR SELECT USING (is_active = true);

-- Super Admin يعدل
DROP POLICY IF EXISTS "templates_super_admin" ON role_templates;
CREATE POLICY "templates_super_admin" ON role_templates
    FOR ALL USING (is_super_admin());

-- =====================================
-- 17. دالة التحقق من صلاحية معينة
-- =====================================

CREATE OR REPLACE FUNCTION has_permission(
    p_user_id UUID,
    p_org_id UUID,
    p_permission_key VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_permission BOOLEAN;
BEGIN
    -- Super Admin: كل الصلاحيات
    IF EXISTS (
        SELECT 1 FROM super_admins 
        WHERE user_id = p_user_id AND is_active = true
    ) THEN
        RETURN true;
    END IF;
    
    -- Org Admin: كل صلاحيات منظمته
    IF EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = p_user_id 
        AND org_id = p_org_id
        AND is_active = true 
        AND is_org_admin = true
    ) THEN
        RETURN true;
    END IF;
    
    -- التحقق من الصلاحيات العادية
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
        INNER JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id
        AND ur.org_id = p_org_id
        AND (
            p.permission_key = p_permission_key
            OR p.permission_key LIKE REPLACE(SPLIT_PART(p_permission_key, '.', 1) || '.%', '*', '%')
        )
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    ) INTO v_has_permission;
    
    RETURN COALESCE(v_has_permission, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =====================================
-- 18. دالة الحصول على كل صلاحيات المستخدم
-- =====================================

CREATE OR REPLACE FUNCTION get_user_permissions(
    p_user_id UUID,
    p_org_id UUID
)
RETURNS TABLE (
    permission_key VARCHAR,
    module_name VARCHAR,
    resource VARCHAR,
    action VARCHAR
) AS $$
BEGIN
    -- Super Admin: كل الصلاحيات
    IF EXISTS (
        SELECT 1 FROM super_admins 
        WHERE user_id = p_user_id AND is_active = true
    ) THEN
        RETURN QUERY
        SELECT 
            p.permission_key::VARCHAR,
            m.name::VARCHAR as module_name,
            p.resource::VARCHAR,
            p.action::VARCHAR
        FROM permissions p
        INNER JOIN modules m ON p.module_id = m.id
        WHERE m.is_active = true;
        RETURN;
    END IF;
    
    -- Org Admin: كل الصلاحيات
    IF EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = p_user_id 
        AND org_id = p_org_id
        AND is_active = true 
        AND is_org_admin = true
    ) THEN
        RETURN QUERY
        SELECT 
            p.permission_key::VARCHAR,
            m.name::VARCHAR as module_name,
            p.resource::VARCHAR,
            p.action::VARCHAR
        FROM permissions p
        INNER JOIN modules m ON p.module_id = m.id
        WHERE m.is_active = true;
        RETURN;
    END IF;
    
    -- صلاحيات عادية
    RETURN QUERY
    SELECT DISTINCT
        p.permission_key::VARCHAR,
        m.name::VARCHAR as module_name,
        p.resource::VARCHAR,
        p.action::VARCHAR
    FROM user_roles ur
    INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
    INNER JOIN permissions p ON rp.permission_id = p.id
    INNER JOIN modules m ON p.module_id = m.id
    WHERE ur.user_id = p_user_id
    AND ur.org_id = p_org_id
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    AND m.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =====================================
-- 19. دالة إنشاء دور من قالب
-- =====================================

CREATE OR REPLACE FUNCTION create_role_from_template(
    p_org_id UUID,
    p_template_id UUID,
    p_custom_name VARCHAR DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_template role_templates%ROWTYPE;
    v_new_role_id UUID;
    v_perm_key TEXT;
BEGIN
    -- جلب القالب
    SELECT * INTO v_template FROM role_templates WHERE id = p_template_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not found';
    END IF;
    
    -- إنشاء الدور
    INSERT INTO roles (org_id, name, name_ar, description_ar, created_by)
    VALUES (
        p_org_id,
        COALESCE(p_custom_name, v_template.name),
        v_template.name_ar,
        v_template.description_ar,
        COALESCE(p_created_by, auth.uid())
    )
    RETURNING id INTO v_new_role_id;
    
    -- إضافة الصلاحيات
    FOREACH v_perm_key IN ARRAY v_template.permission_keys
    LOOP
        INSERT INTO role_permissions (role_id, permission_id, created_by)
        SELECT v_new_role_id, p.id, COALESCE(p_created_by, auth.uid())
        FROM permissions p
        WHERE p.permission_key LIKE REPLACE(v_perm_key, '%', '%%')
           OR p.permission_key LIKE v_perm_key
        ON CONFLICT DO NOTHING;
    END LOOP;
    
    RETURN v_new_role_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- =====================================
-- نهاية الملف
-- =====================================

-- 📝 للاختبار:
-- SELECT is_super_admin();
-- SELECT has_permission(auth.uid(), 'org_id', 'accounting.journals.create');
-- SELECT * FROM get_user_permissions(auth.uid(), 'org_id');

