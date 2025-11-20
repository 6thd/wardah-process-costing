-- ===================================================================
-- EQUIVALENT UNITS EXTENSION FOR PROCESS COSTING
-- Adding equivalent units calculation capabilities to existing schema
-- ===================================================================

-- ===================================================================
-- EQUIVALENT UNITS CALCULATION TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.equivalent_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id UUID NOT NULL REFERENCES public.manufacturing_orders(id),
  stage_no INTEGER NOT NULL,
  calculation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Physical flow quantities
  beginning_wip_units NUMERIC(18,6) DEFAULT 0 CHECK (beginning_wip_units >= 0),
  units_started NUMERIC(18,6) DEFAULT 0 CHECK (units_started >= 0),
  units_completed NUMERIC(18,6) DEFAULT 0 CHECK (units_completed >= 0),
  ending_wip_units NUMERIC(18,6) DEFAULT 0 CHECK (ending_wip_units >= 0),
  
  -- Completion percentages
  material_completion_percentage NUMERIC(5,2) DEFAULT 100 CHECK (material_completion_percentage BETWEEN 0 AND 100),
  conversion_completion_percentage NUMERIC(5,2) DEFAULT 100 CHECK (conversion_completion_percentage BETWEEN 0 AND 100),
  
  -- Calculated equivalent units (using generated columns)
  equivalent_units_material NUMERIC(18,6) GENERATED ALWAYS AS (
    units_completed + (ending_wip_units * material_completion_percentage / 100)
  ) STORED,
  
  equivalent_units_conversion NUMERIC(18,6) GENERATED ALWAYS AS (
    units_completed + (ending_wip_units * conversion_completion_percentage / 100)
  ) STORED,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  
  UNIQUE(tenant_id, mo_id, stage_no, calculation_date)
);

CREATE INDEX idx_equivalent_units_tenant_mo_stage ON public.equivalent_units(tenant_id, mo_id, stage_no);
CREATE INDEX idx_equivalent_units_date ON public.equivalent_units(tenant_id, calculation_date);
CREATE INDEX idx_equivalent_units_completion ON public.equivalent_units(tenant_id, material_completion_percentage, conversion_completion_percentage);

-- ===================================================================
-- COST PER EQUIVALENT UNIT CALCULATION TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.cost_per_equivalent_unit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id UUID NOT NULL REFERENCES public.manufacturing_orders(id),
  stage_no INTEGER NOT NULL,
  calculation_period_start DATE NOT NULL,
  calculation_period_end DATE NOT NULL,
  
  -- Cost components
  material_cost NUMERIC(18,6) DEFAULT 0 CHECK (material_cost >= 0),
  labor_cost NUMERIC(18,6) DEFAULT 0 CHECK (labor_cost >= 0),
  overhead_cost NUMERIC(18,6) DEFAULT 0 CHECK (overhead_cost >= 0),
  total_cost NUMERIC(18,6) GENERATED ALWAYS AS (material_cost + labor_cost + overhead_cost) STORED,
  
  -- Equivalent units (from equivalent_units table)
  equivalent_units_material NUMERIC(18,6) DEFAULT 0 CHECK (equivalent_units_material >= 0),
  equivalent_units_conversion NUMERIC(18,6) DEFAULT 0 CHECK (equivalent_units_conversion >= 0),
  
  -- Cost per equivalent unit (calculated)
  cost_per_equivalent_unit_material NUMERIC(18,6) GENERATED ALWAYS AS (
    CASE WHEN equivalent_units_material > 0 THEN material_cost / equivalent_units_material ELSE 0 END
  ) STORED,
  
  cost_per_equivalent_unit_conversion NUMERIC(18,6) GENERATED ALWAYS AS (
    CASE WHEN equivalent_units_conversion > 0 THEN (labor_cost + overhead_cost) / equivalent_units_conversion ELSE 0 END
  ) STORED,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  
  UNIQUE(tenant_id, mo_id, stage_no, calculation_period_start, calculation_period_end)
);

