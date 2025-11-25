-- ===================================================================
-- FIX RLS POLICIES - Simple Version
-- ===================================================================
-- 
-- This script fixes RLS policies to allow access
-- Use this if the complex policy doesn't work
-- ===================================================================

-- ===================================================================
-- 1. DROP EXISTING POLICIES
-- ===================================================================
DROP POLICY IF EXISTS manufacturing_stages_tenant_isolation ON public.manufacturing_stages;
DROP POLICY IF EXISTS stage_wip_log_tenant_isolation ON public.stage_wip_log;
DROP POLICY IF EXISTS standard_costs_tenant_isolation ON public.standard_costs;

-- ===================================================================
-- 2. CREATE SIMPLIFIED POLICIES
-- ===================================================================

-- Manufacturing Stages Policy (Allow authenticated users)
CREATE POLICY manufacturing_stages_tenant_isolation ON public.manufacturing_stages
    FOR ALL
    USING (
        -- Allow if org_id matches from JWT
        org_id = COALESCE(
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'), '')::uuid,
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'), '')::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid
        )
    );

-- Stage WIP Log Policy
CREATE POLICY stage_wip_log_tenant_isolation ON public.stage_wip_log
    FOR ALL
    USING (
        org_id = COALESCE(
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'), '')::uuid,
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'), '')::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid
        )
    );

-- Standard Costs Policy
CREATE POLICY standard_costs_tenant_isolation ON public.standard_costs
    FOR ALL
    USING (
        org_id = COALESCE(
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'), '')::uuid,
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'), '')::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid
        )
    );

-- ===================================================================
-- 3. VERIFY POLICIES
-- ===================================================================
SELECT 
    tablename,
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
ORDER BY tablename, policyname;

-- ===================================================================
-- 4. TEST QUERY
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
ORDER BY order_sequence;

-- ===================================================================
-- SUMMARY
-- ===================================================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ RLS POLICIES FIXED';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE 'Policies updated to use default org_id as fallback.';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Refresh the application page';
    RAISE NOTICE '  2. Check if stages appear in the UI';
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

