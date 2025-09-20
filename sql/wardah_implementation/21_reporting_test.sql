-- =======================================
-- Reporting Functions Test for Wardah ERP
-- =======================================

-- Set up JWT claims for testing as admin user
SET request.jwt.claims.sub TO '11111111-1111-1111-1111-111111111111';
SET request.jwt.claims.role TO 'authenticated';

\echo '📊 Starting Reporting Functions Test...'

-- 1. Test inventory valuation report
\echo '1. Inventory Valuation Report:'
SELECT * FROM get_inventory_valuation('00000000-0000-0000-0000-000000000001');

-- 2. Test WIP analysis report
\echo '2. WIP Analysis Report:'
SELECT * FROM get_wip_analysis('00000000-0000-0000-0000-000000000001');

-- 3. Test overhead variances
\echo '3. Overhead Variances Report:'
SELECT * FROM calculate_overhead_variances(
    '00000000-0000-0000-0000-000000000001',
    CURRENT_DATE - INTERVAL '1 month',
    CURRENT_DATE
);

-- 4. Check GL accounts
\echo '4. GL Accounts Summary:'
SELECT category, COUNT(*) as account_count 
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY category
ORDER BY category;

-- 5. Check GL mappings
\echo '5. GL Mappings Summary:'
SELECT key_type, COUNT(*) as mapping_count 
FROM gl_mappings 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY key_type
ORDER BY key_type;

-- 6. Check products
\echo '6. Products Summary:'
SELECT product_type, COUNT(*) as product_count 
FROM products 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY product_type
ORDER BY product_type;

\echo '✅ Reporting Functions Test Complete!'