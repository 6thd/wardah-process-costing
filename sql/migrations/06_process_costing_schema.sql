-- ===================================================================
-- WARDAH ERP PROCESS COSTING DATABASE SCHEMA
-- Complete ERP Manufacturing with Process Costing Methodology
-- Multi-tenant with JWT+RLS Security
-- ===================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ===================================================================
-- WORK CENTERS (Manufacturing Stages/Departments)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.work_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  seq INTEGER NOT NULL CHECK (seq > 0),                    -- Stage sequence order
  cost_base TEXT NOT NULL DEFAULT 'labor_hours',           -- 'labor_hours', 'machine_hours', 'units'
  default_rate NUMERIC(18,6) DEFAULT 0 CHECK (default_rate >= 0),
  is_active BOOLEAN DEFAULT true,
  description TEXT,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  
  UNIQUE(tenant_id, code),
  UNIQUE(tenant_id, seq)
);

CREATE INDEX idx_work_centers_tenant ON public.work_centers(tenant_id);
CREATE INDEX idx_work_centers_sequence ON public.work_centers(tenant_id, seq);

-- ===================================================================
-- STAGE COSTS (Core Process Costing Entity)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.stage_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id UUID NOT NULL,                                     -- Manufacturing Order ID
  stage_no INTEGER NOT NULL CHECK (stage_no > 0),
  wc_id UUID NOT NULL REFERENCES public.work_centers(id),
  
  -- Quantities
  input_qty NUMERIC(18,6) DEFAULT 0 CHECK (input_qty >= 0),
  good_qty NUMERIC(18,6) DEFAULT 0 CHECK (good_qty >= 0),
  scrap_qty NUMERIC(18,6) DEFAULT 0 CHECK (scrap_qty >= 0),
  rework_qty NUMERIC(18,6) DEFAULT 0 CHECK (rework_qty >= 0),
  
  -- Cost Components (Standard Process Costing Formula)
  transferred_in NUMERIC(18,6) DEFAULT 0,                  -- From previous stage
  dm_cost NUMERIC(18,6) DEFAULT 0,                         -- Direct Materials (stage 1 only)
  dl_cost NUMERIC(18,6) DEFAULT 0,                         -- Direct Labor
  moh_cost NUMERIC(18,6) DEFAULT 0,                        -- Manufacturing Overhead
  regrind_proc_cost NUMERIC(18,6) DEFAULT 0,               -- Regrind/Reprocessing costs
  waste_credit NUMERIC(18,6) DEFAULT 0,                    -- Credit from waste/scrap sales
  
  -- Calculated totals
  total_cost NUMERIC(18,6) DEFAULT 0,                      -- Sum of all costs minus credits
  unit_cost NUMERIC(18,6) DEFAULT 0,                       -- Cost per good unit
  
  -- Status and type
  mode TEXT DEFAULT 'precosted' CHECK (mode IN ('precosted', 'actual', 'completed')),
  is_final BOOLEAN DEFAULT false,
  
  -- Notes and references
  notes TEXT,
  batch_id TEXT,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  
  UNIQUE (tenant_id, mo_id, stage_no)
);

CREATE INDEX idx_stage_costs_tenant_mo ON public.stage_costs(tenant_id, mo_id, stage_no);
CREATE INDEX idx_stage_costs_wc ON public.stage_costs(tenant_id, wc_id);
CREATE INDEX idx_stage_costs_mode ON public.stage_costs(tenant_id, mode);

-- ===================================================================
-- LABOR TIME LOGS (Direct Labor Tracking)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.labor_time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id UUID NOT NULL,
  stage_no INTEGER NOT NULL,
  wc_id UUID NOT NULL REFERENCES public.work_centers(id),
  
  -- Labor details
  employee_id UUID,
  employee_name TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  hours NUMERIC(18,6) NOT NULL CHECK (hours > 0),
  hourly_rate NUMERIC(18,6) NOT NULL CHECK (hourly_rate >= 0),
  total_cost NUMERIC(18,6) GENERATED ALWAYS AS (hours * hourly_rate) STORED,
  
  -- Operation details
  operation_code TEXT,
  operation_desc TEXT,
  setup_time NUMERIC(18,6) DEFAULT 0,
  run_time NUMERIC(18,6) DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'voided')),
  notes TEXT,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  
  CHECK (end_time IS NULL OR end_time >= start_time)
);

