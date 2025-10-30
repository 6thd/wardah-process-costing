-- الخطوة 1: ابحث عن user_id الخاص بك
SELECT 
  id,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;
