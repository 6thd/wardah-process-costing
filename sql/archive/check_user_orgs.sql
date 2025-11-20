-- Check user-organization associations
SELECT uo.user_id, uo.org_id, uo.role, o.name as org_name
FROM user_organizations uo
JOIN organizations o ON uo.org_id = o.id;

-- Check if our specific user is associated with any organization
SELECT uo.user_id, uo.org_id, uo.role, o.name as org_name
FROM user_organizations uo
JOIN organizations o ON uo.org_id = o.id
WHERE uo.user_id = 'd9bbbe5f-d564-4492-a90d-470836052c88';

-- Check all organizations
SELECT * FROM organizations;