CREATE INDEX idx_labor_logs_tenant_mo_stage ON public.labor_time_logs(tenant_id, mo_id, stage_no);
CREATE INDEX idx_labor_logs_employee ON public.labor_time_logs(tenant_id, employee_id);
CREATE INDEX idx_labor_logs_date ON public.labor_time_logs(tenant_id, start_time);

-- ===================================================================
-- MANUFACTURING OVERHEAD APPLIED (MOH Allocation)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.moh_applied (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id UUID NOT NULL,
  stage_no INTEGER NOT NULL,
  wc_id UUID NOT NULL REFERENCES public.work_centers(id),
  
  -- Allocation basis
  allocation_base TEXT NOT NULL DEFAULT 'labor_hours', -- 'labor_hours', 'machine_hours', 'labor_cost', 'material_cost'
  base_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (base_qty >= 0),
  overhead_rate NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (overhead_rate >= 0),
  amount NUMERIC(18,6) GENERATED ALWAYS AS (base_qty * overhead_rate) STORED,
  
  -- Overhead type
  overhead_type TEXT DEFAULT 'variable', -- 'variable', 'fixed', 'mixed'
  cost_pool_id UUID, -- Reference to overhead cost pool
  
  -- Status and notes
  status TEXT DEFAULT 'applied' CHECK (status IN ('applied', 'reversed')),
  notes TEXT,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID
);

CREATE INDEX idx_moh_applied_tenant_mo_stage ON public.moh_applied(tenant_id, mo_id, stage_no);
CREATE INDEX idx_moh_applied_wc ON public.moh_applied(tenant_id, wc_id);

-- ===================================================================
-- INVENTORY LEDGER (AVCO Inventory Tracking)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.inventory_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL,
  
  -- Movement details
  move_type TEXT NOT NULL,                                 -- 'PURCHASE_IN','PROD_IN','MO_CONS','SALE_OUT','ADJ'
  ref_type TEXT,                                           -- 'PO','MO','SO','ADJ','MANUAL'
  ref_id UUID,                                             -- Reference document ID
  ref_number TEXT,
  
  -- Quantities and costs
  qty_in NUMERIC(18,6) DEFAULT 0 CHECK (qty_in >= 0),
  qty_out NUMERIC(18,6) DEFAULT 0 CHECK (qty_out >= 0),
  unit_cost NUMERIC(18,6) DEFAULT 0,
  total_cost NUMERIC(18,6) DEFAULT 0,                      -- +/- based on in/out
  
  -- AVCO calculation fields
  running_balance NUMERIC(18,6) DEFAULT 0,
  running_value NUMERIC(18,6) DEFAULT 0,
  avg_unit_cost NUMERIC(18,6) DEFAULT 0,
  
  -- Additional details
  lot_number TEXT,
  expiry_date DATE,
  location_code TEXT,
  notes TEXT,
  
  -- Timing
  moved_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  
  CHECK ((qty_in > 0 AND qty_out = 0) OR (qty_in = 0 AND qty_out > 0))
);

CREATE INDEX idx_inv_ledger_tenant_item_time ON public.inventory_ledger(tenant_id, item_id, moved_at);
CREATE INDEX idx_inv_ledger_ref ON public.inventory_ledger(tenant_id, ref_type, ref_id);
CREATE INDEX idx_inv_ledger_move_type ON public.inventory_ledger(tenant_id, move_type);

-- ===================================================================
-- BILL OF MATERIALS (BOM) - Enhanced for Process Costing
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.boms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_item_id UUID NOT NULL,
  version TEXT DEFAULT '1.0',
  is_active BOOLEAN DEFAULT true,
  effective_date DATE DEFAULT CURRENT_DATE,
  
  -- Production details
  base_quantity NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (base_quantity > 0),
  yield_percentage NUMERIC(5,2) DEFAULT 100 CHECK (yield_percentage > 0),
  
  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  notes TEXT,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX idx_boms_tenant_parent ON public.boms(tenant_id, parent_item_id);

