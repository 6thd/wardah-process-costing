-- ===================================================================
-- ENHANCED GL POSTING FUNCTIONS
-- Secure, idempotent posting with period validation
-- ===================================================================

-- ===================================================================
-- RPC TO POST EVENT JOURNAL
-- ===================================================================
CREATE OR REPLACE FUNCTION rpc_post_event_journal(
    p_event TEXT,
    p_amount NUMERIC,
    p_memo TEXT,
    p_ref_type TEXT,
    p_ref_id UUID,
    p_tenant UUID,
    p_idempotency_key TEXT DEFAULT NULL,
    p_jv_date DATE DEFAULT CURRENT_DATE
) 
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_debit_acc TEXT;
    v_credit_acc TEXT;
    v_hdr UUID;
    v_tenant UUID := current_setting('app.current_tenant_id', true)::UUID;
    v_jv_no TEXT;
BEGIN
    -- Security check
    IF v_tenant IS NULL OR v_tenant <> p_tenant THEN
        RAISE EXCEPTION 'Unauthorized tenant';
    END IF;

    -- Validate amount
    IF COALESCE(p_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Invalid amount %', p_amount;
    END IF;

    -- Check open period
    PERFORM gl_assert_open_period(p_tenant, COALESCE(p_jv_date, CURRENT_DATE));

    -- Prevent duplicate posting
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_hdr
        FROM gl_journal_headers
        WHERE tenant_id = p_tenant AND idempotency_key = p_idempotency_key;
        
        IF v_hdr IS NOT NULL THEN
            RETURN v_hdr; -- Return existing journal entry
        END IF;
    END IF;

    -- Get account mapping
    SELECT debit_account_code, credit_account_code
      INTO v_debit_acc, v_credit_acc
    FROM gl_mappings
    WHERE key_type = 'EVENT' 
      AND key_value = p_event 
      AND tenant_id = p_tenant;

    IF v_debit_acc IS NULL THEN
        RAISE EXCEPTION 'GL mapping not found for event %', p_event;
    END IF;

    -- Generate journal entry number
    v_jv_no := 'JV-' || TO_CHAR(p_jv_date, 'YYYYMM') || '-' || LPAD(NEXTVAL('gl_jv_seq')::TEXT, 8, '0');

    -- Create journal header
    INSERT INTO gl_journal_headers(
        jv_no, jv_date, memo, source_ref_type, source_ref_id, idempotency_key, tenant_id
    ) VALUES (
        v_jv_no, COALESCE(p_jv_date, CURRENT_DATE), p_memo, p_ref_type, p_ref_id, p_idempotency_key, p_tenant
    ) RETURNING id INTO v_hdr;

    -- Create journal lines
    INSERT INTO gl_journal_lines(header_id, line_no, account_code, dr, cr, description, tenant_id) VALUES
        (v_hdr, 1, v_debit_acc, p_amount, 0, CONCAT(p_event, '-DR'), p_tenant),
        (v_hdr, 2, v_credit_acc, 0, p_amount, CONCAT(p_event, '-CR'), p_tenant);

    -- Validate balance and update total (trigger will handle this)
    -- Just update the header to trigger the balance validation
    UPDATE gl_journal_headers SET updated_at = NOW() WHERE id = v_hdr;

    RETURN v_hdr;
END $$;

-- ===================================================================
-- RPC TO POST WORK CENTER OVERHEAD
-- ===================================================================
CREATE OR REPLACE FUNCTION rpc_post_work_center_oh(
    p_work_center TEXT,
    p_amount NUMERIC,
    p_memo TEXT,
    p_ref_type TEXT,
    p_ref_id UUID,
    p_tenant UUID,
    p_idempotency_key TEXT DEFAULT NULL,
    p_jv_date DATE DEFAULT CURRENT_DATE
) 
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_debit_acc TEXT;
    v_credit_acc TEXT;
    v_hdr UUID;
    v_tenant UUID := current_setting('app.current_tenant_id', true)::UUID;
    v_jv_no TEXT;
BEGIN
    -- Security check
    IF v_tenant IS NULL OR v_tenant <> p_tenant THEN
        RAISE EXCEPTION 'Unauthorized tenant';
    END IF;

    -- Validate amount
    IF COALESCE(p_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Invalid amount %', p_amount;
    END IF;

    -- Check open period
    PERFORM gl_assert_open_period(p_tenant, COALESCE(p_jv_date, CURRENT_DATE));

    -- Prevent duplicate posting
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_hdr
        FROM gl_journal_headers
        WHERE tenant_id = p_tenant AND idempotency_key = p_idempotency_key;
        
        IF v_hdr IS NOT NULL THEN
            RETURN v_hdr; -- Return existing journal entry
        END IF;
    END IF;

    -- Get account mapping
    SELECT debit_account_code, credit_account_code
      INTO v_debit_acc, v_credit_acc
    FROM gl_mappings
    WHERE key_type = 'WORK_CENTER' 
      AND key_value = p_work_center 
      AND tenant_id = p_tenant;

    IF v_debit_acc IS NULL THEN
        RAISE EXCEPTION 'GL mapping not found for work center %', p_work_center;
    END IF;

    -- Generate journal entry number
    v_jv_no := 'JV-' || TO_CHAR(p_jv_date, 'YYYYMM') || '-' || LPAD(NEXTVAL('gl_jv_seq')::TEXT, 8, '0');

    -- Create journal header
    INSERT INTO gl_journal_headers(
        jv_no, jv_date, memo, source_ref_type, source_ref_id, idempotency_key, tenant_id
    ) VALUES (
        v_jv_no, COALESCE(p_jv_date, CURRENT_DATE), p_memo, p_ref_type, p_ref_id, p_idempotency_key, p_tenant
    ) RETURNING id INTO v_hdr;

    -- Create journal lines
    INSERT INTO gl_journal_lines(header_id, line_no, account_code, dr, cr, description, tenant_id) VALUES
        (v_hdr, 1, v_debit_acc, p_amount, 0, CONCAT('OH Applied - ', p_work_center, '-DR'), p_tenant),
        (v_hdr, 2, v_credit_acc, 0, p_amount, CONCAT('OH Applied - ', p_work_center, '-CR'), p_tenant);

    -- Validate balance and update total (trigger will handle this)
    -- Just update the header to trigger the balance validation
    UPDATE gl_journal_headers SET updated_at = NOW() WHERE id = v_hdr;

    RETURN v_hdr;
END $$;

-- ===================================================================
-- RPC TO LINK INVENTORY MOVE TO JOURNAL
-- ===================================================================
CREATE OR REPLACE FUNCTION rpc_link_inventory_move_to_journal(
    p_move_id UUID, 
    p_header_id UUID, 
    p_tenant UUID
) 
RETURNS VOID 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
    -- Security check
    IF current_setting('app.current_tenant_id', true)::UUID <> p_tenant THEN
        RAISE EXCEPTION 'Unauthorized tenant';
    END IF;
    
    -- Update inventory ledger to link to GL entry
    UPDATE inventory_ledger
      SET gl_header_id = p_header_id
      WHERE id = p_move_id AND tenant_id = p_tenant;
END $$;

-- ===================================================================
-- RPC TO GET ACCOUNT BALANCE
-- ===================================================================
CREATE OR REPLACE FUNCTION rpc_get_account_balance(
    p_account_code TEXT,
    p_tenant UUID,
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC(18,4)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance NUMERIC(18,4) := 0;
    v_tenant UUID := current_setting('app.current_tenant_id', true)::UUID;
BEGIN
    -- Security check
    IF v_tenant IS NULL OR v_tenant <> p_tenant THEN
        RAISE EXCEPTION 'Unauthorized tenant';
    END IF;

    -- Calculate account balance
    SELECT 
        COALESCE(SUM(jl.dr - jl.cr), 0)
    INTO v_balance
    FROM gl_journal_lines jl
    JOIN gl_journal_headers jh ON jl.header_id = jh.id
    WHERE jl.account_code = p_account_code
      AND jl.tenant_id = p_tenant
      AND jh.jv_date <= p_as_of_date
      AND jh.tenant_id = p_tenant;

    RETURN v_balance;
END $$;

-- ===================================================================
-- RPC TO GET TRIAL BALANCE
-- ===================================================================
CREATE OR REPLACE FUNCTION rpc_get_trial_balance(
    p_tenant UUID,
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
    account_code TEXT,
    account_name TEXT,
    debit_balance NUMERIC(18,4),
    credit_balance NUMERIC(18,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant UUID := current_setting('app.current_tenant_id', true)::UUID;
BEGIN
    -- Security check
    IF v_tenant IS NULL OR v_tenant <> p_tenant THEN
        RAISE EXCEPTION 'Unauthorized tenant';
    END IF;

    -- Return trial balance
    RETURN QUERY
    SELECT 
        a.code AS account_code,
        a.name AS account_name,
        COALESCE(SUM(CASE WHEN (jl.dr - jl.cr) > 0 THEN (jl.dr - jl.cr) ELSE 0 END), 0) AS debit_balance,
        COALESCE(SUM(CASE WHEN (jl.dr - jl.cr) < 0 THEN ABS(jl.dr - jl.cr) ELSE 0 END), 0) AS credit_balance
    FROM gl_accounts a
    LEFT JOIN gl_journal_lines jl ON a.code = jl.account_code AND jl.tenant_id = p_tenant
    LEFT JOIN gl_journal_headers jh ON jl.header_id = jh.id AND jh.tenant_id = p_tenant
    WHERE a.tenant_id = p_tenant
      AND (jh.jv_date <= p_as_of_date OR jh.id IS NULL)
    GROUP BY a.code, a.name
    ORDER BY a.code;
END $$;

-- ===================================================================
-- GRANT PERMISSIONS
-- ===================================================================
GRANT EXECUTE ON FUNCTION rpc_post_event_journal(TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_post_work_center_oh(TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_link_inventory_move_to_journal(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_account_balance(TEXT, UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trial_balance(UUID, DATE) TO authenticated;

-- Grant to service_role for admin operations
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;