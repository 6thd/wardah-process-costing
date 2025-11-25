-- =====================================
-- بسم الله الرحمن الرحيم
-- MULTI-TENANT + RBAC SCHEMA
-- تاريخ الإنشاء: نوفمبر 2025
-- =====================================

-- ملاحظة: نفّذ هذا الملف في Supabase SQL Editor

BEGIN;

-- =====================================
-- 1. SUPER ADMINS (مالكي النظام)
-- =====================================

CREATE TABLE IF NOT EXISTS super_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admins_user ON super_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_super_admins_active ON super_admins(is_active) WHERE is_active = true;

COMMENT ON TABLE super_admins IS 'مالكي النظام - يمكنهم إدارة جميع المنظمات';

-- =====================================
-- 2. ORGANIZATIONS (الشركات/المنظمات)
-- =====================================

-- حذف الجدول القديم إن وجد وإعادة إنشائه بالبنية الجديدة
-- أو تحديث الجدول الحالي

-- التحقق من وجود الجدول وإضافة الأعمدة الجديدة
DO $$ 
BEGIN
    -- إضافة الأعمدة الجديدة إن لم تكن موجودة
    
    -- slug
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'slug') THEN
        ALTER TABLE organizations ADD COLUMN slug VARCHAR(100) UNIQUE;
    END IF;
    
    -- plan_type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'plan_type') THEN
        ALTER TABLE organizations ADD COLUMN plan_type VARCHAR(50) DEFAULT 'trial';
    END IF;
    
    -- max_users
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'max_users') THEN
        ALTER TABLE organizations ADD COLUMN max_users INT DEFAULT 5;
    END IF;
    
    -- subscription_start
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'subscription_start') THEN
        ALTER TABLE organizations ADD COLUMN subscription_start DATE;
    END IF;
    
    -- subscription_end
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'subscription_end') THEN
        ALTER TABLE organizations ADD COLUMN subscription_end DATE;
    END IF;
    
    -- logo_url
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'logo_url') THEN
        ALTER TABLE organizations ADD COLUMN logo_url TEXT;
    END IF;
    
    -- primary_color
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'primary_color') THEN
        ALTER TABLE organizations ADD COLUMN primary_color VARCHAR(7);
    END IF;
    
    -- industry
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'industry') THEN
        ALTER TABLE organizations ADD COLUMN industry VARCHAR(100);
    END IF;
    
    -- country
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'country') THEN
        ALTER TABLE organizations ADD COLUMN country VARCHAR(2) DEFAULT 'SA';
    END IF;
    
    -- currency
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'currency') THEN
        ALTER TABLE organizations ADD COLUMN currency VARCHAR(3) DEFAULT 'SAR';
    END IF;
    
    -- timezone
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'timezone') THEN
        ALTER TABLE organizations ADD COLUMN timezone VARCHAR(50) DEFAULT 'Asia/Riyadh';
    END IF;
    
    -- tax_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'tax_id') THEN
        ALTER TABLE organizations ADD COLUMN tax_id VARCHAR(100);
    END IF;
    
    -- feature_flags
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'feature_flags') THEN
        ALTER TABLE organizations ADD COLUMN feature_flags JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- current_users_count
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'current_users_count') THEN
        ALTER TABLE organizations ADD COLUMN current_users_count INT DEFAULT 0;
    END IF;
    
    -- created_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'created_by') THEN
        ALTER TABLE organizations ADD COLUMN created_by UUID REFERENCES auth.users(id);
    END IF;

END $$;

