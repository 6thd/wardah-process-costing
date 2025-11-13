-- ===================================================================
-- GENERAL LEDGER ENHANCEMENTS
-- Account Statement, Reconciliation, Multi-Currency, Cost Centers, Segments
-- ===================================================================

-- ===================================================================
-- COST CENTERS TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT,
    description TEXT,
    parent_id UUID REFERENCES cost_centers(id),
    is_active BOOLEAN DEFAULT true,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, code)
);

CREATE INDEX idx_cost_centers_tenant ON cost_centers(tenant_id);
CREATE INDEX idx_cost_centers_parent ON cost_centers(parent_id);

-- ===================================================================
-- PROFIT CENTERS TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS profit_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT,
    description TEXT,
    parent_id UUID REFERENCES profit_centers(id),
    is_active BOOLEAN DEFAULT true,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, code)
);

CREATE INDEX idx_profit_centers_tenant ON profit_centers(tenant_id);
CREATE INDEX idx_profit_centers_parent ON profit_centers(parent_id);

-- ===================================================================
-- ACCOUNT SEGMENTS TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS account_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_type TEXT NOT NULL, -- 'product', 'region', 'customer', 'project'
    segment_code TEXT NOT NULL,
    segment_name TEXT NOT NULL,
    segment_name_ar TEXT,
    parent_id UUID REFERENCES account_segments(id),
    is_active BOOLEAN DEFAULT true,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, segment_type, segment_code)
);

CREATE INDEX idx_account_segments_tenant ON account_segments(tenant_id);
CREATE INDEX idx_account_segments_type ON account_segments(tenant_id, segment_type);

-- ===================================================================
-- MULTI-CURRENCY SUPPORT
-- ===================================================================

-- Currency Exchange Rates
CREATE TABLE IF NOT EXISTS currency_exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate_date DATE NOT NULL,
    exchange_rate NUMERIC(18,6) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, from_currency, to_currency, rate_date)
);

CREATE INDEX idx_currency_rates_tenant ON currency_exchange_rates(tenant_id);
CREATE INDEX idx_currency_rates_date ON currency_exchange_rates(tenant_id, rate_date);

-- Currency Translation
CREATE TABLE IF NOT EXISTS currency_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID REFERENCES journal_entries(id),
    line_id UUID REFERENCES journal_lines(id),
    original_currency TEXT NOT NULL,
    translated_currency TEXT NOT NULL,
    original_amount NUMERIC(18,4) NOT NULL,
    translated_amount NUMERIC(18,4) NOT NULL,
    exchange_rate NUMERIC(18,6) NOT NULL,
    rate_date DATE NOT NULL,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_currency_translations_entry ON currency_translations(entry_id);
CREATE INDEX idx_currency_translations_line ON currency_translations(line_id);

-- ===================================================================
-- ACCOUNT RECONCILIATION
-- ===================================================================
CREATE TABLE IF NOT EXISTS account_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    reconciliation_date DATE NOT NULL,
    opening_balance NUMERIC(18,4) NOT NULL,
    closing_balance NUMERIC(18,4) NOT NULL,
    reconciled_amount NUMERIC(18,4) NOT NULL,
    unreconciled_amount NUMERIC(18,4) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'disputed')),
    notes TEXT,
    reconciled_by UUID,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(account_id, reconciliation_date)
);

CREATE INDEX idx_account_reconciliations_account ON account_reconciliations(account_id);
CREATE INDEX idx_account_reconciliations_date ON account_reconciliations(tenant_id, reconciliation_date);

-- Reconciliation Items
CREATE TABLE IF NOT EXISTS reconciliation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reconciliation_id UUID NOT NULL REFERENCES account_reconciliations(id) ON DELETE CASCADE,
    journal_line_id UUID REFERENCES journal_lines(id),
    statement_date DATE,
    statement_amount NUMERIC(18,4),
    statement_reference TEXT,
    matched BOOLEAN DEFAULT false,
    matched_at TIMESTAMPTZ,
    matched_by UUID,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_reconciliation_items_reconciliation ON reconciliation_items(reconciliation_id);
CREATE INDEX idx_reconciliation_items_line ON reconciliation_items(journal_line_id);

-- ===================================================================
-- UPDATE JOURNAL LINES TO SUPPORT ENHANCEMENTS
-- ===================================================================

