-- =======================================
-- HR MODULE DATABASE SCHEMA
-- For Wardah ERP System
-- =======================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =======================================
-- 1. EMPLOYEES TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id VARCHAR(50) NOT NULL, -- Employee code/ID
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    full_name VARCHAR(200) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20),
    date_of_birth DATE,
    gender VARCHAR(10) CHECK (gender IN ('male', 'female')),
    nationality VARCHAR(100),
    id_number VARCHAR(50),
    passport_number VARCHAR(50),
    hire_date DATE NOT NULL,
    termination_date DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated')),
    department VARCHAR(100),
    position VARCHAR(100),
    grade_level VARCHAR(50),
    manager_id UUID REFERENCES employees(id),
    salary DECIMAL(12,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'SAR',
    bank_name VARCHAR(100),
    bank_account VARCHAR(50),
    iban VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, employee_id)
);

-- =======================================
-- 2. DEPARTMENTS TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description TEXT,
    manager_id UUID REFERENCES employees(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- =======================================
-- 3. POSITIONS TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description TEXT,
    department_id UUID REFERENCES departments(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- =======================================
-- 4. SALARY COMPONENTS TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS salary_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    component_type VARCHAR(20) NOT NULL CHECK (component_type IN ('earning', 'deduction', 'benefit')),
    calculation_type VARCHAR(20) DEFAULT 'fixed' CHECK (calculation_type IN ('fixed', 'percentage', 'formula')),
    value DECIMAL(12,2) DEFAULT 0,
    percentage_base VARCHAR(50), -- For percentage calculations
    is_active BOOLEAN DEFAULT true,
    is_taxable BOOLEAN DEFAULT true,
    is_insurable BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- =======================================
-- 5. EMPLOYEE SALARY STRUCTURE TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS employee_salary_structures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES salary_components(id),
    value DECIMAL(12,2) DEFAULT 0,
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, employee_id, component_id, effective_from)
);

-- =======================================
-- 6. PAYROLL PERIODS TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS payroll_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_code VARCHAR(20) NOT NULL, -- e.g., '2024-01', '2024-Q1'
    period_name VARCHAR(100) NOT NULL,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'processed', 'closed')),
    processed_at TIMESTAMPTZ,
    processed_by UUID, -- REFERENCES users(id)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, period_code)
);

-- =======================================
-- 7. PAYROLL RUNS TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS payroll_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES payroll_periods(id),
    run_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'calculated', 'approved', 'paid')),
    total_gross DECIMAL(12,2) DEFAULT 0,
    total_deductions DECIMAL(12,2) DEFAULT 0,
    total_net DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================
-- 8. PAYROLL DETAILS TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS payroll_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id),
    component_id UUID NOT NULL REFERENCES salary_components(id),
    amount DECIMAL(12,2) NOT NULL,
    is_processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================
-- 9. ATTENDANCE RECORDS TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id),
    record_date DATE NOT NULL,
    check_in_time TIMESTAMPTZ,
    check_out_time TIMESTAMPTZ,
    hours_worked DECIMAL(5,2),
    status VARCHAR(20) DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late', 'early_departure', 'leave')),
    leave_type VARCHAR(50), -- If on leave
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, employee_id, record_date)
);

-- =======================================
-- 10. LEAVE TYPES TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS leave_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    description TEXT,
    is_paid BOOLEAN DEFAULT true,
    max_days_per_year INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- =======================================
