-- ===================================================================
-- GENERAL LEDGER FOUNDATION FOR WARDAH ERP
-- SAP-like GL architecture with proper audit trails and controls
-- ===================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===================================================================
-- CHART OF ACCOUNTS
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT,
    account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    account_subtype TEXT, -- receivables, payables, inventory, cash, etc.
    is_leaf BOOLEAN DEFAULT true, -- true if can have postings, false if header account
    parent_id UUID REFERENCES accounts(id),
    is_active BOOLEAN DEFAULT true,
    currency_code TEXT DEFAULT 'SAR',
    
    -- Audit fields
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    
    UNIQUE(tenant_id, code)
);

-- Index for performance
CREATE INDEX idx_accounts_tenant_type ON accounts(tenant_id, account_type);
CREATE INDEX idx_accounts_parent ON accounts(parent_id);

-- ===================================================================
-- JOURNALS (Document Types)
-- ===================================================================
CREATE TABLE IF NOT EXISTS journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT,
    journal_type TEXT NOT NULL CHECK (journal_type IN ('general', 'sales', 'purchase', 'cash', 'bank', 'manufacturing')),
    sequence_prefix TEXT, -- e.g., 'JE', 'SI', 'PI', 'CR', 'BR', 'MO'
    is_active BOOLEAN DEFAULT true,
    
    -- Audit fields
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    
    UNIQUE(tenant_id, code)
);

-- Index for performance
CREATE INDEX idx_journals_tenant ON journals(tenant_id);

-- ===================================================================
-- ACCOUNTING PERIODS
-- ===================================================================
CREATE TABLE IF NOT EXISTS accounting_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_code TEXT NOT NULL, -- e.g., '2024-01', '2024-Q1'
    period_name TEXT NOT NULL,
    period_type TEXT NOT NULL CHECK (period_type IN ('month', 'quarter', 'year')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    fiscal_year INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'permanently_closed')),
    
    -- Audit fields
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    
    UNIQUE(tenant_id, period_code),
    CHECK (start_date <= end_date)
);

-- Index for performance
CREATE INDEX idx_periods_tenant_dates ON accounting_periods(tenant_id, start_date, end_date);

-- ===================================================================
-- JOURNAL ENTRIES (Document Headers)
-- ===================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id UUID NOT NULL REFERENCES journals(id),
    entry_number TEXT NOT NULL, -- Auto-generated based on journal sequence
    entry_date DATE NOT NULL,
    posting_date DATE, -- When posted to GL
    period_id UUID REFERENCES accounting_periods(id),
    
    -- Reference information
    reference_type TEXT, -- 'manufacturing_order', 'purchase_receipt', 'sales_invoice', etc.
    reference_id UUID, -- ID of the source document
    reference_number TEXT, -- User-friendly reference number
    
    description TEXT,
    description_ar TEXT,
    
    -- Status and control
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
    posted_at TIMESTAMPTZ,
    posted_by UUID,
    
    -- Reversal tracking
    reversed_by_entry_id UUID REFERENCES journal_entries(id),
    reversal_reason TEXT,
    
    -- Totals for validation
    total_debit NUMERIC(18,4) DEFAULT 0,
    total_credit NUMERIC(18,4) DEFAULT 0,
    
    -- Audit fields
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    
    UNIQUE(tenant_id, entry_number),
    CHECK (total_debit >= 0 AND total_credit >= 0)
);

-- Indexes for performance
CREATE INDEX idx_journal_entries_tenant ON journal_entries(tenant_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(tenant_id, entry_date);
CREATE INDEX idx_journal_entries_status ON journal_entries(tenant_id, status);
CREATE INDEX idx_journal_entries_reference ON journal_entries(tenant_id, reference_type, reference_id);

-- ===================================================================
-- JOURNAL LINES (Line Items)
-- ===================================================================
CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    account_id UUID NOT NULL REFERENCES accounts(id),
    
    -- Analytical dimensions
    cost_center_id UUID, -- Reference to cost centers (work centers)
    partner_id UUID, -- Customer/Supplier ID
    product_id UUID, -- Product/Material ID
    project_id UUID, -- Project/Manufacturing Order ID
    
    -- Amounts
    debit NUMERIC(18,4) DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(18,4) DEFAULT 0 CHECK (credit >= 0),
    currency_code TEXT DEFAULT 'SAR',
    
    -- Line description
    description TEXT,
    description_ar TEXT,
    
    -- Reconciliation tracking
    reconciled BOOLEAN DEFAULT false,
    reconciled_at TIMESTAMPTZ,
    reconciled_by UUID,
    
    -- Audit fields
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(entry_id, line_number),
    CHECK ((debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)) -- Either debit OR credit, not both
);

