-- =============================================
-- BOM Costing Enhancement System
-- نظام تحسين حساب تكلفة BOM
-- =============================================

-- جدول تحليل تكلفة BOM
CREATE TABLE IF NOT EXISTS bom_cost_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
    quantity NUMERIC(18,6) NOT NULL DEFAULT 1,
    
    -- التكاليف المعيارية
    standard_material_cost NUMERIC(18,4) DEFAULT 0,
    standard_labor_cost NUMERIC(18,4) DEFAULT 0,
    standard_overhead_cost NUMERIC(18,4) DEFAULT 0,
    standard_total_cost NUMERIC(18,4) DEFAULT 0,
    standard_unit_cost NUMERIC(18,6) DEFAULT 0,
    
    -- التكاليف الفعلية
    actual_material_cost NUMERIC(18,4) DEFAULT 0,
    actual_labor_cost NUMERIC(18,4) DEFAULT 0,
    actual_overhead_cost NUMERIC(18,4) DEFAULT 0,
    actual_total_cost NUMERIC(18,4) DEFAULT 0,
    actual_unit_cost NUMERIC(18,6) DEFAULT 0,
    
    -- التباينات
    material_variance NUMERIC(18,4) GENERATED ALWAYS AS 
        (actual_material_cost - standard_material_cost) STORED,
    labor_variance NUMERIC(18,4) GENERATED ALWAYS AS 
        (actual_labor_cost - standard_labor_cost) STORED,
    overhead_variance NUMERIC(18,4) GENERATED ALWAYS AS 
        (actual_overhead_cost - standard_overhead_cost) STORED,
    total_variance NUMERIC(18,4) GENERATED ALWAYS AS 
        (actual_total_cost - standard_total_cost) STORED,
    
    -- نسب التباين
    material_variance_pct NUMERIC(5,2) GENERATED ALWAYS AS 
        (CASE WHEN standard_material_cost > 0 
            THEN ((actual_material_cost - standard_material_cost) / standard_material_cost * 100)
            ELSE 0 END) STORED,
    labor_variance_pct NUMERIC(5,2) GENERATED ALWAYS AS 
        (CASE WHEN standard_labor_cost > 0 
            THEN ((actual_labor_cost - standard_labor_cost) / standard_labor_cost * 100)
            ELSE 0 END) STORED,
    
    -- حالة التحليل
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'ARCHIVED')),
    notes TEXT,
    
    org_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID,
    
    UNIQUE(bom_id, analysis_date, quantity)
);

CREATE INDEX IF NOT EXISTS idx_bom_cost_analysis_bom ON bom_cost_analysis(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_cost_analysis_date ON bom_cost_analysis(analysis_date);
CREATE INDEX IF NOT EXISTS idx_bom_cost_analysis_org ON bom_cost_analysis(org_id);

COMMENT ON TABLE bom_cost_analysis IS 'تحليل تكلفة BOM - مقارنة المعياري vs الفعلي';

-- جدول تفاصيل تكلفة BOM (لكل مكون)
CREATE TABLE IF NOT EXISTS bom_cost_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cost_analysis_id UUID NOT NULL REFERENCES bom_cost_analysis(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    level_number INTEGER NOT NULL,
    quantity_required NUMERIC(18,6) NOT NULL,
    
    -- تكاليف معيارية
    standard_unit_cost NUMERIC(18,4) DEFAULT 0,
    standard_total_cost NUMERIC(18,4) DEFAULT 0,
    
    -- تكاليف فعلية
    actual_unit_cost NUMERIC(18,4) DEFAULT 0,
    actual_total_cost NUMERIC(18,4) DEFAULT 0,
    
    -- تباين
    variance NUMERIC(18,4) GENERATED ALWAYS AS 
        (actual_total_cost - standard_total_cost) STORED,
    variance_pct NUMERIC(5,2) GENERATED ALWAYS AS 
        (CASE WHEN standard_total_cost > 0 
            THEN ((actual_total_cost - standard_total_cost) / standard_total_cost * 100)
            ELSE 0 END) STORED,
    
    org_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_cost_details_analysis ON bom_cost_details(cost_analysis_id);
CREATE INDEX IF NOT EXISTS idx_bom_cost_details_item ON bom_cost_details(item_id);

COMMENT ON TABLE bom_cost_details IS 'تفاصيل تكلفة كل مكون في BOM';

-- دالة حساب التكلفة المعيارية لـ BOM
CREATE OR REPLACE FUNCTION calculate_bom_standard_cost(
    p_bom_id UUID,
    p_quantity NUMERIC DEFAULT 1,
    p_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
    material_cost NUMERIC,
    labor_cost NUMERIC,
    overhead_cost NUMERIC,
    total_cost NUMERIC,
    unit_cost NUMERIC
) AS $$
DECLARE
    v_material_cost NUMERIC := 0;
    v_labor_cost NUMERIC := 0;
    v_overhead_cost NUMERIC := 0;
    v_total_cost NUMERIC := 0;
    items_table_exists BOOLEAN;
    products_table_exists BOOLEAN;
BEGIN
    -- تحديد الجدول المستخدم
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'items'
    ) INTO items_table_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'products'
    ) INTO products_table_exists;

    -- حساب تكلفة المواد
    IF items_table_exists THEN
        SELECT COALESCE(SUM(
            eb.quantity_required * 
            COALESCE(i.standard_cost, i.unit_cost, 0)
        ), 0)
        INTO v_material_cost
        FROM explode_bom(p_bom_id, p_quantity, p_org_id) eb
        LEFT JOIN items i ON i.id = eb.item_id
        WHERE eb.line_type = 'COMPONENT';
    ELSIF products_table_exists THEN
        SELECT COALESCE(SUM(
            eb.quantity_required * 
            COALESCE(p.standard_cost, p.unit_cost, 0)
        ), 0)
        INTO v_material_cost
        FROM explode_bom(p_bom_id, p_quantity, p_org_id) eb
        LEFT JOIN products p ON p.id = eb.item_id
        WHERE eb.line_type = 'COMPONENT';
    END IF;

    -- حساب تكلفة العمالة (من routing إذا كان موجوداً)
    SELECT COALESCE(SUM(
        bo.setup_time_minutes / 60.0 * COALESCE(bo.labor_rate, 0) +
        bo.run_time_minutes / 60.0 * COALESCE(bo.labor_rate, 0) * p_quantity
    ), 0)
    INTO v_labor_cost
    FROM bom_operations bo
    WHERE bo.bom_id = p_bom_id
    AND bo.is_active = true
    AND (p_org_id IS NULL OR bo.org_id = p_org_id);

    -- حساب التكاليف غير المباشرة (نسبة من العمالة)
    SELECT COALESCE(v_labor_cost * 0.15, 0) INTO v_overhead_cost; -- 15% افتراضي

    -- التكلفة الإجمالية
    v_total_cost := v_material_cost + v_labor_cost + v_overhead_cost;

    RETURN QUERY SELECT 
        v_material_cost,
        v_labor_cost,
        v_overhead_cost,
        v_total_cost,
        CASE WHEN p_quantity > 0 THEN v_total_cost / p_quantity ELSE 0 END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_bom_standard_cost IS 'حساب التكلفة المعيارية لـ BOM (مواد + عمالة + تكاليف غير مباشرة)';

