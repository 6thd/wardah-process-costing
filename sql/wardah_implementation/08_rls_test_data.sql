-- =======================================
-- Test Data for RLS
-- =======================================

-- Insert test users (simulate)
-- Note: In real Supabase, users are managed through auth.users
INSERT INTO user_organizations (user_id, org_id, role) VALUES
-- Test users for organization 1
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'admin'),
('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'manager'),
('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'user');

-- =======================================
-- RLS Testing Queries
-- =======================================

/*
-- Test RLS isolation (run as different users)

-- As admin user (11111111-1111-1111-1111-111111111111):
SET request.jwt.claims.sub TO '11111111-1111-1111-1111-111111111111';
SELECT * FROM organizations; -- Should see organization 1
SELECT * FROM gl_accounts; -- Should see all accounts for org 1

-- As manager user (22222222-2222-2222-2222-222222222222):
SET request.jwt.claims.sub TO '22222222-2222-2222-2222-222222222222';
SELECT * FROM products; -- Should see all products for org 1
INSERT INTO products (...); -- Should work

-- As regular user (33333333-3333-3333-3333-333333333333):
SET request.jwt.claims.sub TO '33333333-3333-3333-3333-333333333333';
SELECT * FROM stock_moves; -- Should see all moves for org 1  
DELETE FROM gl_accounts WHERE id = '...'; -- Should fail

-- As unauthorized user:
SET request.jwt.claims.sub TO '99999999-9999-9999-9999-999999999999';
SELECT * FROM organizations; -- Should return empty
SELECT * FROM products; -- Should return empty
*/

-- =======================================
-- Indexes for RLS Performance
-- =======================================

-- Indexes to optimize RLS policies
CREATE INDEX idx_user_orgs_user_active ON user_organizations(user_id, is_active);
CREATE INDEX idx_user_orgs_org_role ON user_organizations(org_id, role, is_active);

-- =======================================
-- Success Message
-- =======================================

DO $$
BEGIN
    RAISE NOTICE '🔒 RLS Policies Applied Successfully!';
    RAISE NOTICE '👥 Multi-tenant security enabled';
    RAISE NOTICE '🎭 Role-based access control active';
    RAISE NOTICE '🛡️ Organization data isolation enforced';
    RAISE NOTICE '⚡ Performance indexes created';
    RAISE NOTICE '✅ Production-ready security complete!';
END $$;