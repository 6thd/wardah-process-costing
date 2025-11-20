-- Create default warehouse if not exists
-- Insert a default warehouse for the organization

INSERT INTO warehouses (
    id,
    org_id,
    name,
    name_ar,
    code,
    type,
    is_active,
    created_at
)
VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000001',
    'Main Warehouse',
    'المخزن الرئيسي',
    'WH-001',
    'main',
    true,
    CURRENT_TIMESTAMP
)
ON CONFLICT (org_id, code) DO NOTHING;

-- Verify
SELECT id, name, name_ar, code, type 
FROM warehouses 
WHERE org_id = '00000000-0000-0000-0000-000000000001';
