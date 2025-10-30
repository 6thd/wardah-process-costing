-- ربط المستخدم الحالي بمؤسسة وردة البيان
-- هذا يسمح للمستخدم بالوصول إلى بيانات المؤسسة

INSERT INTO user_organizations (user_id, org_id, role)
VALUES (
  auth.uid(),
  '00000000-0000-0000-0000-000000000001',
  'ADMIN'
)
ON CONFLICT (user_id, org_id) DO UPDATE
SET 
  role = EXCLUDED.role,
  updated_at = now();

-- التحقق
SELECT 
  uo.user_id,
  uo.org_id,
  uo.role,
  o.name as org_name
FROM user_organizations uo
JOIN organizations o ON o.id = uo.org_id
WHERE uo.user_id = auth.uid();
