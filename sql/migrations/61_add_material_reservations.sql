-- =====================================
-- Material Reservations System
-- =====================================
-- This migration creates the material reservations table
-- to track reserved materials for manufacturing orders

BEGIN;

-- =====================================
-- 1. Create material_reservations table
-- =====================================

CREATE TABLE IF NOT EXISTS material_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL, -- References inventory_items or products
    quantity_reserved DECIMAL(18,6) NOT NULL CHECK (quantity_reserved > 0),
    quantity_consumed DECIMAL(18,6) DEFAULT 0 CHECK (quantity_consumed >= 0),
    quantity_released DECIMAL(18,6) DEFAULT 0 CHECK (quantity_released >= 0),
    status VARCHAR(50) NOT NULL DEFAULT 'reserved' CHECK (
        status IN ('reserved', 'consumed', 'released', 'expired', 'cancelled')
    ),
    reserved_at TIMESTAMPTZ DEFAULT NOW(),
    consumed_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT quantity_check CHECK (
        quantity_consumed + quantity_released <= quantity_reserved
    )
);

-- =====================================
-- 2. Create indexes
-- =====================================

CREATE INDEX idx_material_reservations_org_id ON material_reservations(org_id);
CREATE INDEX idx_material_reservations_mo_id ON material_reservations(mo_id);
CREATE INDEX idx_material_reservations_item_id ON material_reservations(item_id);
CREATE INDEX idx_material_reservations_status ON material_reservations(status);
CREATE INDEX idx_material_reservations_org_mo ON material_reservations(org_id, mo_id);
CREATE INDEX idx_material_reservations_expires ON material_reservations(expires_at) WHERE expires_at IS NOT NULL;

-- =====================================
-- 3. Enable RLS
-- =====================================

ALTER TABLE material_reservations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "material_reservations_select" ON material_reservations;
DROP POLICY IF EXISTS "material_reservations_insert" ON material_reservations;
DROP POLICY IF EXISTS "material_reservations_update" ON material_reservations;
DROP POLICY IF EXISTS "material_reservations_delete" ON material_reservations;

-- SELECT policy
CREATE POLICY "material_reservations_select" ON material_reservations
    FOR SELECT USING (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- INSERT policy
CREATE POLICY "material_reservations_insert" ON material_reservations
    FOR INSERT WITH CHECK (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- UPDATE policy
CREATE POLICY "material_reservations_update" ON material_reservations
    FOR UPDATE USING (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- DELETE policy (usually not allowed, but for cleanup)
CREATE POLICY "material_reservations_delete" ON material_reservations
    FOR DELETE USING (
        org_id = auth_org_id()
        AND status IN ('released', 'expired', 'cancelled')
        OR is_super_admin()
    );

-- =====================================
-- 4. Create helper functions
-- =====================================

-- Function to get available quantity (on_hand - reserved)
CREATE OR REPLACE FUNCTION get_available_quantity(
    p_org_id UUID,
    p_item_id UUID,
    p_location_id UUID DEFAULT NULL
)
RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_on_hand DECIMAL := 0;
    v_reserved DECIMAL := 0;
BEGIN
    -- Get on-hand quantity
    SELECT COALESCE(SUM(quantity), 0) INTO v_on_hand
    FROM stock_quants
    WHERE org_id = p_org_id
    AND item_id = p_item_id
    AND (p_location_id IS NULL OR location_id = p_location_id);
    
    -- Get reserved quantity
    SELECT COALESCE(SUM(quantity_reserved - quantity_consumed - quantity_released), 0) INTO v_reserved
    FROM material_reservations
    WHERE org_id = p_org_id
    AND item_id = p_item_id
    AND status = 'reserved';
    
    RETURN GREATEST(0, v_on_hand - v_reserved);
END;
$$;

-- Function to check if materials are available
CREATE OR REPLACE FUNCTION check_materials_availability(
    p_org_id UUID,
    p_materials JSONB[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_material JSONB;
    v_required DECIMAL;
    v_available DECIMAL;
    v_result JSONB := jsonb_build_object('available', true, 'items', jsonb_build_array());
    v_item_result JSONB;
BEGIN
    FOREACH v_material IN ARRAY p_materials
    LOOP
        v_required := (v_material->>'quantity')::DECIMAL;
        v_available := get_available_quantity(
            p_org_id,
            (v_material->>'item_id')::UUID,
            (v_material->>'location_id')::UUID
        );
        
        v_item_result := jsonb_build_object(
            'item_id', v_material->>'item_id',
            'required', v_required,
            'available', v_available,
            'sufficient', v_available >= v_required
        );
        
        v_result := jsonb_set(
            v_result,
            '{items}',
            (v_result->'items')::jsonb || jsonb_build_array(v_item_result)
        );
        
        IF v_available < v_required THEN
            v_result := jsonb_set(v_result, '{available}', 'false'::jsonb);
        END IF;
    END LOOP;
    
    RETURN v_result;
END;
$$;

-- Function to release expired reservations
CREATE OR REPLACE FUNCTION release_expired_reservations(
    p_org_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE material_reservations
    SET status = 'expired',
        released_at = NOW(),
        quantity_released = quantity_reserved - quantity_consumed,
        updated_at = NOW()
    WHERE status = 'reserved'
    AND expires_at IS NOT NULL
    AND expires_at < NOW()
    AND (p_org_id IS NULL OR org_id = p_org_id);
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN v_count;
END;
$$;

-- =====================================
-- 5. Create trigger to update updated_at
-- =====================================

CREATE OR REPLACE FUNCTION update_material_reservations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS material_reservations_updated_at ON material_reservations;
CREATE TRIGGER material_reservations_updated_at
    BEFORE UPDATE ON material_reservations
    FOR EACH ROW
    EXECUTE FUNCTION update_material_reservations_updated_at();

-- Log success message
DO $$
BEGIN
    RAISE NOTICE 'Material reservations table created successfully.';
END $$;

COMMIT;

