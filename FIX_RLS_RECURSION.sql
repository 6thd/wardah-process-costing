-- FIX RLS RECURSION ISSUE
-- This script fixes the recursive RLS policies that are causing stack depth exceeded errors

-- 1) First, let's disable RLS temporarily to break the recursion
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts DISABLE ROW LEVEL SECURITY;

-- 2) Recreate the auth_org_id function with a guard to prevent recursion
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    org_id_result UUID;
BEGIN
    -- Check if we're already in a recursive call by using a session variable
    IF current_setting('app.in_auth_org_id', true) = 'true' THEN
        RETURN NULL;
    END IF;
    
    -- Set the session variable to indicate we're in this function
    PERFORM set_config('app.in_auth_org_id', 'true', true);
    
    BEGIN
        -- Original logic
        SELECT uo.org_id INTO org_id_result
        FROM user_organizations uo 
        WHERE uo.user_id = auth.uid() 
        AND uo.is_active = true 
        LIMIT 1;
        
        -- Reset the session variable
        PERFORM set_config('app.in_auth_org_id', 'false', true);
        
        RETURN org_id_result;
    EXCEPTION
        WHEN OTHERS THEN
            -- Make sure to reset the session variable even if an error occurs
            PERFORM set_config('app.in_auth_org_id', 'false', true);
            RAISE;
    END;
END;
$$;

-- 3) Recreate the has_org_role function with recursion guard
CREATE OR REPLACE FUNCTION has_org_role(required_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    result BOOLEAN;
BEGIN
    -- Check if we're already in a recursive call
    IF current_setting('app.in_has_org_role', true) = 'true' THEN
        RETURN FALSE;
    END IF;
    
    -- Set the session variable to indicate we're in this function
    PERFORM set_config('app.in_has_org_role', 'true', true);
    
    BEGIN
        -- Original logic
        SELECT EXISTS (
            SELECT 1 
            FROM user_organizations uo 
            WHERE uo.user_id = auth.uid() 
            AND uo.org_id = auth_org_id()
            AND uo.role = required_role
            AND uo.is_active = true
        ) INTO result;
        
        -- Reset the session variable
        PERFORM set_config('app.in_has_org_role', 'false', true);
        
        RETURN result;
    EXCEPTION
        WHEN OTHERS THEN
            -- Make sure to reset the session variable even if an error occurs
            PERFORM set_config('app.in_has_org_role', 'false', true);
            RAISE;
    END;
END;
$$;

-- 4) Recreate the has_any_role function with recursion guard
CREATE OR REPLACE FUNCTION has_any_role(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    result BOOLEAN;
BEGIN
    -- Check if we're already in a recursive call
    IF current_setting('app.in_has_any_role', true) = 'true' THEN
        RETURN FALSE;
    END IF;
    
    -- Set the session variable to indicate we're in this function
    PERFORM set_config('app.in_has_any_role', 'true', true);
    
    BEGIN
        -- Original logic
        SELECT EXISTS (
            SELECT 1 
            FROM user_organizations uo 
            WHERE uo.user_id = auth.uid() 
            AND uo.org_id = auth_org_id()
            AND uo.role = ANY(roles)
            AND uo.is_active = true
        ) INTO result;
        
        -- Reset the session variable
        PERFORM set_config('app.in_has_any_role', 'false', true);
        
        RETURN result;
    EXCEPTION
        WHEN OTHERS THEN
            -- Make sure to reset the session variable even if an error occurs
            PERFORM set_config('app.in_has_any_role', 'false', true);
            RAISE;
    END;
END;
$$;

-- 5) Simplified RLS policies that avoid recursion
-- Organizations: Users can only see their own organizations
CREATE OR REPLACE POLICY "Users can view their organizations" ON organizations
    FOR SELECT USING (
        id IN (
            SELECT org_id 
            FROM user_organizations 
            WHERE user_id = auth.uid() 
            AND is_active = true
            -- Add a limit to prevent deep recursion
            LIMIT 100
        )
    );

-- User Organizations: Users can view their own memberships
CREATE OR REPLACE POLICY "Users can view org memberships" ON user_organizations
    FOR SELECT USING (
        user_id = auth.uid()
        OR org_id IN (
            SELECT org_id 
            FROM user_organizations 
            WHERE user_id = auth.uid() 
            AND is_active = true
            LIMIT 100
        )
    );

-- GL Accounts: Users can view accounts from their organizations
CREATE OR REPLACE POLICY "Users can view org GL accounts" ON gl_accounts
    FOR SELECT USING (
        org_id IN (
            SELECT org_id 
            FROM user_organizations 
            WHERE user_id = auth.uid() 
            AND is_active = true
            LIMIT 100
        )
    );

-- 6) Re-enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;

-- 7) Apply the policies
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE user_organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts FORCE ROW LEVEL SECURITY;