-- Fix script for user_organizations table missing updated_at column

-- First, check if the user_organizations table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'user_organizations'
);

-- Check current structure of user_organizations table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_organizations'
ORDER BY ordinal_position;

-- Add the missing updated_at column if it doesn't exist
ALTER TABLE user_organizations 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- If the table doesn't exist at all, create it with the correct structure
CREATE TABLE IF NOT EXISTS user_organizations (
    user_id UUID REFERENCES auth.users(id),
    org_id UUID REFERENCES organizations(id),
    role TEXT DEFAULT 'employee',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, org_id)
);

-- Enable RLS on the table
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;

-- Create policies for user_organizations table
DROP POLICY IF EXISTS "Users can view their organization associations" ON user_organizations;
CREATE POLICY "Users can view their organization associations" ON user_organizations
    FOR SELECT USING (user_id = auth.uid());

-- Grant necessary permissions
GRANT ALL ON TABLE user_organizations TO authenticated;