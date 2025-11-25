-- Update manufacturing_orders status CHECK constraint
-- This script updates the status constraint to support all new status values

-- First, check current constraint
DO $$
DECLARE
  constraint_exists BOOLEAN;
  constraint_name TEXT;
BEGIN
  -- Find the constraint name
  SELECT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conrelid = 'manufacturing_orders'::regclass 
    AND conname LIKE '%status%check%'
  ) INTO constraint_exists;
  
  IF constraint_exists THEN
    -- Get constraint name
    SELECT conname INTO constraint_name
    FROM pg_constraint 
    WHERE conrelid = 'manufacturing_orders'::regclass 
    AND conname LIKE '%status%check%'
    LIMIT 1;
    
    -- Drop old constraint
    EXECUTE format('ALTER TABLE manufacturing_orders DROP CONSTRAINT IF EXISTS %I', constraint_name);
    RAISE NOTICE '✅ Dropped old constraint: %', constraint_name;
  END IF;
END $$;

-- Add new constraint with all status values
ALTER TABLE manufacturing_orders 
DROP CONSTRAINT IF EXISTS manufacturing_orders_status_check;

ALTER TABLE manufacturing_orders
ADD CONSTRAINT manufacturing_orders_status_check 
CHECK (status IN (
  'draft',
  'pending',
  'confirmed',
  'in-progress',
  'in_progress',  -- Support both formats for backward compatibility
  'quality-check',
  'on-hold',
  'completed',
  'done',  -- Support old format for backward compatibility
  'cancelled'
));

-- Update existing data to use new format
-- Convert 'in_progress' to 'in-progress'
UPDATE manufacturing_orders
SET status = 'in-progress'
WHERE status = 'in_progress';

-- Convert 'done' to 'completed'
UPDATE manufacturing_orders
SET status = 'completed'
WHERE status = 'done';

-- Verify the constraint
DO $$
DECLARE
  constraint_check TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO constraint_check
  FROM pg_constraint
  WHERE conrelid = 'manufacturing_orders'::regclass
  AND conname = 'manufacturing_orders_status_check';
  
  RAISE NOTICE '✅ New constraint created: %', constraint_check;
END $$;

-- Show current status distribution
SELECT 
  status,
  COUNT(*) as count
FROM manufacturing_orders
GROUP BY status
ORDER BY count DESC;