-- دالة مقارنة التكاليف
CREATE OR REPLACE FUNCTION compare_bom_costs(
    p_bom_id UUID,
    p_quantity NUMERIC DEFAULT 1,
    p_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
    cost_type VARCHAR,
    standard_cost NUMERIC,
    actual_cost NUMERIC,
    variance NUMERIC,
    variance_pct NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH standard AS (
        SELECT * FROM calculate_bom_standard_cost(p_bom_id, p_quantity, p_org_id)
    ),
    actual AS (
        SELECT 
            COALESCE(SUM(material_cost), 0) AS material_cost,
            COALESCE(SUM(labor_cost), 0) AS labor_cost,
            COALESCE(SUM(overhead_cost), 0) AS overhead_cost
        FROM (
            SELECT 
                actual_material_cost AS material_cost,
                actual_labor_cost AS labor_cost,
                actual_overhead_cost AS overhead_cost
            FROM bom_cost_analysis bca
            WHERE bca.bom_id = p_bom_id
            AND (p_org_id IS NULL OR bca.org_id = p_org_id)
            AND bca.status = 'APPROVED'
            ORDER BY bca.analysis_date DESC
            LIMIT 1
        ) latest
    )
    SELECT 
        'Material'::VARCHAR,
        s.material_cost,
        COALESCE(a.material_cost, 0),
        COALESCE(a.material_cost, 0) - s.material_cost,
        CASE WHEN s.material_cost > 0 
            THEN ((COALESCE(a.material_cost, 0) - s.material_cost) / s.material_cost * 100)
            ELSE 0 END
    FROM standard s
    CROSS JOIN actual a
    
    UNION ALL
    
    SELECT 
        'Labor'::VARCHAR,
        s.labor_cost,
        COALESCE(a.labor_cost, 0),
        COALESCE(a.labor_cost, 0) - s.labor_cost,
        CASE WHEN s.labor_cost > 0 
            THEN ((COALESCE(a.labor_cost, 0) - s.labor_cost) / s.labor_cost * 100)
            ELSE 0 END
    FROM standard s
    CROSS JOIN actual a
    
    UNION ALL
    
    SELECT 
        'Overhead'::VARCHAR,
        s.overhead_cost,
        COALESCE(a.overhead_cost, 0),
        COALESCE(a.overhead_cost, 0) - s.overhead_cost,
        CASE WHEN s.overhead_cost > 0 
            THEN ((COALESCE(a.overhead_cost, 0) - s.overhead_cost) / s.overhead_cost * 100)
            ELSE 0 END
    FROM standard s
    CROSS JOIN actual a;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compare_bom_costs IS 'مقارنة التكاليف المعيارية vs الفعلية لـ BOM';

SELECT 'BOM Costing Enhancement schema created successfully' AS status;