CREATE INDEX idx_cpeu_tenant_mo_stage ON public.cost_per_equivalent_unit(tenant_id, mo_id, stage_no);
CREATE INDEX idx_cpeu_period ON public.cost_per_equivalent_unit(tenant_id, calculation_period_start, calculation_period_end);
CREATE INDEX idx_cpeu_costs ON public.cost_per_equivalent_unit(tenant_id, material_cost, labor_cost, overhead_cost);

-- ===================================================================
-- VARIANCE ANALYSIS TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.variance_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id UUID NOT NULL REFERENCES public.manufacturing_orders(id),
  stage_no INTEGER NOT NULL,
  variance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Standard costs (planned)
  standard_material_cost NUMERIC(18,6) DEFAULT 0,
  standard_labor_cost NUMERIC(18,6) DEFAULT 0,
  standard_overhead_cost NUMERIC(18,6) DEFAULT 0,
  
  -- Actual costs
  actual_material_cost NUMERIC(18,6) DEFAULT 0,
  actual_labor_cost NUMERIC(18,6) DEFAULT 0,
  actual_overhead_cost NUMERIC(18,6) DEFAULT 0,
  
  -- Variances (calculated)
  material_cost_variance NUMERIC(18,6) GENERATED ALWAYS AS (actual_material_cost - standard_material_cost) STORED,
  labor_cost_variance NUMERIC(18,6) GENERATED ALWAYS AS (actual_labor_cost - standard_labor_cost) STORED,
  overhead_cost_variance NUMERIC(18,6) GENERATED ALWAYS AS (actual_overhead_cost - standard_overhead_cost) STORED,
  total_variance NUMERIC(18,6) GENERATED ALWAYS AS (
    (actual_material_cost - standard_material_cost) +
    (actual_labor_cost - standard_labor_cost) +
    (actual_overhead_cost - standard_overhead_cost)
  ) STORED,
  
  -- Variance percentages
  material_variance_percentage NUMERIC(8,4) GENERATED ALWAYS AS (
    CASE WHEN standard_material_cost > 0 THEN ((actual_material_cost - standard_material_cost) / standard_material_cost) * 100 ELSE 0 END
  ) STORED,
  
  labor_variance_percentage NUMERIC(8,4) GENERATED ALWAYS AS (
    CASE WHEN standard_labor_cost > 0 THEN ((actual_labor_cost - standard_labor_cost) / standard_labor_cost) * 100 ELSE 0 END
  ) STORED,
  
  overhead_variance_percentage NUMERIC(8,4) GENERATED ALWAYS AS (
    CASE WHEN standard_overhead_cost > 0 THEN ((actual_overhead_cost - standard_overhead_cost) / standard_overhead_cost) * 100 ELSE 0 END
  ) STORED,
  
  -- Variance severity classification
  variance_severity TEXT GENERATED ALWAYS AS (
    CASE 
      WHEN ABS(((actual_material_cost - standard_material_cost) / NULLIF(standard_material_cost, 0)) * 100) > 10 
        OR ABS(((actual_labor_cost - standard_labor_cost) / NULLIF(standard_labor_cost, 0)) * 100) > 10 
        OR ABS(((actual_overhead_cost - standard_overhead_cost) / NULLIF(standard_overhead_cost, 0)) * 100) > 10 
      THEN 'HIGH'
      WHEN ABS(((actual_material_cost - standard_material_cost) / NULLIF(standard_material_cost, 0)) * 100) > 5 
        OR ABS(((actual_labor_cost - standard_labor_cost) / NULLIF(standard_labor_cost, 0)) * 100) > 5 
        OR ABS(((actual_overhead_cost - standard_overhead_cost) / NULLIF(standard_overhead_cost, 0)) * 100) > 5 
      THEN 'MEDIUM'
      ELSE 'LOW'
    END
  ) STORED,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  
  UNIQUE(tenant_id, mo_id, stage_no, variance_date)
);

