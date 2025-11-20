-- Check if the user_organizations table exists and its structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'user_organizations'
ORDER BY ordinal_position;

-- If the table exists but is missing the updated_at column, add it
ALTER TABLE user_organizations 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Check the structure again
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'user_organizations'
ORDER BY ordinal_position;