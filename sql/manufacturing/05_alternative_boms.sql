-- =============================================
-- Alternative BOMs System
-- نظام BOMs البديلة
-- =============================================

-- جدول BOMs البديلة
CREATE TABLE IF NOT EXISTS bom_alternatives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    primary_bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    alternative_bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 1 CHECK (priority > 0),
    is_default BOOLEAN DEFAULT false,
    
    -- شروط الاستخدام
    min_quantity NUMERIC(18,6),
    max_quantity NUMERIC(18,6),
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    
    -- أسباب البديل
    reason_code VARCHAR(50), -- 'COST', 'AVAILABILITY', 'QUALITY', 'SUPPLIER', 'CUSTOM'
    reason_description TEXT,
    
    -- تكلفة البديل
    cost_difference NUMERIC(18,4) DEFAULT 0,
    cost_difference_pct NUMERIC(5,2) DEFAULT 0,
    
    -- حالة
    is_active BOOLEAN DEFAULT true,
    
    org_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CHECK (primary_bom_id != alternative_bom_id),
    UNIQUE(primary_bom_id, alternative_bom_id)
);

CREATE INDEX IF NOT EXISTS idx_bom_alternatives_primary ON bom_alternatives(primary_bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_alternatives_alt ON bom_alternatives(alternative_bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_alternatives_org ON bom_alternatives(org_id);

COMMENT ON TABLE bom_alternatives IS 'BOMs البديلة - قوائم مواد بديلة لنفس المنتج';

-- جدول قواعد اختيار BOM
CREATE TABLE IF NOT EXISTS bom_selection_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL,
    rule_name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('QUANTITY', 'DATE', 'COST', 'AVAILABILITY', 'SUPPLIER', 'CUSTOM')),
    
    -- شروط القاعدة
    condition_json JSONB NOT NULL, -- شروط ديناميكية
    
    -- أولوية القاعدة
    priority INTEGER NOT NULL DEFAULT 1,
    
    -- حالة
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(org_id, rule_name)
);

CREATE INDEX IF NOT EXISTS idx_bom_selection_rules_org ON bom_selection_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_bom_selection_rules_type ON bom_selection_rules(rule_type);

COMMENT ON TABLE bom_selection_rules IS 'قواعد اختيار BOM البديل';

-- دالة اختيار BOM الأمثل
CREATE OR REPLACE FUNCTION select_optimal_bom(
    p_item_id UUID,
    p_quantity NUMERIC,
    p_order_date DATE DEFAULT CURRENT_DATE,
    p_org_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_selected_bom_id UUID;
    v_primary_bom_id UUID;
    v_alternative_bom_id UUID;
    v_rule bom_selection_rules%ROWTYPE;
    v_condition_met BOOLEAN;
    v_min_cost NUMERIC;
    v_bom_cost NUMERIC;
    v_primary_cost NUMERIC;
BEGIN
    -- البحث عن BOM الأساسي
    SELECT id INTO v_primary_bom_id
    FROM bom_headers
    WHERE item_id = p_item_id
    AND is_active = true
    AND status = 'APPROVED'
    AND (p_org_id IS NULL OR org_id = p_org_id)
    ORDER BY bom_version DESC, effective_date DESC
    LIMIT 1;

    IF v_primary_bom_id IS NULL THEN
        RAISE EXCEPTION 'No active BOM found for item';
    END IF;

    -- حساب تكلفة BOM الأساسي
    SELECT COALESCE(calculate_bom_cost(v_primary_bom_id, p_quantity), 0) INTO v_primary_cost;
    v_min_cost := v_primary_cost;
    v_selected_bom_id := v_primary_bom_id;

    -- البحث عن BOMs بديلة
    FOR v_alternative_bom_id IN
        SELECT alternative_bom_id
        FROM bom_alternatives
        WHERE primary_bom_id = v_primary_bom_id
        AND is_active = true
        AND (p_org_id IS NULL OR org_id = p_org_id)
        AND (min_quantity IS NULL OR p_quantity >= min_quantity)
        AND (max_quantity IS NULL OR p_quantity <= max_quantity)
        AND (effective_from IS NULL OR p_order_date >= effective_from)
        AND (effective_to IS NULL OR p_order_date <= effective_to)
        ORDER BY priority, is_default DESC
    LOOP
        -- التحقق من القواعد
        v_condition_met := true; -- افتراضياً، الشرط محقق
        
        -- تقييم القواعد (مبسط - يمكن تطويره)
        FOR v_rule IN
            SELECT * FROM bom_selection_rules
            WHERE org_id = p_org_id
            AND is_active = true
            ORDER BY priority
        LOOP
            -- تقييم الشرط بناءً على rule_type
            IF v_rule.rule_type = 'COST' THEN
                -- اختيار BOM الأقل تكلفة
                SELECT COALESCE(calculate_bom_cost(v_alternative_bom_id, p_quantity), 0) INTO v_bom_cost;
                
                IF v_bom_cost < v_min_cost THEN
                    v_min_cost := v_bom_cost;
                    v_selected_bom_id := v_alternative_bom_id;
                END IF;
            ELSIF v_rule.rule_type = 'QUANTITY' THEN
                -- التحقق من شروط الكمية
                v_condition_met := true; -- TODO: تقييم condition_json
            ELSE
                v_condition_met := true;
            END IF;
        END LOOP;
        
        -- إذا لم تكن هناك قواعد، استخدم BOM الأقل تكلفة
        IF NOT EXISTS (SELECT 1 FROM bom_selection_rules WHERE org_id = p_org_id AND is_active = true) THEN
            SELECT COALESCE(calculate_bom_cost(v_alternative_bom_id, p_quantity), 0) INTO v_bom_cost;
            
            IF v_bom_cost < v_min_cost THEN
                v_min_cost := v_bom_cost;
                v_selected_bom_id := v_alternative_bom_id;
            END IF;
        END IF;
    END LOOP;

    RETURN v_selected_bom_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION select_optimal_bom IS 'اختيار BOM الأمثل بناءً على القواعد والشروط';

SELECT 'Alternative BOMs schema created successfully' AS status;

