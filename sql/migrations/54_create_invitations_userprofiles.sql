-- sql/migrations/54_create_invitations_userprofiles.sql
-- بسم الله الرحمن الرحيم
-- إنشاء جداول invitations و user_profiles

-- =====================================
-- 1. جدول user_profiles
-- =====================================

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    email VARCHAR(255),
    full_name VARCHAR(255),
    full_name_ar VARCHAR(255),
    avatar_url TEXT,
    phone VARCHAR(50),
    
    -- الإعدادات الشخصية
    preferred_language VARCHAR(10) DEFAULT 'ar',
    timezone VARCHAR(50) DEFAULT 'Asia/Riyadh',
    date_format VARCHAR(20) DEFAULT 'DD/MM/YYYY',
    
    -- حالة الحساب
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- تحديث user_id ليكون نفس id
CREATE OR REPLACE FUNCTION sync_user_profile_user_id()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_id := NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_user_profile_user_id ON user_profiles;
CREATE TRIGGER trigger_sync_user_profile_user_id
    BEFORE INSERT ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION sync_user_profile_user_id();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_profile" ON user_profiles;
CREATE POLICY "users_view_own_profile" ON user_profiles
    FOR SELECT USING (id = auth.uid() OR user_id = auth.uid());

DROP POLICY IF EXISTS "users_update_own_profile" ON user_profiles;
CREATE POLICY "users_update_own_profile" ON user_profiles
    FOR UPDATE USING (id = auth.uid() OR user_id = auth.uid());

DROP POLICY IF EXISTS "users_insert_own_profile" ON user_profiles;
CREATE POLICY "users_insert_own_profile" ON user_profiles
    FOR INSERT WITH CHECK (id = auth.uid());

-- السماح للـ Super Admin
DROP POLICY IF EXISTS "super_admin_all_profiles" ON user_profiles;
CREATE POLICY "super_admin_all_profiles" ON user_profiles
    FOR ALL USING (
        EXISTS (SELECT 1 FROM super_admins WHERE user_id = auth.uid() AND is_active = true)
    );

COMMENT ON TABLE user_profiles IS 'الملفات الشخصية للمستخدمين';

-- =====================================
-- 2. جدول invitations
-- =====================================

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    email VARCHAR(255) NOT NULL,
    token UUID UNIQUE DEFAULT uuid_generate_v4(),
    
    -- الأدوار المعينة
    role_ids UUID[] DEFAULT '{}',
    
    -- رسالة الدعوة
    message TEXT,
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    
    -- التواريخ
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,
    
    -- المرسل
    invited_by UUID REFERENCES auth.users(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- منع التكرار
    UNIQUE(org_id, email, status)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);

-- RLS
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- المستخدم يمكنه رؤية الدعوات المرسلة له
DROP POLICY IF EXISTS "users_view_own_invitations" ON invitations;
CREATE POLICY "users_view_own_invitations" ON invitations
    FOR SELECT USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Org Admin يمكنه إدارة دعوات منظمته
DROP POLICY IF EXISTS "org_admin_manage_invitations" ON invitations;
CREATE POLICY "org_admin_manage_invitations" ON invitations
    FOR ALL USING (
        org_id IN (
            SELECT uo.org_id FROM user_organizations uo 
            WHERE uo.user_id = auth.uid() AND uo.is_org_admin = true AND uo.is_active = true
        )
    );

-- Super Admin يمكنه إدارة جميع الدعوات
DROP POLICY IF EXISTS "super_admin_all_invitations" ON invitations;
CREATE POLICY "super_admin_all_invitations" ON invitations
    FOR ALL USING (
        EXISTS (SELECT 1 FROM super_admins WHERE user_id = auth.uid() AND is_active = true)
    );

COMMENT ON TABLE invitations IS 'دعوات المستخدمين للانضمام للمنظمات';

-- =====================================
-- 3. دالة لإنشاء profile تلقائياً
-- =====================================

CREATE OR REPLACE FUNCTION create_user_profile_on_signup()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, user_id, email, full_name)
    VALUES (
        NEW.id,
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION create_user_profile_on_signup();

-- =====================================
-- 4. إنشاء profiles للمستخدمين الحاليين
-- =====================================

INSERT INTO user_profiles (id, user_id, email, full_name)
SELECT 
    id,
    id,
    email,
    COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- =====================================
-- 5. التحقق
-- =====================================

DO $$
BEGIN
    RAISE NOTICE '✅ تم إنشاء الجداول بنجاح:';
    RAISE NOTICE '   - user_profiles';
    RAISE NOTICE '   - invitations';
END $$;

