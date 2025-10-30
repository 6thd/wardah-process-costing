-- ===================================================================
-- إزالة القيود المانعة من الإدخال وإضافة تحققات أفضل
-- Remove restrictive constraints and add better validations
-- ===================================================================

-- 1. إزالة القيد check_debit_or_credit إذا كان موجوداً
ALTER TABLE journal_lines 
DROP CONSTRAINT IF EXISTS check_debit_or_credit;

-- 2. تحديث دالة الترحيل مع تحققات أفضل
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
    
    -- التحقق من أن كل بند له مدين أو دائن فقط (وليس الاثنين)
    IF EXISTS (
        SELECT 1 FROM journal_lines
        WHERE entry_id = p_entry_id 
        AND (debit > 0 AND credit > 0)
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'كل بند يجب أن يحتوي على مدين أو دائن فقط، وليس الاثنين معاً / Each line must have either debit or credit, not both'
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
            'error', 'كل بند يجب أن يحتوي على مبلغ في المدين أو الدائن / Each line must have either debit or credit amount'
        );
    END IF;
    
    -- التحقق من التوازن
    IF v_total_debit != v_total_credit OR v_total_debit = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'القيد غير متوازن. المدين: ' || v_total_debit || '، الدائن: ' || v_total_credit || ' / Journal entry is not balanced. Debit: ' || v_total_debit || ', Credit: ' || v_total_credit
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
            'error', 'لا يمكن الترحيل على حسابات رئيسية أو حسابات غير صالحة / Cannot post to non-posting accounts or invalid accounts'
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
        'message', 'تم ترحيل القيد بنجاح / Journal entry posted successfully',
        'entry_id', p_entry_id,
        'total_debit', v_total_debit,
        'total_credit', v_total_credit
    );
END;
$$;

-- ===================================================================
-- ✅ تم التحديث بنجاح
-- ✅ Update Completed Successfully
-- ===================================================================

SELECT 'Constraint removed and validations improved!' as message;