-- ===================================================================
-- BOM LINE ITEMS (Components by Stage)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.bom_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id UUID NOT NULL REFERENCES public.boms(id) ON DELETE CASCADE,
  component_item_id UUID NOT NULL,
  
  -- Stage allocation
  stage_no INTEGER DEFAULT 1 CHECK (stage_no > 0),        -- Which stage consumes this material
  wc_id UUID REFERENCES public.work_centers(id),          -- Optional: specific work center
  
  -- Quantities
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  scrap_factor NUMERIC(5,2) DEFAULT 0,                     -- Expected scrap %
  
  -- Usage details
  usage_type TEXT DEFAULT 'consumed',                      -- 'consumed', 'byproduct', 'coproduct'
  consumption_timing TEXT DEFAULT 'start',                 -- 'start', 'end', 'proportional'
  
  -- Costing
  is_cost_significant BOOLEAN DEFAULT true,
  
  -- Sequence and grouping
  line_number INTEGER,
  component_group TEXT,
  
  -- Audit and multi-tenant
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(bom_id, line_number)
);

CREATE INDEX idx_bom_lines_bom ON public.bom_lines(bom_id);
CREATE INDEX idx_bom_lines_component ON public.bom_lines(tenant_id, component_item_id);
CREATE INDEX idx_bom_lines_stage ON public.bom_lines(bom_id, stage_no);

-- ===================================================================
-- AUDIT TRAIL (Comprehensive Audit Logging)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  
  -- Event details
  event_type TEXT NOT NULL,                                -- 'CREATE', 'UPDATE', 'DELETE', 'PROCESS'
  table_name TEXT NOT NULL,
  record_id UUID,
  
  -- Data changes
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  
  -- Context
  operation TEXT,                                          -- 'stage_cost_calculation', 'mo_completion', etc.
  source_ip INET,
  user_agent TEXT,
  
  -- User and timing
  user_id UUID,
  user_email TEXT,
  occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_tenant_time ON public.audit_trail(tenant_id, occurred_at);
CREATE INDEX idx_audit_table_record ON public.audit_trail(tenant_id, table_name, record_id);
CREATE INDEX idx_audit_user ON public.audit_trail(tenant_id, user_id);

-- ===================================================================
-- MANUFACTURING ORDERS (Enhanced for Process Costing)
-- ===================================================================
-- Note: This may already exist, so we'll add columns if needed
DO $$ 
BEGIN
  -- Add columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'bom_id') THEN
    ALTER TABLE public.manufacturing_orders ADD COLUMN bom_id UUID REFERENCES public.boms(id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'routing_id') THEN
    ALTER TABLE public.manufacturing_orders ADD COLUMN routing_id UUID;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'planned_stages') THEN
    ALTER TABLE public.manufacturing_orders ADD COLUMN planned_stages INTEGER DEFAULT 1;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'current_stage') THEN
    ALTER TABLE public.manufacturing_orders ADD COLUMN current_stage INTEGER DEFAULT 1;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'costing_method') THEN
    ALTER TABLE public.manufacturing_orders ADD COLUMN costing_method TEXT DEFAULT 'process_costing';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'batch_number') THEN
    ALTER TABLE public.manufacturing_orders ADD COLUMN batch_number TEXT;
  END IF;
END $$;

-- ===================================================================
-- TRIGGERS FOR AUTOMATED CALCULATIONS
-- ===================================================================

-- Trigger function to update stage cost totals
CREATE OR REPLACE FUNCTION update_stage_cost_totals()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate total cost using the process costing formula:
  -- Total = Transferred In + DM + DL + MOH + Regrind - Waste Credit
  NEW.total_cost := COALESCE(NEW.transferred_in, 0) + 
                    COALESCE(NEW.dm_cost, 0) + 
                    COALESCE(NEW.dl_cost, 0) + 
                    COALESCE(NEW.moh_cost, 0) + 
                    COALESCE(NEW.regrind_proc_cost, 0) - 
                    COALESCE(NEW.waste_credit, 0);
                    
  -- Calculate unit cost
  IF NEW.good_qty > 0 THEN
    NEW.unit_cost := NEW.total_cost / NEW.good_qty;
  ELSE
    NEW.unit_cost := 0;
  END IF;
  
  NEW.updated_at := now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to stage_costs table
