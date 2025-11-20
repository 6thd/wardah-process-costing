-- Complete setup script for gl_accounts table with Materialized Path

-- 1. Enable ltree extension if not already enabled
CREATE EXTENSION IF NOT EXISTS ltree;

-- 2. Create or update gl_accounts table
DO $$
BEGIN
  -- Check if table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') THEN
    -- Create the table
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
    RAISE NOTICE 'Created gl_accounts table';
  ELSE
    -- Table exists, check and add missing columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gl_accounts' AND column_name = 'parent_id') THEN
      ALTER TABLE gl_accounts ADD COLUMN parent_id UUID REFERENCES gl_accounts(id);
      RAISE NOTICE 'Added parent_id column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gl_accounts' AND column_name = 'type') THEN
      ALTER TABLE gl_accounts ADD COLUMN type TEXT CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS','WIP','RM','FG'));
      RAISE NOTICE 'Added type column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gl_accounts' AND column_name = 'is_active') THEN
      ALTER TABLE gl_accounts ADD COLUMN is_active BOOLEAN DEFAULT true;
      RAISE NOTICE 'Added is_active column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gl_accounts' AND column_name = 'tenant_id') THEN
      ALTER TABLE gl_accounts ADD COLUMN tenant_id UUID;
      RAISE NOTICE 'Added tenant_id column';
    END IF;
  END IF;
END $$;

-- 3. Add path column for Materialized Path if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gl_accounts' AND column_name = 'path') THEN
    ALTER TABLE gl_accounts ADD COLUMN path ltree;
    RAISE NOTICE 'Added path column';
  END IF;
END $$;

-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_gl_accounts_tenant_code ON gl_accounts(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_type ON gl_accounts(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_path ON gl_accounts USING gist (path);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_path_btree ON gl_accounts USING btree (path);

-- 5. Create trigger function for maintaining path hierarchy
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

-- 6. Create trigger
DROP TRIGGER IF EXISTS trg_set_gl_account_path ON gl_accounts;
CREATE TRIGGER trg_set_gl_account_path
BEFORE INSERT OR UPDATE OF parent_id, code ON gl_accounts
FOR EACH ROW EXECUTE FUNCTION set_gl_account_path();

-- 7. Add tenant_id column constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gl_accounts' AND column_name = 'tenant_id') THEN
    ALTER TABLE gl_accounts ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- 8. Backfill path values for existing accounts
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Update root accounts (those with no parent)
  UPDATE gl_accounts 
  SET path = regexp_replace(coalesce(code, id::text), '[^a-zA-Z0-9_]', '_', 'g')::ltree
  WHERE parent_id IS NULL AND path IS NULL;
  
  -- Update child accounts recursively
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
  
  RAISE NOTICE 'Backfilled path values for % accounts', (SELECT COUNT(*) FROM gl_accounts WHERE path IS NOT NULL);
END $$;

-- 9. Verify the setup
SELECT 
  (SELECT COUNT(*) FROM gl_accounts) as total_accounts,
  (SELECT COUNT(*) FROM gl_accounts WHERE path IS NOT NULL) as accounts_with_path,
  (SELECT COUNT(*) FROM gl_accounts WHERE parent_id IS NOT NULL) as child_accounts;