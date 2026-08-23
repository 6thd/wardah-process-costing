-- Acceptance for Migration 178 — canonical manual-journal RBAC boundary (#150).
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'J178 expected [%], got [%] for [%]',p_needle,SQLERRM,p_sql;
    END IF;
  END;
  IF v_ok THEN RAISE EXCEPTION 'J178 expected error [%], succeeded: %',p_needle,p_sql; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.payload(p_org uuid,p_journal uuid,p_debit uuid,p_credit uuid,p_key text,p_auto boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'org_id',p_org,'journal_id',p_journal,'entry_date','2026-08-23',
    'description','J178 manual fixture','reference_type','MANUAL_TEST',
    'reference_number',p_key,'idempotency_key',p_key,'auto_post',p_auto,
    'lines',jsonb_build_array(
      jsonb_build_object('line_number',1,'account_id',p_debit,'debit',100,'credit',0,'description','D'),
      jsonb_build_object('line_number',2,'account_id',p_credit,'debit',0,'credit',100,'description','C')
    )
  )
$$;

-- Fixtures.
INSERT INTO auth.users(id,email) VALUES
 ('17800000-0000-0000-0000-000000000001','j178-none@example.test'),
 ('17800000-0000-0000-0000-000000000002','j178-member@example.test'),
 ('17800000-0000-0000-0000-000000000003','j178-admin@example.test'),
 ('17800000-0000-0000-0000-000000000004','j178-expired@example.test'),
 ('17800000-0000-0000-0000-000000000005','j178-other@example.test');

INSERT INTO public.organizations(id,name,code) VALUES
 ('17800000-aaaa-aaaa-aaaa-000000000001','J178 Org A','J178-A'),
 ('17800000-bbbb-bbbb-bbbb-000000000002','J178 Org B','J178-B');

INSERT INTO public.user_organizations(user_id,org_id,is_active,is_org_admin) VALUES
 ('17800000-0000-0000-0000-000000000001','17800000-aaaa-aaaa-aaaa-000000000001',true,false),
 ('17800000-0000-0000-0000-000000000002','17800000-aaaa-aaaa-aaaa-000000000001',true,false),
 ('17800000-0000-0000-0000-000000000003','17800000-aaaa-aaaa-aaaa-000000000001',true,true),
 ('17800000-0000-0000-0000-000000000004','17800000-aaaa-aaaa-aaaa-000000000001',true,false),
 ('17800000-0000-0000-0000-000000000005','17800000-bbbb-bbbb-bbbb-000000000002',true,true);

INSERT INTO public.roles(id,org_id,name,name_ar,is_active) VALUES
 ('17800000-1111-1111-1111-000000000001','17800000-aaaa-aaaa-aaaa-000000000001','J178 Journal Operator','مشغل قيود',true),
 ('17800000-1111-1111-1111-000000000002','17800000-aaaa-aaaa-aaaa-000000000001','J178 Reverse Grant','عكس قيود',true);

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT '17800000-1111-1111-1111-000000000001'::uuid,p.id
FROM public.permissions p
WHERE p.permission_key IN ('accounting.journals.create','accounting.journals.post','accounting.journals.update','accounting.journals.delete');
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT '17800000-1111-1111-1111-000000000002'::uuid,p.id
FROM public.permissions p WHERE p.permission_key='accounting.journals.reverse';

INSERT INTO public.user_roles(user_id,role_id,org_id,expires_at) VALUES
 ('17800000-0000-0000-0000-000000000002','17800000-1111-1111-1111-000000000001','17800000-aaaa-aaaa-aaaa-000000000001',NULL),
 ('17800000-0000-0000-0000-000000000004','17800000-1111-1111-1111-000000000001','17800000-aaaa-aaaa-aaaa-000000000001','2020-01-01T00:00:00Z');

INSERT INTO public.journals(id,org_id,code,name,journal_type,sequence_prefix,is_active) VALUES
 ('17800000-2222-2222-2222-000000000001','17800000-aaaa-aaaa-aaaa-000000000001','J178','J178 Journal','general','J178',true),
 ('17800000-2222-2222-2222-000000000002','17800000-bbbb-bbbb-bbbb-000000000002','J178B','J178 Journal B','general','J178B',true);

INSERT INTO public.gl_accounts(id,org_id,code,name,category,subtype,normal_balance,allow_posting,is_active) VALUES
 ('17800000-3333-3333-3333-000000000001','17800000-aaaa-aaaa-aaaa-000000000001','178101','J178 Debit','ASSET','CURRENT_ASSET','DEBIT',true,true),
 ('17800000-3333-3333-3333-000000000002','17800000-aaaa-aaaa-aaaa-000000000001','178201','J178 Credit','LIABILITY','CURRENT_LIABILITY','CREDIT',true,true),
 ('17800000-3333-3333-3333-000000000003','17800000-bbbb-bbbb-bbbb-000000000002','178301','J178 B Debit','ASSET','CURRENT_ASSET','DEBIT',true,true),
 ('17800000-3333-3333-3333-000000000004','17800000-bbbb-bbbb-bbbb-000000000002','178401','J178 B Credit','LIABILITY','CURRENT_LIABILITY','CREDIT',true,true);

-- Catalog/classifier and execute surface.
DO $$
BEGIN
  IF NOT public.wardah_is_sensitive_permission('accounting.journals.reverse')
     OR public.wardah_is_sensitive_permission('accounting.journals.post') THEN
    RAISE EXCEPTION 'J178 sensitive classifier mismatch';
  END IF;
  IF NOT public.wardah_is_sensitive_permission('accounting.vouchers.cancel')
     OR NOT public.wardah_is_sensitive_permission('accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'J178 regressed 174 voucher sensitivity';
  END IF;
  IF has_function_privilege('authenticated','public.rpc_create_journal_entry(jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.rpc_post_event_journal(text,numeric,text,text,uuid,uuid,text,date)','EXECUTE')
     OR has_function_privilege('authenticated','public.batch_post_journal_entries(uuid[])','EXECUTE')
     OR has_function_privilege('authenticated','public.reverse_journal_entry_enhanced(uuid,text,date)','EXECUTE')
     OR has_function_privilege('anon','public.post_journal_entry(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'J178 internal/legacy function remains client executable';
  END IF;
  IF NOT has_function_privilege('authenticated','public.rpc_create_manual_journal_entry(jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.rpc_post_manual_journal_entry(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.rpc_reverse_manual_journal_entry(uuid,text,date)','EXECUTE') THEN
    RAISE EXCEPTION 'J178 canonical public API not executable';
  END IF;
END $$;

-- No-permission member denied create.
SELECT set_config('request.jwt.claim.sub','17800000-0000-0000-0000-000000000001',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.rpc_create_manual_journal_entry(%L::jsonb)',
  pg_temp.payload('17800000-aaaa-aaaa-aaaa-000000000001','17800000-2222-2222-2222-000000000001',
    '17800000-3333-3333-3333-000000000001','17800000-3333-3333-3333-000000000002','none',false)),
  'PERMISSION_DENIED');
RESET ROLE;

-- Expired role denied.
SELECT set_config('request.jwt.claim.sub','17800000-0000-0000-0000-000000000004',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.rpc_create_manual_journal_entry(%L::jsonb)',
  pg_temp.payload('17800000-aaaa-aaaa-aaaa-000000000001','17800000-2222-2222-2222-000000000001',
    '17800000-3333-3333-3333-000000000001','17800000-3333-3333-3333-000000000002','expired',false)),
  'PERMISSION_DENIED');
RESET ROLE;

-- Explicit operator: auto-post is forbidden; normal create succeeds as manual.
SELECT set_config('request.jwt.claim.sub','17800000-0000-0000-0000-000000000002',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.rpc_create_manual_journal_entry(%L::jsonb)',
  pg_temp.payload('17800000-aaaa-aaaa-aaaa-000000000001','17800000-2222-2222-2222-000000000001',
    '17800000-3333-3333-3333-000000000001','17800000-3333-3333-3333-000000000002','autopost',true)),
  'JOURNAL_AUTO_POST_FORBIDDEN');