-- Indexes للأداء
CREATE INDEX IF NOT EXISTS idx_org_code ON organizations(code);
CREATE INDEX IF NOT EXISTS idx_org_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_org_active ON organizations(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_org_plan ON organizations(plan_type);

-- =====================================
-- 3. USER PROFILES (ملفات المستخدمين)
-- =====================================

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    
    full_name VARCHAR(255),
    full_name_ar VARCHAR(255),
    phone VARCHAR(50),
    avatar_url TEXT,
    preferred_language VARCHAR(10) DEFAULT 'ar' CHECK (preferred_language IN ('ar', 'en')),
    
    -- Security
    two_factor_enabled BOOLEAN DEFAULT false,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user ON user_profiles(user_id);

COMMENT ON TABLE user_profiles IS 'معلومات إضافية عن المستخدمين';

-- =====================================
-- 4. USER ORGANIZATIONS (ربط المستخدمين بالمنظمات)
-- =====================================

-- تحديث الجدول الحالي
DO $$ 
BEGIN
    -- إضافة is_org_admin
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_organizations' AND column_name = 'is_org_admin') THEN
        ALTER TABLE user_organizations ADD COLUMN is_org_admin BOOLEAN DEFAULT false;
    END IF;
    
    -- إضافة invited_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_organizations' AND column_name = 'invited_by') THEN
        ALTER TABLE user_organizations ADD COLUMN invited_by UUID REFERENCES auth.users(id);
    END IF;
    
    -- إضافة joined_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_organizations' AND column_name = 'joined_at') THEN
        ALTER TABLE user_organizations ADD COLUMN joined_at TIMESTAMPTZ;
    END IF;
END $$;

-- =====================================
-- 5. MODULES (أقسام النظام)
-- =====================================

CREATE TABLE IF NOT EXISTS modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description TEXT,
    description_ar TEXT,
    icon VARCHAR(50),
    display_order INT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إدراج الأقسام الأساسية
INSERT INTO modules (name, name_ar, description_ar, icon, display_order) VALUES
    ('dashboard', 'لوحة التحكم', 'الصفحة الرئيسية والإحصائيات', '📊', 0),
    ('manufacturing', 'التصنيع', 'إدارة أوامر الإنتاج والمراحل الصناعية', '🏭', 1),
    ('inventory', 'المخزون', 'إدارة المواد والمنتجات والمستودعات', '📦', 2),
    ('purchasing', 'المشتريات', 'إدارة الموردين وأوامر الشراء', '🛒', 3),
    ('sales', 'المبيعات', 'إدارة العملاء وفواتير البيع', '💰', 4),
    ('accounting', 'المحاسبة', 'الحسابات والقيود المحاسبية', '📒', 5),
    ('hr', 'الموارد البشرية', 'إدارة الموظفين والرواتب والحضور', '👥', 6),
    ('reports', 'التقارير', 'التقارير والتحليلات', '📈', 7),
    ('settings', 'الإعدادات', 'إعدادات النظام والمنظمة', '⚙️', 8)
ON CONFLICT (name) DO UPDATE SET
    name_ar = EXCLUDED.name_ar,
    description_ar = EXCLUDED.description_ar,
    icon = EXCLUDED.icon,
    display_order = EXCLUDED.display_order;

COMMENT ON TABLE modules IS 'أقسام النظام الرئيسية';

-- =====================================
-- 6. PERMISSIONS (الصلاحيات)
-- =====================================

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    
    resource VARCHAR(100) NOT NULL,
    resource_ar VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    action_ar VARCHAR(50) NOT NULL,
    
    -- مفتاح فريد: module.resource.action
    permission_key VARCHAR(255) UNIQUE NOT NULL,
    
    description TEXT,
    description_ar TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module_id);
CREATE INDEX IF NOT EXISTS idx_permissions_key ON permissions(permission_key);

COMMENT ON TABLE permissions IS 'الصلاحيات المتاحة في النظام';

-- =====================================
-- 7. إدراج الصلاحيات الأساسية
-- =====================================

-- دالة مساعدة لإنشاء صلاحيات CRUD لـ resource
CREATE OR REPLACE FUNCTION create_crud_permissions(
    p_module_name VARCHAR,
    p_resource VARCHAR,
    p_resource_ar VARCHAR,
    p_include_approve BOOLEAN DEFAULT false
)
RETURNS void AS $$
DECLARE
    v_module_id UUID;