CREATE INDEX idx_variance_analysis_tenant_mo_stage ON public.variance_analysis(tenant_id, mo_id, stage_no);
CREATE INDEX idx_variance_analysis_date ON public.variance_analysis(tenant_id, variance_date);
CREATE INDEX idx_variance_analysis_severity ON public.variance_analysis(tenant_id, variance_severity);
CREATE INDEX idx_variance_analysis_percentage ON public.variance_analysis(tenant_id, material_variance_percentage, labor_variance_percentage, overhead_variance_percentage);

-- ===================================================================
-- PRODUCTION BATCHES (AGGREGATION OF MANUFACTURING ORDERS)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.production_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number TEXT UNIQUE NOT NULL,
  product_id UUID NOT NULL REFERENCES public.items(id),
  start_date DATE NOT NULL,
  target_completion_date DATE,
  actual_completion_date DATE,
  planned_quantity NUMERIC(18,6) NOT NULL CHECK (planned_quantity > 0),
  actual_quantity NUMERIC(18,6),
  status TEXT DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  priority_level INTEGER DEFAULT 1 CHECK (priority_level BETWEEN 1 AND 5),
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_production_batches_tenant_product ON public.production_batches(tenant_id, product_id);
CREATE INDEX idx_production_batches_status ON public.production_batches(tenant_id, status);
CREATE INDEX idx_production_batches_dates ON public.production_batches(tenant_id, start_date, target_completion_date);

-- ===================================================================
-- BATCH MANUFACTURING ORDER LINK TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.batch_mo_link (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.production_batches(id),
  mo_id UUID NOT NULL REFERENCES public.manufacturing_orders(id),
  sequence_number INTEGER NOT NULL,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(tenant_id, batch_id, mo_id),
  UNIQUE(tenant_id, batch_id, sequence_number)
);

CREATE INDEX idx_batch_mo_link_batch ON public.batch_mo_link(tenant_id, batch_id);
CREATE INDEX idx_batch_mo_link_mo ON public.batch_mo_link(tenant_id, mo_id);

-- ===================================================================
-- RLS POLICIES FOR NEW TABLES
-- ===================================================================
ALTER TABLE public.equivalent_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_per_equivalent_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variance_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_mo_link ENABLE ROW LEVEL SECURITY;

-- Equivalent Units Policies
DROP POLICY IF EXISTS tenant_select_equivalent_units ON public.equivalent_units;
CREATE POLICY tenant_select_equivalent_units ON public.equivalent_units
  FOR SELECT USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_equivalent_units ON public.equivalent_units;
CREATE POLICY tenant_insert_equivalent_units ON public.equivalent_units
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_update_equivalent_units ON public.equivalent_units;
CREATE POLICY tenant_update_equivalent_units ON public.equivalent_units
  FOR UPDATE USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_equivalent_units ON public.equivalent_units;
CREATE POLICY tenant_delete_equivalent_units ON public.equivalent_units
  FOR DELETE USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

-- Cost Per Equivalent Unit Policies
DROP POLICY IF EXISTS tenant_select_cost_per_equivalent_unit ON public.cost_per_equivalent_unit;
CREATE POLICY tenant_select_cost_per_equivalent_unit ON public.cost_per_equivalent_unit
  FOR SELECT USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_cost_per_equivalent_unit ON public.cost_per_equivalent_unit;
CREATE POLICY tenant_insert_cost_per_equivalent_unit ON public.cost_per_equivalent_unit
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_update_cost_per_equivalent_unit ON public.cost_per_equivalent_unit;
CREATE POLICY tenant_update_cost_per_equivalent_unit ON public.cost_per_equivalent_unit
  FOR UPDATE USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_cost_per_equivalent_unit ON public.cost_per_equivalent_unit;
CREATE POLICY tenant_delete_cost_per_equivalent_unit ON public.cost_per_equivalent_unit
  FOR DELETE USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

-- Variance Analysis Policies
DROP POLICY IF EXISTS tenant_select_variance_analysis ON public.variance_analysis;
CREATE POLICY tenant_select_variance_analysis ON public.variance_analysis
  FOR SELECT USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_variance_analysis ON public.variance_analysis;