CREATE TEMP TABLE t178_manual AS
SELECT public.rpc_create_manual_journal_entry(pg_temp.payload(
  '17800000-aaaa-aaaa-aaaa-000000000001','17800000-2222-2222-2222-000000000001',
  '17800000-3333-3333-3333-000000000001','17800000-3333-3333-3333-000000000002','happy',false)) result;

DO $$ DECLARE v jsonb; v_id uuid;
BEGIN
  SELECT result INTO v FROM t178_manual; v_id := (v->>'entry_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.gl_entries
                 WHERE id=v_id AND status='draft' AND journal_origin='manual'
                   AND created_by='17800000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'J178 create provenance/status mismatch';
  END IF;
  IF (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id=v_id) <> 2 THEN
    RAISE EXCEPTION 'J178 create lines mismatch';
  END IF;
END $$;

-- Cross-org UUIDs are indistinguishable from missing UUIDs for every public
-- row-addressed mutation. This closes the tenant-existence oracle before the
-- exact-permission check is reached.
RESET ROLE;
INSERT INTO public.gl_entries(id,org_id,journal_id,entry_number,entry_date,entry_type,status,total_debit,total_credit,journal_origin)
VALUES ('17800000-4444-4444-4444-000000000099','17800000-bbbb-bbbb-bbbb-000000000002',
        '17800000-2222-2222-2222-000000000002','J178B-X','2026-08-23','manual','draft',10,10,'manual');
SELECT set_config('request.jwt.claim.sub','17800000-0000-0000-0000-000000000002',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  'SELECT public.rpc_post_manual_journal_entry(''17800000-4444-4444-4444-000000000099''::uuid)',
  'JOURNAL_ENTRY_NOT_FOUND');
SELECT pg_temp.expect_error(
  'SELECT public.rpc_delete_manual_journal_entry(''17800000-4444-4444-4444-000000000099''::uuid)',
  'JOURNAL_ENTRY_NOT_FOUND');
SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_update_manual_journal_entry(%L::uuid,%L::jsonb)',
  '17800000-4444-4444-4444-000000000099',
  pg_temp.payload('17800000-aaaa-aaaa-aaaa-000000000001','17800000-2222-2222-2222-000000000001',
    '17800000-3333-3333-3333-000000000001','17800000-3333-3333-3333-000000000002','foreign-update',false)),
  'JOURNAL_ENTRY_NOT_FOUND');