BEGIN
    SELECT id INTO v_module_id FROM modules WHERE name = p_module_name;
    
    IF v_module_id IS NULL THEN
        RAISE NOTICE 'Module % not found', p_module_name;
        RETURN;
    END IF;

    -- Read
    INSERT INTO permissions (module_id, resource, resource_ar, action, action_ar, permission_key, description_ar)
    VALUES (v_module_id, p_resource, p_resource_ar, 'read', 'عرض', 
            p_module_name || '.' || p_resource || '.read', 
            'عرض ' || p_resource_ar)
    ON CONFLICT (permission_key) DO NOTHING;

    -- Create
    INSERT INTO permissions (module_id, resource, resource_ar, action, action_ar, permission_key, description_ar)
    VALUES (v_module_id, p_resource, p_resource_ar, 'create', 'إنشاء', 
            p_module_name || '.' || p_resource || '.create', 
            'إنشاء ' || p_resource_ar)
    ON CONFLICT (permission_key) DO NOTHING;

    -- Update
    INSERT INTO permissions (module_id, resource, resource_ar, action, action_ar, permission_key, description_ar)
    VALUES (v_module_id, p_resource, p_resource_ar, 'update', 'تعديل', 
            p_module_name || '.' || p_resource || '.update', 
            'تعديل ' || p_resource_ar)
    ON CONFLICT (permission_key) DO NOTHING;

    -- Delete
    INSERT INTO permissions (module_id, resource, resource_ar, action, action_ar, permission_key, description_ar)
    VALUES (v_module_id, p_resource, p_resource_ar, 'delete', 'حذف', 
            p_module_name || '.' || p_resource || '.delete', 
            'حذف ' || p_resource_ar)
    ON CONFLICT (permission_key) DO NOTHING;

    -- Approve (اختياري)
    IF p_include_approve THEN
        INSERT INTO permissions (module_id, resource, resource_ar, action, action_ar, permission_key, description_ar)
        VALUES (v_module_id, p_resource, p_resource_ar, 'approve', 'اعتماد', 
                p_module_name || '.' || p_resource || '.approve', 
                'اعتماد ' || p_resource_ar)
        ON CONFLICT (permission_key) DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- إنشاء صلاحيات لكل قسم

-- Dashboard
SELECT create_crud_permissions('dashboard', 'overview', 'نظرة عامة', false);
SELECT create_crud_permissions('dashboard', 'analytics', 'التحليلات', false);

-- Manufacturing
SELECT create_crud_permissions('manufacturing', 'orders', 'أوامر الإنتاج', true);
SELECT create_crud_permissions('manufacturing', 'stages', 'مراحل الإنتاج', false);
SELECT create_crud_permissions('manufacturing', 'boms', 'قوائم المواد', true);
SELECT create_crud_permissions('manufacturing', 'work_centers', 'مراكز العمل', false);
SELECT create_crud_permissions('manufacturing', 'stage_costs', 'تكاليف المراحل', false);

-- Inventory
SELECT create_crud_permissions('inventory', 'items', 'المواد', false);
SELECT create_crud_permissions('inventory', 'products', 'المنتجات', false);
SELECT create_crud_permissions('inventory', 'stock_moves', 'حركات المخزون', true);
SELECT create_crud_permissions('inventory', 'warehouses', 'المستودعات', false);
SELECT create_crud_permissions('inventory', 'adjustments', 'تسويات المخزون', true);

-- Purchasing
SELECT create_crud_permissions('purchasing', 'suppliers', 'الموردين', false);
SELECT create_crud_permissions('purchasing', 'purchase_orders', 'أوامر الشراء', true);
SELECT create_crud_permissions('purchasing', 'purchase_invoices', 'فواتير الشراء', true);
SELECT create_crud_permissions('purchasing', 'payments', 'المدفوعات', true);

-- Sales
SELECT create_crud_permissions('sales', 'customers', 'العملاء', false);
SELECT create_crud_permissions('sales', 'sales_orders', 'أوامر البيع', true);
SELECT create_crud_permissions('sales', 'sales_invoices', 'فواتير البيع', true);
SELECT create_crud_permissions('sales', 'receipts', 'المقبوضات', true);
SELECT create_crud_permissions('sales', 'delivery_notes', 'إذونات التسليم', true);

