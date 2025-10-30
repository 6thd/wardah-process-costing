-- ===================================================================
-- التحقق من القيود المرحلة والبنود
-- Check Posted Entries and Lines
-- ===================================================================

-- 1. عرض جميع القيود وحالتها
SELECT 
    entry_number,
    entry_date,
    status,
    posting_date,
    posted_at,
    total_debit,
    total_credit,
    created_at
FROM journal_entries
ORDER BY created_at DESC
LIMIT 10;

-- 2. عرض بنود القيود المرحلة
SELECT 
    je.entry_number,
    je.status,
    je.posting_date,
    jl.line_number,
    ga.code as account_code,
    ga.name as account_name,
    jl.debit,
    jl.credit
FROM journal_lines jl
JOIN journal_entries je ON jl.entry_id = je.id
JOIN gl_accounts ga ON jl.account_id = ga.id
WHERE je.status = 'posted'
ORDER BY je.posting_date DESC, je.entry_number, jl.line_number;

-- 3. إحصائيات القيود
SELECT 
    status,
    COUNT(*) as count,
    SUM(total_debit) as total_debit,
    SUM(total_credit) as total_credit
FROM journal_entries
GROUP BY status;

-- 4. اختبار دالة ميزان المراجعة
SELECT * FROM rpc_get_trial_balance(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2025-10-29'::date
);

-- 5. التحقق من وجود الدالة
SELECT 
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines
WHERE routine_name = 'rpc_get_trial_balance';

-- ===================================================================
-- ملاحظات:
-- - إذا كانت القيود موجودة لكن status != 'posted'، يجب ترحيلها
-- - إذا كانت posting_date فارغة، قد تكون المشكلة في دالة الترحيل
-- - إذا لم تظهر الدالة rpc_get_trial_balance، يجب إنشاؤها
-- ===================================================================
