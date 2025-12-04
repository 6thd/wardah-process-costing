-- =====================================================
-- Migration: Fix View Security Invoker
-- =====================================================
-- 
-- Purpose: Fix "Security Definer View" warning for v_all_public_functions
--          by recreating it with security_invoker=true
--
-- Issue: v_all_public_functions view was created with SECURITY DEFINER
-- Fix: Recreate view with security_invoker=true
--
-- Date: 2025-01-XX
-- =====================================================

-- Drop and recreate the view with security_invoker
DROP VIEW IF EXISTS v_all_public_functions;

CREATE VIEW v_all_public_functions 
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
'View listing all public functions. All functions should have search_path = public, pg_temp after migration 66_fix_all_function_search_paths.sql. Created with security_invoker=true for security compliance.';

-- =====================================================
-- Migration Complete
-- =====================================================
-- 
-- Next Steps:
-- 1. Re-run Supabase Database Linter
-- 2. Expected: 0 "Security Definer View" errors
--
-- =====================================================