-- Accounting
SELECT create_crud_permissions('accounting', 'accounts', 'الحسابات', false);
SELECT create_crud_permissions('accounting', 'journals', 'القيود', true);
SELECT create_crud_permissions('accounting', 'entries', 'القيود اليومية', true);
SELECT create_crud_permissions('accounting', 'cost_centers', 'مراكز التكلفة', false);

-- HR
SELECT create_crud_permissions('hr', 'employees', 'الموظفين', false);
SELECT create_crud_permissions('hr', 'attendance', 'الحضور والانصراف', false);
SELECT create_crud_permissions('hr', 'payroll', 'الرواتب', true);
SELECT create_crud_permissions('hr', 'leaves', 'الإجازات', true);

-- Reports
SELECT create_crud_permissions('reports', 'financial', 'التقارير المالية', false);
SELECT create_crud_permissions('reports', 'inventory', 'تقارير المخزون', false);
SELECT create_crud_permissions('reports', 'sales', 'تقارير المبيعات', false);
SELECT create_crud_permissions('reports', 'manufacturing', 'تقارير التصنيع', false);

-- Settings
SELECT create_crud_permissions('settings', 'organization', 'إعدادات المنظمة', false);
SELECT create_crud_permissions('settings', 'users', 'المستخدمين', false);
SELECT create_crud_permissions('settings', 'roles', 'الأدوار', false);

-- إضافة صلاحيات خاصة
INSERT INTO permissions (module_id, resource, resource_ar, action, action_ar, permission_key, description_ar)
SELECT m.id, 'exports', 'التصدير', 'export', 'تصدير', 'reports.exports.export', 'تصدير التقارير'
FROM modules m WHERE m.name = 'reports'
ON CONFLICT (permission_key) DO NOTHING;

-- =====================================
-- 8. ROLES (الأدوار)
-- =====================================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description TEXT,
    description_ar TEXT,
    
    -- System Roles لا يمكن حذفها
    is_system_role BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(org_id);
CREATE INDEX IF NOT EXISTS idx_roles_active ON roles(is_active) WHERE is_active = true;

COMMENT ON TABLE roles IS 'الأدوار داخل كل منظمة';

-- =====================================
-- 9. ROLE PERMISSIONS (ربط الأدوار بالصلاحيات)
-- =====================================

CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON role_permissions(permission_id);

COMMENT ON TABLE role_permissions IS 'ربط الأدوار بالصلاحيات';

-- =====================================
-- 10. USER ROLES (ربط المستخدمين بالأدوار)
-- =====================================

CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES auth.users(id),
    expires_at TIMESTAMPTZ, -- صلاحية مؤقتة
    
    UNIQUE(user_id, role_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON user_roles(org_id);

COMMENT ON TABLE user_roles IS 'ربط المستخدمين بالأدوار في المنظمات';

-- =====================================
-- 11. INVITATIONS (الدعوات)
-- =====================================

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    email VARCHAR(255) NOT NULL,
    role_ids UUID[] NOT NULL,
    
    token VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    
    invitation_message TEXT,
    
    invited_by UUID REFERENCES auth.users(id),
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

COMMENT ON TABLE invitations IS 'دعوات الانضمام للمنظمات';

-- =====================================
-- 12. AUDIT LOGS (سجلات المراجعة)
-- =====================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    
    changes JSONB,
    metadata JSONB,
    
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

COMMENT ON TABLE audit_logs IS 'سجلات مراجعة العمليات';

-- =====================================
-- 13. ROLE TEMPLATES (قوالب الأدوار)
-- =====================================

CREATE TABLE IF NOT EXISTS role_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description TEXT,
    description_ar TEXT,
    
    permission_keys TEXT[] NOT NULL,
    
    category VARCHAR(50),
    available_for_plans VARCHAR[] DEFAULT ARRAY['trial', 'basic', 'pro', 'enterprise'],
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إدراج قوالب افتراضية
INSERT INTO role_templates (name, name_ar, description_ar, category, permission_keys) VALUES
    ('cfo', 'المدير المالي', 'جميع صلاحيات المحاسبة والتقارير المالية', 'accounting',
     ARRAY['accounting.%', 'reports.financial.%']),
    
    ('accountant', 'محاسب', 'إدارة القيود والفواتير', 'accounting',
     ARRAY['accounting.journals.%', 'accounting.entries.%', 'sales.sales_invoices.read', 'purchasing.purchase_invoices.read']),
    
    ('production_manager', 'مدير الإنتاج', 'إدارة كاملة للتصنيع', 'manufacturing',
     ARRAY['manufacturing.%', 'inventory.items.read', 'inventory.stock_moves.read']),
    
    ('sales_manager', 'مدير المبيعات', 'إدارة المبيعات والعملاء', 'sales',
     ARRAY['sales.%', 'reports.sales.%']),
    
    ('sales_rep', 'مندوب مبيعات', 'إنشاء أوامر البيع فقط', 'sales',
     ARRAY['sales.customers.read', 'sales.sales_orders.read', 'sales.sales_orders.create']),
    
    ('warehouse_manager', 'مدير المستودع', 'إدارة المخزون والمستودعات', 'inventory',
     ARRAY['inventory.%']),
    
    ('hr_manager', 'مدير الموارد البشرية', 'إدارة الموظفين والرواتب', 'hr',
     ARRAY['hr.%']),
    
    ('viewer', 'مشاهد', 'صلاحيات القراءة فقط', 'general',
     ARRAY['%.read'])
ON CONFLICT DO NOTHING;

COMMENT ON TABLE role_templates IS 'قوالب جاهزة للأدوار';

-- =====================================
-- 14. TRIGGERS
-- =====================================

-- Trigger: إنشاء الأدوار الافتراضية عند إنشاء منظمة
CREATE OR REPLACE FUNCTION create_default_org_roles()
RETURNS TRIGGER AS $$
BEGIN
    -- إنشاء أدوار أساسية
    INSERT INTO roles (org_id, name, name_ar, description_ar, is_system_role) VALUES
        (NEW.id, 'org_admin', 'مدير المنظمة', 'صلاحيات كاملة على المنظمة', true),
        (NEW.id, 'manager', 'مدير', 'صلاحيات إدارية', true),
        (NEW.id, 'accountant', 'محاسب', 'صلاحيات المحاسبة', true),
        (NEW.id, 'warehouse', 'أمين مستودع', 'صلاحيات المخزون', true),
        (NEW.id, 'sales', 'مندوب مبيعات', 'صلاحيات المبيعات', true),
        (NEW.id, 'viewer', 'مشاهد', 'صلاحيات القراءة فقط', true);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_default_org_roles ON organizations;
CREATE TRIGGER trigger_create_default_org_roles
    AFTER INSERT ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION create_default_org_roles();

-- Trigger: تحديث updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_organizations ON organizations;
CREATE TRIGGER trigger_update_organizations
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_user_profiles ON user_profiles;
CREATE TRIGGER trigger_update_user_profiles
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_roles ON roles;
CREATE TRIGGER trigger_update_roles
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_super_admins ON super_admins;
CREATE TRIGGER trigger_update_super_admins
    BEFORE UPDATE ON super_admins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger: تحديث عدد المستخدمين في المنظمة
CREATE OR REPLACE FUNCTION update_org_users_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE organizations 
        SET current_users_count = current_users_count + 1
        WHERE id = NEW.org_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE organizations 
        SET current_users_count = current_users_count - 1
        WHERE id = OLD.org_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_org_users_count ON user_organizations;
CREATE TRIGGER trigger_update_org_users_count
    AFTER INSERT OR DELETE ON user_organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_org_users_count();

COMMIT;

-- =====================================
-- نهاية الملف
-- =====================================

-- 📝 للتحقق من النتائج:
-- SELECT * FROM modules;
-- SELECT * FROM permissions ORDER BY permission_key;
-- SELECT * FROM role_templates;

