-- ===================================================================
-- GL MAPPINGS AND PERIODS FOR PROCESS COSTING
-- Enhanced accounting integration with proper controls
-- ===================================================================

-- ===================================================================
-- GL ACCOUNTS (Enhanced for Process Costing)
-- ===================================================================
CREATE TABLE IF NOT EXISTS gl_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS','WIP','RM','FG')),
    parent_id UUID REFERENCES gl_accounts(id),
    is_active BOOLEAN DEFAULT true,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_gl_accounts_tenant_code ON gl_accounts(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_type ON gl_accounts(tenant_id, type);

-- Insert basic process costing accounts
INSERT INTO gl_accounts (code, name, type, tenant_id) VALUES
-- Expenses
('5100', 'Actual Manufacturing Overhead', 'EXPENSE', '00000000-0000-0000-0000-000000000001'),
('5101', 'Applied Manufacturing Overhead', 'EXPENSE', '00000000-0000-0000-0000-000000000001'),
('5250', 'Overhead Variance', 'EXPENSE', '00000000-0000-0000-0000-000000000001'),

-- WIP Accounts by stage
('WIP-PP', 'WIP - PP Production', 'WIP', '00000000-0000-0000-0000-000000000001'),
('WIP-PS', 'WIP - PS Production', 'WIP', '00000000-0000-0000-0000-000000000001'),
('WIP-PET', 'WIP - PET Production', 'WIP', '00000000-0000-0000-0000-000000000001'),
('WIP-ROLLS', 'WIP - Rolls Processing', 'WIP', '00000000-0000-0000-0000-000000000001'),

-- External Processing
('500', 'External Processing Materials', 'ASSET', '00000000-0000-0000-0000-000000000001'),
('200', 'External Processing (Invoices)', 'ASSET', '00000000-0000-0000-0000-000000000001'),
('30', 'Input VAT', 'ASSET', '00000000-0000-0000-0000-000000000001'),
('230', 'Accounts Payable (Suppliers)', 'LIABILITY', '00000000-0000-0000-0000-000000000001'),

-- Raw Materials
('700-PP', 'Raw Materials - PP', 'RM', '00000000-0000-0000-0000-000000000001'),
('700-PS', 'Raw Materials - PS', 'RM', '00000000-0000-0000-0000-000000000001'),
('700-PET', 'Raw Materials - PET', 'RM', '00000000-0000-0000-0000-000000000001'),

-- Finished Goods (Scrap)
('FG-SCRAP', 'Finished Goods - Scrap', 'FG', '00000000-0000-0000-0000-000000000001'),
('REV-SCRAP', 'Revenue from Scrap Sales', 'REVENUE', '00000000-0000-0000-0000-000000000001'),
('COGS-SCRAP', 'COGS - Scrap', 'COGS', '00000000-0000-0000-0000-000000000001');

-- ===================================================================
-- GL MAPPINGS (Event to Account Mapping)
-- ===================================================================
CREATE TABLE IF NOT EXISTS gl_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_type TEXT NOT NULL CHECK (key_type IN ('EVENT','WORK_CENTER','MATERIAL','STAGE')),
    key_value TEXT NOT NULL, -- e.g., EVENT: 'SCRAP_TO_FG', WORK_CENTER: 'WC-ROLLS', MATERIAL:'PP'
    debit_account_code TEXT NOT NULL,
    credit_account_code TEXT NOT NULL,
    notes TEXT,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (key_type, key_value, tenant_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gl_mappings_tenant_key ON gl_mappings(tenant_id, key_type, key_value);
CREATE INDEX IF NOT EXISTS idx_gl_mappings_accounts ON gl_mappings(tenant_id, debit_account_code, credit_account_code);

-- Insert basic mappings for process costing events
INSERT INTO gl_mappings (key_type, key_value, debit_account_code, credit_account_code, notes, tenant_id) VALUES
-- Scrap to Finished Goods
('EVENT', 'SCRAP_TO_FG', 'FG-SCRAP', 'WIP-ROLLS', 'Convert scrap to finished goods', '00000000-0000-0000-0000-000000000001'),
('EVENT', 'SCRAP_COGS', 'COGS-SCRAP', 'FG-SCRAP', 'COGS for scrap sales', '00000000-0000-0000-0000-000000000001'),

-- Regrind processing
('EVENT', 'REGRIND_TO_PP', 'WIP-PP', 'WIP-ROLLS', 'Convert regrind to PP production', '00000000-0000-0000-0000-000000000001'),
('EVENT', 'REGRIND_TO_PS', 'WIP-PS', 'WIP-ROLLS', 'Convert regrind to PS production', '00000000-0000-0000-0000-000000000001'),
('EVENT', 'REGRIND_TO_PET', 'WIP-PET', 'WIP-ROLLS', 'Convert regrind to PET production', '00000000-0000-0000-0000-000000000001'),

-- External processing
('EVENT', 'SEND_EXTERNAL', '500', 'WIP-ROLLS', 'Send for external processing', '00000000-0000-0000-0000-000000000001'),
('EVENT', 'RECEIVE_PP', '700-PP', '200', 'Receive PP materials from external', '00000000-0000-0000-0000-000000000001'),
('EVENT', 'RECEIVE_PS', '700-PS', '200', 'Receive PS materials from external', '00000000-0000-0000-0000-000000000001'),
('EVENT', 'RECEIVE_PET', '700-PET', '200', 'Receive PET materials from external', '00000000-0000-0000-0000-000000000001'),

-- Work Center OH mappings
('WORK_CENTER', 'WC-PP', 'WIP-PP', '5101', 'OH applied to WIP-PP', '00000000-0000-0000-0000-000000000001'),
('WORK_CENTER', 'WC-PS', 'WIP-PS', '5101', 'OH applied to WIP-PS', '00000000-0000-0000-0000-000000000001'),
('WORK_CENTER', 'WC-PET', 'WIP-PET', '5101', 'OH applied to WIP-PET', '00000000-0000-0000-0000-000000000001');

-- ===================================================================
-- ACCOUNTING PERIODS
-- ===================================================================
CREATE TABLE IF NOT EXISTS gl_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')),
    tenant_id UUID NOT NULL,
    UNIQUE (tenant_id, period_start, period_end)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_gl_periods_tenant_dates ON gl_periods(tenant_id, period_start, period_end);

-- Insert sample periods
INSERT INTO gl_periods (period_start, period_end, status, tenant_id) VALUES
('2024-01-01', '2024-01-31', 'OPEN', '00000000-0000-0000-0000-000000000001'),
('2024-02-01', '2024-02-29', 'OPEN', '00000000-0000-0000-0000-000000000001'),
('2024-03-01', '2024-03-31', 'OPEN', '00000000-0000-0000-0000-000000000001');

-- ===================================================================
-- SEQUENCE FOR JOURNAL ENTRY NUMBERS
-- ===================================================================
CREATE SEQUENCE IF NOT EXISTS gl_jv_seq;

-- ===================================================================
-- JOURNAL HEADERS
-- ===================================================================
CREATE TABLE IF NOT EXISTS gl_journal_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jv_no TEXT UNIQUE NOT NULL,
    jv_date DATE NOT NULL DEFAULT CURRENT_DATE,
    memo TEXT,
    source_ref_type TEXT, -- 'MO','BATCH','INVOICE','ADJUSTMENT','EVENT'
    source_ref_id UUID,
    idempotency_key TEXT, -- to prevent duplicate postings
    total_amount NUMERIC(18,4) DEFAULT 0,
    currency_code TEXT DEFAULT 'SAR',
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_gl_headers_tenant ON gl_journal_headers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gl_headers_ref ON gl_journal_headers(tenant_id, source_ref_type, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_gl_headers_date ON gl_journal_headers(tenant_id, jv_date);

-- ===================================================================
-- JOURNAL LINES
-- ===================================================================
CREATE TABLE IF NOT EXISTS gl_journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    header_id UUID NOT NULL REFERENCES gl_journal_headers(id) ON DELETE CASCADE,
    line_no INT NOT NULL,
    account_code TEXT NOT NULL,
    dr NUMERIC(18,4) DEFAULT 0 CHECK (dr>=0),
    cr NUMERIC(18,4) DEFAULT 0 CHECK (cr>=0),
    description TEXT,
    tenant_id UUID NOT NULL,
    UNIQUE (header_id, line_no)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gl_lines_hdr ON gl_journal_lines(header_id);
CREATE INDEX IF NOT EXISTS idx_gl_lines_tenant ON gl_journal_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gl_lines_account ON gl_journal_lines(tenant_id, account_code);

-- ===================================================================
-- FUNCTION TO ASSERT OPEN PERIOD
-- ===================================================================
CREATE OR REPLACE FUNCTION gl_assert_open_period(p_tenant UUID, p_date DATE)
RETURNS VOID 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
    v_cnt INT;
BEGIN
    -- Check tenant access
    IF current_setting('app.current_tenant_id', true)::UUID != p_tenant THEN
        RAISE EXCEPTION 'Unauthorized tenant';
    END IF;

    SELECT COUNT(*) INTO v_cnt
    FROM gl_periods
    WHERE tenant_id = p_tenant
      AND p_date BETWEEN period_start AND period_end
      AND status = 'OPEN';

    IF v_cnt = 0 THEN
        RAISE EXCEPTION 'GL period closed for date %', p_date;
    END IF;
END $$;

-- ===================================================================
-- TRIGGER TO ENSURE JOURNAL BALANCE
-- ===================================================================
CREATE OR REPLACE FUNCTION trg_gl_assert_balanced()
RETURNS TRIGGER 
LANGUAGE plpgsql 
AS $$
DECLARE 
    v_dr NUMERIC; 
    v_cr NUMERIC;
BEGIN
    SELECT COALESCE(SUM(dr), 0), COALESCE(SUM(cr), 0)
      INTO v_dr, v_cr
    FROM gl_journal_lines 
    WHERE header_id = NEW.id;

    IF v_dr <> v_cr THEN
        RAISE EXCEPTION 'Unbalanced JV: DR=% CR=%', v_dr, v_cr;
    END IF;

    UPDATE gl_journal_headers
      SET total_amount = v_dr
    WHERE id = NEW.id;

    RETURN NEW;
END $$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS t_gl_hdr_balance ON gl_journal_headers;

-- Create trigger for journal balance validation
CREATE TRIGGER t_gl_hdr_balance
AFTER INSERT OR UPDATE ON gl_journal_headers
FOR EACH ROW EXECUTE FUNCTION trg_gl_assert_balanced();

-- ===================================================================
-- RLS POLICIES
-- ===================================================================
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_journal_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_periods ENABLE ROW LEVEL SECURITY;

-- Policies for gl_accounts
CREATE POLICY p_gl_accounts_tenant ON gl_accounts
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for gl_mappings
CREATE POLICY p_gl_mappings_tenant ON gl_mappings
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for gl_journal_headers
CREATE POLICY p_gl_headers_tenant ON gl_journal_headers
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for gl_journal_lines
CREATE POLICY p_gl_lines_tenant ON gl_journal_lines
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policies for gl_periods
CREATE POLICY p_gl_periods_tenant ON gl_periods
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);