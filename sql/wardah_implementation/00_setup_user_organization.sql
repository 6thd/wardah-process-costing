-- Wardah ERP - Setup User Organization
-- Run this to ensure your user is properly associated with an organization

-- First, check if organizations exist
SELECT 'organizations' as table_name, COUNT(*) as row_count FROM organizations;

-- Check if your user exists in the users table
-- Note: Replace 'YOUR_EMAIL' with your actual email
-- SELECT * FROM users WHERE email = 'YOUR_EMAIL';

-- Check if user_organizations table exists and has data
SELECT 'user_organizations' as table_name, COUNT(*) as row_count FROM user_organizations;

-- If no organizations exist, create a default one
INSERT INTO organizations (id, name, code)
VALUES ('00000000-0000-0000-0000-000000000001', 'Wardah Factory', 'WARD')
ON CONFLICT (id) DO NOTHING;

-- You'll need to get your Supabase user ID from the Supabase dashboard
-- Then associate your user with the organization
-- Note: Replace 'YOUR_USER_ID' with your actual Supabase user ID
-- INSERT INTO user_organizations (user_id, org_id, role)
-- VALUES ('YOUR_USER_ID', '00000000-0000-0000-0000-000000000001', 'admin')
-- ON CONFLICT (user_id, org_id) DO NOTHING;

-- Verify the setup
SELECT o.name as organization_name, uo.role
FROM user_organizations uo
JOIN organizations o ON uo.org_id = o.id
WHERE uo.user_id = 'YOUR_USER_ID'; -- Replace with your actual user ID