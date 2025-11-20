-- ربط المستخدم mom77909@gmail.com بمؤسسة وردة البيان
INSERT INTO user_organizations (user_id, org_id, role)
VALUES (
  'd572eb14-5a8a-4ec9-ad3b-6945fcc8be0e',
  '00000000-0000-0000-0000-000000000001',
  'admin'
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
  o.name as org_name,
  u.email
FROM user_organizations uo
JOIN organizations o ON o.id = uo.org_id
JOIN auth.users u ON u.id = uo.user_id
WHERE uo.user_id = 'd572eb14-5a8a-4ec9-ad3b-6945fcc8be0e';
