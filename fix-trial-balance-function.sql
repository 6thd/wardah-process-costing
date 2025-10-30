-- ===================================================================
-- إعادة إنشاء دالة ميزان المراجعة المحسّنة
-- Recreate Improved Trial Balance Function
-- ===================================================================

-- حذف الدالة القديمة
DROP FUNCTION IF EXISTS rpc_get_trial_balance(UUID, DATE);

-- إنشاء دالة جديدة محسّنة
CREATE OR REPLACE FUNCTION rpc_get_trial_balance(
    p_tenant UUID,
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    account_code TEXT,
    account_name TEXT,
    account_name_ar TEXT,
    account_type TEXT,
    opening_debit NUMERIC(18,4),
    opening_credit NUMERIC(18,4),
    period_debit NUMERIC(18,4),
    period_credit NUMERIC(18,4),
    closing_debit NUMERIC(18,4),
    closing_credit NUMERIC(18,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH account_movements AS (
        SELECT
            ga.id as account_id,
            ga.code,
            ga.name,
            ga.name_en,
            ga.category,
            COALESCE(SUM(CASE WHEN je.status = 'posted' THEN jl.debit ELSE 0 END), 0) as total_debit,
            COALESCE(SUM(CASE WHEN je.status = 'posted' THEN jl.credit ELSE 0 END), 0) as total_credit
        FROM gl_accounts ga
        LEFT JOIN journal_lines jl ON ga.id = jl.account_id
        LEFT JOIN journal_entries je ON jl.entry_id = je.id 
            AND je.status = 'posted'
            AND COALESCE(je.posting_date, je.entry_date) <= p_as_of_date
        WHERE ga.allow_posting = true 
            AND ga.is_active = true
            AND (ga.org_id = p_tenant OR ga.org_id IS NULL)
        GROUP BY ga.id, ga.code, ga.name, ga.name_en, ga.category
    )
    SELECT
        am.code::TEXT,
        am.name::TEXT,
        COALESCE(am.name_en, am.name)::TEXT as account_name_ar,
        am.category::TEXT as account_type,
        0::NUMERIC(18,4) as opening_debit,
        0::NUMERIC(18,4) as opening_credit,
        am.total_debit::NUMERIC(18,4) as period_debit,
        am.total_credit::NUMERIC(18,4) as period_credit,
        CASE 
            WHEN am.total_debit > am.total_credit 
            THEN (am.total_debit - am.total_credit)::NUMERIC(18,4)
            ELSE 0::NUMERIC(18,4)
        END as closing_debit,
        CASE 
            WHEN am.total_credit > am.total_debit 
            THEN (am.total_credit - am.total_debit)::NUMERIC(18,4)
            ELSE 0::NUMERIC(18,4)
        END as closing_credit
    FROM account_movements am
    WHERE am.total_debit > 0 OR am.total_credit > 0
    ORDER BY am.code;
END;
$$;

-- منح الصلاحيات
GRANT EXECUTE ON FUNCTION rpc_get_trial_balance(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trial_balance(UUID, DATE) TO anon;

-- اختبار الدالة
SELECT 
    account_code,
    account_name,
    period_debit,
    period_credit,
    closing_debit,
    closing_credit
FROM rpc_get_trial_balance(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2025-10-29'::date
)
ORDER BY account_code;

-- ===================================================================
-- ✅ التحسينات:
-- - استخدام COALESCE لمعالجة القيم الفارغة
-- - استخدام posting_date أو entry_date (أيهما متوفر)
-- - تبسيط المنطق لعرض الحركات مباشرة
-- - إضافة SECURITY DEFINER لضمان الصلاحيات
-- ===================================================================

SELECT 'Trial balance function recreated successfully!' as message;
