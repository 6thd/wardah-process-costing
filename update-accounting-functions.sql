-- ===================================================================
-- تحديث الدوال المحاسبية للعمل مع gl_accounts
-- Update Accounting Functions to work with gl_accounts
-- ===================================================================

-- 1. تحديث دالة ترحيل القيد
CREATE OR REPLACE FUNCTION post_journal_entry(p_entry_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_entry RECORD;
    v_total_debit NUMERIC(18,4);
    v_total_credit NUMERIC(18,4);
    v_line_count INTEGER;
    v_result JSON;
BEGIN
    -- الحصول على تفاصيل القيد
    SELECT * INTO v_entry
    FROM journal_entries 
    WHERE id = p_entry_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal entry not found'
        );
    END IF;
    
    -- التحقق من الحالة
    IF v_entry.status = 'posted' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal entry is already posted'
        );
    END IF;
    
    IF v_entry.status = 'reversed' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cannot post a reversed entry'
        );
    END IF;
    
    -- التحقق من وجود بنود
    SELECT 
        COUNT(*),
        COALESCE(SUM(debit), 0),
        COALESCE(SUM(credit), 0)
    INTO v_line_count, v_total_debit, v_total_credit
    FROM journal_lines 
    WHERE entry_id = p_entry_id;
    
    IF v_line_count = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal entry has no lines'
        );
    END IF;
    
    -- التحقق من التوازن
    IF v_total_debit != v_total_credit OR v_total_debit = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Journal entry is not balanced. Debit: ' || v_total_debit || ', Credit: ' || v_total_credit
        );
    END IF;
    
    -- التحقق من أن كل بند له مدين أو دائن فقط (وليس الاثنين)
    IF EXISTS (
        SELECT 1 FROM journal_lines
        WHERE entry_id = p_entry_id 
        AND (debit > 0 AND credit > 0)
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Each line must have either debit or credit, not both'
        );
    END IF;
    
    -- التحقق من عدم وجود بنود بدون مدين ولا دائن
    IF EXISTS (
        SELECT 1 FROM journal_lines
        WHERE entry_id = p_entry_id 
        AND debit = 0 AND credit = 0
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Each line must have either debit or credit amount'
        );
    END IF;
    
    -- التحقق من أن جميع الحسابات تقبل الترحيل
    IF EXISTS (
        SELECT 1 FROM journal_lines jl
        LEFT JOIN gl_accounts a ON jl.account_id = a.id
        WHERE jl.entry_id = p_entry_id 
        AND (a.allow_posting = false OR a.id IS NULL)
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cannot post to non-posting accounts or invalid accounts'
        );
    END IF;
    
    -- تحديث حالة القيد
    UPDATE journal_entries
    SET 
        status = 'posted',
        posting_date = CURRENT_DATE,
        posted_at = NOW(),
        total_debit = v_total_debit,
        total_credit = v_total_credit
    WHERE id = p_entry_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Journal entry posted successfully',
        'entry_id', p_entry_id,
        'total_debit', v_total_debit,
        'total_credit', v_total_credit
    );
END;
$$;

-- 2. تحديث دالة ميزان المراجعة
CREATE OR REPLACE FUNCTION rpc_get_trial_balance(
    p_tenant UUID,
    p_as_of_date DATE DEFAULT NULL
)
RETURNS TABLE (
    account_code VARCHAR,
    account_name VARCHAR,
    account_name_ar VARCHAR,
    account_type VARCHAR,
    opening_debit NUMERIC,
    opening_credit NUMERIC,
    period_debit NUMERIC,
    period_credit NUMERIC,
    closing_debit NUMERIC,
    closing_credit NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_as_of_date DATE;
BEGIN
    v_as_of_date := COALESCE(p_as_of_date, CURRENT_DATE);
    
    RETURN QUERY
    WITH account_movements AS (
        SELECT 
            a.id as account_id,
            a.code,
            a.name,
            a.name_ar,
            a.category as account_type,
            COALESCE(SUM(jl.debit), 0) as total_debit,
            COALESCE(SUM(jl.credit), 0) as total_credit
        FROM gl_accounts a
        LEFT JOIN journal_lines jl ON a.id = jl.account_id
        LEFT JOIN journal_entries je ON jl.entry_id = je.id
        WHERE a.org_id = p_tenant
        AND a.allow_posting = true
        AND a.is_active = true
        AND (je.status = 'posted' OR je.id IS NULL)
        AND (je.posting_date <= v_as_of_date OR je.id IS NULL)
        GROUP BY a.id, a.code, a.name, a.name_ar, a.category
    )
    SELECT 
        am.code::VARCHAR,
        am.name::VARCHAR,
        am.name_ar::VARCHAR,
        am.account_type::VARCHAR,
        CASE WHEN am.total_debit > am.total_credit 
             THEN (am.total_debit - am.total_credit)::NUMERIC 
             ELSE 0::NUMERIC 
        END as opening_debit,
        CASE WHEN am.total_credit > am.total_debit 
             THEN (am.total_credit - am.total_debit)::NUMERIC 
             ELSE 0::NUMERIC 
        END as opening_credit,
        am.total_debit::NUMERIC as period_debit,
        am.total_credit::NUMERIC as period_credit,
        CASE WHEN am.total_debit > am.total_credit 
             THEN (am.total_debit - am.total_credit)::NUMERIC 
             ELSE 0::NUMERIC 
        END as closing_debit,
        CASE WHEN am.total_credit > am.total_debit 
             THEN (am.total_credit - am.total_debit)::NUMERIC 
             ELSE 0::NUMERIC 
        END as closing_credit
    FROM account_movements am
    WHERE am.total_debit != 0 OR am.total_credit != 0
    ORDER BY am.code;
END;
$$;

-- ===================================================================
-- ✅ تم تحديث الدوال بنجاح
-- ✅ Functions Updated Successfully
-- ===================================================================

SELECT 'Functions updated to work with gl_accounts!' as message;
