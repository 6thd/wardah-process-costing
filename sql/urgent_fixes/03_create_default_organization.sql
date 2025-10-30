-- ===================================
-- إنشاء المنظمة الافتراضية وربط المستخدمين
-- ===================================

BEGIN;

-- 1. إنشاء المنظمة الافتراضية
INSERT INTO organizations (
    id, 
    name, 
    code, 
    is_active,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Wardah Factory',
    'WF-001',
    true,
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- 2. التحقق من إنشاء المنظمة
SELECT 
    '✅ Organization Created' as status,
    id,
    name,
    code
FROM organizations
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 3. ربط جميع المستخدمين الموجودين بالمنظمة
INSERT INTO user_organizations (user_id, org_id, role, is_active, created_at)
SELECT 
    id,
    '00000000-0000-0000-0000-000000000001'::UUID,
    'admin',
    true,
    NOW()
FROM auth.users
ON CONFLICT (user_id, org_id) DO UPDATE SET
    role = 'admin',
    is_active = true;

-- 4. عرض المستخدمين المرتبطين
SELECT 
    u.id,
    u.email,
    uo.role,
    o.name as organization_name
FROM auth.users u
JOIN user_organizations uo ON u.id = uo.user_id
JOIN organizations o ON uo.org_id = o.id
ORDER BY u.email;

-- 5. رسالة النجاح
DO $$
DECLARE
    org_count INTEGER;
    user_count INTEGER;
    assoc_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO org_count FROM organizations;
    SELECT COUNT(*) INTO user_count FROM auth.users;
    SELECT COUNT(*) INTO assoc_count FROM user_organizations;
    
    RAISE NOTICE '╔══════════════════════════════════════════╗';
    RAISE NOTICE '║  ✅ Setup Complete!                      ║';
    RAISE NOTICE '╠══════════════════════════════════════════╣';
    RAISE NOTICE '║  Organizations: %                        ║', org_count;
    RAISE NOTICE '║  Users: %                                ║', user_count;
    RAISE NOTICE '║  User Associations: %                    ║', assoc_count;
    RAISE NOTICE '╚══════════════════════════════════════════╝';
    
    IF user_count = 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '⚠️  لا يوجد مستخدمين!';
        RAISE NOTICE '📋 يجب إنشاء مستخدم في Supabase Authentication أولاً:';
        RAISE NOTICE '   1. اذهب إلى Authentication > Users';
        RAISE NOTICE '   2. اضغط Add User';
        RAISE NOTICE '   3. أدخل Email و Password';
        RAISE NOTICE '   4. نفذ هذا السكريبت مرة أخرى';
    END IF;
END $$;

COMMIT;

-- ===================================
-- معلومات إضافية
-- ===================================

-- التحقق من حالة RLS
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('organizations', 'user_organizations', 'gl_accounts')
ORDER BY tablename;
