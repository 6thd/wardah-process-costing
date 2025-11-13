-- ===================================================================
-- FIX ACCOUNT STATEMENT FUNCTION TO WORK WITH gl_accounts
-- ===================================================================

-- Drop old function
DROP FUNCTION IF EXISTS get_account_statement(UUID, DATE, DATE, BOOLEAN);

-- Create updated function that works with gl_accounts
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
    v_account_code TEXT;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    -- Try to get account from gl_accounts first, then accounts
    SELECT account_type, code INTO v_account_type, v_account_code
    FROM (
        SELECT account_type, code, org_id as tenant_id, id
        FROM gl_accounts
        WHERE id = p_account_id
        UNION ALL
        SELECT account_type, code, tenant_id, id
        FROM accounts
        WHERE id = p_account_id
    ) combined_accounts
    WHERE tenant_id = v_tenant_id
    LIMIT 1;
    
    IF v_account_type IS NULL THEN
        RAISE EXCEPTION 'Account not found or access denied';
    END IF;
    
    -- Calculate opening balance
    IF p_from_date IS NOT NULL THEN
        SELECT 
            CASE 
                WHEN v_account_type IN ('asset', 'expense', 'ASSET', 'EXPENSE') THEN
                    COALESCE(SUM(jl.debit - jl.credit), 0)
                ELSE
                    COALESCE(SUM(jl.credit - jl.debit), 0)
            END
        INTO v_opening_balance
        FROM journal_lines jl
        JOIN journal_entries je ON jl.entry_id = je.id
        WHERE jl.account_id = p_account_id
        AND jl.org_id = v_tenant_id
        AND je.org_id = v_tenant_id
        AND je.entry_date < p_from_date
        AND (p_include_unposted OR je.status = 'posted');
    END IF;
    
    -- Return statement lines
    RETURN QUERY
    SELECT 
        je.entry_date,
        je.entry_number,
        COALESCE(jl.description, je.description) as description,
        COALESCE(jl.description_ar, je.description_ar) as description_ar,
        jl.debit,
        jl.credit,
        CASE 
            WHEN v_account_type IN ('asset', 'expense', 'ASSET', 'EXPENSE') THEN
                jl.debit - jl.credit
            ELSE
                jl.credit - jl.debit
        END as balance,
        v_opening_balance + 
        SUM(CASE 
            WHEN v_account_type IN ('asset', 'expense', 'ASSET', 'EXPENSE') THEN
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
    AND jl.org_id = v_tenant_id
    AND je.org_id = v_tenant_id
    AND (p_from_date IS NULL OR je.entry_date >= p_from_date)
    AND je.entry_date <= p_to_date
    AND (p_include_unposted OR je.status = 'posted')
    ORDER BY je.entry_date, je.entry_number, jl.line_number;
END;
$$;

-- ===================================================================
-- ALTERNATIVE: Function that works with account code instead of ID
-- ===================================================================
CREATE OR REPLACE FUNCTION get_account_statement_by_code(
    p_account_code TEXT,
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
    v_account_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    -- Get account ID and type from gl_accounts
    SELECT id, account_type INTO v_account_id, v_account_type
    FROM gl_accounts
    WHERE code = p_account_code 
    AND org_id = v_tenant_id
    AND is_active = true
    LIMIT 1;
    
    IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Account not found: %', p_account_code;
    END IF;
    
    -- Calculate opening balance
    IF p_from_date IS NOT NULL THEN
        SELECT 
            CASE 
                WHEN v_account_type IN ('asset', 'expense', 'ASSET', 'EXPENSE') THEN
                    COALESCE(SUM(jl.debit - jl.credit), 0)
                ELSE
                    COALESCE(SUM(jl.credit - jl.debit), 0)
            END
        INTO v_opening_balance
        FROM journal_lines jl
        JOIN journal_entries je ON jl.entry_id = je.id
        WHERE jl.account_id = v_account_id
        AND jl.org_id = v_tenant_id
        AND je.org_id = v_tenant_id
        AND je.entry_date < p_from_date
        AND (p_include_unposted OR je.status = 'posted');
    END IF;
    
    -- Return statement lines
    RETURN QUERY
    SELECT 
        je.entry_date,
        je.entry_number,
        COALESCE(jl.description, je.description) as description,
        COALESCE(jl.description_ar, je.description_ar) as description_ar,
        jl.debit,
        jl.credit,
        CASE 
            WHEN v_account_type IN ('asset', 'expense', 'ASSET', 'EXPENSE') THEN
                jl.debit - jl.credit
            ELSE
                jl.credit - jl.debit
        END as balance,
        v_opening_balance + 
        SUM(CASE 
            WHEN v_account_type IN ('asset', 'expense', 'ASSET', 'EXPENSE') THEN
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
    WHERE jl.account_id = v_account_id
    AND jl.org_id = v_tenant_id
    AND je.org_id = v_tenant_id
    AND (p_from_date IS NULL OR je.entry_date >= p_from_date)
    AND je.entry_date <= p_to_date
    AND (p_include_unposted OR je.status = 'posted')
    ORDER BY je.entry_date, je.entry_number, jl.line_number;
END;
$$;

