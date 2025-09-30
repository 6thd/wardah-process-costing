-- =======================================
-- Test Setup for Wardah ERP
-- =======================================

-- Set up JWT claims for testing as admin user
SET request.jwt.claims.sub TO '11111111-1111-1111-1111-111111111111';
SET request.jwt.claims.role TO 'authenticated';

-- Verify we can see the organization
SELECT * FROM organizations;

-- Verify we can see GL accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- Verify we can see GL mappings
SELECT COUNT(*) as total_mappings FROM gl_mappings;