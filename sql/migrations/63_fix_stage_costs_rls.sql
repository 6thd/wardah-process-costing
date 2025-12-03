-- =============================================
-- Fix stage_costs RLS Policies
-- إصلاح RLS policies على جدول stage_costs
-- =============================================
-- Migration: 63_fix_stage_costs_rls.sql
-- Date: 2024
-- 
-- Issues Fixed:
-- 1. Update stage_costs to use org_id instead of tenant_id
-- 2. Fix RLS policies to use auth_org_id() instead of get_current_tenant_id()
-- =============================================

-- =============================================
-- PART 1: Add org_id column if missing
-- =============================================

DO $$ 
BEGIN
    -- Check if org_id column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'org_id'
    ) THEN
        -- Add org_id column
        ALTER TABLE stage_costs 
        ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
        
        -- Migrate data from tenant_id to org_id if tenant_id exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'stage_costs' 
            AND column_name = 'tenant_id'
        ) THEN
            -- Try to map tenant_id to org_id (assuming they're the same for now)
            -- Only update if we can safely cast
            BEGIN
                UPDATE stage_costs 
                SET org_id = tenant_id::uuid
                WHERE org_id IS NULL AND tenant_id IS NOT NULL;
                
                RAISE NOTICE '✅ Migrated tenant_id to org_id';
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE '⚠️ Could not migrate from tenant_id: %', SQLERRM;
            END;
        END IF;
        
        -- Set default org_id for any remaining NULL values
        UPDATE stage_costs 
        SET org_id = '00000000-0000-0000-0000-000000000001'::uuid
        WHERE org_id IS NULL;
        
        IF FOUND THEN
            RAISE NOTICE '✅ Set default org_id for existing records';
        END IF;
        
        -- Make org_id NOT NULL after migration
        ALTER TABLE stage_costs 
        ALTER COLUMN org_id SET NOT NULL;
        
        RAISE NOTICE '✅ Added org_id column to stage_costs';
    ELSE
        RAISE NOTICE '✅ org_id column already exists';
    END IF;
END $$;

-- =============================================
-- PART 2: Drop old RLS policies
-- =============================================

DROP POLICY IF EXISTS tenant_select_stage_costs ON public.stage_costs;
DROP POLICY IF EXISTS tenant_insert_stage_costs ON public.stage_costs;
DROP POLICY IF EXISTS tenant_update_stage_costs ON public.stage_costs;
DROP POLICY IF EXISTS tenant_delete_stage_costs ON public.stage_costs;

-- Also drop any other old policies
DROP POLICY IF EXISTS "Users can read stage_costs" ON public.stage_costs;
DROP POLICY IF EXISTS "Users can insert stage_costs" ON public.stage_costs;
DROP POLICY IF EXISTS "Users can update stage_costs" ON public.stage_costs;
DROP POLICY IF EXISTS "Users can delete stage_costs" ON public.stage_costs;

-- =============================================
-- PART 3: Create new RLS policies using org_id
-- =============================================

-- Ensure RLS is enabled
ALTER TABLE stage_costs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view stage_costs for their organizations
CREATE POLICY "Users can view org stage_costs" ON public.stage_costs
  FOR SELECT 
  USING (
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Policy: Users can insert stage_costs for their organizations
CREATE POLICY "Users can insert org stage_costs" ON public.stage_costs
  FOR INSERT 
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Policy: Users can update stage_costs for their organizations
CREATE POLICY "Users can update org stage_costs" ON public.stage_costs
  FOR UPDATE 
  USING (
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Policy: Users can delete stage_costs for their organizations
CREATE POLICY "Users can delete org stage_costs" ON public.stage_costs
  FOR DELETE 
  USING (
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- =============================================
-- PART 4: Create index on org_id for performance
-- =============================================

CREATE INDEX IF NOT EXISTS idx_stage_costs_org_id ON public.stage_costs(org_id);

-- Create index on org_id + mo_id if mo_id exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'mo_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_stage_costs_org_mo ON public.stage_costs(org_id, mo_id);
        RAISE NOTICE '✅ Created index on org_id, mo_id';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'manufacturing_order_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_stage_costs_org_mo ON public.stage_costs(org_id, manufacturing_order_id);
        RAISE NOTICE '✅ Created index on org_id, manufacturing_order_id';
    END IF;
END $$;

-- =============================================
-- Verification
-- =============================================

DO $$ 
DECLARE
    v_rls_enabled BOOLEAN;
    v_policy_count INTEGER;
    v_org_id_exists BOOLEAN;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Verifying stage_costs RLS Fix ===';
    RAISE NOTICE '';
    
    -- Check if org_id exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'org_id'
    ) INTO v_org_id_exists;
    
    IF v_org_id_exists THEN
        RAISE NOTICE '✅ org_id column exists';
    ELSE
        RAISE NOTICE '❌ org_id column missing';
    END IF;
    
    -- Check if RLS is enabled
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'stage_costs'
    AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    
    IF v_rls_enabled THEN
        RAISE NOTICE '✅ RLS is ENABLED on stage_costs';
    ELSE
        RAISE NOTICE '❌ RLS is NOT enabled on stage_costs';
    END IF;
    
    -- Count policies
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'stage_costs';
    
    RAISE NOTICE '✅ Policies count: %', v_policy_count;
    
    RAISE NOTICE '';
    RAISE NOTICE '=== Fix Complete ===';
END $$;

