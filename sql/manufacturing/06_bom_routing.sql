-- =============================================
-- BOM Routing & Operations System
-- نظام عمليات التصنيع (Routing) لـ BOM
-- =============================================

-- جدول عمليات BOM (Routing)
CREATE TABLE IF NOT EXISTS bom_operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    operation_sequence INTEGER NOT NULL,
    operation_code VARCHAR(50) NOT NULL,
    operation_name VARCHAR(255) NOT NULL,
    operation_description TEXT,
    
    -- مركز العمل
    work_center_id UUID,
    
    -- الأوقات (بالدقائق)
    setup_time_minutes NUMERIC(10,2) DEFAULT 0 CHECK (setup_time_minutes >= 0),
    run_time_minutes NUMERIC(10,2) DEFAULT 0 CHECK (run_time_minutes >= 0), -- لكل وحدة
    queue_time_minutes NUMERIC(10,2) DEFAULT 0 CHECK (queue_time_minutes >= 0),
    move_time_minutes NUMERIC(10,2) DEFAULT 0 CHECK (move_time_minutes >= 0),
    
    -- التكاليف
    labor_rate NUMERIC(18,6) DEFAULT 0 CHECK (labor_rate >= 0),
    machine_rate NUMERIC(18,6) DEFAULT 0 CHECK (machine_rate >= 0),
    overhead_rate NUMERIC(18,6) DEFAULT 0 CHECK (overhead_rate >= 0),
    
    -- التكاليف المحسوبة
    setup_cost NUMERIC(18,4) GENERATED ALWAYS AS 
        (setup_time_minutes / 60.0 * COALESCE(labor_rate, 0)) STORED,
    run_cost_per_unit NUMERIC(18,4) GENERATED ALWAYS AS 
        (run_time_minutes / 60.0 * COALESCE(labor_rate, 0)) STORED,
    total_cost_per_unit NUMERIC(18,4) GENERATED ALWAYS AS 
        ((setup_time_minutes / 60.0 * COALESCE(labor_rate, 0)) + 
         (run_time_minutes / 60.0 * COALESCE(labor_rate, 0))) STORED,
    
    -- معلومات إضافية
    tooling_required TEXT,
    skill_level_required VARCHAR(50),
    is_critical BOOLEAN DEFAULT false,
    
    -- حالة
    is_active BOOLEAN DEFAULT true,
    
    org_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(bom_id, operation_sequence)
);

CREATE INDEX IF NOT EXISTS idx_bom_operations_bom ON bom_operations(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_operations_wc ON bom_operations(work_center_id);
CREATE INDEX IF NOT EXISTS idx_bom_operations_org ON bom_operations(org_id);

COMMENT ON TABLE bom_operations IS 'عمليات التصنيع لـ BOM (Routing)';

-- جدول ربط العمليات بالمواد
CREATE TABLE IF NOT EXISTS bom_operation_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operation_id UUID NOT NULL REFERENCES bom_operations(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    quantity_required NUMERIC(18,6) NOT NULL CHECK (quantity_required > 0),
    uom VARCHAR(50),
    issue_type VARCHAR(20) DEFAULT 'AUTO' CHECK (issue_type IN ('AUTO', 'MANUAL', 'BACKFLUSH')),
    
    org_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(operation_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_bom_op_materials_op ON bom_operation_materials(operation_id);
CREATE INDEX IF NOT EXISTS idx_bom_op_materials_item ON bom_operation_materials(item_id);
CREATE INDEX IF NOT EXISTS idx_bom_op_materials_org ON bom_operation_materials(org_id);

COMMENT ON TABLE bom_operation_materials IS 'ربط العمليات بالمواد المطلوبة';

-- دالة حساب تكلفة Routing
CREATE OR REPLACE FUNCTION calculate_routing_cost(
    p_bom_id UUID,
    p_quantity NUMERIC DEFAULT 1,
    p_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
    operation_sequence INTEGER,
    operation_code VARCHAR,
    operation_name VARCHAR,
    setup_cost NUMERIC,
    run_cost NUMERIC,
    total_cost NUMERIC,
    total_time_minutes NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        bo.operation_sequence,
        bo.operation_code,
        bo.operation_name,
        bo.setup_cost,
        bo.run_cost_per_unit * p_quantity AS run_cost,
        bo.setup_cost + (bo.run_cost_per_unit * p_quantity) AS total_cost,
        bo.setup_time_minutes + (bo.run_time_minutes * p_quantity) AS total_time_minutes
    FROM bom_operations bo
    WHERE bo.bom_id = p_bom_id
    AND bo.is_active = true
    AND (p_org_id IS NULL OR bo.org_id = p_org_id)
    ORDER BY bo.operation_sequence;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_routing_cost IS 'حساب تكلفة Routing لـ BOM';

-- دالة حساب إجمالي تكلفة Routing
CREATE OR REPLACE FUNCTION calculate_total_routing_cost(
    p_bom_id UUID,
    p_quantity NUMERIC DEFAULT 1,
    p_org_id UUID DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
    v_total_cost NUMERIC := 0;
BEGIN
    SELECT COALESCE(SUM(total_cost), 0)
    INTO v_total_cost
    FROM calculate_routing_cost(p_bom_id, p_quantity, p_org_id);
    
    RETURN v_total_cost;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_total_routing_cost IS 'حساب إجمالي تكلفة Routing';

SELECT 'BOM Routing schema created successfully' AS status;