SELECT pg_temp.expect_error(
  'SELECT public.rpc_reverse_manual_journal_entry(''17800000-4444-4444-4444-000000000099''::uuid,''foreign'',''2026-08-23''::date)',
  'JOURNAL_ENTRY_NOT_FOUND');
SELECT pg_temp.expect_error(
  'SELECT public.rpc_post_manual_journal_entry(''17800000-4444-4444-4444-000000000098''::uuid)',
  'JOURNAL_ENTRY_NOT_FOUND');

-- Post succeeds with exact post grant.
CREATE TEMP TABLE t178_post AS
SELECT public.rpc_post_manual_journal_entry((SELECT (result->>'entry_id')::uuid FROM t178_manual)) result;
DO $$ DECLARE v_id uuid;
BEGIN
  SELECT (result->>'entry_id')::uuid INTO v_id FROM t178_post;
  IF NOT EXISTS (SELECT 1 FROM public.gl_entries WHERE id=v_id AND status='posted'
                 AND posted_by='17800000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'J178 post did not persist canonical actor/status';
  END IF;
END $$;

-- A system-origin draft cannot be posted from the manual API even with post permission.
RESET ROLE;
INSERT INTO public.gl_entries(id,org_id,journal_id,entry_number,entry_date,entry_type,status,total_debit,total_credit,journal_origin)
VALUES ('17800000-4444-4444-4444-000000000001','17800000-aaaa-aaaa-aaaa-000000000001',
        '17800000-2222-2222-2222-000000000001','J178-SYS','2026-08-23','manual','draft',10,10,'system');
SELECT set_config('request.jwt.claim.sub','17800000-0000-0000-0000-000000000002',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  'SELECT public.rpc_post_manual_journal_entry(''17800000-4444-4444-4444-000000000001''::uuid)',
  'JOURNAL_SYSTEM_ENTRY_NOT_MANUAL_POSTABLE');

-- Reverse is sensitive: org admin override alone is NOT enough.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','17800000-0000-0000-0000-000000000003',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_reverse_manual_journal_entry(%L::uuid,%L,%L::date)',
  (SELECT result->>'entry_id' FROM t178_post),'test reverse','2026-08-23'),
  'PERMISSION_DENIED');