-- Indexes for performance and reporting
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(tenant_id, account_id);
CREATE INDEX idx_journal_lines_cost_center ON journal_lines(tenant_id, cost_center_id);
CREATE INDEX idx_journal_lines_partner ON journal_lines(tenant_id, partner_id);

-- ===================================================================
-- ROW LEVEL SECURITY (RLS)
-- ===================================================================
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

-- Policies for accounts
CREATE POLICY accounts_tenant_isolation ON accounts
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for journals
CREATE POLICY journals_tenant_isolation ON journals
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for accounting periods
CREATE POLICY periods_tenant_isolation ON accounting_periods
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for journal entries
CREATE POLICY journal_entries_tenant_isolation ON journal_entries
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for journal lines
CREATE POLICY journal_lines_tenant_isolation ON journal_lines
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- ===================================================================
-- TRIGGERS FOR AUDIT FIELDS
-- ===================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_journals_updated_at BEFORE UPDATE ON journals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_periods_updated_at BEFORE UPDATE ON accounting_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_entries_updated_at BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===================================================================
-- VALIDATION TRIGGER FOR JOURNAL ENTRIES
-- ===================================================================
CREATE OR REPLACE FUNCTION validate_journal_entry()
RETURNS TRIGGER AS $$
DECLARE
    v_total_debit NUMERIC(18,4);
    v_total_credit NUMERIC(18,4);
BEGIN
    -- Calculate totals from lines
    SELECT 
        COALESCE(SUM(debit), 0),
        COALESCE(SUM(credit), 0)
    INTO v_total_debit, v_total_credit
    FROM journal_lines 
    WHERE entry_id = NEW.id;
    
    -- Update totals in header
    NEW.total_debit = v_total_debit;
    NEW.total_credit = v_total_credit;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER validate_journal_entry_trigger 
    BEFORE INSERT OR UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION validate_journal_entry();

-- ===================================================================
-- INITIAL CHART OF ACCOUNTS (BASIC STRUCTURE)
-- ===================================================================
INSERT INTO accounts (tenant_id, code, name, name_ar, account_type, account_subtype, is_leaf) VALUES
-- Assets
('00000000-0000-0000-0000-000000000001', '1000', 'ASSETS', 'الأصول', 'asset', 'OTHER', false),
('00000000-0000-0000-0000-000000000001', '1100', 'Current Assets', 'الأصول المتداولة', 'asset', 'OTHER', false),
('00000000-0000-0000-0000-000000000001', '1110', 'Cash and Bank', 'النقد والبنك', 'asset', 'CASH', true),
('00000000-0000-0000-0000-000000000001', '1120', 'Accounts Receivable', 'العملاء', 'asset', 'RECEIVABLE', true),
('00000000-0000-0000-0000-000000000001', '1130', 'Inventory - Raw Materials', 'المخزون - مواد خام', 'asset', 'RM', true),
('00000000-0000-0000-0000-000000000001', '1131', 'Inventory - WIP', 'المخزون - تحت التشغيل', 'asset', 'WIP', true),
('00000000-0000-0000-0000-000000000001', '1132', 'Inventory - Finished Goods', 'المخزون - منتجات تامة', 'asset', 'FG', true),

-- Liabilities
('00000000-0000-0000-0000-000000000001', '2000', 'LIABILITIES', 'الخصوم', 'liability', 'OTHER', false),
('00000000-0000-0000-0000-000000000001', '2100', 'Current Liabilities', 'الخصوم المتداولة', 'liability', 'OTHER', false),
('00000000-0000-0000-0000-000000000001', '2110', 'Accounts Payable', 'الموردين', 'liability', 'PAYABLE', true),
('00000000-0000-0000-0000-000000000001', '2120', 'Accrued Wages', 'الأجور المستحقة', 'liability', 'ACCRUED', true),
('00000000-0000-0000-0000-000000000001', '2130', 'GR/IR Clearing', 'تسوية الاستلام/الفوترة', 'liability', 'CLEARING', true),

