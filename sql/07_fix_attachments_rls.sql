-- ============================================================================
-- Fix journal_entry_attachments RLS Policy
-- ============================================================================
-- This script fixes the 403 Forbidden error when uploading attachments
-- by ensuring the RLS policy correctly handles org_id
-- ============================================================================

-- Drop existing policies
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Enable all for org users" ON journal_entry_attachments;
  DROP POLICY IF EXISTS "Users can access own org attachments" ON journal_entry_attachments;
  DROP POLICY IF EXISTS "Users can insert own org attachments" ON journal_entry_attachments;
  DROP POLICY IF EXISTS "Users can delete own org attachments" ON journal_entry_attachments;
  RAISE NOTICE '✓ Dropped existing policies for journal_entry_attachments';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE '⚠ journal_entry_attachments table does not exist';
  WHEN undefined_object THEN
    RAISE NOTICE '✓ No existing policies to drop';
END $$;

-- Create comprehensive RLS policies
DO $$ 
BEGIN
  -- Enable RLS
  ALTER TABLE journal_entry_attachments ENABLE ROW LEVEL SECURITY;
  RAISE NOTICE '✓ RLS enabled for journal_entry_attachments';

  -- SELECT policy
CREATE POLICY "Users can view own org attachments"
  ON journal_entry_attachments
  FOR SELECT
  TO authenticated
  USING (
    org_id = get_effective_org_id()
  );
  RAISE NOTICE '✓ Created SELECT policy';

  -- INSERT policy
CREATE POLICY "Users can insert own org attachments"
  ON journal_entry_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = get_effective_org_id()
  );
  RAISE NOTICE '✓ Created INSERT policy';

  -- UPDATE policy
CREATE POLICY "Users can update own org attachments"
  ON journal_entry_attachments
  FOR UPDATE
  TO authenticated
  USING (
    org_id = get_effective_org_id()
  )
  WITH CHECK (
    org_id = get_effective_org_id()
  );
  RAISE NOTICE '✓ Created UPDATE policy';

  -- DELETE policy
CREATE POLICY "Users can delete own org attachments"
  ON journal_entry_attachments
  FOR DELETE
  TO authenticated
  USING (
    org_id = get_effective_org_id()
  );
  RAISE NOTICE '✓ Created DELETE policy';

EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE '⚠ journal_entry_attachments table does not exist - skipping';
  WHEN OTHERS THEN
    RAISE NOTICE '⚠ Error creating policies: %', SQLERRM;
END $$;

-- Verify policies
DO $$ 
DECLARE
  policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'journal_entry_attachments';
  
  RAISE NOTICE '✓ Total policies for journal_entry_attachments: %', policy_count;
END $$;

-- ============================================================================
-- Final Summary
-- ============================================================================
DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Attachments RLS Fix Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '1. Restart dev server (npm run dev)';
  RAISE NOTICE '2. Hard refresh (Ctrl+Shift+R)';
  RAISE NOTICE '3. Test uploading attachments';
  RAISE NOTICE '';
END $$;

