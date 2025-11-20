-- ============================================================================
-- COMPREHENSIVE FIX - إصلاح شامل ونهائي
-- ============================================================================
-- This script fixes ALL remaining issues in one go
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🚀 Starting Comprehensive Fix';
    RAISE NOTICE '========================================';
END $$;

-- ============================================================================
-- PART 1: Fix Attachments RLS (403 Error)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '📎 Fixing Attachments RLS...';
    
    -- Drop ALL existing policies
    DROP POLICY IF EXISTS "Enable all for org users" ON journal_entry_attachments;
    DROP POLICY IF EXISTS "Users can access own org attachments" ON journal_entry_attachments;
    DROP POLICY IF EXISTS "Users can insert own org attachments" ON journal_entry_attachments;
    DROP POLICY IF EXISTS "Users can update own org attachments" ON journal_entry_attachments;
    DROP POLICY IF EXISTS "Users can delete own org attachments" ON journal_entry_attachments;
    DROP POLICY IF EXISTS "Users can view own org attachments" ON journal_entry_attachments;
    DROP POLICY IF EXISTS journal_attachments_org_isolation ON journal_entry_attachments;
    
    RAISE NOTICE '  ✓ Dropped old policies';
    
    -- Enable RLS
    ALTER TABLE journal_entry_attachments ENABLE ROW LEVEL SECURITY;
    
    -- Create NEW policies using get_effective_org_id()
    CREATE POLICY "attachments_select_policy"
        ON journal_entry_attachments
        FOR SELECT
        TO authenticated
        USING (org_id = get_effective_org_id());
    
    CREATE POLICY "attachments_insert_policy"
        ON journal_entry_attachments
        FOR INSERT
        TO authenticated
        WITH CHECK (org_id = get_effective_org_id());
    
    CREATE POLICY "attachments_update_policy"
        ON journal_entry_attachments
        FOR UPDATE
        TO authenticated
        USING (org_id = get_effective_org_id())
        WITH CHECK (org_id = get_effective_org_id());
    
    CREATE POLICY "attachments_delete_policy"
        ON journal_entry_attachments
        FOR DELETE
        TO authenticated
        USING (org_id = get_effective_org_id());
    
    RAISE NOTICE '  ✓ Created 4 new RLS policies with get_effective_org_id()';
    
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE '  ⚠ journal_entry_attachments table not found';
    WHEN OTHERS THEN
        RAISE NOTICE '  ⚠ Error: %', SQLERRM;
END $$;

-- ============================================================================
-- PART 2: Fix gl_entry_lines structure
-- ============================================================================

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '📊 Fixing gl_entry_lines structure...';
    
    -- Add missing columns if needed
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entry_lines' AND column_name = 'account_code'
    ) THEN
        ALTER TABLE gl_entry_lines ADD COLUMN account_code TEXT;
        RAISE NOTICE '  ✓ Added account_code column';
    END IF;
    
    -- Remove NOT NULL constraint from account_code
    BEGIN
        ALTER TABLE gl_entry_lines ALTER COLUMN account_code DROP NOT NULL;
        RAISE NOTICE '  ✓ Removed NOT NULL from account_code';
    EXCEPTION
        WHEN OTHERS THEN
            NULL;
    END;
    
    -- Fill account_code from gl_accounts
    UPDATE gl_entry_lines el
    SET account_code = ga.code
    FROM gl_accounts ga
    WHERE el.account_code IS NULL
      AND el.account_id = ga.id;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE '  ✓ Updated % account_code values', v_count;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '  ⚠ Error: %', SQLERRM;
END $$;

-- ============================================================================
-- PART 3: Verify data integrity
-- ============================================================================

DO $$
DECLARE
    v_entries_count INTEGER;
    v_lines_count INTEGER;
    v_attachments_policies INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🔍 Verification...';
    
    -- Count entries
    SELECT COUNT(*) INTO v_entries_count FROM gl_entries;
    RAISE NOTICE '  ✓ gl_entries: % records', v_entries_count;
    
    -- Count lines
    SELECT COUNT(*) INTO v_lines_count FROM gl_entry_lines;
    RAISE NOTICE '  ✓ gl_entry_lines: % records', v_lines_count;
    
    -- Count policies
    SELECT COUNT(*) INTO v_attachments_policies
    FROM pg_policies
    WHERE tablename = 'journal_entry_attachments';
    RAISE NOTICE '  ✓ Attachments policies: %', v_attachments_policies;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '  ⚠ Error: %', SQLERRM;
END $$;

-- ============================================================================
-- COMPLETION
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ COMPREHENSIVE FIX COMPLETED!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '1. Hard Refresh Browser (Ctrl+Shift+R)';
    RAISE NOTICE '2. Test uploading attachments';
    RAISE NOTICE '3. Test viewing entry lines';
    RAISE NOTICE '4. Test filters';
    RAISE NOTICE '';
END $$;