DROP TRIGGER IF EXISTS trigger_update_stage_cost_totals ON public.stage_costs;
CREATE TRIGGER trigger_update_stage_cost_totals
  BEFORE INSERT OR UPDATE ON public.stage_costs
  FOR EACH ROW
  EXECUTE FUNCTION update_stage_cost_totals();

-- Trigger function for audit trail
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
DECLARE
  user_id UUID;
  user_email TEXT;
  tenant_id UUID;
BEGIN
  -- Get user info from JWT
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid INTO user_id;
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'email' INTO user_email;
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid INTO tenant_id;
  
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_trail (
      tenant_id, event_type, table_name, record_id, 
      old_values, user_id, user_email
    ) VALUES (
      COALESCE(tenant_id, OLD.tenant_id), 
      'DELETE', 
      TG_TABLE_NAME, 
      OLD.id,
      to_jsonb(OLD), 
      user_id, 
      user_email
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_trail (
      tenant_id, event_type, table_name, record_id,
      old_values, new_values, user_id, user_email
    ) VALUES (
      COALESCE(tenant_id, NEW.tenant_id), 
      'UPDATE', 
      TG_TABLE_NAME, 
      NEW.id,
      to_jsonb(OLD), 
      to_jsonb(NEW), 
      user_id, 
      user_email
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_trail (
      tenant_id, event_type, table_name, record_id,
      new_values, user_id, user_email
    ) VALUES (
      COALESCE(tenant_id, NEW.tenant_id), 
      'INSERT', 
      TG_TABLE_NAME, 
      NEW.id,
      to_jsonb(NEW), 
      user_id, 
      user_email
    );
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit triggers to key tables
CREATE TRIGGER audit_work_centers AFTER INSERT OR UPDATE OR DELETE ON public.work_centers
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_stage_costs AFTER INSERT OR UPDATE OR DELETE ON public.stage_costs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_labor_time_logs AFTER INSERT OR UPDATE OR DELETE ON public.labor_time_logs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_moh_applied AFTER INSERT OR UPDATE OR DELETE ON public.moh_applied
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- ===================================================================
-- COMMENTS FOR DOCUMENTATION
-- ===================================================================
COMMENT ON TABLE public.work_centers IS 'Manufacturing work centers/stages for process costing';
COMMENT ON TABLE public.stage_costs IS 'Core process costing data with standard formula calculations';
COMMENT ON TABLE public.labor_time_logs IS 'Direct labor time tracking by stage and employee';
COMMENT ON TABLE public.moh_applied IS 'Manufacturing overhead allocation by various bases';
COMMENT ON TABLE public.inventory_ledger IS 'AVCO inventory tracking with running balances';
COMMENT ON TABLE public.audit_trail IS 'Comprehensive audit log for all system changes';

COMMENT ON COLUMN public.stage_costs.transferred_in IS 'Cost transferred from previous manufacturing stage';
COMMENT ON COLUMN public.stage_costs.dm_cost IS 'Direct materials cost (typically stage 1 only)';
COMMENT ON COLUMN public.stage_costs.dl_cost IS 'Direct labor cost from labor_time_logs';
COMMENT ON COLUMN public.stage_costs.moh_cost IS 'Manufacturing overhead from moh_applied';
COMMENT ON COLUMN public.stage_costs.total_cost IS 'Calculated: transferred_in + dm + dl + moh + regrind - waste_credit';
COMMENT ON COLUMN public.stage_costs.unit_cost IS 'Calculated: total_cost / good_qty';

-- ===================================================================
-- INITIAL DATA (Work Centers Example)
-- ===================================================================
-- Note: This will be inserted via application logic with proper tenant_id