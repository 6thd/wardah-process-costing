-- بسم الله الرحمن الرحيم
-- إضافة المستخدم الحالي كـ Org Admin

-- 1. أولاً نحتاج معرفة user_id للمستخدم
-- يمكنك الحصول عليه من Supabase Dashboard > Authentication > Users

-- 2. إضافة المستخدم لجدول user_organizations
-- استبدل 'YOUR_USER_ID' بالـ UUID الفعلي

/*
-- Example:
INSERT INTO user_organizations (user_id, org_id, is_active, is_org_admin)
VALUES (
    'YOUR_USER_ID',  -- استبدل بالـ user_id من auth.users
    '00000000-0000-0000-0000-000000000001',  -- org_id الافتراضي
    true,
    true  -- org admin
)
ON CONFLICT (user_id, org_id) DO UPDATE SET
    is_active = true,
    is_org_admin = true;
*/

-- 3. إضافة المستخدم لجدول super_admins (اختياري)
/*
INSERT INTO super_admins (user_id, email, is_active)
VALUES (
    'YOUR_USER_ID',
    'mom77909@gmail.com',
    true
)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;
*/

-- للحصول على user_id، شغل هذا الاستعلام في Supabase SQL Editor:
-- SELECT id, email FROM auth.users WHERE email = 'mom77909@gmail.com';

