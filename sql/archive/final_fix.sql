-- Final fix for tenant ID issues in gl_accounts
-- Run this script in Supabase SQL Editor

-- 1. First, let's check the current state
SELECT 
  CASE 
    WHEN tenant_id IS NULL THEN 'NULL' 
    ELSE 'HAS_VALUE' 
  END as tenant_status,
  COUNT(*) as count
FROM gl_accounts
GROUP BY 
  CASE 
    WHEN tenant_id IS NULL THEN 'NULL' 
    ELSE 'HAS_VALUE' 
  END;

-- 2. Update all accounts with NULL tenant_id to use default
-- First, check if there's an existing organization we can use
DO $$
DECLARE
    org_uuid UUID;
BEGIN
    -- Try to get an existing organization
    SELECT id INTO org_uuid FROM organizations LIMIT 1;
    
    -- If no organization exists, use our default
    IF org_uuid IS NULL THEN
        org_uuid := '00000000-0000-0000-0000-000000000001';
    END IF;
    
    -- Update accounts with NULL tenant_id
    UPDATE gl_accounts 
    SET tenant_id = org_uuid
    WHERE tenant_id IS NULL;
END $$;

-- 3. Check if there are any malformed tenant_ids
SELECT tenant_id::text, COUNT(*) as count
FROM gl_accounts
WHERE tenant_id IS NOT NULL 
  AND tenant_id::text NOT SIMILAR TO '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
GROUP BY tenant_id::text;

-- 4. Update any malformed tenant_ids
DO $$
DECLARE
    org_uuid UUID;
BEGIN
    -- Try to get an existing organization
    SELECT id INTO org_uuid FROM organizations LIMIT 1;
    
    -- If no organization exists, use our default
    IF org_uuid IS NULL THEN
        org_uuid := '00000000-0000-0000-0000-000000000001';
    END IF;
    
    -- Update malformed tenant_ids
    UPDATE gl_accounts 
    SET tenant_id = org_uuid
    WHERE tenant_id IS NOT NULL 
      AND tenant_id::text NOT SIMILAR TO '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
END $$;

-- 5. Verify the update
SELECT tenant_id, COUNT(*) as count
FROM gl_accounts
GROUP BY tenant_id
ORDER BY count DESC;

-- 6. Create organizations table if it doesn't exist
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Insert default organization only if it doesn't exist
INSERT INTO organizations (id, name)
SELECT '00000000-0000-0000-0000-000000000001', 'Default Organization'
WHERE NOT EXISTS (
    SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001'
);

-- 8. Create user_organizations table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_organizations (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, org_id)
);

-- 9. Associate all existing users with the default organization
INSERT INTO user_organizations (user_id, org_id, role)
SELECT id, '00000000-0000-0000-0000-000000000001', 'admin'
FROM auth.users
WHERE NOT EXISTS (
    SELECT 1 FROM user_organizations uo 
    WHERE uo.user_id = auth.users.id 
    AND uo.org_id = '00000000-0000-0000-0000-000000000001'
);

-- 10. Check the results
SELECT 
  (SELECT COUNT(*) FROM gl_accounts WHERE tenant_id IS NOT NULL) as accounts_with_tenant,
  (SELECT COUNT(*) FROM organizations) as organizations_count,
  (SELECT COUNT(*) FROM user_organizations) as user_org_associations;

-- 11. Update the RLS policy on gl_accounts to be more permissive in demo mode
-- First drop existing policy if it exists
DROP POLICY IF EXISTS "Users can access accounts from their organization" ON gl_accounts;

-- Create a more permissive policy for demo/testing
DO $$
BEGIN
    -- Only create policy if RLS is enabled
    IF (SELECT relrowsecurity FROM pg_class WHERE relname = 'gl_accounts') THEN
        CREATE POLICY "Users can access accounts from their organization" 
        ON gl_accounts FOR ALL 
        USING (
          -- Allow access if tenant_id matches user's organization
          tenant_id IN (
            SELECT org_id 
            FROM user_organizations 
            WHERE user_id = auth.uid()
          )
          OR
          -- Allow access in demo mode (when no user org associations exist)
          NOT EXISTS (
            SELECT 1 FROM user_organizations WHERE user_id = auth.uid()
          )
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Ignore errors if policy already exists or other issues
    NULL;
END $$;

-- Grant necessary permissions
DO $$
BEGIN
    GRANT ALL ON gl_accounts TO authenticated;
EXCEPTION WHEN OTHERS THEN
    -- Ignore if permission already granted
    NULL;
END $$;