CREATE POLICY tenant_insert_variance_analysis ON public.variance_analysis
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_update_variance_analysis ON public.variance_analysis;
CREATE POLICY tenant_update_variance_analysis ON public.variance_analysis
  FOR UPDATE USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_variance_analysis ON public.variance_analysis;
CREATE POLICY tenant_delete_variance_analysis ON public.variance_analysis
  FOR DELETE USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

-- Production Batches Policies
DROP POLICY IF EXISTS tenant_select_production_batches ON public.production_batches;
CREATE POLICY tenant_select_production_batches ON public.production_batches
  FOR SELECT USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_production_batches ON public.production_batches;
CREATE POLICY tenant_insert_production_batches ON public.production_batches
  FOR INSERT WITH CHECK (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_update_production_batches ON public.production_batches;
CREATE POLICY tenant_update_production_batches ON public.production_batches
  FOR UPDATE USING (tenant_id = get_current_tenant_id())
  WITH CHECK (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_delete_production_batches ON public.production_batches;
CREATE POLICY tenant_delete_production_batches ON public.production_batches
  FOR DELETE USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() = 'admin'
  );

-- Batch MO Link Policies
DROP POLICY IF EXISTS tenant_select_batch_mo_link ON public.batch_mo_link;
CREATE POLICY tenant_select_batch_mo_link ON public.batch_mo_link
  FOR SELECT USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_batch_mo_link ON public.batch_mo_link;
CREATE POLICY tenant_insert_batch_mo_link ON public.batch_mo_link
  FOR INSERT WITH CHECK (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_update_batch_mo_link ON public.batch_mo_link;
CREATE POLICY tenant_update_batch_mo_link ON public.batch_mo_link
  FOR UPDATE USING (tenant_id = get_current_tenant_id())
  WITH CHECK (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_delete_batch_mo_link ON public.batch_mo_link;
CREATE POLICY tenant_delete_batch_mo_link ON public.batch_mo_link
  FOR DELETE USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() = 'admin'
  );

-- ===================================================================
-- TRIGGERS FOR AUDIT TRAIL
-- ===================================================================
CREATE TRIGGER audit_equivalent_units AFTER INSERT OR UPDATE OR DELETE ON public.equivalent_units
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_cost_per_equivalent_unit AFTER INSERT OR UPDATE OR DELETE ON public.cost_per_equivalent_unit
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_variance_analysis AFTER INSERT OR UPDATE OR DELETE ON public.variance_analysis
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_production_batches AFTER INSERT OR UPDATE OR DELETE ON public.production_batches
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_batch_mo_link AFTER INSERT OR UPDATE OR DELETE ON public.batch_mo_link
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- ===================================================================
-- COMMENTS FOR DOCUMENTATION
-- ===================================================================
COMMENT ON TABLE public.equivalent_units IS 'Equivalent units calculation for process costing method';
COMMENT ON TABLE public.cost_per_equivalent_unit IS 'Cost per equivalent unit calculation with material and conversion costs';
COMMENT ON TABLE public.variance_analysis IS 'Variance analysis between standard and actual costs';
COMMENT ON TABLE public.production_batches IS 'Aggregation of manufacturing orders for batch processing';
COMMENT ON TABLE public.batch_mo_link IS 'Link table between production batches and manufacturing orders';

COMMENT ON COLUMN public.equivalent_units.equivalent_units_material IS 'Equivalent units for materials (100% completion assumption)';
COMMENT ON COLUMN public.equivalent_units.equivalent_units_conversion IS 'Equivalent units for conversion costs (labor + overhead)';
COMMENT ON COLUMN public.cost_per_equivalent_unit.cost_per_equivalent_unit_material IS 'Material cost per equivalent unit';
COMMENT ON COLUMN public.cost_per_equivalent_unit.cost_per_equivalent_unit_conversion IS 'Conversion cost per equivalent unit';
COMMENT ON COLUMN public.variance_analysis.variance_severity IS 'Severity classification based on variance percentages';