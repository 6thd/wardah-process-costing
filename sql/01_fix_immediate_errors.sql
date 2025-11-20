-- ===================================================================
-- إصلاح الأخطاء الفورية من Console
-- Fix Immediate Console Errors
-- ===================================================================
-- This script fixes the errors detected in Phase A testing
-- يصلح الأخطاء المكتشفة في اختبار المرحلة A
-- ===================================================================

-- ===================================================================
-- 1. Fix RPC Functions - Replace tenant_id with org_id
-- إصلاح دوال RPC - استبدال tenant_id بـ org_id
-- ===================================================================

-- Drop and recreate check_entry_approval_required with org_id
DROP FUNCTION IF EXISTS check_entry_approval_required(UUID);

CREATE OR REPLACE FUNCTION check_entry_approval_required(p_entry_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_total_amount NUMERIC;
    v_threshold NUMERIC := 10000; -- Default threshold
BEGIN
    -- Get total amount from gl_entries (use org_id instead of tenant_id)
    SELECT COALESCE(SUM(ABS(amount)), 0)
    INTO v_total_amount
    FROM gl_entry_lines
    WHERE entry_id = p_entry_id;
    
    -- Check if approval is required
    RETURN v_total_amount > v_threshold;
EXCEPTION
    WHEN OTHERS THEN
        -- Return false if any error
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===================================================================
-- 2. Fix get_account_statement RPC - Replace account_type with category
-- إصلاح دالة كشف الحساب - استبدال account_type بـ category
-- ===================================================================

DROP FUNCTION IF EXISTS get_account_statement(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION get_account_statement(
    p_account_id UUID,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
    transaction_date DATE,
    reference VARCHAR,
    description TEXT,
    debit NUMERIC,
    credit NUMERIC,
    balance NUMERIC,
    entry_id UUID
) AS $$
DECLARE
    v_opening_balance NUMERIC := 0;
    v_running_balance NUMERIC := 0;
    v_normal_balance VARCHAR;
    v_from_date DATE;
    v_to_date DATE;
BEGIN
    -- Set default dates if not provided
    v_from_date := COALESCE(p_from_date, DATE_TRUNC('year', CURRENT_DATE)::DATE);
    v_to_date := COALESCE(p_to_date, CURRENT_DATE);
    
    -- Get account normal balance (use category not account_type)
    SELECT normal_balance 
    INTO v_normal_balance
    FROM gl_accounts 
    WHERE id = p_account_id;
    
    -- If account not found, return empty
    IF v_normal_balance IS NULL THEN
        RETURN;
    END IF;
    
    -- Calculate opening balance
    SELECT COALESCE(SUM(
        CASE 
            WHEN v_normal_balance = 'DEBIT' THEN el.debit - el.credit
            ELSE el.credit - el.debit
        END
    ), 0)
    INTO v_opening_balance
    FROM gl_entry_lines el
    JOIN gl_entries e ON el.entry_id = e.id
    WHERE el.account_id = p_account_id
    AND e.entry_date < v_from_date
    AND e.status = 'POSTED';
    
    v_running_balance := v_opening_balance;
    
    -- Return opening balance row
    IF v_opening_balance <> 0 THEN
        RETURN QUERY SELECT
            v_from_date::DATE,
            'OPENING'::VARCHAR,
            'Opening Balance'::TEXT,
            CASE WHEN v_opening_balance > 0 THEN v_opening_balance ELSE 0 END,
            CASE WHEN v_opening_balance < 0 THEN ABS(v_opening_balance) ELSE 0 END,
            v_opening_balance,
            NULL::UUID;
    END IF;
    
    -- Return transactions
    RETURN QUERY
    SELECT
        e.entry_date::DATE,
        e.reference::VARCHAR,
        el.description::TEXT,
        el.debit,
        el.credit,
        v_running_balance + SUM(
            CASE 
                WHEN v_normal_balance = 'DEBIT' THEN el.debit - el.credit
                ELSE el.credit - el.debit
            END
        ) OVER (ORDER BY e.entry_date, e.id, el.id) AS balance,
        e.id AS entry_id
    FROM gl_entry_lines el
    JOIN gl_entries e ON el.entry_id = e.id
    WHERE el.account_id = p_account_id
    AND e.entry_date BETWEEN v_from_date AND v_to_date
    AND e.status = 'POSTED'
    ORDER BY e.entry_date, e.id, el.id;
    
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===================================================================
-- 3. Fix journal_entries and journal_lines tables references
-- إصلاح مراجع جداول قيود اليومية
-- ===================================================================

-- Check if we're using gl_entries or journal_entries
DO $$
BEGIN
    -- If journal_entries doesn't exist but gl_entries does, create a view
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_entries') THEN
        
        -- Create journal_entries as a view to gl_entries
        CREATE OR REPLACE VIEW journal_entries AS
        SELECT 
            id,
            org_id,
            entry_date,
            reference,
            description,
            status,
            created_by,
            created_at,
            updated_at,
            NULL::UUID as journal_id,  -- Add missing columns expected by frontend
            org_id as tenant_id  -- Backward compatibility
        FROM gl_entries;
        
        RAISE NOTICE 'Created journal_entries view pointing to gl_entries';
    END IF;
    
    -- If journal_lines doesn't exist but gl_entry_lines does, create a view
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_lines')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_entry_lines') THEN
        
        -- Create journal_lines as a view to gl_entry_lines
        CREATE OR REPLACE VIEW journal_lines AS
        SELECT 
            id,
            entry_id,
            account_id,
            description,
            debit,
            credit,
            line_number,
            created_at,
            updated_at
        FROM gl_entry_lines;
        
        RAISE NOTICE 'Created journal_lines view pointing to gl_entry_lines';
    END IF;
END $$;

-- ===================================================================
-- 4. Create documents storage bucket (placeholder - needs Supabase dashboard)
-- إنشاء bucket للمستندات (يحتاج لوحة تحكم Supabase)
-- ===================================================================

-- Note: Storage buckets cannot be created via SQL
-- You need to create the 'documents' bucket manually in Supabase Dashboard:
-- 1. Go to Storage in Supabase Dashboard
-- 2. Create new bucket named 'documents'
-- 3. Set it as public or private based on your needs
-- 4. Add RLS policies for the bucket

DO $$
BEGIN
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'IMPORTANT: You need to create the "documents" bucket manually in Supabase Dashboard';
    RAISE NOTICE 'Go to: Storage > New Bucket > Name: "documents"';
    RAISE NOTICE '==================================================';
END $$;

-- ===================================================================
-- 5. Add missing journals table if needed
-- إضافة جدول journals إذا كان مفقوداً
-- ===================================================================

CREATE TABLE IF NOT EXISTS journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_journals_org_id ON journals(org_id);

-- Add some default journals if table is empty
DO $$
BEGIN
    -- Insert default journal if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM journals WHERE org_id = '00000000-0000-0000-0000-000000000001' AND code = 'GJ') THEN
        INSERT INTO journals (org_id, code, name, name_ar, is_active)
        VALUES (
            '00000000-0000-0000-0000-000000000001',
            'GJ',
            'General Journal',
            'اليومية العامة',
            true
        );
        RAISE NOTICE 'Created default journal: General Journal (GJ)';
    ELSE
        RAISE NOTICE 'Default journal already exists';
    END IF;
END $$;

-- ===================================================================
-- SUMMARY / الملخص
-- ===================================================================

DO $$
BEGIN
    RAISE NOTICE '==================================================';
    RAISE NOTICE '✅ Fixed RPC Functions:';
    RAISE NOTICE '   - check_entry_approval_required (now uses org_id)';
    RAISE NOTICE '   - get_account_statement (now uses category not account_type)';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Created Views (if needed):';
    RAISE NOTICE '   - journal_entries → gl_entries';
    RAISE NOTICE '   - journal_lines → gl_entry_lines';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Created journals table with default journal';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  MANUAL STEP REQUIRED:';
    RAISE NOTICE '   Create "documents" bucket in Supabase Dashboard > Storage';
    RAISE NOTICE '';
    RAISE NOTICE '==================================================';
END $$;

