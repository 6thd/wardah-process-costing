# 🏢 خطة نظام Multi-Tenant + RBAC الشامل

> **بسم الله الرحمن الرحيم**
> 
> تاريخ البدء: نوفمبر 2025
> الحالة: 🔄 قيد التنفيذ

---

## 📋 جدول المحتويات

1. [نظرة عامة](#نظرة-عامة)
2. [البنية التقنية](#البنية-التقنية)
3. [Schema قاعدة البيانات](#schema-قاعدة-البيانات)
4. [نظام الصلاحيات RBAC](#نظام-الصلاحيات-rbac)
5. [Row Level Security](#row-level-security)
6. [واجهات المستخدم](#واجهات-المستخدم)
7. [مراحل التنفيذ](#مراحل-التنفيذ)
8. [سجل التحديثات](#سجل-التحديثات)

---

## 🎯 نظرة عامة

### المفهوم الأساسي

نظام **SaaS Multi-Tenant** يسمح ببيع النظام لعدة شركات مع:
- ✅ فصل كامل للبيانات بين الشركات
- ✅ نظام صلاحيات مرن (RBAC)
- ✅ لوحة تحكم Super Admin
- ✅ إدارة مستقلة لكل منظمة

### الهيكل التنظيمي

```
🔴 Super Admin (مالك النظام)
    │
    └─── 🏢 Organizations (الشركات/العملاء)
              │
              ├─── 🟡 Org Admin (مدير الشركة)
              │       │
              │       └─── Roles (أدوار مخصصة)
              │               ├─── مدير مالي
              │               ├─── محاسب
              │               ├─── مندوب مبيعات
              │               └─── ...
              │
              └─── 👥 Users (مستخدمي الشركة)
                      └─── يُعيّن لهم Roles
```

### ضمانات الفصل

| الضمان | الآلية |
|--------|--------|
| لا يرى بيانات غيره | RLS + org_id |
| لا يعدل بيانات غيره | RLS + Middleware |
| أرقام مستقلة | Unique per org |
| إعدادات مستقلة | org.settings |
| سجلات مستقلة | audit_logs.org_id |

---

## 🏗️ البنية التقنية

### طبقات الحماية (Defense in Depth)

```
┌─────────────────────────────────────────┐
│         Layer 1: Frontend               │
│    Auth Context + Org Context           │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│         Layer 2: API Middleware         │
│    validateOrgAccess() + checkPerm()    │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│         Layer 3: Supabase Client        │
│    Auto org_id injection                │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│         Layer 4: PostgreSQL RLS         │
│    Row Level Security Policies          │
└─────────────────────────────────────────┘
```

### الملفات الرئيسية

```
src/
├── contexts/
│   ├── AuthContext.tsx          # إدارة المصادقة
│   └── OrgContext.tsx           # إدارة المنظمة الحالية
│
├── services/
│   ├── organization-service.ts  # خدمات المنظمات
│   ├── rbac-service.ts          # خدمات الصلاحيات
│   └── invitation-service.ts    # خدمات الدعوات
│
├── pages/
│   ├── login.tsx                # تسجيل الدخول
│   ├── super-admin/             # لوحة Super Admin
│   │   ├── dashboard.tsx
│   │   ├── organizations.tsx
│   │   └── organization-form.tsx
│   │
│   └── admin/                   # لوحة Org Admin
│       ├── users.tsx
│       ├── roles.tsx
│       └── permissions.tsx
│
├── components/
│   ├── organization-selector.tsx
│   ├── role-permission-matrix.tsx
│   └── user-role-assignment.tsx
│
└── hooks/
    ├── usePermissions.ts        # التحقق من الصلاحيات
    └── useOrganization.ts       # بيانات المنظمة
```

---

## 📊 Schema قاعدة البيانات

### 1. Super Admins

```sql
CREATE TABLE super_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Organizations

```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- معلومات أساسية
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    code VARCHAR(50) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE,
    
    -- الاشتراك
    plan_type VARCHAR(50) DEFAULT 'trial',
    max_users INT DEFAULT 5,
    subscription_start DATE,
    subscription_end DATE,
    
    -- العلامة التجارية
    logo_url TEXT,
    primary_color VARCHAR(7),
    
    -- معلومات العمل
    industry VARCHAR(100),
    country VARCHAR(2) DEFAULT 'SA',
    currency VARCHAR(3) DEFAULT 'SAR',
    
    -- الإعدادات
    settings JSONB DEFAULT '{}'::jsonb,
    feature_flags JSONB DEFAULT '{}'::jsonb,
    
    -- الحالة
    is_active BOOLEAN DEFAULT true,
    
    -- التدقيق
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. User Profiles

```sql
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    
    full_name VARCHAR(255),
    full_name_ar VARCHAR(255),
    phone VARCHAR(50),
    avatar_url TEXT,
    preferred_language VARCHAR(10) DEFAULT 'ar',
    
    last_login_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4. User Organizations

```sql
CREATE TABLE user_organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    is_active BOOLEAN DEFAULT true,
    is_org_admin BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    UNIQUE(user_id, org_id)
);
```

---

## 🔐 نظام الصلاحيات RBAC

### Modules (أقسام النظام)

```sql
CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description_ar TEXT,
    icon VARCHAR(50),
    display_order INT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- الأقسام الأساسية
INSERT INTO modules (name, name_ar, icon, display_order) VALUES
    ('manufacturing', 'التصنيع', '🏭', 1),
    ('inventory', 'المخزون', '📦', 2),
    ('purchasing', 'المشتريات', '🛒', 3),
    ('sales', 'المبيعات', '💰', 4),
    ('accounting', 'المحاسبة', '📊', 5),
    ('hr', 'الموارد البشرية', '👥', 6),
    ('reports', 'التقارير', '📈', 7),
    ('settings', 'الإعدادات', '⚙️', 8);
```

### Permissions (الصلاحيات)

```sql
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES modules(id),
    
    resource VARCHAR(100) NOT NULL,
    resource_ar VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    action_ar VARCHAR(50) NOT NULL,
    
    permission_key VARCHAR(255) UNIQUE NOT NULL,
    description_ar TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- أمثلة على الصلاحيات
-- manufacturing.orders.create
-- manufacturing.orders.read
-- manufacturing.orders.update
-- manufacturing.orders.delete
-- manufacturing.orders.approve
-- accounting.invoices.create
-- accounting.invoices.approve
-- ...
```

### Roles (الأدوار)

```sql
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description_ar TEXT,
    
    is_system_role BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(org_id, name)
);
```

### Role Permissions

```sql
CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    UNIQUE(role_id, permission_id)
);
```

### User Roles

```sql
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES auth.users(id),
    expires_at TIMESTAMPTZ,
    
    UNIQUE(user_id, role_id, org_id)
);
```

### Invitations (الدعوات)

```sql
CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    email VARCHAR(255) NOT NULL,
    role_ids UUID[] NOT NULL,
    
    token VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    
    invited_by UUID REFERENCES auth.users(id),
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ
);
```

### Audit Logs

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id),
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
```

---

## 🔒 Row Level Security

### سياسات RLS الأساسية

```sql
-- تفعيل RLS على جميع الجداول
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Super Admin يرى كل شيء
CREATE POLICY "super_admin_all" ON organizations
    FOR ALL USING (
        auth.uid() IN (SELECT user_id FROM super_admins WHERE is_active = true)
    );

-- المستخدمين يرون منظماتهم فقط
CREATE POLICY "users_own_orgs" ON organizations
    FOR SELECT USING (
        id IN (
            SELECT org_id FROM user_organizations
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Org Admin يدير منظمته
CREATE POLICY "org_admin_manage" ON roles
    FOR ALL USING (
        org_id IN (
            SELECT org_id FROM user_organizations
            WHERE user_id = auth.uid() 
            AND is_active = true 
            AND is_org_admin = true
        )
    );
```

### دالة التحقق من الصلاحيات

```sql
CREATE OR REPLACE FUNCTION has_permission(
    p_user_id UUID,
    p_org_id UUID,
    p_permission_key VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_permission BOOLEAN;
BEGIN
    -- Super Admin
    IF EXISTS (SELECT 1 FROM super_admins WHERE user_id = p_user_id AND is_active = true) THEN
        RETURN true;
    END IF;
    
    -- Org Admin
    IF EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = p_user_id AND org_id = p_org_id 
        AND is_active = true AND is_org_admin = true
    ) THEN
        RETURN true;
    END IF;
    
    -- التحقق من الصلاحيات
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
        INNER JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id
        AND ur.org_id = p_org_id
        AND p.permission_key = p_permission_key
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    ) INTO v_has_permission;
    
    RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 🖥️ واجهات المستخدم

### 1. Super Admin Dashboard

```
┌──────────────────────────────────────────────────────────────┐
│  🔴 لوحة تحكم Super Admin                                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  📊 الإحصائيات                                               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐│
│  │ 25         │ │ 150        │ │ 12         │ │ SAR 50K    ││
│  │ شركة نشطة │ │ مستخدم     │ │ اشتراك جديد│ │ الإيراد    ││
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘│
│                                                              │
│  🏢 آخر الشركات المضافة                                      │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ شركة وردة للتصنيع    │ Pro  │ 15 مستخدم │ نشط │ إدارة ➜ ││
│  │ مؤسسة النور التجارية │ Basic│ 5 مستخدم  │ نشط │ إدارة ➜ ││
│  │ شركة السلام          │ Trial│ 3 مستخدم  │ نشط │ إدارة ➜ ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  [+ إنشاء شركة جديدة]                                        │
└──────────────────────────────────────────────────────────────┘
```

### 2. Org Admin - إدارة المستخدمين

```
┌──────────────────────────────────────────────────────────────┐
│  👥 إدارة مستخدمي شركة وردة                                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [+ دعوة مستخدم جديد]  [📋 استيراد من Excel]                 │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ 👤 أحمد محمد         │ مدير مالي    │ نشط  │ ⚙️ │ 🗑️  ││
│  │    ahmed@wardah.sa   │              │      │    │     ││
│  ├──────────────────────────────────────────────────────────┤│
│  │ 👤 سارة علي          │ محاسب        │ نشط  │ ⚙️ │ 🗑️  ││
│  │    sara@wardah.sa    │              │      │    │     ││
│  ├──────────────────────────────────────────────────────────┤│
│  │ 👤 خالد أحمد         │ مندوب مبيعات │ نشط  │ ⚙️ │ 🗑️  ││
│  │    khaled@wardah.sa  │              │      │    │     ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  📨 الدعوات المعلقة (2)                                      │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ محمد@wardah.sa │ محاسب │ منذ 2 أيام │ [إعادة إرسال] [❌]││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### 3. Org Admin - إدارة الأدوار والصلاحيات

```
┌──────────────────────────────────────────────────────────────┐
│  🔐 إدارة الأدوار والصلاحيات                                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  📋 الأدوار              🔧 صلاحيات: مدير مالي               │
│  ┌────────────────┐      ┌──────────────────────────────────┐│
│  │ ✅ مدير مالي  │ ←──→ │                                  ││
│  │ ○  محاسب      │      │  📦 التصنيع                      ││
│  │ ○  مندوب      │      │  ├─ □ عرض  □ إنشاء  □ تعديل  □ حذف││
│  │ ○  أمين مخزن  │      │                                  ││
│  │               │      │  📊 المحاسبة                      ││
│  │ [+ دور جديد] │      │  ├─ ✅ عرض  ✅ إنشاء  ✅ تعديل  □ حذف││
│  └────────────────┘      │  ├─ ✅ اعتماد القيود              ││
│                          │                                  ││
│                          │  📈 التقارير                      ││
│                          │  ├─ ✅ التقارير المالية           ││
│                          │  ├─ □ التقارير الإدارية           ││
│                          │                                  ││
│                          │  [💾 حفظ] [📋 نسخ من قالب]       ││
│                          └──────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## 📋 مراحل التنفيذ

### المرحلة 1: الأساسيات (Phase 1) ✅ مكتملة
- [x] إنشاء Schema قاعدة البيانات ✅
- [x] إنشاء RLS Policies ✅
- [x] إنشاء Helper Functions ✅
- [x] خدمة RBAC (rbac-service.ts) ✅

### المرحلة 2: Super Admin (Phase 2)
- [ ] صفحة Super Admin Dashboard
- [ ] إدارة المنظمات (CRUD)
- [ ] إنشاء منظمة + Org Admin

### المرحلة 3: Org Admin (Phase 3)
- [ ] إدارة المستخدمين
- [ ] نظام الدعوات
- [ ] إدارة الأدوار
- [ ] مصفوفة الصلاحيات

### المرحلة 4: التكامل (Phase 4)
- [ ] usePermissions Hook
- [ ] ProtectedComponent
- [ ] تكامل مع الموديولات الحالية

### المرحلة 5: التحسينات (Phase 5)
- [ ] Permission Caching
- [ ] Role Templates
- [ ] Audit Log UI
- [ ] Activity Tracking

---

## 📝 سجل التحديثات

| التاريخ | التحديث | الحالة |
|---------|---------|--------|
| 2025-11-25 | إنشاء الخطة والتوثيق | ✅ |
| 2025-11-25 | إكمال Schema + RLS + RBAC Service | ✅ |
| - | - | - |

---

## 🔗 ملفات ذات صلة

- [MULTI_TENANT_AUTH.md](./MULTI_TENANT_AUTH.md) - نظام المصادقة
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - توثيق قاعدة البيانات
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - توثيق الـ API

---

> **ملاحظة**: هذا المستند يُحدّث تلقائياً مع كل مرحلة تنفيذ.
> آخر تحديث: 2025-11-25

