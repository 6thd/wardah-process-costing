-- ===================================================================
-- Tenant ID Functions for Multi-tenant Architecture
-- ===================================================================

-- ===================================================================
-- HELPER FUNCTIONS FOR JWT CLAIMS
-- ===================================================================

-- Function to extract tenant_id from JWT
-- This function tries multiple methods to get the tenant_id
-- and handles cases where no tenant_id is available gracefully
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID 
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    tenant_id UUID;
BEGIN
    -- First try to get tenant_id from auth.jwt() (Supabase recommended method)
    BEGIN
        tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
        IF tenant_id IS NOT NULL THEN
            RETURN tenant_id;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            -- Continue to next method if this fails
            NULL;
    END;

    -- Fallback: Try to get tenant_id from JWT claims in request settings
    BEGIN
        SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid INTO tenant_id;
        IF tenant_id IS NOT NULL THEN
            RETURN tenant_id;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            -- Continue to next method if this fails
            NULL;
    END;

    -- If no tenant_id found, return NULL (don't raise an exception)
    -- This allows the application to handle the case gracefully
    RETURN NULL;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_current_tenant_id() TO anon, authenticated;

-- Also create a version that raises an exception if no tenant_id is found
-- This can be used in contexts where a tenant_id is required
CREATE OR REPLACE FUNCTION get_current_tenant_id_strict()
RETURNS UUID 
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    tenant_id UUID;
BEGIN
    tenant_id := get_current_tenant_id();
    
    IF tenant_id IS NULL THEN
        RAISE EXCEPTION 'No tenant_id found in JWT token or session context';
    END IF;
    
    RETURN tenant_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_current_tenant_id_strict() TO anon, authenticated;