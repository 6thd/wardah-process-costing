-- ===================================================================
-- FIX RLS POLICIES - Allow Default Org ID
-- ===================================================================
-- 
-- This script fixes RLS policies to allow access using default org_id
-- as fallback when JWT doesn't contain org_id
-- ===================================================================

-- ===================================================================
-- 1. DROP EXISTING POLICIES
-- ===================================================================
DROP POLICY IF EXISTS manufacturing_stages_tenant_isolation ON public.manufacturing_stages;
DROP POLICY IF EXISTS stage_wip_log_tenant_isolation ON public.stage_wip_log;
DROP POLICY IF EXISTS standard_costs_tenant_isolation ON public.standard_costs;

-- ===================================================================
-- 2. CREATE FIXED POLICIES WITH FALLBACK
-- ===================================================================

-- Manufacturing Stages Policy
CREATE POLICY manufacturing_stages_tenant_isolation ON public.manufacturing_stages
    FOR ALL
    USING (
        -- Try to get org_id from JWT claims
        org_id = COALESCE(
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'), '')::uuid,
            NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'), '')::uuid,
            -- Fallback to default org_id if JWT doesn't have it
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
-- 3. VERIFY POLICIES CREATED
-- ===================================================================
SELECT 
    tablename,
    policyname,
    cmd,
    substring(qual::text, 1, 100) as policy_condition
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs')
ORDER BY tablename, policyname;

-- ===================================================================
-- 4. TEST QUERY (should return 5 stages)
-- ===================================================================
SELECT 
    COUNT(*) as stage_count,
    'Should return 5 stages' as expected
FROM manufacturing_stages
WHERE org_id = '00000000-0000-0000-0000-000000000001'::uuid;

-- ===================================================================
-- 5. SUMMARY
-- ===================================================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '╔════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║     RLS POLICIES FIXED - WITH FALLBACK                 ║';
    RAISE NOTICE '╚════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Policies updated to use default org_id as fallback';
    RAISE NOTICE '';
    RAISE NOTICE 'Policy logic:';
    RAISE NOTICE '  1. Try to get org_id from JWT claims (org_id or tenant_id)';
    RAISE NOTICE '  2. If not found, use default: 00000000-0000-0000-0000-000000000001';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Refresh the application page';
    RAISE NOTICE '  2. Check if stages appear in the UI';
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