-- 11. EMPLOYEE LEAVES TABLE
-- =======================================
CREATE TABLE IF NOT EXISTS employee_leaves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id),
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days DECIMAL(5,1) NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_by UUID, -- REFERENCES employees(id)
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================
-- INDEXES FOR PERFORMANCE
-- =======================================
CREATE INDEX IF NOT EXISTS idx_employees_org ON employees(org_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(org_id);
CREATE INDEX IF NOT EXISTS idx_positions_org ON positions(org_id);
CREATE INDEX IF NOT EXISTS idx_salary_components_org ON salary_components(org_id);
CREATE INDEX IF NOT EXISTS idx_employee_salary_structures_org ON employee_salary_structures(org_id);
CREATE INDEX IF NOT EXISTS idx_employee_salary_structures_employee ON employee_salary_structures(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_org ON payroll_periods(org_id);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_status ON payroll_periods(status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_org ON payroll_runs(org_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_details_org ON payroll_details(org_id);
CREATE INDEX IF NOT EXISTS idx_payroll_details_run ON payroll_details(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_org ON attendance_records(org_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records(record_date);
CREATE INDEX IF NOT EXISTS idx_leave_types_org ON leave_types(org_id);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_org ON employee_leaves(org_id);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_employee ON employee_leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_status ON employee_leaves(status);

-- =======================================
-- RLS POLICIES
-- =======================================
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_leaves ENABLE ROW LEVEL SECURITY;

-- Employees policies
CREATE POLICY "Users can view org employees" ON employees
    FOR SELECT USING (org_id = (SELECT uo.org_id FROM user_organizations uo WHERE uo.user_id = auth.uid() AND uo.is_active = true));

CREATE POLICY "Managers can insert employees" ON employees
    FOR INSERT WITH CHECK (org_id = (SELECT uo.org_id FROM user_organizations uo WHERE uo.user_id = auth.uid() AND uo.is_active = true AND uo.role IN ('admin', 'manager')));

CREATE POLICY "Managers can update employees" ON employees
    FOR UPDATE USING (org_id = (SELECT uo.org_id FROM user_organizations uo WHERE uo.user_id = auth.uid() AND uo.is_active = true AND uo.role IN ('admin', 'manager')));

-- Apply similar policies to all other tables
CREATE POLICY "Users can view org departments" ON departments
    FOR SELECT USING (org_id = (SELECT uo.org_id FROM user_organizations uo WHERE uo.user_id = auth.uid() AND uo.is_active = true));

CREATE POLICY "Managers can manage departments" ON departments
    FOR ALL USING (org_id = (SELECT uo.org_id FROM user_organizations uo WHERE uo.user_id = auth.uid() AND uo.is_active = true AND uo.role IN ('admin', 'manager')));

CREATE POLICY "Users can view org positions" ON positions
    FOR SELECT USING (org_id = (SELECT uo.org_id FROM user_organizations uo WHERE uo.user_id = auth.uid() AND uo.is_active = true));

CREATE POLICY "Managers can manage positions" ON positions
    FOR ALL USING (org_id = (SELECT uo.org_id FROM user_organizations uo WHERE uo.user_id = auth.uid() AND uo.is_active = true AND uo.role IN ('admin', 'manager')));

-- Continue with policies for all other tables...

-- =======================================
-- TRIGGERS FOR AUDIT FIELDS
-- =======================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_salary_components_updated_at BEFORE UPDATE ON salary_components
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_salary_structures_updated_at BEFORE UPDATE ON employee_salary_structures
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_periods_updated_at BEFORE UPDATE ON payroll_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_runs_updated_at BEFORE UPDATE ON payroll_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_details_updated_at BEFORE UPDATE ON payroll_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_records_updated_at BEFORE UPDATE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leave_types_updated_at BEFORE UPDATE ON leave_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_leaves_updated_at BEFORE UPDATE ON employee_leaves
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =======================================
-- SAMPLE DATA
-- =======================================

-- Insert sample departments
INSERT INTO departments (org_id, code, name, name_ar, is_active) VALUES
('00000000-0000-0000-0000-000000000001', 'HR', 'Human Resources', 'الموارد البشرية', true),
('00000000-0000-0000-0000-000000000001', 'FIN', 'Finance', 'المالية', true),
('00000000-0000-0000-0000-000000000001', 'MFG', 'Manufacturing', 'التصنيع', true),
('00000000-0000-0000-0000-000000000001', 'SALES', 'Sales', 'المبيعات', true),
('00000000-0000-0000-0000-000000000001', 'IT', 'Information Technology', 'تقنية المعلومات', true);

-- Insert sample positions
INSERT INTO positions (org_id, code, name, name_ar, department_id, is_active) VALUES
('00000000-0000-0000-0000-000000000001', 'MGR', 'Manager', 'مدير', (SELECT id FROM departments WHERE code = 'HR'), true),
('00000000-0000-0000-0000-000000000001', 'SUP', 'Supervisor', 'مشرف', (SELECT id FROM departments WHERE code = 'HR'), true),
('00000000-0000-0000-0000-000000000001', 'SPEC', 'Specialist', 'أخصائي', (SELECT id FROM departments WHERE code = 'HR'), true);

-- Insert sample salary components
INSERT INTO salary_components (org_id, code, name, name_ar, component_type, calculation_type, value, is_active, is_taxable) VALUES
('00000000-0000-0000-0000-000000000001', 'BASIC', 'Basic Salary', 'الراتب الأساسي', 'earning', 'fixed', 5000, true, true),
('00000000-0000-0000-0000-000000000001', 'HRA', 'Housing Allowance', 'بدل السكن', 'earning', 'fixed', 1500, true, true),
('00000000-0000-0000-0000-000000000001', 'TRAN', 'Transportation Allowance', 'بدل المواصلات', 'earning', 'fixed', 500, true, true),
('00000000-0000-0000-0000-000000000001', 'GOSI', 'GOSI Contribution', 'مخصصات التأمينات الاجتماعية', 'deduction', 'percentage', 9.5, true, true),
('00000000-0000-0000-0000-000000000001', 'TAX', 'Income Tax', 'ضريبة الدخل', 'deduction', 'percentage', 5, true, true);

-- Insert sample leave types
INSERT INTO leave_types (org_id, code, name, name_ar, is_paid, max_days_per_year, is_active) VALUES
('00000000-0000-0000-0000-000000000001', 'ANNUAL', 'Annual Leave', 'إجازة سنوية', true, 21, true),
('00000000-0000-0000-0000-000000000001', 'SICK', 'Sick Leave', 'إجازة مرضية', true, 15, true),
('00000000-0000-0000-0000-000000000001', 'EMERGENCY', 'Emergency Leave', 'إجازة طارئة', false, 5, true);

-- =======================================
-- SUCCESS MESSAGE
-- =======================================

RAISE NOTICE '✅ HR Module Database Schema Created Successfully!';
RAISE NOTICE '📋 Next steps:';
RAISE NOTICE '1. Run the HR module React components';
RAISE NOTICE '2. Configure HR settings in the application';
RAISE NOTICE '3. Import employee data';
