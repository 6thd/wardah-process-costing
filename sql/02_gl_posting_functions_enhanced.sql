-- ===================================================================
-- ENHANCED JOURNAL ENTRIES FUNCTIONS
-- Batch Posting, Approval Workflow, Attachments, Comments
-- ===================================================================

-- ===================================================================
-- BATCH POSTING FUNCTION
-- Post multiple journal entries at once
-- ===================================================================
CREATE OR REPLACE FUNCTION batch_post_journal_entries(
    p_entry_ids UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry_id UUID;
    v_result JSON;
    v_success_count INTEGER := 0;
    v_fail_count INTEGER := 0;
    v_results JSONB := '[]'::JSONB;
    v_entry_result JSON;
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    IF v_tenant_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Tenant context not found'
        );
    END IF;
    
    -- Process each entry
    FOREACH v_entry_id IN ARRAY p_entry_ids
    LOOP
        BEGIN
            -- Try to post the entry
            SELECT post_journal_entry(v_entry_id) INTO v_entry_result;
            
            IF (v_entry_result->>'success')::BOOLEAN THEN
                v_success_count := v_success_count + 1;
                v_results := v_results || jsonb_build_object(
                    'entry_id', v_entry_id,
                    'success', true,
                    'message', v_entry_result->>'message'
                );
            ELSE
                v_fail_count := v_fail_count + 1;
                v_results := v_results || jsonb_build_object(
                    'entry_id', v_entry_id,
                    'success', false,
                    'error', v_entry_result->>'error'
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_fail_count := v_fail_count + 1;
            v_results := v_results || jsonb_build_object(
                'entry_id', v_entry_id,
                'success', false,
                'error', SQLERRM
            );
        END;
    END LOOP;
    
    -- Return summary
    RETURN json_build_object(
        'success', v_fail_count = 0,
        'total', array_length(p_entry_ids, 1),
        'success_count', v_success_count,
        'fail_count', v_fail_count,
        'results', v_results
    );
END;
$$;

-- ===================================================================
-- APPROVAL WORKFLOW TABLES
-- ===================================================================

-- Approval Levels
CREATE TABLE IF NOT EXISTS journal_entry_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    approval_level INTEGER NOT NULL,
    approver_id UUID NOT NULL, -- User ID
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    comments TEXT,
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(entry_id, approval_level)
);

CREATE INDEX idx_journal_entry_approvals_entry ON journal_entry_approvals(entry_id);
CREATE INDEX idx_journal_entry_approvals_approver ON journal_entry_approvals(tenant_id, approver_id);
CREATE INDEX idx_journal_entry_approvals_status ON journal_entry_approvals(tenant_id, status);

-- Approval Rules (configure which entries need approval)
CREATE TABLE IF NOT EXISTS journal_approval_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id UUID REFERENCES journals(id),
    min_amount NUMERIC(18,4),
    max_amount NUMERIC(18,4),
    approval_levels INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_journal_approval_rules_journal ON journal_approval_rules(tenant_id, journal_id);

-- ===================================================================
-- APPROVAL WORKFLOW FUNCTIONS
-- ===================================================================

-- Check if entry needs approval
CREATE OR REPLACE FUNCTION check_entry_approval_required(
    p_entry_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry RECORD;
    v_rule RECORD;
    v_required_levels INTEGER := 0;
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    -- Get entry details
    SELECT je.*, j.code as journal_code
    INTO v_entry
    FROM journal_entries je
    JOIN journals j ON je.journal_id = j.id
    WHERE je.id = p_entry_id AND je.tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('required', false, 'error', 'Entry not found');
    END IF;
    
    -- Check approval rules
    SELECT * INTO v_rule
    FROM journal_approval_rules
    WHERE tenant_id = v_tenant_id
    AND (journal_id = v_entry.journal_id OR journal_id IS NULL)
    AND is_active = true
    AND (
        (min_amount IS NULL OR v_entry.total_debit >= min_amount)
        AND (max_amount IS NULL OR v_entry.total_debit <= max_amount)
    )
    ORDER BY min_amount DESC NULLS LAST
    LIMIT 1;
    
    IF FOUND THEN
        v_required_levels := v_rule.approval_levels;
    END IF;
    
    RETURN json_build_object(
        'required', v_required_levels > 0,
        'required_levels', v_required_levels,
        'current_levels', (
            SELECT COUNT(*) FROM journal_entry_approvals
            WHERE entry_id = p_entry_id AND status = 'approved'
        )
    );
END;
$$;

-- Approve entry at a level
CREATE OR REPLACE FUNCTION approve_journal_entry(
    p_entry_id UUID,
    p_approval_level INTEGER,
    p_comments TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_approval RECORD;
    v_tenant_id UUID;
    v_user_id UUID;
    v_required_levels INTEGER;
    v_approved_levels INTEGER;
BEGIN
    -- Get tenant and user context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    v_user_id := current_setting('app.current_user_id', true)::UUID;
    
    -- Check if approval exists
    SELECT * INTO v_approval
    FROM journal_entry_approvals
    WHERE entry_id = p_entry_id
    AND approval_level = p_approval_level
    AND tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Approval record not found'
        );
    END IF;
    
    IF v_approval.status != 'pending' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Approval already processed'
        );
    END IF;
    
    -- Update approval
    UPDATE journal_entry_approvals SET
        status = 'approved',
        comments = p_comments,
        approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_approval.id;
    
    -- Check if all required approvals are done
    SELECT (check_entry_approval_required(p_entry_id)->>'required_levels')::INTEGER INTO v_required_levels;
    SELECT COUNT(*) INTO v_approved_levels
    FROM journal_entry_approvals
    WHERE entry_id = p_entry_id AND status = 'approved';
    
    RETURN json_build_object(
        'success', true,
        'message', 'Entry approved at level ' || p_approval_level,
        'approved_levels', v_approved_levels,
        'required_levels', v_required_levels,
        'can_post', v_approved_levels >= v_required_levels
    );
