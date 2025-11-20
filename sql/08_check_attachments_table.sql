-- ============================================================================
-- Check journal_entry_attachments Table Status
-- ============================================================================

-- Check if table exists
DO $$ 
DECLARE
  table_exists BOOLEAN;
  has_org_id BOOLEAN;
  policy_count INTEGER;
  policy_record RECORD;
  column_record RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Checking journal_entry_attachments';
  RAISE NOTICE '========================================';
  
  -- Check table existence
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'journal_entry_attachments'
  ) INTO table_exists;
  
  IF table_exists THEN
    RAISE NOTICE '✓ Table exists';
    
    -- Check org_id column
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'journal_entry_attachments'
      AND column_name = 'org_id'
    ) INTO has_org_id;
    
    IF has_org_id THEN
      RAISE NOTICE '✓ org_id column exists';
    ELSE
      RAISE NOTICE '✗ org_id column MISSING';
    END IF;
    
    -- Check RLS status
    IF (SELECT relrowsecurity FROM pg_class WHERE relname = 'journal_entry_attachments') THEN
      RAISE NOTICE '✓ RLS is enabled';
    ELSE
      RAISE NOTICE '✗ RLS is DISABLED';
    END IF;
    
    -- Count policies
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'journal_entry_attachments';
    
    RAISE NOTICE '✓ Total policies: %', policy_count;
    
    -- List all policies
    IF policy_count > 0 THEN
      RAISE NOTICE '';
      RAISE NOTICE 'Current Policies:';
      FOR policy_record IN 
        SELECT policyname, cmd, qual::text, with_check::text
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = 'journal_entry_attachments'
      LOOP
        RAISE NOTICE '  - % (%) USING: %', policy_record.policyname, policy_record.cmd, policy_record.qual;
      END LOOP;
    END IF;
    
    -- Show table structure
    RAISE NOTICE '';
    RAISE NOTICE 'Table Columns:';
    FOR column_record IN 
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'journal_entry_attachments'
      ORDER BY ordinal_position
    LOOP
      RAISE NOTICE '  - % (%) %', column_record.column_name, column_record.data_type, 
        CASE WHEN column_record.is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULL' END;
    END LOOP;
    
  ELSE
    RAISE NOTICE '✗ Table does NOT exist';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;

-- Show current org setting
DO $$ 
BEGIN
  RAISE NOTICE 'Current org_id setting: %', current_setting('app.current_org_id', true);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'No org_id setting found';
END $$;