RESET ROLE;

-- Explicit reverse grant to the same org admin authorizes it.
INSERT INTO public.user_roles(user_id,role_id,org_id,expires_at) VALUES
 ('17800000-0000-0000-0000-000000000003','17800000-1111-1111-1111-000000000002','17800000-aaaa-aaaa-aaaa-000000000001',NULL);
SELECT set_config('request.jwt.claim.sub','17800000-0000-0000-0000-000000000003',false);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t178_reverse AS
SELECT public.rpc_reverse_manual_journal_entry(
 (SELECT (result->>'entry_id')::uuid FROM t178_post),'test reverse','2026-08-23') result;

DO $$ DECLARE v jsonb; v_original uuid; v_reverse uuid; v_d numeric; v_c numeric;
BEGIN
  SELECT result INTO v FROM t178_reverse;
  v_original := (v->>'original_entry_id')::uuid;
  v_reverse := (v->>'reversal_entry_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.gl_entries WHERE id=v_original AND status='reversed') THEN
    RAISE EXCEPTION 'J178 original not marked reversed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gl_entries WHERE id=v_reverse AND status='posted'
                 AND journal_origin='manual_reversal' AND reference_id=v_original
                 AND posted_by='17800000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'J178 reversal provenance mismatch';
  END IF;
  SELECT sum(debit),sum(credit) INTO v_d,v_c FROM public.gl_entry_lines WHERE entry_id=v_reverse;
  IF v_d<>100 OR v_c<>100 THEN RAISE EXCEPTION 'J178 reversal balance mismatch'; END IF;
END $$;

-- Reversal is idempotent after the original has already become reversed.
DO $$ DECLARE v1 jsonb; v2 jsonb;
BEGIN
  SELECT result INTO v1 FROM t178_reverse;
  v2 := public.rpc_reverse_manual_journal_entry((v1->>'original_entry_id')::uuid,'retry','2026-08-23');
  IF NOT COALESCE((v2->>'duplicate')::boolean,false)
     OR v2->>'reversal_entry_id' <> v1->>'reversal_entry_id' THEN
    RAISE EXCEPTION 'J178 reversal replay mismatch';
  END IF;
END $$;
RESET ROLE;

-- Revocation is immediate for the sensitive permission.
DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id=p.id
  AND rp.role_id='17800000-1111-1111-1111-000000000002'
  AND p.permission_key='accounting.journals.reverse';
SELECT set_config('request.jwt.claim.sub','17800000-0000-0000-0000-000000000003',false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.has_permission('17800000-0000-0000-0000-000000000003',
      '17800000-aaaa-aaaa-aaaa-000000000001','accounting.journals.reverse') THEN
    RAISE EXCEPTION 'J178 revoked reverse permission still effective';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
\echo 'JOURNAL_RBAC_178_ACCEPTANCE_PASS'
