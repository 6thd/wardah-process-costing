-- IMPLEMENT MATERIALIZE PATH SOLUTION FOR CHART OF ACCOUNTS
-- This script implements the Materialized Path solution using PostgreSQL ltree extension
-- to eliminate recursive queries that cause stack depth limit exceeded errors

-- 1) Enable ltree extension (usually allowed in Supabase)
CREATE EXTENSION IF NOT EXISTS ltree;

-- 2) Check if gl_accounts table exists and has the expected structure
-- If not, we may need to create or modify it

-- First, let's check if the table exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') THEN
    -- Create the table if it doesn't exist
    CREATE TABLE gl_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS','WIP','RM','FG')),
        parent_id UUID REFERENCES gl_accounts(id),
        is_active BOOLEAN DEFAULT true,
        tenant_id UUID NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
    );
  ELSE
    -- Check if parent_id column exists, if not add it
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'gl_accounts' AND column_name = 'parent_id'
    ) THEN
      ALTER TABLE gl_accounts ADD COLUMN parent_id UUID REFERENCES gl_accounts(id);
    END IF;
  END IF;
END $$;

-- 3) Add path column to gl_accounts table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'gl_accounts' AND column_name = 'path'
  ) THEN
    ALTER TABLE gl_accounts ADD COLUMN path ltree;
  END IF;
END $$;

-- 4) Create indexes for ltree path if they don't exist
CREATE INDEX IF NOT EXISTS idx_gl_accounts_path ON gl_accounts USING gist (path);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_path_btree ON gl_accounts USING btree (path);

-- 5) Create trigger function to automatically maintain path hierarchy
CREATE OR REPLACE FUNCTION set_gl_account_path()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  p ltree;
  label text;
BEGIN
  -- label must be alphanumeric/underscore for ltree
  label := regexp_replace(coalesce(new.code, new.id::text), '[^a-zA-Z0-9_]', '_', 'g');

  IF new.parent_id IS NULL THEN
    new.path := label::ltree;                  -- root
  ELSE
    SELECT path INTO p FROM gl_accounts WHERE id = new.parent_id;
    IF p IS NULL THEN
      RAISE EXCEPTION 'Parent account not found';
    END IF;

    -- Prevent cycle: don't make parent a child of itself
    IF EXISTS (
      SELECT 1
      FROM gl_accounts c
      WHERE c.id = new.parent_id
        AND c.path <@ (SELECT path FROM gl_accounts WHERE id = new.id)
    ) THEN
      RAISE EXCEPTION 'Cycle detected in chart of accounts';
    END IF;

    new.path := p || label::ltree;             -- child path
  END IF;

  RETURN new;
END $$;

-- 6) Create trigger to execute the function
DROP TRIGGER IF EXISTS trg_set_gl_account_path ON gl_accounts;
CREATE TRIGGER trg_set_gl_account_path
BEFORE INSERT OR UPDATE OF parent_id, code ON gl_accounts
FOR EACH ROW EXECUTE FUNCTION set_gl_account_path();

-- 7) Backfill existing accounts with path values
-- First, update root accounts (those with no parent)
UPDATE gl_accounts 
SET path = regexp_replace(coalesce(code, id::text), '[^a-zA-Z0-9_]', '_', 'g')::ltree
WHERE parent_id IS NULL AND path IS NULL;

-- Then, update child accounts recursively
-- This is a simple approach that may need to be run multiple times for deep hierarchies
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  LOOP
    -- Update accounts that have a parent with a path but don't have their own path set
    UPDATE gl_accounts 
    SET path = parent.path || regexp_replace(coalesce(gl_accounts.code, gl_accounts.id::text), '[^a-zA-Z0-9_]', '_', 'g')::ltree
    FROM gl_accounts parent
    WHERE gl_accounts.parent_id = parent.id 
      AND parent.path IS NOT NULL 
      AND gl_accounts.path IS NULL;
    
    -- Get the number of rows updated
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    -- Exit the loop if no more rows were updated
    EXIT WHEN updated_count = 0;
  END LOOP;
END $$;

-- 8) Verify the path column is populated
-- SELECT id, code, name, parent_id, path FROM gl_accounts ORDER BY code;

-- 9) Example query to get total balance for an account including all its descendants
-- This replaces the recursive CTE approach that was causing stack depth issues
/*
SELECT
  parent.id,
  parent.code,
  parent.name,
  SUM(bal.amount) as total_balance
FROM gl_accounts parent
JOIN gl_accounts leaf ON leaf.path <@ parent.path   -- all descendants within path
LEFT JOIN gl_balances bal ON bal.account_id = leaf.id
WHERE parent.tenant_id = 'YOUR_TENANT_ID_HERE'
GROUP BY parent.id, parent.code, parent.name
ORDER BY parent.code;
*/