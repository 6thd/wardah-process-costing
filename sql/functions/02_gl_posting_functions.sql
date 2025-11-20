-- ===================================================================
-- GENERAL LEDGER POSTING FUNCTIONS
-- Core GL operations with proper validation and audit trails
-- ===================================================================

-- ===================================================================
-- SEQUENCE GENERATION FOR ENTRY NUMBERS
-- ===================================================================
CREATE OR REPLACE FUNCTION generate_entry_number(p_journal_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_prefix TEXT;
    v_sequence_name TEXT;
    v_next_number INTEGER;
    v_entry_number TEXT;
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get journal prefix and create sequence name
    SELECT sequence_prefix INTO v_prefix
    FROM journals 
    WHERE id = p_journal_id AND tenant_id = v_tenant_id;
    
    IF v_prefix IS NULL THEN
        RAISE EXCEPTION 'Journal not found or access denied';
    END IF;
    
    -- Create tenant-specific sequence name
    v_sequence_name := 'seq_' || lower(v_prefix) || '_' || replace(v_tenant_id::text, '-', '_');
    
    -- Create sequence if it doesn't exist
    BEGIN
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I START WITH 1', v_sequence_name);
    EXCEPTION WHEN OTHERS THEN
        -- Sequence might already exist, ignore error
        NULL;
    END;
    
    -- Get next number
    EXECUTE format('SELECT nextval(%L)', v_sequence_name) INTO v_next_number;
    
    -- Format entry number: PREFIX-YYYY-NNNNNN
    v_entry_number := v_prefix || '-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_number::text, 6, '0');
    
    RETURN v_entry_number;
END;
$$;

-- ===================================================================
-- POST JOURNAL ENTRY
-- ===================================================================
CREATE OR REPLACE FUNCTION post_journal_entry(p_entry_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry RECORD;
    v_total_debit NUMERIC(18,4);
    v_total_credit NUMERIC(18,4);
    v_line_count INTEGER;
    v_tenant_id UUID;
    v_period_id UUID;
    v_result JSON;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get entry details with validation
    SELECT * INTO v_entry
    FROM journal_entries 
    WHERE id = p_entry_id AND tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal entry not found or access denied'
        );
    END IF;
    
    -- Check if already posted
    IF v_entry.status = 'posted' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal entry is already posted'
        );
    END IF;
    
    -- Check if entry is reversed
    IF v_entry.status = 'reversed' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cannot post a reversed entry'
        );
    END IF;
    
    -- Validate journal lines exist
    SELECT 
        COUNT(*),
        COALESCE(SUM(debit), 0),
        COALESCE(SUM(credit), 0)
    INTO v_line_count, v_total_debit, v_total_credit
    FROM journal_lines 
    WHERE entry_id = p_entry_id AND tenant_id = v_tenant_id;
    
    IF v_line_count = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal entry has no lines'
        );
    END IF;
    
    -- Validate balanced entry
    IF v_total_debit != v_total_credit OR v_total_debit = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal entry is not balanced. Debit: ' || v_total_debit || ', Credit: ' || v_total_credit
        );
    END IF;
    
    -- Validate all accounts are posting accounts (leaf accounts)
    IF EXISTS (
        SELECT 1 FROM journal_lines jl
        JOIN accounts a ON jl.account_id = a.id
        WHERE jl.entry_id = p_entry_id 
        AND jl.tenant_id = v_tenant_id
        AND a.tenant_id = v_tenant_id
        AND a.is_leaf = false
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cannot post to header accounts (non-leaf accounts)'
        );
    END IF;
    
    -- Find appropriate accounting period
    SELECT id INTO v_period_id
    FROM accounting_periods
    WHERE tenant_id = v_tenant_id
    AND v_entry.entry_date >= start_date
    AND v_entry.entry_date <= end_date
    AND status = 'open'
    LIMIT 1;
    
    IF v_period_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'No open accounting period found for entry date: ' || v_entry.entry_date
        );
    END IF;
    
    -- Post the entry
    UPDATE journal_entries SET
        status = 'posted',
        posted_at = CURRENT_TIMESTAMP,
        posted_by = current_setting('app.current_user_id', true)::UUID,
        posting_date = CURRENT_DATE,
        period_id = v_period_id,
        total_debit = v_total_debit,
        total_credit = v_total_credit,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = current_setting('app.current_user_id', true)::UUID
    WHERE id = p_entry_id AND tenant_id = v_tenant_id;
    
    -- Return success
    v_result := json_build_object(
        'success', true,
        'message', 'Journal entry posted successfully',
        'entry_id', p_entry_id,
        'entry_number', v_entry.entry_number,
        'total_amount', v_total_debit,
        'posted_at', CURRENT_TIMESTAMP
    );
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Posting failed: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- REVERSE JOURNAL ENTRY
-- ===================================================================
CREATE OR REPLACE FUNCTION reverse_journal_entry(
    p_entry_id UUID,
    p_reversal_reason TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_original_entry RECORD;
    v_reversal_entry_id UUID;
    v_reversal_number TEXT;
    v_line RECORD;
    v_tenant_id UUID;
    v_result JSON;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get original entry details
    SELECT * INTO v_original_entry
    FROM journal_entries 
    WHERE id = p_entry_id AND tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Original journal entry not found or access denied'
        );
    END IF;
    
    -- Check if entry is posted
    IF v_original_entry.status != 'posted' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Can only reverse posted entries'
        );
    END IF;
    
    -- Check if already reversed
    IF v_original_entry.status = 'reversed' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Entry is already reversed'
        );
    END IF;
    
    -- Check if there's already a reversal
    IF v_original_entry.reversed_by_entry_id IS NOT NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Entry already has a reversal'
        );
    END IF;
    
    -- Generate reversal entry ID and number
    v_reversal_entry_id := gen_random_uuid();
    v_reversal_number := generate_entry_number(v_original_entry.journal_id);
    
    -- Create reversal entry header
    INSERT INTO journal_entries (
        id, journal_id, entry_number, entry_date, posting_date, period_id,
        reference_type, reference_id, reference_number,
        description, description_ar,
        status, posted_at, posted_by,
        total_debit, total_credit,
        tenant_id, created_by, updated_by
    ) VALUES (
        v_reversal_entry_id,
        v_original_entry.journal_id,
        v_reversal_number,
        CURRENT_DATE,
        CURRENT_DATE,
        v_original_entry.period_id,
        'reversal',
        p_entry_id,
        'REV-' || v_original_entry.entry_number,
        'Reversal of ' || COALESCE(v_original_entry.description, 'Journal Entry'),
        'عكس قيد: ' || COALESCE(v_original_entry.description_ar, 'قيد يومية'),
        'posted',
        CURRENT_TIMESTAMP,
        current_setting('app.current_user_id', true)::UUID,
        v_original_entry.total_debit,
        v_original_entry.total_credit,
        v_tenant_id,
        current_setting('app.current_user_id', true)::UUID,
        current_setting('app.current_user_id', true)::UUID
    );
    
    -- Create reversal lines (swap debit/credit)
    FOR v_line IN 
        SELECT * FROM journal_lines 
        WHERE entry_id = p_entry_id AND tenant_id = v_tenant_id
        ORDER BY line_number
    LOOP
        INSERT INTO journal_lines (
            entry_id, line_number, account_id,
            cost_center_id, partner_id, product_id, project_id,
            debit, credit, currency_code,
            description, description_ar,
            tenant_id
        ) VALUES (
            v_reversal_entry_id,
            v_line.line_number,
            v_line.account_id,
            v_line.cost_center_id,
            v_line.partner_id,
            v_line.product_id,
            v_line.project_id,
            v_line.credit, -- Swap: original credit becomes debit
            v_line.debit,  -- Swap: original debit becomes credit
            v_line.currency_code,
            'REV: ' || COALESCE(v_line.description, ''),
            'عكس: ' || COALESCE(v_line.description_ar, ''),
            v_tenant_id
        );
    END LOOP;
    
    -- Update original entry to mark as reversed
    UPDATE journal_entries SET
        status = 'reversed',
        reversed_by_entry_id = v_reversal_entry_id,
        reversal_reason = p_reversal_reason,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = current_setting('app.current_user_id', true)::UUID
    WHERE id = p_entry_id AND tenant_id = v_tenant_id;
    
    -- Return success
    v_result := json_build_object(
        'success', true,
        'message', 'Journal entry reversed successfully',
        'original_entry_id', p_entry_id,
        'reversal_entry_id', v_reversal_entry_id,
        'reversal_number', v_reversal_number
    );
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Reversal failed: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- CREATE JOURNAL ENTRY (Helper function)
-- ===================================================================
CREATE OR REPLACE FUNCTION create_journal_entry(
    p_journal_code TEXT,
    p_entry_date DATE,
    p_description TEXT,
    p_description_ar TEXT DEFAULT NULL,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_reference_number TEXT DEFAULT NULL,
    p_lines JSON DEFAULT NULL,
    p_auto_post BOOLEAN DEFAULT false
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_journal_id UUID;
    v_entry_id UUID;
    v_entry_number TEXT;
    v_tenant_id UUID;
    v_line JSON;
    v_line_number INTEGER := 1;
    v_result JSON;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get journal ID
    SELECT id INTO v_journal_id
    FROM journals 
    WHERE code = p_journal_code AND tenant_id = v_tenant_id AND is_active = true;
    
    IF v_journal_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal not found: ' || p_journal_code
        );
    END IF;
    
    -- Generate entry ID and number
    v_entry_id := gen_random_uuid();
    v_entry_number := generate_entry_number(v_journal_id);
    
    -- Create entry header
    INSERT INTO journal_entries (
        id, journal_id, entry_number, entry_date,
        reference_type, reference_id, reference_number,
        description, description_ar,
        status, tenant_id, created_by, updated_by
    ) VALUES (
        v_entry_id,
        v_journal_id,
        v_entry_number,
        p_entry_date,
        p_reference_type,
        p_reference_id,
        p_reference_number,
        p_description,
        p_description_ar,
        'draft',
        v_tenant_id,
        current_setting('app.current_user_id', true)::UUID,
        current_setting('app.current_user_id', true)::UUID
    );
    
    -- Add lines if provided
    IF p_lines IS NOT NULL THEN
        FOR v_line IN SELECT * FROM json_array_elements(p_lines)
        LOOP
            INSERT INTO journal_lines (
                entry_id, line_number, account_id,
                cost_center_id, partner_id, product_id, project_id,
                debit, credit, currency_code,
                description, description_ar,
                tenant_id
            ) VALUES (
                v_entry_id,
                v_line_number,
                (v_line->>'account_id')::UUID,
                (v_line->>'cost_center_id')::UUID,
                (v_line->>'partner_id')::UUID,
                (v_line->>'product_id')::UUID,
                (v_line->>'project_id')::UUID,
                COALESCE((v_line->>'debit')::NUMERIC(18,4), 0),
                COALESCE((v_line->>'credit')::NUMERIC(18,4), 0),
                COALESCE(v_line->>'currency_code', 'SAR'),
                v_line->>'description',
                v_line->>'description_ar',
                v_tenant_id
            );
            
            v_line_number := v_line_number + 1;
        END LOOP;
    END IF;
    
    -- Auto-post if requested
    IF p_auto_post AND p_lines IS NOT NULL THEN
        SELECT post_journal_entry(v_entry_id) INTO v_result;
        IF (v_result->>'success')::BOOLEAN = false THEN
            -- If posting failed, return the posting error
            RETURN v_result;
        END IF;
    END IF;
    
    -- Return success
    v_result := json_build_object(
        'success', true,
        'message', 'Journal entry created successfully',
        'entry_id', v_entry_id,
        'entry_number', v_entry_number,
        'auto_posted', p_auto_post
    );
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Entry creation failed: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- GET ACCOUNT BALANCE
-- ===================================================================
CREATE OR REPLACE FUNCTION get_account_balance(
    p_account_id UUID,
    p_as_of_date DATE DEFAULT CURRENT_DATE,
    p_include_unposted BOOLEAN DEFAULT false
)
RETURNS NUMERIC(18,4)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_balance NUMERIC(18,4) := 0;
    v_tenant_id UUID;
    v_account_type TEXT;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get account type for balance calculation
    SELECT account_type INTO v_account_type
    FROM accounts 
    WHERE id = p_account_id AND tenant_id = v_tenant_id;
    
    IF v_account_type IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Calculate balance based on account type
    SELECT 
        CASE 
            WHEN v_account_type IN ('asset', 'expense') THEN
                COALESCE(SUM(jl.debit - jl.credit), 0)
            ELSE -- liability, equity, revenue
                COALESCE(SUM(jl.credit - jl.debit), 0)
        END
    INTO v_balance
    FROM journal_lines jl
    JOIN journal_entries je ON jl.entry_id = je.id
    WHERE jl.account_id = p_account_id
    AND jl.tenant_id = v_tenant_id
    AND je.tenant_id = v_tenant_id
    AND je.entry_date <= p_as_of_date
    AND (p_include_unposted OR je.status = 'posted');
    
    RETURN COALESCE(v_balance, 0);