END;
$$;

-- ===================================================================
-- DOCUMENT ATTACHMENTS TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS journal_entry_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    file_type TEXT,
    uploaded_by UUID,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_journal_entry_attachments_entry ON journal_entry_attachments(entry_id);

-- ===================================================================
-- COMMENTS AND NOTES TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS journal_entry_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    comment_text TEXT NOT NULL,
    comment_type TEXT DEFAULT 'note' CHECK (comment_type IN ('note', 'comment', 'internal')),
    created_by UUID,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_journal_entry_comments_entry ON journal_entry_comments(entry_id);
CREATE INDEX idx_journal_entry_comments_created ON journal_entry_comments(tenant_id, created_at);

-- ===================================================================
-- ENHANCED AUTO-NUMBERING (with better formatting)
-- ===================================================================
CREATE OR REPLACE FUNCTION generate_entry_number_enhanced(
    p_journal_id UUID,
    p_entry_date DATE DEFAULT CURRENT_DATE
)
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
    v_year TEXT;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    -- Get journal prefix
    SELECT sequence_prefix INTO v_prefix
    FROM journals 
    WHERE id = p_journal_id;
    
    IF v_prefix IS NULL THEN
        -- Try to get from code
        SELECT code INTO v_prefix
        FROM journals
        WHERE id = p_journal_id;
        
        IF v_prefix IS NULL THEN
            RAISE EXCEPTION 'Journal not found';
        END IF;
    END IF;
    
    -- Get year
    v_year := EXTRACT(YEAR FROM p_entry_date)::TEXT;
    
    -- Create sequence name with year
    v_sequence_name := 'seq_' || lower(replace(v_prefix, '-', '_')) || '_' || v_year || '_' || replace(v_tenant_id::text, '-', '_');
    
    -- Create sequence if it doesn't exist
    BEGIN
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I START WITH 1', v_sequence_name);
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    
    -- Get next number
    EXECUTE format('SELECT nextval(%L)', v_sequence_name) INTO v_next_number;
    
    -- Format: PREFIX-YYYY-NNNNNN
    v_entry_number := v_prefix || '-' || v_year || '-' || LPAD(v_next_number::text, 6, '0');
    
    RETURN v_entry_number;
END;
$$;

-- ===================================================================
-- REVERSAL ENTRY ENHANCED (with better tracking)
-- ===================================================================
CREATE OR REPLACE FUNCTION reverse_journal_entry_enhanced(
    p_entry_id UUID,
    p_reversal_reason TEXT DEFAULT NULL,
    p_reversal_date DATE DEFAULT CURRENT_DATE
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
    v_tenant_id := current_setting('app.current_tenant_id', true)::UUID;
    
    -- Get original entry
    SELECT * INTO v_original_entry
    FROM journal_entries 
    WHERE id = p_entry_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Original entry not found'
        );
    END IF;
    
    IF v_original_entry.status != 'posted' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Can only reverse posted entries'
        );
    END IF;
    
    IF v_original_entry.reversed_by_entry_id IS NOT NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Entry already reversed'
        );
    END IF;
    
    -- Generate reversal entry
    v_reversal_entry_id := gen_random_uuid();
    v_reversal_number := generate_entry_number_enhanced(v_original_entry.journal_id, p_reversal_date);
    
    -- Create reversal entry
    INSERT INTO journal_entries (
        id, journal_id, entry_number, entry_date, posting_date,
        reference_type, reference_id, reference_number,
        description, description_ar,
        status, posted_at, posted_by,
        total_debit, total_credit,
        reversed_by_entry_id, reversal_reason,
        tenant_id, created_by, updated_by
    ) VALUES (
        v_reversal_entry_id,
        v_original_entry.journal_id,
        v_reversal_number,
        p_reversal_date,
        p_reversal_date,
        'reversal',
        p_entry_id,
        'REV-' || v_original_entry.entry_number,
        COALESCE('Reversal: ' || v_original_entry.description, 'Reversal Entry'),
        COALESCE('عكس: ' || v_original_entry.description_ar, 'عكس قيد'),
        'posted',
        CURRENT_TIMESTAMP,
        current_setting('app.current_user_id', true)::UUID,
        v_original_entry.total_credit, -- Swap totals
        v_original_entry.total_debit,  -- Swap totals
        NULL,
        p_reversal_reason,
        v_tenant_id,
        current_setting('app.current_user_id', true)::UUID,
        current_setting('app.current_user_id', true)::UUID
    );
    
    -- Create reversal lines (swap debit/credit)
    FOR v_line IN 
        SELECT * FROM journal_lines 
        WHERE entry_id = p_entry_id
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
            v_line.credit, -- Swap
            v_line.debit,  -- Swap
            v_line.currency_code,
            'REV: ' || COALESCE(v_line.description, ''),
            'عكس: ' || COALESCE(v_line.description_ar, ''),
            v_tenant_id
        );
    END LOOP;
    
    -- Update original entry
    UPDATE journal_entries SET
        status = 'reversed',
        reversed_by_entry_id = v_reversal_entry_id,
        reversal_reason = p_reversal_reason,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_entry_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Entry reversed successfully',
        'original_entry_id', p_entry_id,
        'reversal_entry_id', v_reversal_entry_id,
        'reversal_number', v_reversal_number
    );
END;
$$;

-- ===================================================================
-- RLS POLICIES FOR NEW TABLES
-- ===================================================================
ALTER TABLE journal_entry_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_comments ENABLE ROW LEVEL SECURITY;

-- Policies will be added in separate RLS file

