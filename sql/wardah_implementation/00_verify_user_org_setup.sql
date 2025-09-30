-- Wardah ERP - Verify User Organization Setup
-- Run this to verify that your user is properly associated with an organization

-- 1. Check if default organization exists
SELECT 
  id,
  name,
  code,
  is_active
FROM organizations
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 2. Check if your user is associated with the organization
-- Replace 'YOUR_USER_ID' with your actual Supabase user ID
SELECT 
  user_id,
  org_id,
  role,
  is_active,
  created_at
FROM user_organizations
WHERE user_id = 'YOUR_USER_ID'; -- Replace with your actual user ID

-- 3. If no user organization record exists, create one
-- Uncomment and run the following lines after replacing 'YOUR_USER_ID'
-- INSERT INTO user_organizations (user_id, org_id, role)
-- VALUES ('YOUR_USER_ID', '00000000-0000-0000-0000-000000000001', 'admin')
-- ON CONFLICT (user_id, org_id) 
-- DO UPDATE SET 
--   role = EXCLUDED.role,
--   is_active = true;

-- 4. Verify the setup worked
-- Replace 'YOUR_USER_ID' with your actual Supabase user ID
SELECT 
  uo.user_id,
  o.name as organization_name,
  uo.role,
  uo.is_active
FROM user_organizations uo
JOIN organizations o ON uo.org_id = o.id
WHERE uo.user_id = 'YOUR_USER_ID'; -- Replace with your actual user ID