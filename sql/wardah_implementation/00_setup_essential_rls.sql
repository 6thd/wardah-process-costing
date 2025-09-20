-- Wardah ERP - Setup Essential RLS Policies
-- Run this to enable RLS and set up essential policies

-- Enable RLS on essential tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_mappings ENABLE ROW LEVEL SECURITY;

-- Create helper functions if they don't exist
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
    SELECT uo.org_id 
    FROM user_organizations uo 
    WHERE uo.user_id = auth.uid() 
    AND uo.is_active = true 
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION has_org_role(required_role TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM user_organizations uo 
        WHERE uo.user_id = auth.uid() 
        AND uo.org_id = auth_org_id()
        AND uo.role = required_role
        AND uo.is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION has_any_role(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM user_organizations uo 
        WHERE uo.user_id = auth.uid() 
        AND uo.org_id = auth_org_id()
        AND uo.role = ANY(roles)
        AND uo.is_active = true
    );
$$;

-- Essential RLS Policies
-- Organizations: Users can only see their own organizations
CREATE POLICY "Users can view their organizations" ON organizations
    FOR SELECT USING (
        id IN (
            SELECT org_id 
            FROM user_organizations 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

CREATE POLICY "Admins can update their organizations" ON organizations
    FOR UPDATE USING (
        id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

-- User Organizations
CREATE POLICY "Users can view org memberships" ON user_organizations
    FOR SELECT USING (
        org_id = auth_org_id() 
        OR user_id = auth.uid()
    );

CREATE POLICY "Admins can manage org memberships" ON user_organizations
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_org_role('admin')
    );

-- GL Accounts
CREATE POLICY "Users can view org GL accounts" ON gl_accounts
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can insert GL accounts" ON gl_accounts
    FOR INSERT WITH CHECK (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

CREATE POLICY "Managers can update GL accounts" ON gl_accounts
    FOR UPDATE USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

CREATE POLICY "Admins can delete GL accounts" ON gl_accounts
    FOR DELETE USING (
        org_id = auth_org_id() 
        AND has_org_role('admin')
    );

-- GL Mappings
CREATE POLICY "Users can view org GL mappings" ON gl_mappings
    FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "Managers can manage GL mappings" ON gl_mappings
    FOR ALL USING (
        org_id = auth_org_id() 
        AND has_any_role(ARRAY['admin', 'manager'])
    );

SELECT 'Essential RLS policies setup complete' as result;