-- Equity
('00000000-0000-0000-0000-000000000001', '3000', 'EQUITY', 'حقوق الملكية', 'equity', 'OTHER', false),
('00000000-0000-0000-0000-000000000001', '3100', 'Capital', 'رأس المال', 'equity', 'CAPITAL', true),
('00000000-0000-0000-0000-000000000001', '3200', 'Retained Earnings', 'الأرباح المحتجزة', 'equity', 'RETAINED_EARNINGS', true),

-- Revenue
('00000000-0000-0000-0000-000000000001', '4000', 'REVENUE', 'الإيرادات', 'revenue', 'OTHER', false),
('00000000-0000-0000-0000-000000000001', '4100', 'Sales Revenue', 'إيرادات المبيعات', 'revenue', 'SALES', true),

-- Expenses
('00000000-0000-0000-0000-000000000001', '5000', 'EXPENSES', 'المصروفات', 'expense', 'OTHER', false),
('00000000-0000-0000-0000-000000000001', '5100', 'Cost of Goods Sold', 'تكلفة البضاعة المباعة', 'expense', 'COGS', true),
('00000000-0000-0000-0000-000000000001', '5200', 'Manufacturing Overhead', 'الأعباء الصناعية', 'expense', 'OVERHEAD', true),
('00000000-0000-0000-0000-000000000001', '5210', 'Direct Labor', 'العمالة المباشرة', 'expense', 'LABOR', true),
('00000000-0000-0000-0000-000000000001', '5220', 'Manufacturing Overhead Applied', 'الأعباء الصناعية المحملة', 'expense', 'OVERHEAD_APPLIED', true),
('00000000-0000-0000-0000-000000000001', '5300', 'Operating Expenses', 'المصروفات التشغيلية', 'expense', 'OPERATING', false),
('00000000-0000-0000-0000-000000000001', '5310', 'Salaries and Wages', 'الرواتب والأجور', 'expense', 'SALARIES', true);

-- Basic Journals
INSERT INTO journals (tenant_id, code, name, name_ar, journal_type, sequence_prefix) VALUES
('00000000-0000-0000-0000-000000000001', 'GJ', 'General Journal', 'اليومية العامة', 'general', 'JE'),
('00000000-0000-0000-0000-000000000001', 'MJ', 'Manufacturing Journal', 'يومية التصنيع', 'manufacturing', 'MJ'),
('00000000-0000-0000-0000-000000000001', 'PJ', 'Purchase Journal', 'يومية المشتريات', 'purchase', 'PJ'),
('00000000-0000-0000-0000-000000000001', 'SJ', 'Sales Journal', 'يومية المبيعات', 'sales', 'SJ');

-- Default accounting period for 2024
INSERT INTO accounting_periods (tenant_id, period_code, period_name, period_type, start_date, end_date, fiscal_year) VALUES
('00000000-0000-0000-0000-000000000001', '2024-01', 'January 2024', 'month', '2024-01-01', '2024-01-31', 2024),
('00000000-0000-0000-0000-000000000001', '2024-02', 'February 2024', 'month', '2024-02-01', '2024-02-29', 2024),
('00000000-0000-0000-0000-000000000001', '2024-03', 'March 2024', 'month', '2024-03-01', '2024-03-31', 2024),
('00000000-0000-0000-0000-000000000001', '2024-04', 'April 2024', 'month', '2024-04-01', '2024-04-30', 2024),
('00000000-0000-0000-0000-000000000001', '2024-05', 'May 2024', 'month', '2024-05-01', '2024-05-31', 2024),
('00000000-0000-0000-0000-000000000001', '2024-06', 'June 2024', 'month', '2024-06-01', '2024-06-30', 2024),
('00000000-0000-0000-0000-000000000001', '2024-07', 'July 2024', 'month', '2024-07-01', '2024-07-31', 2024),
('00000000-0000-0000-0000-000000000001', '2024-08', 'August 2024', 'month', '2024-08-01', '2024-08-31', 2024),
('00000000-0000-0000-0000-000000000001', '2024-09', 'September 2024', 'month', '2024-09-01', '2024-09-30', 2024),
('00000000-0000-0000-0000-000000000001', '2024-10', 'October 2024', 'month', '2024-10-01', '2024-10-31', 2024),
('00000000-0000-0000-0000-000000000001', '2024-11', 'November 2024', 'month', '2024-11-01', '2024-11-30', 2024),
('00000000-0000-0000-0000-000000000001', '2024-12', 'December 2024', 'month', '2024-12-01', '2024-12-31', 2024);