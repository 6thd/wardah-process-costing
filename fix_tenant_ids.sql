-- Fix tenant IDs in gl_accounts table
-- This script will update all gl_accounts to use a consistent tenant ID

-- First, let's check what tenant IDs currently exist
SELECT DISTINCT tenant_id, COUNT(*) as count
FROM gl_accounts
GROUP BY tenant_id
ORDER BY count DESC;

-- Check if there are any users in the auth system
SELECT id, email, raw_user_meta_data 
FROM auth.users 
LIMIT 5;

-- Update all gl_accounts to use a default tenant ID
-- We'll use a standard UUID for the default organization
UPDATE gl_accounts 
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL OR tenant_id = '' OR tenant_id NOT SIMILAR TO '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

-- Verify the update
SELECT DISTINCT tenant_id, COUNT(*) as count
FROM gl_accounts
GROUP BY tenant_id
ORDER BY count DESC;

-- If the organizations table doesn't exist, create it
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert a default organization if it doesn't exist
INSERT INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization')
ON CONFLICT (id) DO NOTHING;

-- Create user_organizations table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_organizations (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, org_id)
);

-- Associate all existing users with the default organization
INSERT INTO user_organizations (user_id, org_id, role)
SELECT id, '00000000-0000-0000-0000-000000000001', 'admin'
FROM auth.users
ON CONFLICT (user_id, org_id) DO NOTHING;

-- Enable RLS on gl_accounts if not already enabled
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;

-- Create or replace the RLS policy to allow access based on tenant_id
DROP POLICY IF EXISTS "Users can access accounts from their organization" ON gl_accounts;

CREATE POLICY "Users can access accounts from their organization" 
ON gl_accounts FOR ALL 
USING (
    tenant_id IN (
        SELECT org_id 
        FROM user_organizations 
        WHERE user_id = auth.uid()
    )
);

-- Grant necessary permissions
GRANT ALL ON gl_accounts TO authenticated;