END;
$$;

-- ===================================================================
-- TRIAL BALANCE VIEW
-- ===================================================================
CREATE OR REPLACE VIEW trial_balance AS
SELECT 
    a.tenant_id,
    a.id as account_id,
    a.code as account_code,
    a.name as account_name,
    a.name_ar as account_name_ar,
    a.account_type,
    COALESCE(SUM(jl.debit), 0) as total_debit,
    COALESCE(SUM(jl.credit), 0) as total_credit,
    CASE 
        WHEN a.account_type IN ('asset', 'expense') THEN
            COALESCE(SUM(jl.debit - jl.credit), 0)
        ELSE
            COALESCE(SUM(jl.credit - jl.debit), 0)
    END as balance,
    CASE 
        WHEN a.account_type IN ('asset', 'expense') THEN
            CASE WHEN COALESCE(SUM(jl.debit - jl.credit), 0) >= 0 THEN COALESCE(SUM(jl.debit - jl.credit), 0) ELSE 0 END
        ELSE
            CASE WHEN COALESCE(SUM(jl.credit - jl.debit), 0) < 0 THEN ABS(COALESCE(SUM(jl.credit - jl.debit), 0)) ELSE 0 END
    END as debit_balance,
    CASE 
        WHEN a.account_type IN ('asset', 'expense') THEN
            CASE WHEN COALESCE(SUM(jl.debit - jl.credit), 0) < 0 THEN ABS(COALESCE(SUM(jl.debit - jl.credit), 0)) ELSE 0 END
        ELSE
            CASE WHEN COALESCE(SUM(jl.credit - jl.debit), 0) >= 0 THEN COALESCE(SUM(jl.credit - jl.debit), 0) ELSE 0 END
    END as credit_balance
FROM accounts a
LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
WHERE (je.status = 'posted' OR je.id IS NULL)
AND a.is_leaf = true
GROUP BY a.tenant_id, a.id, a.code, a.name, a.name_ar, a.account_type
ORDER BY a.code;