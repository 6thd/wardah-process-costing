-- Create the necessary tables and populate them with data

-- 1. Create the users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'employee',
    tenant_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create the organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create the user_organizations table
CREATE TABLE IF NOT EXISTS user_organizations (
    user_id UUID REFERENCES auth.users(id),
    org_id UUID REFERENCES organizations(id),
    role TEXT DEFAULT 'employee',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, org_id)
);

-- 4. Enable RLS on these tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;

-- 5. Create policies for users table
DROP POLICY IF EXISTS "Users can view their own profile" ON users;
CREATE POLICY "Users can view their own profile" ON users
    FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own profile" ON users;
CREATE POLICY "Users can update their own profile" ON users
    FOR UPDATE USING (id = auth.uid());

-- 6. Create policies for organizations table
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON organizations;
CREATE POLICY "Users can view organizations they belong to" ON organizations
    FOR SELECT USING (id IN (
        SELECT org_id FROM user_organizations WHERE user_id = auth.uid()
    ));

-- 7. Create policies for user_organizations table
DROP POLICY IF EXISTS "Users can view their organization associations" ON user_organizations;
CREATE POLICY "Users can view their organization associations" ON user_organizations
    FOR SELECT USING (user_id = auth.uid());

-- 8. Grant necessary permissions
GRANT ALL ON TABLE users TO authenticated;
GRANT ALL ON TABLE organizations TO authenticated;
GRANT ALL ON TABLE user_organizations TO authenticated;

-- 9. Create a default organization
INSERT INTO organizations (id, name, code, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'DEFAULT', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  updated_at = NOW();

-- 10. Create a user profile for the existing auth user (replace with your actual user ID)
-- First, let's check what users exist in auth.users
SELECT id, email, created_at FROM auth.users;

-- Then, create a user profile for each auth user
INSERT INTO users (id, email, full_name, role, tenant_id, created_at, updated_at)
SELECT 
    id, 
    email, 
    split_part(email, '@', 1) as full_name, 
    'employee' as role, 
    '00000000-0000-0000-0000-000000000001' as tenant_id,
    created_at,
    NOW() as updated_at
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    tenant_id = EXCLUDED.tenant_id,
    updated_at = NOW();

-- 11. Associate users with the default organization
INSERT INTO user_organizations (user_id, org_id, role, created_at, updated_at)
SELECT 
    id as user_id,
    '00000000-0000-0000-0000-000000000001' as org_id,
    'employee' as role,
    NOW() as created_at,
    NOW() as updated_at
FROM auth.users
ON CONFLICT (user_id, org_id) DO UPDATE SET
    role = EXCLUDED.role,
    updated_at = NOW();

-- 12. Update any gl_accounts with NULL tenant_id to use the default organization
UPDATE gl_accounts 
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

-- 13. Verify the setup
SELECT COUNT(*) as total_auth_users FROM auth.users;
SELECT COUNT(*) as total_custom_users FROM users;
SELECT COUNT(*) as total_organizations FROM organizations;
SELECT COUNT(*) as total_user_org_associations FROM user_organizations;
SELECT COUNT(*) as total_gl_accounts FROM gl_accounts;
SELECT COUNT(*) as accounts_with_tenant FROM gl_accounts WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
SELECT COUNT(*) as accounts_without_tenant FROM gl_accounts WHERE tenant_id IS NULL;