-- ===================================================================
-- FIX MANUFACTURING STAGES RLS - Phase 1
-- ===================================================================
-- 
-- This script fixes RLS policies to allow access to manufacturing_stages
-- ===================================================================

-- ===================================================================
-- 1. CHECK CURRENT RLS POLICIES
-- ===================================================================
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'manufacturing_stages';

-- ===================================================================
-- 2. DROP EXISTING POLICY (if too restrictive)
-- ===================================================================
DROP POLICY IF EXISTS manufacturing_stages_tenant_isolation ON public.manufacturing_stages;

-- ===================================================================
-- 3. CREATE MORE PERMISSIVE POLICY (for testing)
-- ===================================================================
-- Allow access based on org_id from JWT or default org_id
CREATE POLICY manufacturing_stages_tenant_isolation ON public.manufacturing_stages
    FOR ALL
    USING (
        -- Option 1: Check if org_id matches from JWT claims
        org_id = COALESCE(
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'), '')::uuid,
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'), '')::uuid,
            NULL
        )
        OR
        -- Option 2: Allow if org_id matches default org_id (for development)
        org_id = '00000000-0000-0000-0000-000000000001'::uuid
        AND auth.role() = 'authenticated'
    );

-- ===================================================================
-- 4. ALTERNATIVE: MORE PERMISSIVE POLICY (for development)
-- ===================================================================
-- Uncomment this if the above doesn't work:
/*
DROP POLICY IF EXISTS manufacturing_stages_tenant_isolation ON public.manufacturing_stages;

CREATE POLICY manufacturing_stages_tenant_isolation ON public.manufacturing_stages
    FOR ALL
    USING (auth.role() = 'authenticated');
*/

-- ===================================================================
-- 5. VERIFY POLICY
-- ===================================================================
SELECT 
    tablename,
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'manufacturing_stages';

-- ===================================================================
-- 6. TEST QUERY
-- ===================================================================
-- This should return the 5 stages now
SELECT 
    id,
    code,
    name,
    name_ar,
    org_id,
    order_sequence,
    is_active
FROM manufacturing_stages
WHERE org_id = '00000000-0000-0000-0000-000000000001'::uuid
ORDER BY order_sequence;

-- ===================================================================
-- SUMMARY
-- ===================================================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'RLS POLICY FIXED';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Policy updated to allow access';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Refresh the application page';
    RAISE NOTICE '  2. Check if stages appear';
    RAISE NOTICE '';
    RAISE NOTICE 'If still not working, check:';
    RAISE NOTICE '  - JWT token contains org_id or tenant_id';
    RAISE NOTICE '  - User is authenticated';
    RAISE NOTICE '  - RLS is enabled on the table';
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

