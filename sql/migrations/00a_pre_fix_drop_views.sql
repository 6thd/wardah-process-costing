-- ===================================================================
-- PRE-FIX: Drop problematic views before running schema fixes
-- إسقاط الـ Views المشكلة قبل تشغيل إصلاحات الـ Schema
-- ===================================================================
-- Run this BEFORE running 00_critical_schema_fixes.sql
-- شغّل هذا قبل تشغيل 00_critical_schema_fixes.sql
-- ===================================================================

DO $$
DECLARE
    view_rec RECORD;
BEGIN
    RAISE NOTICE 'Starting to drop problematic views...';
    
    -- Drop known problematic views
    FOR view_rec IN 
        SELECT viewname 
        FROM pg_views 
        WHERE schemaname = 'public'
        AND viewname LIKE '%warehouse%' OR viewname LIKE '%suggested%'
    LOOP
        EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', view_rec.viewname);
        RAISE NOTICE 'Dropped view: %', view_rec.viewname;
    END LOOP;
    
    -- Also drop v_suggested_warehouse_accounts specifically
    DROP VIEW IF EXISTS v_suggested_warehouse_accounts CASCADE;
    RAISE NOTICE 'Dropped view: v_suggested_warehouse_accounts (if existed)';
    
    RAISE NOTICE 'Completed dropping problematic views';
    RAISE NOTICE 'You can now run 00_critical_schema_fixes.sql safely';
END $$;

-- List remaining views for reference
SELECT 
    schemaname,
    viewname,
    viewowner
FROM pg_views
WHERE schemaname = 'public'
ORDER BY viewname;

