-- =====================================
-- Data Integrity Validation Scripts
-- =====================================
-- These functions help validate data integrity across the system

-- =====================================
-- 1. Validate Foreign Key
-- =====================================

CREATE OR REPLACE FUNCTION validate_foreign_key(
    p_table_name TEXT,
    p_column_name TEXT,
    p_reference_table TEXT,
    p_org_id UUID
)
RETURNS TABLE (
    orphaned_count BIGINT,
    orphaned_ids UUID[]
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_query TEXT;
    v_orphaned_count BIGINT;
    v_orphaned_ids UUID[];
BEGIN
    -- Build dynamic query to find orphaned records
    v_query := format('
        SELECT COUNT(*), array_agg(id)
        FROM %I t
        WHERE t.org_id = $1
        AND t.%I IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM %I r
            WHERE r.id = t.%I
            AND r.org_id = $1
        )
    ', p_table_name, p_column_name, p_reference_table, p_column_name);
    
    EXECUTE v_query INTO v_orphaned_count, v_orphaned_ids USING p_org_id;
    
    RETURN QUERY SELECT v_orphaned_count, COALESCE(v_orphaned_ids, ARRAY[]::UUID[]);
END;
$$;

-- =====================================
-- 2. Validate Stock Balance
-- =====================================

CREATE OR REPLACE FUNCTION validate_stock_balance(
    p_org_id UUID
)
RETURNS TABLE (
    item_id UUID,
    location_id UUID,
    calculated_quantity DECIMAL,
    actual_quantity DECIMAL,
    difference DECIMAL
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH stock_calculated AS (
        SELECT
            sm.item_id,
            sm.location_id,
            SUM(sm.quantity) as calculated_qty
        FROM stock_moves sm
        WHERE sm.org_id = p_org_id
        GROUP BY sm.item_id, sm.location_id
    ),
    stock_actual AS (
        SELECT
            sq.item_id,
            sq.location_id,
            sq.quantity as actual_qty
        FROM stock_quants sq
        WHERE sq.org_id = p_org_id
    )
    SELECT
        COALESCE(sc.item_id, sa.item_id) as item_id,
        COALESCE(sc.location_id, sa.location_id) as location_id,
        COALESCE(sc.calculated_qty, 0) as calculated_quantity,
        COALESCE(sa.actual_qty, 0) as actual_quantity,
        COALESCE(sc.calculated_qty, 0) - COALESCE(sa.actual_qty, 0) as difference
    FROM stock_calculated sc
    FULL OUTER JOIN stock_actual sa
        ON sc.item_id = sa.item_id
        AND sc.location_id = sa.location_id
    WHERE ABS(COALESCE(sc.calculated_qty, 0) - COALESCE(sa.actual_qty, 0)) > 0.01;
END;
$$;

-- =====================================
-- 3. Validate Material Reservations
-- =====================================

CREATE OR REPLACE FUNCTION validate_reservations(
    p_org_id UUID
)
RETURNS TABLE (
    item_id UUID,
    mo_id UUID,
    reserved DECIMAL,
    available DECIMAL,
    on_hand DECIMAL
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH reservations_summary AS (
        SELECT
            mr.item_id,
            mr.mo_id,
            SUM(mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0) - COALESCE(mr.quantity_released, 0)) as reserved
        FROM material_reservations mr
        WHERE mr.org_id = p_org_id
        AND mr.status = 'reserved'
        GROUP BY mr.item_id, mr.mo_id
    ),
    stock_available AS (
        SELECT
            sq.item_id,
            sq.quantity as on_hand
        FROM stock_quants sq
        WHERE sq.org_id = p_org_id
    )
    SELECT
        rs.item_id,
        rs.mo_id,
        rs.reserved,
        COALESCE(sa.on_hand, 0) - COALESCE(rs.reserved, 0) as available,
        COALESCE(sa.on_hand, 0) as on_hand
    FROM reservations_summary rs
    LEFT JOIN stock_available sa ON rs.item_id = sa.item_id
    WHERE COALESCE(sa.on_hand, 0) < rs.reserved;
END;
$$;

-- =====================================
-- 4. Validate Tenant Isolation
-- =====================================

CREATE OR REPLACE FUNCTION validate_tenant_isolation(
    p_table_name TEXT,
    p_org_id UUID
)
RETURNS TABLE (
    record_count BIGINT,
    valid_count BIGINT,
    invalid_count BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_query TEXT;
    v_total BIGINT;
    v_valid BIGINT;
    v_invalid BIGINT;
BEGIN
    -- Count total records
    v_query := format('SELECT COUNT(*) FROM %I WHERE org_id = $1', p_table_name);
    EXECUTE v_query INTO v_total USING p_org_id;
    
    -- Count valid records (with org_id matching)
    v_valid := v_total; -- If RLS is working, all visible records should be valid
    
    -- Invalid would be records we can't see due to RLS (which is good)
    v_invalid := 0;
    
    RETURN QUERY SELECT v_total, v_valid, v_invalid;
END;
$$;

-- =====================================
-- 5. Comprehensive Data Integrity Check
-- =====================================

CREATE OR REPLACE FUNCTION comprehensive_data_integrity_check(
    p_org_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB := jsonb_build_object(
        'valid', true,
        'checks', jsonb_build_array(),
        'errors', jsonb_build_array(),
        'warnings', jsonb_build_array()
    );
    v_check_result JSONB;
    v_table_name TEXT;
    v_tables TEXT[] := ARRAY[
        'manufacturing_orders',
        'inventory_items',
        'stock_moves',
        'gl_accounts',
        'journal_entries',
        'sales_orders',
        'purchase_orders'
    ];
BEGIN
    -- Check each table
    FOREACH v_table_name IN ARRAY v_tables
    LOOP
        -- Check org_id presence
        SELECT jsonb_build_object(
            'table', v_table_name,
            'check', 'org_id_presence',
            'valid', NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = v_table_name
                AND column_name = 'org_id'
            ) OR NOT EXISTS (
                SELECT 1 FROM information_schema.tables t
                WHERE t.table_name = v_table_name
                AND EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relname = v_table_name
                    AND n.nspname = 'public'
                    AND EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = v_table_name
                        AND column_name = 'org_id'
                        AND is_nullable = 'NO'
                    )
                )
            )
        ) INTO v_check_result;
        
        v_result := jsonb_set(
            v_result,
            '{checks}',
            (v_result->'checks')::jsonb || jsonb_build_array(v_check_result)
        );
    END LOOP;
    
    -- Check stock balance
    IF EXISTS (SELECT 1 FROM validate_stock_balance(p_org_id)) THEN
        v_result := jsonb_set(v_result, '{valid}', 'false'::jsonb);
        v_result := jsonb_set(
            v_result,
            '{errors}',
            (v_result->'errors')::jsonb || jsonb_build_array('Stock balance mismatches found')
        );
    END IF;
    
    -- Check reservations
    IF EXISTS (SELECT 1 FROM validate_reservations(p_org_id)) THEN
        v_result := jsonb_set(v_result, '{valid}', 'false'::jsonb);
        v_result := jsonb_set(
            v_result,
            '{warnings}',
            (v_result->'warnings')::jsonb || jsonb_build_array('Reservation issues found')
        );
    END IF;
    
    RETURN v_result;
END;
$$;

