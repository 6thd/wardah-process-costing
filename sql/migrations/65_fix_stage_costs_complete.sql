-- =============================================
-- Complete Fix for stage_costs Table (V2 - Fixed)
-- إصلاح شامل لجدول stage_costs
-- =============================================
-- Migration: 65_fix_stage_costs_complete_v2.sql
-- Date: 2024
-- 
-- This migration:
-- 1. Adds org_id if missing
-- 2. Fixes RLS policies
-- 3. Ensures proper column structure
-- =============================================

-- =============================================
-- PART 1: Check and Add org_id
-- =============================================

DO $$ 
DECLARE
    v_org_id_exists BOOLEAN;
    v_tenant_id_exists BOOLEAN;
    v_mo_col_name TEXT;
BEGIN
    RAISE NOTICE '=== Checking stage_costs structure ===';
    
    -- Check if org_id exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'org_id'
    ) INTO v_org_id_exists;
    
    -- Check if tenant_id exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs' 
        AND column_name = 'tenant_id'
    ) INTO v_tenant_id_exists;
    
    -- Find MO column name (prefer manufacturing_order_id as it's the actual column)
    SELECT column_name INTO v_mo_col_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'stage_costs'
    AND column_name IN ('manufacturing_order_id', 'mo_id')
    ORDER BY 
      CASE column_name 
        WHEN 'manufacturing_order_id' THEN 1
        WHEN 'mo_id' THEN 2
      END
    LIMIT 1;
    
    RAISE NOTICE 'org_id exists: %', v_org_id_exists;
    RAISE NOTICE 'tenant_id exists: %', v_tenant_id_exists;
    RAISE NOTICE 'MO column: %', COALESCE(v_mo_col_name, 'NOT FOUND');
    
    -- Add org_id if missing
    IF NOT v_org_id_exists THEN
        ALTER TABLE stage_costs 
        ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
        
        -- Migrate from tenant_id if it exists
        IF v_tenant_id_exists THEN
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
        
        RAISE NOTICE '✅ Added org_id column';
    ELSE
        RAISE NOTICE '✅ org_id already exists';
    END IF;
END $$;

-- =============================================
-- PART 2: Drop ALL Existing RLS Policies
-- =============================================

-- Drop all policies dynamically
DO $$ 
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE '=== Dropping existing policies ===';
    FOR r IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'stage_costs'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.stage_costs', r.policyname);
        RAISE NOTICE 'Dropped policy: %', r.policyname;
    END LOOP;
    
    -- Also drop known policy names explicitly (in case pg_policies doesn't show them)
    DROP POLICY IF EXISTS tenant_select_stage_costs ON public.stage_costs;
    DROP POLICY IF EXISTS tenant_insert_stage_costs ON public.stage_costs;
    DROP POLICY IF EXISTS tenant_update_stage_costs ON public.stage_costs;
    DROP POLICY IF EXISTS tenant_delete_stage_costs ON public.stage_costs;
    DROP POLICY IF EXISTS "Users can read stage_costs" ON public.stage_costs;
    DROP POLICY IF EXISTS "Users can insert stage_costs" ON public.stage_costs;
    DROP POLICY IF EXISTS "Users can update stage_costs" ON public.stage_costs;
    DROP POLICY IF EXISTS "Users can delete stage_costs" ON public.stage_costs;
    DROP POLICY IF EXISTS "Super admins can manage stage_costs" ON public.stage_costs;
    DROP POLICY IF EXISTS "Users can view org stage_costs" ON public.stage_costs;
    DROP POLICY IF EXISTS "Users can insert org stage_costs" ON public.stage_costs;
    DROP POLICY IF EXISTS "Users can update org stage_costs" ON public.stage_costs;
    DROP POLICY IF EXISTS "Users can delete org stage_costs" ON public.stage_costs;
    
    RAISE NOTICE '✅ All policies dropped';
END $$;

-- =============================================
-- PART 3: Enable RLS
-- =============================================

ALTER TABLE stage_costs ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PART 4: Create New RLS Policies
-- =============================================

-- Policy: Super admins can do everything
CREATE POLICY "Super admins can manage stage_costs" ON public.stage_costs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Policy: Users can view stage_costs for their organizations
CREATE POLICY "Users can view org stage_costs" ON public.stage_costs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Policy: Users can insert stage_costs for their organizations
CREATE POLICY "Users can insert org stage_costs" ON public.stage_costs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Policy: Users can update stage_costs for their organizations
CREATE POLICY "Users can update org stage_costs" ON public.stage_costs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Policy: Users can delete stage_costs for their organizations
CREATE POLICY "Users can delete org stage_costs" ON public.stage_costs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM super_admins
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    OR
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- =============================================
-- PART 5: Create Indexes
-- =============================================

CREATE INDEX IF NOT EXISTS idx_stage_costs_org_id ON public.stage_costs(org_id);

-- Create index on org_id + mo column (whichever exists)
DO $$ 
DECLARE
    v_mo_col TEXT;
BEGIN
    -- Find MO column (prefer manufacturing_order_id as it's the actual column)
    SELECT column_name INTO v_mo_col
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'stage_costs'
    AND column_name IN ('manufacturing_order_id', 'mo_id')
    ORDER BY 
      CASE column_name 
        WHEN 'manufacturing_order_id' THEN 1
        WHEN 'mo_id' THEN 2
      END
    LIMIT 1;
    
    IF v_mo_col IS NOT NULL THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_stage_costs_org_mo ON public.stage_costs(org_id, %I)', v_mo_col);
        RAISE NOTICE '✅ Created index on org_id, %', v_mo_col;
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
    v_mo_col TEXT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Verification ===';
    RAISE NOTICE '';
    
    -- Check org_id
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
    
    -- Check MO column
    SELECT column_name INTO v_mo_col
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'stage_costs'
    AND column_name IN ('manufacturing_order_id', 'mo_id')
    ORDER BY 
      CASE column_name 
        WHEN 'manufacturing_order_id' THEN 1
        WHEN 'mo_id' THEN 2
      END
    LIMIT 1;
    
    IF v_mo_col IS NOT NULL THEN
        RAISE NOTICE '✅ MO column exists: %', v_mo_col;
    ELSE
        RAISE NOTICE '❌ MO column missing (neither mo_id nor manufacturing_order_id found)';
    END IF;
    
    -- Check RLS
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'stage_costs'
    AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    
    IF v_rls_enabled THEN
        RAISE NOTICE '✅ RLS is ENABLED';
    ELSE
        RAISE NOTICE '❌ RLS is NOT enabled';
    END IF;
    
    -- Count policies
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'stage_costs';
    
    RAISE NOTICE '✅ Policies count: %', v_policy_count;
    
    IF v_policy_count > 0 THEN
        RAISE NOTICE 'Policies:';
        DECLARE
            v_policy_name TEXT;
        BEGIN
            FOR v_policy_name IN 
                SELECT policyname 
                FROM pg_policies
                WHERE schemaname = 'public'
                AND tablename = 'stage_costs'
            LOOP
                RAISE NOTICE '  - %', v_policy_name;
            END LOOP;
        END;
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '=== Fix Complete ===';
END $$;

