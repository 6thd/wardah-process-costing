-- =====================================================================
-- Wardah ERP - HR Operational Extensions (Hasebny Alignment)
-- Adds smart alerts, settlements, and payroll adjustment layers
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper function (reused if already exists)
CREATE OR REPLACE FUNCTION hr_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================
-- Smart Alerts Table
-- ==============================================================
CREATE TABLE IF NOT EXISTS hr_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'compliance',
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  description TEXT,
  due_date DATE,
  source TEXT,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_alerts_org ON hr_alerts(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_alerts_employee ON hr_alerts(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_alerts_severity ON hr_alerts(severity);

-- ==============================================================
-- Settlements (End of Service / Adjustments)
-- ==============================================================
CREATE TABLE IF NOT EXISTS hr_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  settlement_type TEXT NOT NULL DEFAULT 'end_of_service',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','paid','rejected')),
  service_start DATE,
  service_end DATE,
  service_days INTEGER,
  calculated_amount NUMERIC(14,2) DEFAULT 0,
  payable_amount NUMERIC(14,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'SAR',
  notes TEXT,
  created_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_settlement_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  settlement_id UUID NOT NULL REFERENCES hr_settlements(id) ON DELETE CASCADE,
  component_code TEXT NOT NULL,
  component_label TEXT NOT NULL,
  calculation_basis TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_deduction BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_settlements_org ON hr_settlements(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_settlements_employee ON hr_settlements(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_settlement_lines_org ON hr_settlement_lines(org_id);

-- ==============================================================
-- Payroll Adjustments
-- ==============================================================
CREATE TABLE IF NOT EXISTS hr_payroll_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id UUID REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL, -- allowance, deduction, loan, gosi, overtime
  description TEXT,
  amount NUMERIC(12,2) NOT NULL,
  is_recurring BOOLEAN DEFAULT FALSE,
  effective_month DATE,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_payroll_adjustments_org ON hr_payroll_adjustments(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_payroll_adjustments_employee ON hr_payroll_adjustments(employee_id);

-- ==============================================================
-- RLS Policies
-- ==============================================================
DO $$
BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'hr_alerts_select';
  IF NOT FOUND THEN
    ALTER TABLE hr_alerts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY hr_alerts_select ON hr_alerts
      FOR SELECT USING (org_id = (SELECT org_id FROM user_organizations WHERE user_id = auth.uid() AND is_active LIMIT 1));
    CREATE POLICY hr_alerts_manage ON hr_alerts
      FOR ALL USING (org_id = (SELECT org_id FROM user_organizations WHERE user_id = auth.uid() AND is_active AND role IN ('admin','manager') LIMIT 1));
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '⚠️ Could not apply RLS policy on hr_alerts (insufficient privileges).';
END $$;

DO $$
BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'hr_settlements_select';
  IF NOT FOUND THEN
    ALTER TABLE hr_settlements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE hr_settlement_lines ENABLE ROW LEVEL SECURITY;

    CREATE POLICY hr_settlements_select ON hr_settlements
      FOR SELECT USING (org_id = (SELECT org_id FROM user_organizations WHERE user_id = auth.uid() AND is_active LIMIT 1));
    CREATE POLICY hr_settlements_manage ON hr_settlements
      FOR ALL USING (org_id = (SELECT org_id FROM user_organizations WHERE user_id = auth.uid() AND is_active AND role IN ('admin','manager') LIMIT 1));

    CREATE POLICY hr_settlement_lines_select ON hr_settlement_lines
      FOR SELECT USING (org_id = (SELECT org_id FROM user_organizations WHERE user_id = auth.uid() AND is_active LIMIT 1));
    CREATE POLICY hr_settlement_lines_manage ON hr_settlement_lines
      FOR ALL USING (org_id = (SELECT org_id FROM user_organizations WHERE user_id = auth.uid() AND is_active AND role IN ('admin','manager') LIMIT 1));
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '⚠️ Could not apply RLS policy on settlements (insufficient privileges).';
END $$;

DO $$
BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'hr_payroll_adjustments_select';
  IF NOT FOUND THEN
    ALTER TABLE hr_payroll_adjustments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY hr_payroll_adjustments_select ON hr_payroll_adjustments
      FOR SELECT USING (org_id = (SELECT org_id FROM user_organizations WHERE user_id = auth.uid() AND is_active LIMIT 1));
    CREATE POLICY hr_payroll_adjustments_manage ON hr_payroll_adjustments
      FOR ALL USING (org_id = (SELECT org_id FROM user_organizations WHERE user_id = auth.uid() AND is_active AND role IN ('admin','manager') LIMIT 1));
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '⚠️ Could not apply RLS policy on payroll adjustments.';
END $$;

-- ==============================================================
-- Triggers
-- ==============================================================
CREATE TRIGGER hr_alerts_touch_updated_at
  BEFORE UPDATE ON hr_alerts
  FOR EACH ROW
  EXECUTE FUNCTION hr_touch_updated_at();

CREATE TRIGGER hr_settlements_touch_updated_at
  BEFORE UPDATE ON hr_settlements
  FOR EACH ROW
  EXECUTE FUNCTION hr_touch_updated_at();

CREATE TRIGGER hr_payroll_adjustments_touch_updated_at
  BEFORE UPDATE ON hr_payroll_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION hr_touch_updated_at();

-- ==============================================================
-- Sample Data (Optional)
-- ==============================================================
INSERT INTO hr_alerts (org_id, title, category, severity, description, due_date)
SELECT o.id, 'انتهاء عقود عمل خلال 30 يوم', 'contracts', 'warning',
       'هناك عقود موظفين تحتاج لتجديد قبل نهاية الشهر', CURRENT_DATE + INTERVAL '30 days'
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM hr_alerts)
LIMIT 1;

INSERT INTO hr_settlements (org_id, employee_id, settlement_type, status, service_start, service_end, calculated_amount, payable_amount)
SELECT e.org_id, e.id, 'end_of_service', 'draft', e.hire_date, CURRENT_DATE, 15000, 14000
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM hr_settlements)
LIMIT 1;

DO $$
BEGIN
  RAISE NOTICE '✅ HR operational extensions deployed successfully.';
END $$;

