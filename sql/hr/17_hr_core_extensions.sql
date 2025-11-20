-- =====================================================================
-- Wardah ERP - HR Core Extensions (Hasebny Alignment Phase 1)
-- Creates attendance monthly map, HR policies, payroll locks, GL mappings
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1) HR Policies (configurable working hours, overtime, weekends)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hr_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_daily_hours NUMERIC(4,2) NOT NULL DEFAULT 8.0,
  worker_daily_hours NUMERIC(4,2) NOT NULL DEFAULT 11.0,
  worker_shifts SMALLINT NOT NULL DEFAULT 2,
  weekend_days TEXT[] NOT NULL DEFAULT ARRAY['friday'],
  overtime_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.5,
  overtime_grace_minutes SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_policies_org ON hr_policies(org_id);

-- ---------------------------------------------------------------------
-- 2) Attendance monthly map (days JSONB)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hr_attendance_monthly (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  days JSONB NOT NULL DEFAULT '{}'::JSONB,
  metadata JSONB,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, employee_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_hr_attendance_monthly_org ON hr_attendance_monthly(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_monthly_employee ON hr_attendance_monthly(employee_id);

-- ---------------------------------------------------------------------
-- 3) Payroll locks (generated -> paid -> locked)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hr_payroll_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated','paid','locked')),
  locked_at TIMESTAMPTZ,
  locked_by UUID,
  journal_entry_id UUID REFERENCES gl_entries(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_hr_payroll_locks_org ON hr_payroll_locks(org_id);

-- ---------------------------------------------------------------------
-- 4) Payroll GL account mappings
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hr_payroll_account_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_type TEXT NOT NULL CHECK (
    account_type IN (
      'basic_salary',
      'housing_allowance',
      'transport_allowance',
      'other_allowance',
      'deductions',
      'loans',
      'payable',
      'net_payable'
    )
  ),
  gl_account_id UUID NOT NULL REFERENCES gl_accounts(id) ON DELETE CASCADE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, account_type)
);

CREATE INDEX IF NOT EXISTS idx_hr_payroll_account_mappings_org
  ON hr_payroll_account_mappings(org_id);

-- ---------------------------------------------------------------------
-- 5) Helper RPC to upsert attendance day
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION upsert_attendance_day(
  p_org_id UUID,
  p_employee_id UUID,
  p_year SMALLINT,
  p_month SMALLINT,
  p_day TEXT,
  p_payload JSONB
) RETURNS hr_attendance_monthly
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result hr_attendance_monthly;
BEGIN
  UPDATE hr_attendance_monthly
  SET days = COALESCE(days, '{}'::jsonb) || jsonb_build_object(p_day, p_payload),
      updated_at = NOW()
  WHERE org_id = p_org_id
    AND employee_id = p_employee_id
    AND year = p_year
    AND month = p_month
  RETURNING * INTO result;

  IF NOT FOUND THEN
    INSERT INTO hr_attendance_monthly (
      org_id,
      employee_id,
      year,
      month,
      days
    )
    VALUES (
      p_org_id,
      p_employee_id,
      p_year,
      p_month,
      jsonb_build_object(p_day, p_payload)
    )
    RETURNING * INTO result;
  END IF;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------
-- 5) Helper function & triggers for updated_at
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION hr_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_hr_policies_touch_updated_at
  BEFORE UPDATE ON hr_policies
  FOR EACH ROW EXECUTE FUNCTION hr_touch_updated_at();

CREATE TRIGGER trg_hr_attendance_monthly_touch_updated_at
  BEFORE UPDATE ON hr_attendance_monthly
  FOR EACH ROW EXECUTE FUNCTION hr_touch_updated_at();

CREATE TRIGGER trg_hr_payroll_locks_touch_updated_at
  BEFORE UPDATE ON hr_payroll_locks
  FOR EACH ROW EXECUTE FUNCTION hr_touch_updated_at();

CREATE TRIGGER trg_hr_payroll_account_mappings_touch_updated_at
  BEFORE UPDATE ON hr_payroll_account_mappings
  FOR EACH ROW EXECUTE FUNCTION hr_touch_updated_at();

-- ---------------------------------------------------------------------
-- 6) RLS policies (multi-tenant)
-- ---------------------------------------------------------------------

ALTER TABLE hr_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_attendance_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_account_mappings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'hr_policies_select'
  ) THEN
    CREATE POLICY hr_policies_select ON hr_policies
      FOR SELECT USING (
        org_id = (
          SELECT uo.org_id FROM user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active LIMIT 1
        )
      );
    CREATE POLICY hr_policies_manage ON hr_policies
      FOR ALL USING (
        org_id = (
          SELECT uo.org_id FROM user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active
            AND uo.role IN ('admin','manager') LIMIT 1
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'hr_attendance_monthly_select'
  ) THEN
    CREATE POLICY hr_attendance_monthly_select ON hr_attendance_monthly
      FOR SELECT USING (
        org_id = (
          SELECT uo.org_id FROM user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active LIMIT 1
        )
      );
    CREATE POLICY hr_attendance_monthly_manage ON hr_attendance_monthly
      FOR ALL USING (
        org_id = (
          SELECT uo.org_id FROM user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active
            AND uo.role IN ('admin','manager') LIMIT 1
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'hr_payroll_locks_select'
  ) THEN
    CREATE POLICY hr_payroll_locks_select ON hr_payroll_locks
      FOR SELECT USING (
        org_id = (
          SELECT uo.org_id FROM user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active LIMIT 1
        )
      );
    CREATE POLICY hr_payroll_locks_manage ON hr_payroll_locks
      FOR ALL USING (
        org_id = (
          SELECT uo.org_id FROM user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active
            AND uo.role IN ('admin','manager') LIMIT 1
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'hr_payroll_account_mappings_select'
  ) THEN
    CREATE POLICY hr_payroll_account_mappings_select ON hr_payroll_account_mappings
      FOR SELECT USING (
        org_id = (
          SELECT uo.org_id FROM user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active LIMIT 1
        )
      );
    CREATE POLICY hr_payroll_account_mappings_manage ON hr_payroll_account_mappings
      FOR ALL USING (
        org_id = (
          SELECT uo.org_id FROM user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active
            AND uo.role IN ('admin','manager') LIMIT 1
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7) Seed default policy per organization (optional)
-- ---------------------------------------------------------------------

INSERT INTO hr_policies (org_id)
SELECT o.id
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM hr_policies hp WHERE hp.org_id = o.id
);

DO $$
BEGIN
  RAISE NOTICE '✅ HR core extensions deployed (policies, attendance, payroll locks).';
END $$;

