-- Fix missing warehouse_id in existing stock adjustment items
-- This will set warehouse_id to the first available warehouse for the organization

DO $$
DECLARE
    default_warehouse_id UUID;
    org_uuid UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- Get first warehouse for the organization
    SELECT id INTO default_warehouse_id
    FROM warehouses
    WHERE org_id = org_uuid
    LIMIT 1;

    -- Update stock_adjustment_items that have NULL warehouse_id
    IF default_warehouse_id IS NOT NULL THEN
        UPDATE stock_adjustment_items
        SET warehouse_id = default_warehouse_id
        WHERE warehouse_id IS NULL
        AND organization_id = org_uuid;
        
        RAISE NOTICE 'Updated % items with warehouse_id: %', 
            (SELECT COUNT(*) FROM stock_adjustment_items WHERE warehouse_id = default_warehouse_id),
            default_warehouse_id;
    ELSE
        RAISE NOTICE 'No warehouse found for organization';
    END IF;
END $$;

-- Verify the update
SELECT 
    COUNT(*) as total_items,
    COUNT(warehouse_id) as items_with_warehouse,
    COUNT(*) - COUNT(warehouse_id) as items_without_warehouse
FROM stock_adjustment_items;
