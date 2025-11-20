-- EXPORT_ALL_GL_ACCOUNTS.sql
-- Script to export all gl_accounts records to CSV format

-- Export all gl_accounts records
-- COPY (
SELECT 
    'id,org_id,code,name,name_ar,category,subtype,parent_code,normal_balance,allow_posting,is_active,currency,notes,created_at,updated_at' as csv_header
UNION ALL
SELECT
    id || ',' ||
    org_id || ',' ||
    code || ',' ||
    REPLACE(REPLACE(name, ',', ';'), '"', '""') || ',' ||
    COALESCE(REPLACE(REPLACE(name_ar, ',', ';'), '"', '""'), '') || ',' ||
    category || ',' ||
    COALESCE(subtype, '') || ',' ||
    COALESCE(parent_code, '') || ',' ||
    normal_balance || ',' ||
    allow_posting || ',' ||
    is_active || ',' ||
    COALESCE(currency, '') || ',' ||
    COALESCE(REPLACE(REPLACE(notes, ',', ';'), '"', '""'), '') || ',' ||
    created_at || ',' ||
    updated_at
FROM gl_accounts
ORDER BY code
-- ) TO '/path/to/all_gl_accounts.csv' WITH CSV;