-- Add cost_center_id, profit_center_id, segment_id if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'journal_lines' AND column_name = 'cost_center_id') THEN
        ALTER TABLE journal_lines ADD COLUMN cost_center_id UUID REFERENCES cost_centers(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'journal_lines' AND column_name = 'profit_center_id') THEN
        ALTER TABLE journal_lines ADD COLUMN profit_center_id UUID REFERENCES profit_centers(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'journal_lines' AND column_name = 'segment_id') THEN
        ALTER TABLE journal_lines ADD COLUMN segment_id UUID REFERENCES account_segments(id);
    END IF;
END $$;

-- ===================================================================
-- ACCOUNT STATEMENT FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION get_account_statement(
    p_account_id UUID,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT CURRENT_DATE,
    p_include_unposted BOOLEAN DEFAULT false
)
RETURNS TABLE (
    entry_date DATE,
    entry_number TEXT,
    description TEXT,
    description_ar TEXT,
    debit NUMERIC(18,4),
    credit NUMERIC(18,4),
    balance NUMERIC(18,4),
    running_balance NUMERIC(18,4),
    reference_type TEXT,
    reference_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_opening_balance NUMERIC(18,4) := 0;
    v_account_type TEXT;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    -- Get account type
    SELECT account_type INTO v_account_type
    FROM accounts
    WHERE id = p_account_id AND tenant_id = v_tenant_id;
    
    IF v_account_type IS NULL THEN
        RAISE EXCEPTION 'Account not found or access denied';
    END IF;
    
    -- Calculate opening balance
    IF p_from_date IS NOT NULL THEN
        SELECT 
            CASE 
                WHEN v_account_type IN ('asset', 'expense') THEN
                    COALESCE(SUM(jl.debit - jl.credit), 0)
                ELSE
                    COALESCE(SUM(jl.credit - jl.debit), 0)
            END
        INTO v_opening_balance
        FROM journal_lines jl
        JOIN journal_entries je ON jl.entry_id = je.id
        WHERE jl.account_id = p_account_id
        AND jl.tenant_id = v_tenant_id
        AND je.tenant_id = v_tenant_id
        AND je.entry_date < p_from_date
        AND (p_include_unposted OR je.status = 'posted');
    END IF;
    
    -- Return statement lines
    RETURN QUERY
    SELECT 
        je.entry_date,
        je.entry_number,
        je.description,
        je.description_ar,
        jl.debit,
        jl.credit,
        CASE 
            WHEN v_account_type IN ('asset', 'expense') THEN
                jl.debit - jl.credit
            ELSE
                jl.credit - jl.debit
        END as balance,
        v_opening_balance + 
        SUM(CASE 
            WHEN v_account_type IN ('asset', 'expense') THEN
                jl.debit - jl.credit
            ELSE
                jl.credit - jl.debit
        END) OVER (
            ORDER BY je.entry_date, je.entry_number, jl.line_number
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) as running_balance,
        je.reference_type,
        je.reference_number
    FROM journal_lines jl
    JOIN journal_entries je ON jl.entry_id = je.id
    WHERE jl.account_id = p_account_id
    AND jl.tenant_id = v_tenant_id
    AND je.tenant_id = v_tenant_id
    AND (p_from_date IS NULL OR je.entry_date >= p_from_date)
    AND je.entry_date <= p_to_date
    AND (p_include_unposted OR je.status = 'posted')
    ORDER BY je.entry_date, je.entry_number, jl.line_number;
END;
$$;

-- ===================================================================
-- ACCOUNT RECONCILIATION FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION reconcile_account(
    p_account_id UUID,
    p_reconciliation_date DATE,
    p_statement_items JSONB DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_reconciliation_id UUID;
    v_opening_balance NUMERIC(18,4);
    v_closing_balance NUMERIC(18,4);
    v_unreconciled_amount NUMERIC(18,4);
    v_item JSONB;
    v_result JSON;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    -- Get account balance
    SELECT get_account_balance(p_account_id, p_reconciliation_date, false)
    INTO v_closing_balance;
    
    -- Calculate opening balance
    SELECT get_account_balance(p_account_id, p_reconciliation_date - INTERVAL '1 day', false)
    INTO v_opening_balance;
    
    -- Create reconciliation record
    v_reconciliation_id := gen_random_uuid();
    
    INSERT INTO account_reconciliations (
        id, account_id, reconciliation_date,
        opening_balance, closing_balance,
        reconciled_amount, unreconciled_amount,
        status, tenant_id
    ) VALUES (
        v_reconciliation_id,
        p_account_id,
        p_reconciliation_date,
        v_opening_balance,
        v_closing_balance,
        v_closing_balance - v_opening_balance,
        0,
        'open',
        v_tenant_id
    );
    
    -- Add statement items if provided
    IF p_statement_items IS NOT NULL THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_statement_items)
        LOOP
            INSERT INTO reconciliation_items (
                reconciliation_id,
                statement_date,
                statement_amount,
                statement_reference,
                tenant_id
            ) VALUES (
                v_reconciliation_id,
                (v_item->>'date')::DATE,
                (v_item->>'amount')::NUMERIC(18,4),
                v_item->>'reference',
                v_tenant_id
            );
        END LOOP;
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'reconciliation_id', v_reconciliation_id,
        'opening_balance', v_opening_balance,
        'closing_balance', v_closing_balance,
        'movement', v_closing_balance - v_opening_balance
    );
