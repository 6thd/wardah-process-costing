-- FIX RECURSIVE TRIGGERS FOR CHART OF ACCOUNTS
-- This script fixes the recursive trigger issue by implementing guards against infinite recursion

-- 1) Add a flag column to prevent re-entry
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'gl_accounts' AND column_name = 'in_process'
  ) THEN
    ALTER TABLE gl_accounts ADD COLUMN in_process BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- 2) Drop the existing problematic trigger
DROP TRIGGER IF EXISTS trg_set_gl_account_path ON gl_accounts;

-- 3) Create an improved trigger function with recursion guards
CREATE OR REPLACE FUNCTION set_gl_account_path()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  p ltree;
  label text;
BEGIN
  -- Guard against re-entry to prevent infinite recursion
  IF NEW.in_process IS TRUE THEN
    RETURN NEW;
  END IF;
  
  -- Set the in_process flag to prevent re-entry
  NEW.in_process := TRUE;
  
  BEGIN
    -- label must be alphanumeric/underscore for ltree
    label := regexp_replace(coalesce(NEW.code, NEW.id::text), '[^a-zA-Z0-9_]', '_', 'g');

    IF NEW.parent_id IS NULL THEN
      NEW.path := label::ltree;                  -- root
    ELSE
      SELECT path INTO p FROM gl_accounts WHERE id = NEW.parent_id;
      IF p IS NULL THEN
        RAISE EXCEPTION 'Parent account not found';
      END IF;

      -- Prevent cycle: don't make parent a child of itself
      IF EXISTS (
        SELECT 1
        FROM gl_accounts c
        WHERE c.id = NEW.parent_id
          AND c.path <@ (SELECT path FROM gl_accounts WHERE id = NEW.id)
      ) THEN
        RAISE EXCEPTION 'Cycle detected in chart of accounts';
      END IF;

      NEW.path := p || label::ltree;             -- child path
    END IF;
    
    -- Clear the in_process flag
    NEW.in_process := FALSE;
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Make sure to clear the flag even if an error occurs
      NEW.in_process := FALSE;
      RAISE;
  END;
  
  RETURN NEW;
END $$;

-- 4) Create separate triggers for INSERT and UPDATE to handle WHEN conditions properly
-- For INSERT operations
CREATE TRIGGER trg_set_gl_account_path_insert
BEFORE INSERT ON gl_accounts
FOR EACH ROW
EXECUTE FUNCTION set_gl_account_path();

-- For UPDATE operations (only when parent_id or code changes)
CREATE TRIGGER trg_set_gl_account_path_update
BEFORE UPDATE OF parent_id, code ON gl_accounts
FOR EACH ROW
WHEN (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.code IS DISTINCT FROM OLD.code)
EXECUTE FUNCTION set_gl_account_path();

-- 5) Add depth limit check to prevent too-deep hierarchies (using path-based approach to avoid recursion)
CREATE OR REPLACE FUNCTION check_account_depth()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_depth INTEGER;
  parent_path ltree;
BEGIN
  -- Check if this is an update to parent_id or a new insert with parent_id
  IF (TG_OP = 'INSERT' AND NEW.parent_id IS NOT NULL) OR 
     (TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
     
    -- Get the parent's path to calculate depth
    SELECT path INTO parent_path FROM gl_accounts WHERE id = NEW.parent_id;
    
    IF parent_path IS NOT NULL THEN
      -- Calculate depth based on path (number of segments)
      SELECT nlevel(parent_path) INTO current_depth;
      
      -- Add 1 for the current level
      current_depth := current_depth + 1;
      
      -- Raise exception if hierarchy is too deep
      IF current_depth > 50 THEN
        RAISE EXCEPTION 'Account hierarchy too deep: % levels. Maximum allowed is 50.', current_depth;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END $$;

-- 6) Create triggers for depth checking
-- For INSERT operations
CREATE OR REPLACE TRIGGER trg_check_account_depth_insert
AFTER INSERT ON gl_accounts
FOR EACH ROW
EXECUTE FUNCTION check_account_depth();

-- For UPDATE operations
CREATE OR REPLACE TRIGGER trg_check_account_depth_update
AFTER UPDATE OF parent_id ON gl_accounts
FOR EACH ROW
EXECUTE FUNCTION check_account_depth();

-- 7) Backfill existing accounts with path values (with recursion guards)
-- First, update root accounts (those with no parent)
UPDATE gl_accounts 
SET path = regexp_replace(coalesce(code, id::text), '[^a-zA-Z0-9_]', '_', 'g')::ltree,
    in_process = FALSE
WHERE parent_id IS NULL AND path IS NULL;

-- Temporarily disable triggers to prevent recursion during bulk update
ALTER TABLE gl_accounts DISABLE TRIGGER trg_set_gl_account_path_insert;
ALTER TABLE gl_accounts DISABLE TRIGGER trg_set_gl_account_path_update;

-- Then, update child accounts with a limited loop to prevent infinite recursion
DO $$
DECLARE
  updated_count INTEGER;
  loop_count INTEGER := 0;
BEGIN
  LOOP
    -- Update accounts that have a parent with a path but don't have their own path set
    UPDATE gl_accounts 
    SET path = parent.path || regexp_replace(coalesce(gl_accounts.code, gl_accounts.id::text), '[^a-zA-Z0-9_]', '_', 'g')::ltree,
        in_process = FALSE
    FROM gl_accounts parent
    WHERE gl_accounts.parent_id = parent.id 
      AND parent.path IS NOT NULL 
      AND gl_accounts.path IS NULL
      AND gl_accounts.in_process IS FALSE;
    
    -- Get the number of rows updated
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    -- Exit the loop if no more rows were updated
    EXIT WHEN updated_count = 0 OR loop_count > 100;  -- Safety limit
    
    loop_count := loop_count + 1;
  END LOOP;
END $$;

-- Re-enable triggers
ALTER TABLE gl_accounts ENABLE TRIGGER trg_set_gl_account_path_insert;
ALTER TABLE gl_accounts ENABLE TRIGGER trg_set_gl_account_path_update;

-- 8) Clear any remaining in_process flags
UPDATE gl_accounts SET in_process = FALSE WHERE in_process IS TRUE;

-- 9) Verify the path column is populated
-- SELECT id, code, name, parent_id, path, in_process FROM gl_accounts ORDER BY code LIMIT 10;