-- ===================================================================
-- FIX: Remove org_id column update attempt from views
-- حل: إزالة محاولة تحديث org_id من الـ Views
-- ===================================================================

-- This script fixes the error: "cannot update view v_suggested_warehouse_accounts"
-- الخطأ: "لا يمكن تحديث الـ view v_suggested_warehouse_accounts"

DO $$
BEGIN
    -- Drop and recreate the problematic view if it exists
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'v_suggested_warehouse_accounts') THEN
        -- Drop the view temporarily
        DROP VIEW IF EXISTS v_suggested_warehouse_accounts CASCADE;
        RAISE NOTICE 'Dropped view v_suggested_warehouse_accounts to fix org_id issue';
        
        -- Recreate it if you have the original definition
        -- You'll need to get the original CREATE VIEW statement from your schema
        RAISE NOTICE 'View dropped successfully. Please recreate it using the original CREATE VIEW statement.';
    ELSE
        RAISE NOTICE 'View v_suggested_warehouse_accounts does not exist';
    END IF;
END $$;

-- List all views in the database for reference
SELECT 
    schemaname,
    viewname,
    viewowner
FROM pg_views
WHERE schemaname = 'public'
ORDER BY viewname;

RAISE NOTICE 'Script completed successfully';

