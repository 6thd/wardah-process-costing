-- Script to safely add parent_id column to gl_accounts table if it doesn't exist

-- Check if parent_id column exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'gl_accounts' AND column_name = 'parent_id'
  ) THEN
    ALTER TABLE gl_accounts ADD COLUMN parent_id UUID REFERENCES gl_accounts(id);
    RAISE NOTICE 'Added parent_id column to gl_accounts table';
  ELSE
    RAISE NOTICE 'parent_id column already exists in gl_accounts table';
  END IF;
END $$;