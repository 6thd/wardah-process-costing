-- =======================================
-- Import Actual GL Mappings Data
-- =======================================

-- First, read the JSON data
\set mappings_data `cat gl_mappings_data.json`

-- Import the GL mappings data
SELECT import_gl_mappings(
    '00000000-0000-0000-0000-000000000001',
    :'mappings_data'::JSONB
);

-- Verify the import
SELECT COUNT(*) as total_mappings FROM gl_mappings WHERE org_id = '00000000-0000-0000-0000-000000000001';