END;
$$;

-- ===================================================================
-- MULTI-CURRENCY FUNCTIONS
-- ===================================================================

-- Get Exchange Rate
CREATE OR REPLACE FUNCTION get_exchange_rate(
    p_from_currency TEXT,
    p_to_currency TEXT,
    p_rate_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC(18,6)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_rate NUMERIC(18,6);
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    -- Same currency
    IF p_from_currency = p_to_currency THEN
        RETURN 1.0;
    END IF;
    
    -- Get direct rate
    SELECT exchange_rate INTO v_rate
    FROM currency_exchange_rates
    WHERE tenant_id = v_tenant_id
    AND from_currency = p_from_currency
    AND to_currency = p_to_currency
    AND rate_date <= p_rate_date
    AND is_active = true
    ORDER BY rate_date DESC
    LIMIT 1;
    
    -- If not found, try reverse
    IF v_rate IS NULL THEN
        SELECT 1.0 / exchange_rate INTO v_rate
        FROM currency_exchange_rates
        WHERE tenant_id = v_tenant_id
        AND from_currency = p_to_currency
        AND to_currency = p_from_currency
        AND rate_date <= p_rate_date
        AND is_active = true
        ORDER BY rate_date DESC
        LIMIT 1;
    END IF;
    
    RETURN COALESCE(v_rate, 1.0);
END;
$$;

-- Translate Amount
CREATE OR REPLACE FUNCTION translate_amount(
    p_amount NUMERIC(18,4),
    p_from_currency TEXT,
    p_to_currency TEXT,
    p_rate_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC(18,4)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rate NUMERIC(18,6);
BEGIN
    v_rate := get_exchange_rate(p_from_currency, p_to_currency, p_rate_date);
    RETURN p_amount * v_rate;
END;
$$;

-- ===================================================================
-- SEGMENT REPORTING FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION get_segment_report(
    p_segment_type TEXT,
    p_segment_id UUID DEFAULT NULL,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT CURRENT_DATE,
    p_account_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    segment_code TEXT,
    segment_name TEXT,
    account_code TEXT,
    account_name TEXT,
    total_debit NUMERIC(18,4),
    total_credit NUMERIC(18,4),
    balance NUMERIC(18,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    RETURN QUERY
    SELECT 
        seg.segment_code,
        seg.segment_name,
        a.code as account_code,
        a.name as account_name,
        COALESCE(SUM(jl.debit), 0) as total_debit,
        COALESCE(SUM(jl.credit), 0) as total_credit,
        CASE 
            WHEN a.account_type IN ('asset', 'expense') THEN
                COALESCE(SUM(jl.debit - jl.credit), 0)
            ELSE
                COALESCE(SUM(jl.credit - jl.debit), 0)
        END as balance
    FROM account_segments seg
    JOIN journal_lines jl ON jl.segment_id = seg.id
    JOIN journal_entries je ON jl.entry_id = je.id
    JOIN accounts a ON jl.account_id = a.id
    WHERE seg.tenant_id = v_tenant_id
    AND seg.segment_type = p_segment_type
    AND (p_segment_id IS NULL OR seg.id = p_segment_id)
    AND (p_from_date IS NULL OR je.entry_date >= p_from_date)
    AND je.entry_date <= p_to_date
    AND je.status = 'posted'
    AND (p_account_type IS NULL OR a.account_type = p_account_type)
    GROUP BY seg.segment_code, seg.segment_name, a.code, a.name, a.account_type
    ORDER BY seg.segment_code, a.code;
END;
$$;

-- ===================================================================
-- RLS POLICIES
-- ===================================================================
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE profit_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_items ENABLE ROW LEVEL SECURITY;

-- Policies will be added in separate RLS file

