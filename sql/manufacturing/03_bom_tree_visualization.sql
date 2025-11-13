-- =============================================
-- BOM Tree Visualization Support
-- دعم عرض شجرة BOM متعددة المستويات
-- =============================================

-- جدول لحفظ شجرة BOM المحسوبة (للأداء)
CREATE TABLE IF NOT EXISTS bom_tree_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES bom_tree_cache(id),
    item_id UUID NOT NULL,
    level_number INTEGER NOT NULL CHECK (level_number >= 0),
    quantity_required NUMERIC(18,6) NOT NULL,
    cumulative_quantity NUMERIC(18,6) NOT NULL,
    unit_cost NUMERIC(18,4) DEFAULT 0,
    total_cost NUMERIC(18,4) DEFAULT 0,
    is_critical BOOLEAN DEFAULT false,
    scrap_factor NUMERIC(5,2) DEFAULT 0,
    line_type VARCHAR(20) DEFAULT 'COMPONENT',
    path TEXT, -- Materialized path for quick queries
    org_id UUID NOT NULL,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    UNIQUE(bom_id, item_id, parent_id, level_number)
);

CREATE INDEX IF NOT EXISTS idx_bom_tree_cache_bom ON bom_tree_cache(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_tree_cache_parent ON bom_tree_cache(parent_id);
CREATE INDEX IF NOT EXISTS idx_bom_tree_cache_path ON bom_tree_cache(path);
CREATE INDEX IF NOT EXISTS idx_bom_tree_cache_org ON bom_tree_cache(org_id);

COMMENT ON TABLE bom_tree_cache IS 'ذاكرة مؤقتة لشجرة BOM متعددة المستويات مع المسار المادي';

-- دالة لبناء شجرة BOM كاملة مع المسارات
CREATE OR REPLACE FUNCTION build_bom_tree(
    p_bom_id UUID,
    p_quantity NUMERIC DEFAULT 1,
    p_org_id UUID DEFAULT NULL,
    p_force_rebuild BOOLEAN DEFAULT false
)
RETURNS TABLE (
    id UUID,
    parent_id UUID,
    item_id UUID,
    item_code VARCHAR,
    item_name VARCHAR,
    level_number INTEGER,
    quantity_required NUMERIC,
    cumulative_quantity NUMERIC,
    unit_cost NUMERIC,
    total_cost NUMERIC,
    is_critical BOOLEAN,
    scrap_factor NUMERIC,
    line_type VARCHAR,
    path TEXT,
    has_children BOOLEAN
) AS $$
DECLARE
    v_cache_expiry INTERVAL := INTERVAL '1 hour';
    v_cached_count INTEGER;
    items_table_exists BOOLEAN;
    products_table_exists BOOLEAN;
BEGIN
    -- التحقق من وجود الجداول
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'items'
    ) INTO items_table_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'products'
    ) INTO products_table_exists;

    -- التحقق من وجود cache صالح
    IF NOT p_force_rebuild THEN
        SELECT COUNT(*) INTO v_cached_count
        FROM bom_tree_cache
        WHERE bom_id = p_bom_id
        AND (p_org_id IS NULL OR org_id = p_org_id)
        AND (expires_at IS NULL OR expires_at > NOW());
        
        IF v_cached_count > 0 THEN
            -- إرجاع البيانات من cache
            IF items_table_exists THEN
                RETURN QUERY
                SELECT 
                    c.id,
                    c.parent_id,
                    c.item_id,
                    COALESCE(i.code, i.item_code)::VARCHAR AS item_code,
                    COALESCE(i.name, i.item_name)::VARCHAR AS item_name,
                    c.level_number,
                    c.quantity_required,
                    c.cumulative_quantity,
                    c.unit_cost,
                    c.total_cost,
                    c.is_critical,
                    c.scrap_factor,
                    c.line_type,
                    c.path,
                    EXISTS(
                        SELECT 1 FROM bom_tree_cache child 
                        WHERE child.parent_id = c.id
                    ) AS has_children
                FROM bom_tree_cache c
                LEFT JOIN items i ON i.id = c.item_id
                WHERE c.bom_id = p_bom_id
                AND (p_org_id IS NULL OR c.org_id = p_org_id)
                AND (c.expires_at IS NULL OR c.expires_at > NOW())
                ORDER BY c.level_number, c.path;
            ELSIF products_table_exists THEN
                RETURN QUERY
                SELECT 
                    c.id,
                    c.parent_id,
                    c.item_id,
                    COALESCE(p.code, p.product_code)::VARCHAR AS item_code,
                    COALESCE(p.name, p.product_name)::VARCHAR AS item_name,
                    c.level_number,
                    c.quantity_required,
                    c.cumulative_quantity,
                    c.unit_cost,
                    c.total_cost,
                    c.is_critical,
                    c.scrap_factor,
                    c.line_type,
                    c.path,
                    EXISTS(
                        SELECT 1 FROM bom_tree_cache child 
                        WHERE child.parent_id = c.id
                    ) AS has_children
                FROM bom_tree_cache c
                LEFT JOIN products p ON p.id = c.item_id
                WHERE c.bom_id = p_bom_id
                AND (p_org_id IS NULL OR c.org_id = p_org_id)
                AND (c.expires_at IS NULL OR c.expires_at > NOW())
                ORDER BY c.level_number, c.path;
            END IF;
            
            RETURN;
        END IF;
    END IF;

    -- بناء شجرة جديدة
    IF items_table_exists THEN
        WITH RECURSIVE bom_tree AS (
            -- الجذر (المنتج النهائي)
            SELECT 
                0 AS level,
                bh.item_id,
                NULL::UUID AS parent_item_id,
                p_quantity AS qty_required,
                p_quantity AS cumulative_qty,
                false AS is_critical,
                0 AS scrap_factor,
                'COMPONENT'::VARCHAR AS line_type,
                bh.id AS bom_id,
                '/' || bh.item_id::TEXT AS path
            FROM bom_headers bh
            WHERE bh.id = p_bom_id
            AND (p_org_id IS NULL OR bh.org_id = p_org_id)
            
            UNION ALL
            
            -- المستويات الفرعية
            SELECT 
                bt.level + 1,
                bl.item_id,
                bt.item_id AS parent_item_id,
                bt.qty_required * bl.quantity * (1 + COALESCE(bl.scrap_factor, 0)/100) AS qty_required,
                bt.cumulative_qty * bl.quantity * (1 + COALESCE(bl.scrap_factor, 0)/100) AS cumulative_qty,
                COALESCE(bl.is_critical, false) AS is_critical,
                COALESCE(bl.scrap_factor, 0) AS scrap_factor,
                COALESCE(bl.line_type, 'COMPONENT')::VARCHAR AS line_type,
                COALESCE(sub_bh.id, bt.bom_id) AS bom_id,
                bt.path || '/' || bl.item_id::TEXT AS path
            FROM bom_tree bt
            JOIN bom_lines bl ON bl.bom_id = bt.bom_id
            LEFT JOIN bom_headers sub_bh ON sub_bh.item_id = bl.item_id 
                AND sub_bh.is_active = true
                AND (p_org_id IS NULL OR sub_bh.org_id = p_org_id)
            WHERE bt.level < 20
            AND bl.line_type != 'REFERENCE'
        )
        INSERT INTO bom_tree_cache (
            bom_id, parent_id, item_id, level_number, 
            quantity_required, cumulative_quantity, 
            unit_cost, total_cost, is_critical, scrap_factor, 
            line_type, path, org_id, expires_at
        )
        SELECT DISTINCT ON (bt.item_id, bt.path)
            p_bom_id,
            NULL, -- سيتم تحديثه لاحقاً
            bt.item_id,
            bt.level,
            bt.qty_required,
            bt.cumulative_qty,
            COALESCE(i.unit_cost, i.standard_cost, 0) AS unit_cost,
            bt.cumulative_qty * COALESCE(i.unit_cost, i.standard_cost, 0) AS total_cost,
            bt.is_critical,
            bt.scrap_factor,
            bt.line_type,
            bt.path,
            COALESCE(p_org_id, (SELECT org_id FROM bom_headers WHERE id = p_bom_id)),
            NOW() + v_cache_expiry
        FROM bom_tree bt
        LEFT JOIN items i ON i.id = bt.item_id
        ORDER BY bt.item_id, bt.path, bt.level;
    END IF;

    -- تحديث parent_id
    UPDATE bom_tree_cache c1
    SET parent_id = c2.id
    FROM bom_tree_cache c2
    WHERE c1.bom_id = p_bom_id
    AND c1.path LIKE c2.path || '/%'
    AND c1.level_number = c2.level_number + 1
    AND (p_org_id IS NULL OR c1.org_id = p_org_id);

    -- إرجاع النتيجة
    IF items_table_exists THEN
        RETURN QUERY
        SELECT 
            c.id,
            c.parent_id,
            c.item_id,
            COALESCE(i.code, i.item_code)::VARCHAR AS item_code,
            COALESCE(i.name, i.item_name)::VARCHAR AS item_name,
            c.level_number,
            c.quantity_required,
            c.cumulative_quantity,
            c.unit_cost,
            c.total_cost,
            c.is_critical,
            c.scrap_factor,
            c.line_type,
            c.path,
            EXISTS(
                SELECT 1 FROM bom_tree_cache child 
                WHERE child.parent_id = c.id
            ) AS has_children
        FROM bom_tree_cache c
        LEFT JOIN items i ON i.id = c.item_id
        WHERE c.bom_id = p_bom_id
        AND (p_org_id IS NULL OR c.org_id = p_org_id)
        ORDER BY c.level_number, c.path;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION build_bom_tree IS 'بناء شجرة BOM كاملة مع دعم التخزين المؤقت والمسارات المادية';

-- دالة لمسح cache قديم
CREATE OR REPLACE FUNCTION cleanup_bom_tree_cache()
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM bom_tree_cache
    WHERE expires_at IS NOT NULL 
    AND expires_at < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_bom_tree_cache IS 'مسح cache BOM المنتهي الصلاحية';

-- جدول إعدادات BOM
CREATE TABLE IF NOT EXISTS bom_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    setting_type VARCHAR(20) DEFAULT 'string' CHECK (setting_type IN ('string', 'number', 'boolean', 'json')),
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID,
    
    UNIQUE(org_id, setting_key)
);

CREATE INDEX IF NOT EXISTS idx_bom_settings_org ON bom_settings(org_id);

COMMENT ON TABLE bom_settings IS 'إعدادات BOM لكل منظمة';

-- إدراج إعدادات افتراضية (سيتم إدراجها عند الحاجة)
-- يتم إدراجها ديناميكياً في التطبيق

SELECT 'BOM Tree Visualization schema created successfully' AS status;

