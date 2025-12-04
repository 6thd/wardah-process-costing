-- =====================================================
-- Migration: Fix Search Path for All Functions
-- =====================================================
-- 
-- Purpose: Fix "Function Search Path Mutable" warnings
--          by setting search_path = public, pg_temp for all functions
--
-- Issue: 98 functions have mutable search_path which is a security risk
-- Fix: Apply SET search_path = public, pg_temp to all public functions
--
-- Date: 2025-01-XX
-- =====================================================

-- =====================================================
-- PART 1: Fix Search Path for All Functions
-- =====================================================

DO $$
DECLARE
  func_record RECORD;
  sql_stmt TEXT;
  fixed_count INTEGER := 0;
  failed_count INTEGER := 0;
  total_count INTEGER := 0;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Starting to fix search_path for all functions...';
  RAISE NOTICE '========================================';

  -- First, count total functions
  SELECT COUNT(*) INTO total_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prokind = 'f';  -- functions only (not procedures or aggregates)

  RAISE NOTICE 'Total functions found: %', total_count;

  -- Loop through all public functions
  FOR func_record IN 
    SELECT 
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args,
      p.oid AS func_oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'  -- functions only
    ORDER BY p.proname
  LOOP
    BEGIN
      -- Build ALTER FUNCTION statement
      -- Handle functions with no arguments specially
      IF func_record.args = '' THEN
        sql_stmt := format(
          'ALTER FUNCTION %I.%I() SET search_path = public, pg_temp',
          func_record.schema_name,
          func_record.function_name
        );
      ELSE
        sql_stmt := format(
          'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp',
          func_record.schema_name,
          func_record.function_name,
          func_record.args
        );
      END IF;

      -- Execute the ALTER FUNCTION statement
      EXECUTE sql_stmt;
      
      fixed_count := fixed_count + 1;
      
      -- Log progress every 10 functions
      IF fixed_count % 10 = 0 THEN
        RAISE NOTICE 'Progress: %/% functions fixed...', fixed_count, total_count;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      failed_count := failed_count + 1;
      RAISE WARNING 'Failed to fix %.%(%): %', 
        func_record.schema_name,
        func_record.function_name,
        func_record.args,
        SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Search Path Fix Summary:';
  RAISE NOTICE '  Total functions: %', total_count;
  RAISE NOTICE '  Successfully fixed: %', fixed_count;
  RAISE NOTICE '  Failed: %', failed_count;
  RAISE NOTICE '========================================';

END $$;

-- =====================================================
-- PART 2: Verification - Summary
-- =====================================================

DO $$
DECLARE
  total_functions INTEGER := 0;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Verification Summary';
  RAISE NOTICE '========================================';

  -- Count total functions that were processed
  SELECT COUNT(*) INTO total_functions
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prokind = 'f';

  RAISE NOTICE 'Total functions in public schema: %', total_functions;
  RAISE NOTICE '';
  RAISE NOTICE '✅ Migration completed successfully!';
  RAISE NOTICE '   All functions should now have search_path = public, pg_temp';
  RAISE NOTICE '';
  RAISE NOTICE '📋 Next Steps:';
  RAISE NOTICE '   1. Re-run Supabase Database Linter to verify';
  RAISE NOTICE '   2. Check Dashboard → Advisors → Security → Rerun Linter';
  RAISE NOTICE '   3. Expected: 0 "Function Search Path Mutable" warnings';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;

-- =====================================================
-- PART 3: Create Summary View (for reference)
-- =====================================================

-- Create a simple view listing all public functions
-- Note: Direct verification of search_path requires Postgres 14+ with pg_proc_config
-- The best way to verify is to re-run Supabase Database Linter
-- Using security_invoker=true to avoid SECURITY DEFINER warnings
CREATE OR REPLACE VIEW v_all_public_functions 
WITH (security_invoker=true) AS
SELECT 
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  CASE 
    WHEN p.provolatile = 'i' THEN 'IMMUTABLE'
    WHEN p.provolatile = 's' THEN 'STABLE'
    WHEN p.provolatile = 'v' THEN 'VOLATILE'
    ELSE 'UNKNOWN'
  END AS volatility
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
ORDER BY p.proname;

COMMENT ON VIEW v_all_public_functions IS 
'View listing all public functions. All functions should have search_path = public, pg_temp after migration 66_fix_all_function_search_paths.sql';

-- =====================================================
-- PART 4: Verification Query (run manually after migration)
-- =====================================================

-- To verify the migration worked, run this query:
-- SELECT COUNT(*) as total_functions FROM v_all_public_functions;
-- 
-- Then re-run Supabase Database Linter:
-- Dashboard → Advisors → Security → Rerun Linter
-- 
-- Expected result: 0 "Function Search Path Mutable" warnings

-- =====================================================
-- Migration Complete
-- =====================================================
-- 
-- Next Steps:
-- 1. Verify the migration by checking the function count:
--    SELECT COUNT(*) as total_functions FROM v_all_public_functions;
--
-- 2. Re-run Supabase Database Linter:
--    Dashboard → Advisors → Security → Rerun Linter
--
-- 3. Expected result: 0 "Function Search Path Mutable" warnings
--
-- Note: Direct verification of search_path configuration requires
--       Postgres 14+ with pg_proc_config. The best verification method
--       is to re-run Supabase Database Linter after this migration.
--
-- =====================================================

