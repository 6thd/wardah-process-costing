-- ===================================================================
-- إعداد النظام المحاسبي الكامل
-- Setup Complete Accounting System
-- ===================================================================

-- 1. التحقق من وجود الجداول وإنشائها إن لزم الأمر
-- Check for tables existence and create if needed

-- جدول الدفاتر (Journals)
CREATE TABLE IF NOT EXISTS journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100),
    journal_type VARCHAR(50) NOT NULL, -- 'general', 'sales', 'purchases', 'cash', 'bank'
    sequence_prefix VARCHAR(10),
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- جدول القيود (Journal Entries)
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT NOT NULL,
    entry_number VARCHAR(50) UNIQUE NOT NULL,
    entry_date DATE NOT NULL,
    posting_date DATE,
    period_id UUID,
    reference_type VARCHAR(50),
    reference_id UUID,
    reference_number VARCHAR(100),
    description TEXT,
    description_ar TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft', 'posted', 'reversed'
    posted_at TIMESTAMPTZ,
    posted_by UUID,
    reversed_by_entry_id UUID REFERENCES journal_entries(id),
    reversal_reason TEXT,
    total_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
    total_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT check_balanced CHECK (total_debit >= 0 AND total_credit >= 0)
);

-- جدول بنود القيود (Journal Lines)
CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE NOT NULL,
    line_number INTEGER NOT NULL,
    account_id UUID NOT NULL,
    cost_center_id UUID,
    partner_id UUID,
    product_id UUID,
    project_id UUID,
    debit NUMERIC(18, 4) DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(18, 4) DEFAULT 0 CHECK (credit >= 0),
    currency_code VARCHAR(3) DEFAULT 'SAR',
    description TEXT,
    description_ar TEXT,
    reconciled BOOLEAN DEFAULT FALSE,
    reconciled_at TIMESTAMPTZ,
    reconciled_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entry_id, line_number)
    -- تم إزالة check_debit_or_credit للسماح بالإدخال المرن
);

-- جدول الحسابات (إذا لم يكن موجوداً)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    name_ar VARCHAR(200),
    account_type VARCHAR(50) NOT NULL, -- 'asset', 'liability', 'equity', 'revenue', 'expense'
    account_subtype VARCHAR(50),
    is_leaf BOOLEAN DEFAULT TRUE,
    parent_id UUID REFERENCES accounts(id),
    is_active BOOLEAN DEFAULT TRUE,
    currency_code VARCHAR(3) DEFAULT 'SAR',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- ===================================================================
-- 2. دالة توليد رقم القيد
-- Generate Entry Number Function
-- ===================================================================

CREATE OR REPLACE FUNCTION generate_entry_number(p_journal_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix VARCHAR(10);
    v_sequence_name TEXT;
    v_next_number INTEGER;
    v_entry_number TEXT;
    v_org_id UUID;
BEGIN
    -- الحصول على معلومات الدفتر
    SELECT sequence_prefix, org_id INTO v_prefix, v_org_id
    FROM journals 
    WHERE id = p_journal_id;
    
    IF v_prefix IS NULL THEN
        RAISE EXCEPTION 'Journal not found';
    END IF;
    
    -- إنشاء اسم تسلسل فريد لكل دفتر
    v_sequence_name := 'seq_' || lower(v_prefix) || '_' || replace(v_org_id::text, '-', '_');
    
    -- إنشاء التسلسل إذا لم يكن موجوداً
    BEGIN
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I START WITH 1', v_sequence_name);
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    
    -- الحصول على الرقم التالي
    EXECUTE format('SELECT nextval(%L)', v_sequence_name) INTO v_next_number;
    
    -- تنسيق رقم القيد: PREFIX-YYYY-NNNNNN
    v_entry_number := v_prefix || '-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_number::text, 6, '0');
    
    RETURN v_entry_number;
END;
$$;

-- ===================================================================
-- 3. دالة ترحيل القيد
-- Post Journal Entry Function
-- ===================================================================

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

-- ===================================================================
-- 4. دالة ميزان المراجعة
-- Trial Balance Function  
-- ===================================================================

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
-- 5. إنشاء دفاتر افتراضية
-- Create Default Journals
-- ===================================================================

INSERT INTO journals (org_id, code, name, name_ar, journal_type, sequence_prefix, description)
VALUES 
    ('00000000-0000-0000-0000-000000000001', 'GJ', 'General Journal', 'قيد يومي عام', 'general', 'GJ', 'General purpose journal entries'),
    ('00000000-0000-0000-0000-000000000001', 'SI', 'Sales Invoice', 'فاتورة مبيعات', 'sales', 'SI', 'Sales invoices journal'),
    ('00000000-0000-0000-0000-000000000001', 'PI', 'Purchase Invoice', 'فاتورة مشتريات', 'purchases', 'PI', 'Purchase invoices journal'),
    ('00000000-0000-0000-0000-000000000001', 'CR', 'Cash Receipt', 'سند قبض', 'cash', 'CR', 'Cash receipts journal'),
    ('00000000-0000-0000-0000-000000000001', 'CP', 'Cash Payment', 'سند صرف', 'cash', 'CP', 'Cash payments journal'),
    ('00000000-0000-0000-0000-000000000001', 'BR', 'Bank Receipt', 'إيداع بنكي', 'bank', 'BR', 'Bank receipts journal'),
    ('00000000-0000-0000-0000-000000000001', 'BP', 'Bank Payment', 'دفع بنكي', 'bank', 'BP', 'Bank payments journal')
ON CONFLICT (code) DO NOTHING;

-- ===================================================================
-- 6. إنشاء الفهارس لتحسين الأداء
-- Create Indexes for Performance
-- ===================================================================

CREATE INDEX IF NOT EXISTS idx_journal_entries_org_date 
    ON journal_entries(org_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_journal_entries_status 
    ON journal_entries(org_id, status);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry 
    ON journal_lines(entry_id);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account 
    ON journal_lines(org_id, account_id);

CREATE INDEX IF NOT EXISTS idx_accounts_org_code 
    ON accounts(org_id, code);

CREATE INDEX IF NOT EXISTS idx_accounts_type 
    ON accounts(org_id, account_type);

-- ===================================================================
-- ✅ اكتمل إعداد النظام المحاسبي
-- ✅ Accounting System Setup Completed
-- ===================================================================

SELECT 
    'Setup completed successfully!' as message,
    (SELECT COUNT(*) FROM journals WHERE org_id = '00000000-0000-0000-0000-000000000001') as journals_count,
    (SELECT COUNT(*) FROM accounts WHERE org_id = '00000000-0000-0000-0000-000000000001') as accounts_count;
