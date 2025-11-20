-- Script to fix user-organization association
-- This script will ensure the user is properly associated with an organization

-- First, let's check what users we have
SELECT id, email FROM auth.users;

-- Check existing organizations
SELECT id, name FROM organizations;

-- Check existing user-organization associations
SELECT user_id, org_id, role FROM user_organizations;

-- If there are no organizations, create a default one
INSERT INTO organizations (id, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Associate the first user with the default organization as admin
-- Replace 'USER_ID_HERE' with the actual user ID from the first query
INSERT INTO user_organizations (user_id, org_id, role, created_at, updated_at)
VALUES ('USER_ID_HERE', '00000000-0000-0000-0000-000000000001', 'admin', NOW(), NOW())
ON CONFLICT (user_id, org_id) DO NOTHING;

-- Update gl_accounts to have the correct tenant_id
-- This will set all accounts to use the default organization ID
UPDATE gl_accounts 
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL OR tenant_id = '';

-- Verify the update
SELECT DISTINCT tenant_id FROM gl_accounts;