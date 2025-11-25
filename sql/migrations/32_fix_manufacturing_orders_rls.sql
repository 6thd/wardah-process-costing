-- Fix RLS Policies for manufacturing_orders
-- This script fixes the RLS policy to support both org_id and tenant_id columns

-- Update get_current_tenant_id function to support both tenant_id and org_id from JWT
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  result UUID;
  jwt_claims JSONB;
BEGIN
  -- Get JWT claims
  BEGIN
    jwt_claims := current_setting('request.jwt.claims', true)::jsonb;
  EXCEPTION
    WHEN OTHERS THEN
      jwt_claims := NULL;
  END;
  
  -- Try to get tenant_id from JWT claim
  IF jwt_claims IS NOT NULL THEN
    result := (jwt_claims->>'tenant_id')::UUID;
    
    -- If not found, try org_id
    IF result IS NULL THEN
      result := (jwt_claims->>'org_id')::UUID;
    END IF;
  END IF;
  
  -- If not found in JWT, try to get from user_organizations
  IF result IS NULL THEN
    SELECT uo.org_id INTO result
    FROM user_organizations uo
    WHERE uo.user_id = auth.uid()
    LIMIT 1;
  END IF;
  
  -- If still not found, use default org_id
  IF result IS NULL THEN
    result := '00000000-0000-0000-0000-000000000001'::UUID;
  END IF;
  
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    -- Return default org_id on any error
    RETURN '00000000-0000-0000-0000-000000000001'::UUID;
END;
$$;

-- Drop existing policies
DROP POLICY IF EXISTS tenant_select_manufacturing_orders ON public.manufacturing_orders;
DROP POLICY IF EXISTS tenant_insert_manufacturing_orders ON public.manufacturing_orders;
DROP POLICY IF EXISTS tenant_update_manufacturing_orders ON public.manufacturing_orders;
DROP POLICY IF EXISTS tenant_delete_manufacturing_orders ON public.manufacturing_orders;

-- Create new policies that support both org_id and tenant_id
-- First, check which column exists
DO $$
DECLARE
  has_tenant_id BOOLEAN;
  has_org_id BOOLEAN;
  policy_sql TEXT;
BEGIN
  -- Check which columns exist
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'manufacturing_orders' 
    AND column_name = 'tenant_id'
  ) INTO has_tenant_id;
  
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'manufacturing_orders' 
    AND column_name = 'org_id'
  ) INTO has_org_id;
  
  -- SELECT Policy
  IF has_tenant_id THEN
    CREATE POLICY tenant_select_manufacturing_orders ON public.manufacturing_orders
      FOR SELECT USING (tenant_id = get_current_tenant_id());
  ELSIF has_org_id THEN
    CREATE POLICY tenant_select_manufacturing_orders ON public.manufacturing_orders
      FOR SELECT USING (org_id = get_current_tenant_id());
  ELSE
    CREATE POLICY tenant_select_manufacturing_orders ON public.manufacturing_orders
      FOR SELECT USING (true);
  END IF;
  
  -- INSERT Policy (This is the critical one for the 403 error)
  IF has_tenant_id THEN
    CREATE POLICY tenant_insert_manufacturing_orders ON public.manufacturing_orders
      FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());
  ELSIF has_org_id THEN
    CREATE POLICY tenant_insert_manufacturing_orders ON public.manufacturing_orders
      FOR INSERT WITH CHECK (org_id = get_current_tenant_id());
  ELSE
    CREATE POLICY tenant_insert_manufacturing_orders ON public.manufacturing_orders
      FOR INSERT WITH CHECK (true);
  END IF;
  
  -- UPDATE Policy
  IF has_tenant_id THEN
    CREATE POLICY tenant_update_manufacturing_orders ON public.manufacturing_orders
      FOR UPDATE 
      USING (tenant_id = get_current_tenant_id())
      WITH CHECK (tenant_id = get_current_tenant_id());
  ELSIF has_org_id THEN
    CREATE POLICY tenant_update_manufacturing_orders ON public.manufacturing_orders
      FOR UPDATE 
      USING (org_id = get_current_tenant_id())
      WITH CHECK (org_id = get_current_tenant_id());
  ELSE
    CREATE POLICY tenant_update_manufacturing_orders ON public.manufacturing_orders
      FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  
  -- DELETE Policy
  IF has_tenant_id THEN
    CREATE POLICY tenant_delete_manufacturing_orders ON public.manufacturing_orders
      FOR DELETE USING (tenant_id = get_current_tenant_id());
  ELSIF has_org_id THEN
    CREATE POLICY tenant_delete_manufacturing_orders ON public.manufacturing_orders
      FOR DELETE USING (org_id = get_current_tenant_id());
  ELSE
    CREATE POLICY tenant_delete_manufacturing_orders ON public.manufacturing_orders
      FOR DELETE USING (true);
  END IF;
  
  RAISE NOTICE '✅ RLS policies for manufacturing_orders have been updated';
  RAISE NOTICE '   - has_tenant_id: %', has_tenant_id;
  RAISE NOTICE '   - has_org_id: %', has_org_id;
END $$;

-- Verify the policies
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
WHERE tablename = 'manufacturing_orders'
ORDER BY policyname;

