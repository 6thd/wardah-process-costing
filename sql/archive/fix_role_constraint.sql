-- Fix script for user_organizations role constraint issue

-- First, let's check the existing constraint
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'user_organizations'::regclass 
AND contype = 'c';

-- Drop the existing constraint if it exists
ALTER TABLE user_organizations 
DROP CONSTRAINT IF EXISTS user_organizations_role_check;

-- Add a new constraint that includes all the roles we need
ALTER TABLE user_organizations 
ADD CONSTRAINT user_organizations_role_check 
CHECK (role IN ('user', 'manager', 'admin', 'employee'));

-- Verify the constraint was added
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'user_organizations'::regclass 
AND contype = 'c';

-- Now try to insert the data again
INSERT INTO user_organizations (user_id, org_id, role, created_at, updated_at)
SELECT 
    id as user_id,
    '00000000-0000-0000-0000-000000000001' as org_id,
    'employee' as role,
    NOW() as created_at,
    NOW() as updated_at
FROM auth.users
ON CONFLICT (user_id, org_id) DO UPDATE SET
    role = EXCLUDED.role,
    updated_at = NOW();