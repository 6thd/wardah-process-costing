-- M194 role, identity and close-RPC prevention tests on a disposable PG17.
-- Added after the independent review of #278, which found that mutations
-- removing the INSERT permission check, the close-RPC permission check, the
-- NULL-is_closed handling, the close-RPC MO lock, or freezing of the primary
-- key were all invisible to the first acceptance (it only exercised an Org
-- Admin, a consumer and a reader).
--
-- Every principal is asserted against an exact SQLSTATE and message. Every
-- denied or zero-row call is also asserted to leave the WHOLE stage_wip_log
-- unchanged: a successful UPDATE that touched zero RLS-visible rows is not
-- evidence of denial. Successful probes are rolled back so probes stay
-- independent. Legacy shapes (NULL is_closed, NULL ambiguity, the historical
-- overlap) come from the committed historical_fixture.sql, seeded BEFORE M194.
\set ON_ERROR_STOP on
BEGIN;
\ir ../posted-history-193/_fixture.sql

CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);

CREATE FUNCTION pg_temp.uid(p_k text) RETURNS uuid LANGUAGE sql AS
$fn$ SELECT v FROM pg_temp.ids WHERE k=p_k $fn$;

-- '{key}' placeholders are resolved as the harness, before any role switch.
CREATE FUNCTION pg_temp.subst(p_sql text) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE r record; s text := p_sql;
BEGIN
  FOR r IN SELECT k,v FROM pg_temp.ids LOOP
    s := replace(s,'{'||r.k||'}',r.v::text);
  END LOOP;
  RETURN s;
END
$fn$;

-- Like the shared try_as, but also for anon and service_role.
CREATE FUNCTION pg_temp.try_role(p_role text, p_uid uuid, p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_res jsonb; v_state text; v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',COALESCE(p_uid::text,''),true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN json_build_object('role',p_role)::text
         ELSE json_build_object('sub',p_uid,'role',p_role)::text END,true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I',p_role);
    EXECUTE p_sql INTO v_res;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('ok',true,'result',v_res);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    RETURN jsonb_build_object('ok',false,'sqlstate',v_state,'error',v_msg);
  END;
END
$fn$;

CREATE FUNCTION pg_temp.wip_state() RETURNS text LANGUAGE sql AS $fn$
  SELECT md5(COALESCE(string_agg((to_jsonb(w)-'updated_at'-'updated_by')::text,
                                 ',' ORDER BY w.id),''))
  FROM public.stage_wip_log w
$fn$;

-- One probe for one principal. Expectations:
--   ERR:<sqlstate>[:<message>]  denied; the whole table is unchanged
--   ZERO                        zero rows affected (RLS-invisible); unchanged
--   ONE | ONE_UNCHANGED         one row affected (the latter: stored row identical)
--   OK                          call succeeded
--   EQ:<text>                   call succeeded and returned exactly that JSON string
-- The probe's own effects are always rolled back (private ZZ001 exception).
CREATE FUNCTION pg_temp.check_call(p_label text, p_who text, p_sql text, p_expect text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  -- OWNADM: the table owner role (what an owner-run SECURITY DEFINER function
  -- executes as) carrying the Org Admin's JWT subject.
  v_role text := CASE p_who WHEN 'ANON' THEN 'anon' WHEN 'SVC' THEN 'service_role'
                            WHEN 'OWNADM' THEN session_user::text
                            ELSE 'authenticated' END;
  v_uid uuid := CASE WHEN p_who IN ('ANON','SVC') THEN NULL
                     WHEN p_who='OWNADM' THEN pg_temp.uid('adm')
                     ELSE pg_temp.uid(lower(p_who)) END;
  v_before text; v_after text; v_call jsonb;
  v_state text; v_msg text;
BEGIN
  BEGIN
    v_before := pg_temp.wip_state();
    v_call := pg_temp.try_role(v_role,v_uid,pg_temp.subst(p_sql));
    v_after := pg_temp.wip_state();
    IF p_expect LIKE 'ERR:%' THEN
      v_state := split_part(p_expect,':',2);
      v_msg := NULLIF(split_part(p_expect,':',3),'');
      IF v_call->>'ok' IS DISTINCT FROM 'false'
         OR v_call->>'sqlstate' IS DISTINCT FROM v_state
         OR (v_msg IS NOT NULL AND v_call->>'error' IS DISTINCT FROM v_msg) THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_UNEXPECTED[% / %]: want % got %',
          p_who,p_label,p_expect,v_call;
      END IF;
      IF v_after IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_DENIED_CALL_CHANGED_TABLE[% / %]: %',
          p_who,p_label,v_call;
      END IF;
    ELSIF p_expect='ZERO' THEN
      IF v_call->>'ok' IS DISTINCT FROM 'true' OR v_call->>'result' IS DISTINCT FROM '0'
         OR v_after IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_UNEXPECTED[% / %]: want ZERO got %',
          p_who,p_label,v_call;
      END IF;
    ELSIF p_expect IN ('ONE','ONE_UNCHANGED') THEN
      IF v_call->>'ok' IS DISTINCT FROM 'true' OR v_call->>'result' IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_UNEXPECTED[% / %]: want ONE got %',
          p_who,p_label,v_call;
      END IF;
      IF p_expect='ONE_UNCHANGED' AND v_after IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_FORGED_VALUE_PERSISTED[% / %]',p_who,p_label;
      END IF;
    ELSIF p_expect LIKE 'ROWS:%' THEN
      IF v_call->>'ok' IS DISTINCT FROM 'true'
         OR v_call->>'result' IS DISTINCT FROM substr(p_expect,6) THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_UNEXPECTED[% / %]: want % got %',
          p_who,p_label,p_expect,v_call;
      END IF;
    ELSIF p_expect='OK' THEN
      IF v_call->>'ok' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_UNEXPECTED[% / %]: want OK got %',
          p_who,p_label,v_call;
      END IF;
    ELSIF p_expect LIKE 'EQ:%' THEN
      IF v_call->>'ok' IS DISTINCT FROM 'true'
         OR v_call->>'result' IS DISTINCT FROM substr(p_expect,4) THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_UNEXPECTED[% / %]: want % got %',
          p_who,p_label,p_expect,v_call;
      END IF;
    ELSE
      RAISE EXCEPTION 'GREEN_278_ROLES_BAD_EXPECTATION: %',p_expect;
    END IF;
    RAISE EXCEPTION USING ERRCODE='ZZ001',MESSAGE='probe rollback';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
END
$fn$;

CREATE FUNCTION pg_temp.each_who(p_label text, p_whos text[], p_sql text, p_expect text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE w text;
BEGIN
  FOREACH w IN ARRAY p_whos LOOP
    PERFORM pg_temp.check_call(p_label,w,p_sql,p_expect);
  END LOOP;
END
$fn$;

CREATE FUNCTION pg_temp.upd(p_set text, p_key text) RETURNS text LANGUAGE sql AS $fn$
  SELECT format('WITH u AS (UPDATE public.stage_wip_log SET %s WHERE id=%L RETURNING 1) '
                || 'SELECT to_jsonb(count(*)) FROM u',p_set,'{'||p_key||'}')
$fn$;

-- Like upd(), but the statement first sets a transaction-local custom setting.
-- The UPDATE reads the CTE that sets it, so the setting exists before the BEFORE
-- ROW trigger fires. Plain-SQL callers (PostgREST) cannot run a second statement
-- in the same transaction, so this is the closest a client can get to forging one.
CREATE FUNCTION pg_temp.upd_marked(p_name text, p_value text, p_set text, p_key text)
RETURNS text LANGUAGE sql AS $fn$
  SELECT format('WITH f AS MATERIALIZED (SELECT set_config(%L,%L,true) AS v), '
                || 'u AS (UPDATE public.stage_wip_log w SET %s FROM f WHERE w.id=%L RETURNING 1) '
                || 'SELECT to_jsonb(count(*)) FROM u',p_name,p_value,p_set,'{'||p_key||'}')
$fn$;

CREATE FUNCTION pg_temp.ins(p_extra_cols text, p_vals text) RETURNS text LANGUAGE sql AS $fn$
  SELECT format('WITH i AS (INSERT INTO public.stage_wip_log'
                || '(org_id,mo_id,stage_id,period_start,period_end%s) VALUES (%s) RETURNING 1) '
                || 'SELECT to_jsonb(count(*)) FROM i',p_extra_cols,p_vals)
$fn$;

CREATE FUNCTION pg_temp.close_rpc(p_key text) RETURNS text LANGUAGE sql AS $fn$
  SELECT format('SELECT to_jsonb(public.rpc_close_stage_wip_194(%L::uuid))','{'||p_key||'}')
$fn$;

-- ------------------------------------------------------------------ fixture
DO $fx$
DECLARE
  o1 uuid:=pg_temp.org(); o2 uuid:='ed000000-0000-4000-8000-0000000000e0';
  s1 uuid:=pg_temp.stage(); s1b uuid:='ed000000-0000-4000-8000-0000000000f9';
  s2 uuid:='ed000000-0000-4000-8000-0000000000f8';
  a4 uuid:='ed000000-0000-4000-8000-0000000000a4';   -- ED    non-admin, explicit create/update
  a5 uuid:='ed000000-0000-4000-8000-0000000000a5';   -- FADM  foreign org admin
  a6 uuid:='ed000000-0000-4000-8000-0000000000a6';   -- FMEM  foreign org member with grants
  a7 uuid:='ed000000-0000-4000-8000-0000000000a7';   -- INACT editor role, membership deactivated
  a8 uuid:='ed000000-0000-4000-8000-0000000000a8';   -- EXP   editor role expired
  a9 uuid:='ed000000-0000-4000-8000-0000000000a9';   -- NULLACT editor role, membership is_active IS NULL
  r1 uuid:='ed000000-0000-4000-8000-0000000000b4';
  r2 uuid:='ed000000-0000-4000-8000-0000000000b5';
  mo_a uuid; mo_b uuid; mo_c uuid; mo2 uuid:=gen_random_uuid();
  ev uuid:=gen_random_uuid();
BEGIN
  INSERT INTO public.organizations(id,name,code) VALUES (o2,'Roles 278 Org2','ROLES-278-2');
  INSERT INTO auth.users(id,email) VALUES
    (a4,'roles-278-editor@example.test'),(a5,'roles-278-foreign-admin@example.test'),
    (a6,'roles-278-foreign-member@example.test'),(a7,'roles-278-inactive@example.test'),
    (a8,'roles-278-expired@example.test'),(a9,'roles-278-null-active@example.test');
  INSERT INTO public.user_organizations(user_id,org_id,role,is_active,is_org_admin) VALUES
    (a4,o1,'user',true,false),(a7,o1,'user',true,false),(a8,o1,'user',true,false),
    (a9,o1,'user',true,false),
    (a5,o2,'admin',true,true),(a6,o2,'user',true,false);
  INSERT INTO public.roles(id,org_id,name,name_ar,is_active) VALUES
    (r1,o1,'ROLES 278 Editor','محرر',true),(r2,o2,'ROLES 278 Editor 2','محرر 2',true);
  INSERT INTO public.role_permissions(role_id,permission_id)
    SELECT r,p.id FROM (VALUES (r1),(r2)) AS x(r), public.permissions p
    WHERE p.permission_key IN ('manufacturing.stage_costs.create',
      'manufacturing.stage_costs.update','manufacturing.stage_costs.read');
  INSERT INTO public.user_roles(user_id,role_id,org_id,expires_at) VALUES
    (a4,r1,o1,NULL),(a7,r1,o1,NULL),(a8,r1,o1,now()-interval '1 day'),(a6,r2,o2,NULL),
    (a9,r1,o1,NULL);
  -- The DB refuses a role for a user without an ACTIVE membership, so the
  -- inactive principal is deactivated only after its role was granted.
  UPDATE public.user_organizations SET is_active=false WHERE user_id=a7 AND org_id=o1;
  -- is_active is nullable. Tenant resolution (and so row-level security) counts a
  -- NULL as active, while wardah_assert_org_member and has_permission need TRUE:
  -- this principal can see the rows and must still be refused by name.
  UPDATE public.user_organizations SET is_active=NULL WHERE user_id=a9 AND org_id=o1;
  INSERT INTO public.manufacturing_stages(id,org_id,code,name,order_sequence) VALUES
    (s1b,o1,'ROLES-278-B','Roles stage B',2),(s2,o2,'ROLES-278-2','Roles stage org2',1);
  INSERT INTO public.manufacturing_orders(id,org_id,order_number,quantity,status)
    VALUES (mo2,o2,'ROLES-278-ORG2',5,'draft');
  INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end)
    VALUES (o2,mo2,s2,CURRENT_DATE,CURRENT_DATE+10);

  mo_a:=pg_temp.mk_mo('ROLES-278-POSTED',5,20,'in_progress','IN_PROGRESS');
  mo_b:=pg_temp.mk_mo('ROLES-278-OPEN',5,1,'in_progress','IN_PROGRESS');
  mo_c:=pg_temp.mk_mo('ROLES-278-CLOSE',5,1,'in_progress','IN_PROGRESS');
  PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(mo_a,ev));

  INSERT INTO pg_temp.ids(k,v) VALUES
    ('org1',o1),('org2',o2),('stage1',s1),('stage1b',s1b),('stage2',s2),
    ('adm',pg_temp.admin()),('con',pg_temp.consumer()),('rdr',pg_temp.reader()),
    ('ed',a4),('fadm',a5),('fmem',a6),('inact',a7),('exp',a8),('nullact',a9),
    ('moA',mo_a),('moB',mo_b),('moC',mo_c),('mo2',mo2),('evA',ev),
    ('wipA',(SELECT id FROM public.stage_wip_log WHERE mo_id=mo_a)),
    ('wipB',(SELECT id FROM public.stage_wip_log WHERE mo_id=mo_b)),
    ('wipC',(SELECT id FROM public.stage_wip_log WHERE mo_id=mo_c)),
    ('moH',(SELECT id FROM public.manufacturing_orders WHERE order_number='GREEN-278-HISTORICAL')),
    ('moN',(SELECT id FROM public.manufacturing_orders WHERE order_number='GREEN-278-NULL-OPEN')),
    ('wipN',(SELECT w.id FROM public.stage_wip_log w JOIN public.manufacturing_orders m
             ON m.id=w.mo_id WHERE m.order_number='GREEN-278-NULL-OPEN')),
    ('moAmb',(SELECT id FROM public.manufacturing_orders WHERE order_number='GREEN-278-AMBIGUOUS')),
    ('moAmbNull',(SELECT id FROM public.manufacturing_orders WHERE order_number='GREEN-278-AMBIGUOUS-NULL'));

  IF (SELECT cost_material FROM public.stage_wip_log WHERE id=pg_temp.uid('wipA'))<>100
     OR (SELECT is_closed FROM public.stage_wip_log WHERE id=pg_temp.uid('wipN')) IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM wardah_internal.material_issue_events e
                    JOIN public.stage_wip_log w ON w.id::text=e.result->>'stage_wip_log_id'
                    WHERE e.event_id=ev) THEN
    RAISE EXCEPTION 'GREEN_278_ROLES_INVALID_FIXTURE';
  END IF;
END
$fx$;

-- ------------------------------------------- cost, identity and closed state
DO $cost_identity$
DECLARE
  v_reach text[]:=ARRAY['ED','ADM','RDR','CON','EXP','SVC'];  -- reach the row trigger
  v_blind text[]:=ARRAY['INACT','FADM','FMEM'];                -- RLS hides the row
BEGIN
  -- Posted material cost: nobody but the M192 writer, whatever the role.
  PERFORM pg_temp.each_who('cost=0',v_reach,pg_temp.upd('cost_material=0','wipA'),
    'ERR:P0001:WIP_POSTED_MATERIAL_IMMUTABLE');
  PERFORM pg_temp.each_who('cost=9999',v_reach,pg_temp.upd('cost_material=9999','wipA'),
    'ERR:P0001:WIP_POSTED_MATERIAL_IMMUTABLE');
  PERFORM pg_temp.each_who('stale form: cost 50 + labor',v_reach,
    pg_temp.upd('cost_material=50,cost_labor=cost_labor+1','wipA'),
    'ERR:P0001:WIP_POSTED_MATERIAL_IMMUTABLE');
  -- A marker the CLIENT sets itself is worthless: it counts only for the table
  -- owner, and only when it names this very row. OWNADM (the owner role, as an
  -- owner-run function executes) is the control proving this statement shape
  -- really delivers the marker before the row trigger; without it the client
  -- denials below could pass merely because no marker ever arrived.
  PERFORM pg_temp.each_who('cost marker for this row, owner (control)',ARRAY['OWNADM'],
    pg_temp.upd_marked('wardah.material_issue_wip_194','{wipA}','cost_material=cost_material+1','wipA'),
    'ONE');
  PERFORM pg_temp.each_who('cost marker for another row, owner',ARRAY['OWNADM'],
    pg_temp.upd_marked('wardah.material_issue_wip_194','{wipB}','cost_material=cost_material+1','wipA'),
    'ERR:P0001:WIP_POSTED_MATERIAL_IMMUTABLE');
  PERFORM pg_temp.each_who('cost marker for this row, forged by a client',v_reach,
    pg_temp.upd_marked('wardah.material_issue_wip_194','{wipA}','cost_material=cost_material+1','wipA'),
    'ERR:P0001:WIP_POSTED_MATERIAL_IMMUTABLE');
  -- Identity and eligibility dates, including the primary key that the M192
  -- receipt links to (there is no foreign key on that link).
  PERFORM pg_temp.each_who('org_id',v_reach,pg_temp.upd('org_id=''{org2}''','wipA'),
    'ERR:P0001:WIP_IDENTITY_OR_PERIOD_IMMUTABLE');
  PERFORM pg_temp.each_who('mo_id',v_reach,pg_temp.upd('mo_id=''{moB}''','wipA'),
    'ERR:P0001:WIP_IDENTITY_OR_PERIOD_IMMUTABLE');
  PERFORM pg_temp.each_who('stage_id',v_reach,pg_temp.upd('stage_id=''{stage1b}''','wipA'),
    'ERR:P0001:WIP_IDENTITY_OR_PERIOD_IMMUTABLE');
  PERFORM pg_temp.each_who('period_end',v_reach,pg_temp.upd('period_end=period_end+1','wipA'),
    'ERR:P0001:WIP_IDENTITY_OR_PERIOD_IMMUTABLE');
  PERFORM pg_temp.each_who('period_start',v_reach,pg_temp.upd('period_start=period_start-1','wipA'),
    'ERR:P0001:WIP_IDENTITY_OR_PERIOD_IMMUTABLE');
  PERFORM pg_temp.each_who('id re-key',v_reach,pg_temp.upd('id=gen_random_uuid()','wipA'),
    'ERR:P0001:WIP_IDENTITY_OR_PERIOD_IMMUTABLE');
  -- The upsert conflict path is an UPDATE too: same protections, same errors.
  PERFORM pg_temp.each_who('id re-key via ON CONFLICT (id)',ARRAY['ED','ADM'],
    'WITH i AS (INSERT INTO public.stage_wip_log'
    || '(id,org_id,mo_id,stage_id,period_start,period_end) '
    || 'VALUES (''{wipA}'',''{org1}'',''{moA}'',''{stage1}'',CURRENT_DATE+400,CURRENT_DATE+410) '
    || 'ON CONFLICT (id) DO UPDATE SET id=gen_random_uuid() RETURNING 1) '
    || 'SELECT to_jsonb(count(*)) FROM i',
    'ERR:P0001:WIP_IDENTITY_OR_PERIOD_IMMUTABLE');
  PERFORM pg_temp.each_who('cost via ON CONFLICT (id)',ARRAY['ED','ADM'],
    'WITH i AS (INSERT INTO public.stage_wip_log'
    || '(id,org_id,mo_id,stage_id,period_start,period_end) '
    || 'VALUES (''{wipA}'',''{org1}'',''{moA}'',''{stage1}'',CURRENT_DATE+400,CURRENT_DATE+410) '
    || 'ON CONFLICT (id) DO UPDATE SET cost_material=0 RETURNING 1) '
    || 'SELECT to_jsonb(count(*)) FROM i',
    'ERR:P0001:WIP_POSTED_MATERIAL_IMMUTABLE');
  -- Direct close, partial close and reopen belong to the audited RPC only.
  PERFORM pg_temp.each_who('direct close',ARRAY['ED','ADM','RDR','CON','EXP','SVC'],
    pg_temp.upd('is_closed=true,closed_at=now(),closed_by=auth.uid()','wipA'),
    'ERR:P0001:WIP_CLOSE_REQUIRES_RPC');
  PERFORM pg_temp.each_who('closed_by only',ARRAY['ED','ADM'],
    pg_temp.upd('closed_by=auth.uid()','wipA'),'ERR:P0001:WIP_CLOSE_REQUIRES_RPC');
  PERFORM pg_temp.each_who('closed_at only',ARRAY['ED','ADM'],
    pg_temp.upd('closed_at=now()','wipA'),'ERR:P0001:WIP_CLOSE_REQUIRES_RPC');
  -- The close token follows the same rule: owner-run, and bound to this row.
  PERFORM pg_temp.each_who('close token for this row, owner (control)',ARRAY['OWNADM'],
    pg_temp.upd_marked('wardah.stage_wip_close_194','{wipC}',
      'is_closed=true,closed_at=now(),closed_by=auth.uid()','wipC'),'ONE');
  PERFORM pg_temp.each_who('close token for another row, owner',ARRAY['OWNADM'],
    pg_temp.upd_marked('wardah.stage_wip_close_194','{wipB}',
      'is_closed=true,closed_at=now(),closed_by=auth.uid()','wipC'),
    'ERR:P0001:WIP_CLOSE_REQUIRES_RPC');
  PERFORM pg_temp.each_who('close token for this row, forged by a client',v_reach,
    pg_temp.upd_marked('wardah.stage_wip_close_194','{wipC}',
      'is_closed=true,closed_at=now(),closed_by=auth.uid()','wipC'),
    'ERR:P0001:WIP_CLOSE_REQUIRES_RPC');
  -- A row RLS hides is not a denial: it must be zero rows AND leave the table alone.
  PERFORM pg_temp.each_who('cost=0 (hidden row)',v_blind,pg_temp.upd('cost_material=0','wipA'),'ZERO');
  PERFORM pg_temp.each_who('id re-key (hidden row)',v_blind,pg_temp.upd('id=gen_random_uuid()','wipA'),'ZERO');
  PERFORM pg_temp.each_who('cost=0 (anon)',ARRAY['ANON'],pg_temp.upd('cost_material=0','wipA'),'ERR:42501');
  -- Derived values are recomputed by the equivalent-unit trigger, never stored.
  PERFORM pg_temp.each_who('forged derived columns',ARRAY['ED','ADM'],
    pg_temp.upd('equivalent_units_material=999999,cost_per_eu_material=999999,'
                || 'cost_completed_transferred=999999,cost_ending_wip=999999','wipA'),
    'ONE_UNCHANGED');
  RAISE NOTICE 'GREEN_278_ROLES_COST_IDENTITY_CLOSE_FIELDS';
END
$cost_identity$;

-- ------------------------------ lawful writes, INSERT permission, intervals
DO $writes$
DECLARE
  v_ins text:=pg_temp.ins('','''{org1}'',''{moB}'',''{stage1}'',CURRENT_DATE+200,CURRENT_DATE+210');
  -- new interval derived from the existing open row wipB = [ps,pe]
  v_iv text:='WITH b AS (SELECT period_start ps,period_end pe FROM public.stage_wip_log '
    || 'WHERE id=''{wipB}''), i AS (INSERT INTO public.stage_wip_log'
    || '(org_id,mo_id,stage_id,period_start,period_end) SELECT ''{org1}'',''{moB}'','
    || '''{stage1}'',%s,%s FROM b RETURNING 1) SELECT to_jsonb(count(*)) FROM i';
  -- new interval against the two committed historical rows
  -- H1=[2025-11-16,2025-11-23], H2=[2025-11-17,2025-11-24], both open, cost 1000
  v_h text:='WITH i AS (INSERT INTO public.stage_wip_log'
    || '(org_id,mo_id,stage_id,period_start,period_end) VALUES '
    || '(''{org1}'',''{moH}'',''{stage1}'',DATE ''%s'',DATE ''%s'') RETURNING 1) '
    || 'SELECT to_jsonb(count(*)) FROM i';
  v_nul text:='WITH b AS (SELECT period_start ps,period_end pe FROM public.stage_wip_log '
    || 'WHERE id=''{wipN}''), i AS (INSERT INTO public.stage_wip_log'
    || '(org_id,mo_id,stage_id,period_start,period_end) SELECT ''{org1}'',''{moN}'','
    || '''{stage1}'',ps+1,pe FROM b RETURNING 1) SELECT to_jsonb(count(*)) FROM i';
  v_over text:='ERR:P0001:WIP_OPEN_PERIOD_OVERLAP';
BEGIN
  -- Lawful edits keep working, including an old bundle that resends the
  -- unchanged protected fields together with a labor change.
  PERFORM pg_temp.each_who('lawful labor edit',ARRAY['ED','ADM'],
    pg_temp.upd('cost_labor=cost_labor+5','wipB'),'ONE');
  PERFORM pg_temp.each_who('old bundle: unchanged protected fields + labor',ARRAY['ED','ADM'],
    pg_temp.upd('mo_id=''{moA}'',stage_id=''{stage1}'',cost_material=100,cost_labor=cost_labor+1','wipA'),
    'ONE');
  PERFORM pg_temp.each_who('labor edit by a member whose is_active IS NULL',ARRAY['NULLACT'],
    pg_temp.upd('cost_labor=cost_labor+1','wipB'),'ERR:P0001:NOT_ORG_MEMBER');
  PERFORM pg_temp.each_who('labor edit without stage_costs.update',ARRAY['RDR','CON','EXP'],
    pg_temp.upd('cost_labor=cost_labor+5','wipB'),'ERR:P0001:WIP_UPDATE_PERMISSION_DENIED');
  PERFORM pg_temp.each_who('labor edit by service_role',ARRAY['SVC'],
    pg_temp.upd('cost_labor=cost_labor+5','wipB'),'ERR:42501');
  PERFORM pg_temp.each_who('labor edit, row hidden by RLS',ARRAY['INACT','FADM','FMEM'],
    pg_temp.upd('cost_labor=cost_labor+5','wipB'),'ZERO');
  PERFORM pg_temp.each_who('labor edit by anon',ARRAY['ANON'],
    pg_temp.upd('cost_labor=cost_labor+5','wipB'),'ERR:42501');
  PERFORM pg_temp.each_who('lawful labor edit on a historical overlapping row',ARRAY['ED'],
    'WITH u AS (UPDATE public.stage_wip_log SET cost_labor=cost_labor+1 '
    || 'WHERE mo_id=''{moH}'' AND period_start=DATE ''2025-11-16'' RETURNING 1) '
    || 'SELECT to_jsonb(count(*)) FROM u','ONE');

  -- INSERT needs stage_costs.create: this is separate from the UPDATE check.
  PERFORM pg_temp.each_who('lawful non-overlapping insert',ARRAY['ED','ADM'],v_ins,'ONE');
  PERFORM pg_temp.each_who('insert without stage_costs.create',ARRAY['RDR','CON','EXP'],v_ins,
    'ERR:P0001:WIP_CREATE_PERMISSION_DENIED');
  -- The MO table's own policy hides its row from this principal, so an INSERT stops
  -- at the parent check before the editor helper is reached (UPDATE, above, does not).
  PERFORM pg_temp.each_who('insert by a member whose is_active IS NULL',ARRAY['NULLACT'],v_ins,
    'ERR:P0001:WIP_PARENT_ORG_MISMATCH');
  PERFORM pg_temp.each_who('insert by inactive or foreign member',ARRAY['INACT','FADM','FMEM'],v_ins,
    'ERR:P0001:WIP_PARENT_ORG_MISMATCH');
  PERFORM pg_temp.each_who('insert by anon or service_role',ARRAY['ANON','SVC'],v_ins,'ERR:42501');
  PERFORM pg_temp.each_who('insert with posted material cost',ARRAY['ED','ADM','SVC'],
    pg_temp.ins(',cost_material','''{org1}'',''{moB}'',''{stage1}'',CURRENT_DATE+200,CURRENT_DATE+210,5'),
    'ERR:P0001:WIP_CLIENT_POSTED_FIELDS_DENIED');
  PERFORM pg_temp.each_who('insert already closed',ARRAY['ED','ADM'],
    pg_temp.ins(',is_closed','''{org1}'',''{moB}'',''{stage1}'',CURRENT_DATE+200,CURRENT_DATE+210,true'),
    'ERR:P0001:WIP_CLIENT_POSTED_FIELDS_DENIED');
  PERFORM pg_temp.each_who('foreign MO under an org1 row',ARRAY['ED','ADM'],
    pg_temp.ins('','''{org1}'',''{mo2}'',''{stage1}'',CURRENT_DATE+200,CURRENT_DATE+210'),
    'ERR:P0001:WIP_PARENT_ORG_MISMATCH');
  PERFORM pg_temp.each_who('foreign stage under an org1 row',ARRAY['ED','ADM'],
    pg_temp.ins('','''{org1}'',''{moB}'',''{stage2}'',CURRENT_DATE+200,CURRENT_DATE+210'),
    'ERR:P0001:WIP_PARENT_ORG_MISMATCH');
  PERFORM pg_temp.each_who('org2 row for an org2 MO by its own members',ARRAY['FADM','FMEM'],
    pg_temp.ins('','''{org2}'',''{mo2}'',''{stage2}'',CURRENT_DATE+200,CURRENT_DATE+210'),'ONE');
  PERFORM pg_temp.each_who('org2 row for an org2 MO by an org1 editor',ARRAY['ED'],
    pg_temp.ins('','''{org2}'',''{mo2}'',''{stage2}'',CURRENT_DATE+200,CURRENT_DATE+210'),
    'ERR:P0001:WIP_PARENT_ORG_MISMATCH');

  -- Inclusive interval semantics against the open row [ps,pe].
  PERFORM pg_temp.each_who('start = existing end (shared day)',ARRAY['ED'],format(v_iv,'pe','pe+5'),v_over);
  PERFORM pg_temp.each_who('end = existing start (shared day)',ARRAY['ED'],format(v_iv,'ps-5','ps'),v_over);
  PERFORM pg_temp.each_who('equal end date, earlier start',ARRAY['ED'],format(v_iv,'ps-10','pe'),v_over);
  PERFORM pg_temp.each_who('equal end date, later start',ARRAY['ED'],format(v_iv,'ps+3','pe'),v_over);
  PERFORM pg_temp.each_who('identical interval',ARRAY['ED'],format(v_iv,'ps','pe'),v_over);
  PERFORM pg_temp.each_who('strictly inside',ARRAY['ED'],format(v_iv,'ps+2','pe-2'),v_over);
  PERFORM pg_temp.each_who('strictly containing',ARRAY['ED'],format(v_iv,'ps-3','pe+3'),v_over);
  PERFORM pg_temp.each_who('single day = existing end',ARRAY['ED'],format(v_iv,'pe','pe'),v_over);
  PERFORM pg_temp.each_who('adjacent day after',ARRAY['ED'],format(v_iv,'pe+1','pe+6'),'ONE');
  PERFORM pg_temp.each_who('adjacent day before',ARRAY['ED'],format(v_iv,'ps-6','ps-1'),'ONE');
  PERFORM pg_temp.each_who('two overlapping rows in one statement',ARRAY['ED'],
    'WITH i AS (INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end) VALUES '
    || '(''{org1}'',''{moB}'',''{stage1}'',CURRENT_DATE+300,CURRENT_DATE+310),'
    || '(''{org1}'',''{moB}'',''{stage1}'',CURRENT_DATE+305,CURRENT_DATE+315) RETURNING 1) '
    || 'SELECT to_jsonb(count(*)) FROM i',v_over);
  PERFORM pg_temp.each_who('two disjoint rows in one statement',ARRAY['ED'],
    'WITH i AS (INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end) VALUES '
    || '(''{org1}'',''{moB}'',''{stage1}'',CURRENT_DATE+300,CURRENT_DATE+310),'
    || '(''{org1}'',''{moB}'',''{stage1}'',CURRENT_DATE+311,CURRENT_DATE+315) RETURNING 1) '
    || 'SELECT to_jsonb(count(*)) FROM i','ROWS:2');

  -- The two historical overlapping rows stay untouched, yet a new interval
  -- touching EITHER of them (not only both) is refused.
  PERFORM pg_temp.each_who('touches H1 only',ARRAY['ED'],format(v_h,'2025-11-10','2025-11-16'),v_over);
  PERFORM pg_temp.each_who('touches H2 only',ARRAY['ED'],format(v_h,'2025-11-24','2025-11-30'),v_over);
  PERFORM pg_temp.each_who('inside both',ARRAY['ED'],format(v_h,'2025-11-18','2025-11-19'),v_over);
  PERFORM pg_temp.each_who('adjacent before H1',ARRAY['ED'],format(v_h,'2025-11-01','2025-11-15'),'ONE');
  PERFORM pg_temp.each_who('adjacent after H2',ARRAY['ED'],format(v_h,'2025-11-25','2025-11-30'),'ONE');

  -- An EXISTING row whose is_closed IS NULL is still open (M192 uses
  -- COALESCE(is_closed,false)=false) and must still block an overlap.
  PERFORM pg_temp.each_who('overlap with an existing is_closed IS NULL row',ARRAY['ED','ADM'],v_nul,v_over);

  -- Forged derived columns on INSERT are recomputed, never stored.
  PERFORM pg_temp.each_who('insert with forged derived columns',ARRAY['ED'],
    pg_temp.ins(',units_started,units_completed,equivalent_units_material,cost_per_eu_material,'
                || 'cost_completed_transferred,cost_ending_wip',
                '''{org1}'',''{moB}'',''{stage1}'',CURRENT_DATE+500,CURRENT_DATE+510,'
                || '4,4,999999,999999,999999,999999'),'ONE');
  RAISE NOTICE 'GREEN_278_ROLES_WRITES_INTERVALS_LEGACY_NULL';
END
$writes$;

-- ---------------------------------------------------------- close RPC
DO $close$
DECLARE
  v_wip uuid:=pg_temp.uid('wipC'); v_mo uuid:=pg_temp.uid('moC');
  v_call jsonb; v_row public.stage_wip_log; v_audit jsonb; v_state jsonb; v_before jsonb;
BEGIN
  PERFORM pg_temp.each_who('close by an authorized editor or admin',ARRAY['ED','ADM'],
    pg_temp.close_rpc('wipC'),'OK');
  -- The close token is transaction scratch space that the RPC must clear again;
  -- the CTE forces the RPC to run before the setting is read.
  PERFORM pg_temp.check_call('close token cleared after the RPC','ED',
    'WITH c AS MATERIALIZED (SELECT public.rpc_close_stage_wip_194(''{wipC}''::uuid) AS r) '
    || 'SELECT to_jsonb(COALESCE(current_setting(''wardah.stage_wip_close_194'',true),''<unset>'')) FROM c',
    'EQ:');
  PERFORM pg_temp.each_who('close without stage_costs.update',ARRAY['RDR','CON','EXP'],
    pg_temp.close_rpc('wipC'),'ERR:P0001:WIP_CLOSE_PERMISSION_DENIED');
  PERFORM pg_temp.each_who('close by an inactive or foreign member',ARRAY['INACT','FADM','FMEM','NULLACT'],
    pg_temp.close_rpc('wipC'),'ERR:P0001:NOT_ORG_MEMBER');
  PERFORM pg_temp.each_who('close by anon or service_role',ARRAY['ANON','SVC'],
    pg_temp.close_rpc('wipC'),'ERR:42501');
  PERFORM pg_temp.check_call('close of an unknown id','ED',
    'SELECT to_jsonb(public.rpc_close_stage_wip_194(gen_random_uuid()))',
    'ERR:P0001:WIP_NOT_FOUND');
  PERFORM pg_temp.check_call('close a legacy is_closed IS NULL row','ED',
    pg_temp.close_rpc('wipN'),'OK');

  -- Persisted close by the non-admin editor: actor, time, audit, one-way.
  v_call:=pg_temp.try_role('authenticated',pg_temp.uid('ed'),pg_temp.subst(pg_temp.close_rpc('wipC')));
  IF v_call->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'GREEN_278_ROLES_CLOSE_FAILED: %',v_call;
  END IF;
  SELECT * INTO v_row FROM public.stage_wip_log WHERE id=v_wip;
  IF v_row.is_closed IS NOT TRUE OR v_row.closed_at IS NULL
     OR v_row.closed_by IS DISTINCT FROM pg_temp.uid('ed')
     OR v_row.updated_by IS DISTINCT FROM pg_temp.uid('ed') THEN
    RAISE EXCEPTION 'GREEN_278_ROLES_CLOSE_ROW_NOT_ATTRIBUTED: %',to_jsonb(v_row);
  END IF;
  SELECT to_jsonb(a) INTO v_audit FROM public.audit_logs a
    WHERE a.entity_id=v_wip::text AND a.action='STAGE_WIP_CLOSED'
      AND a.entity_type='stage_wip_log' AND a.user_id=pg_temp.uid('ed')
      AND a.org_id=pg_temp.org();
  IF v_audit IS NULL OR v_audit->'new_data'->>'is_closed' IS DISTINCT FROM 'true'
     OR v_audit->'old_data'->>'is_closed' IS DISTINCT FROM 'false'
     OR v_audit->'new_data'->>'closed_by' IS DISTINCT FROM pg_temp.uid('ed')::text THEN
    RAISE EXCEPTION 'GREEN_278_ROLES_CLOSE_NOT_AUDITED: %',v_audit;
  END IF;
  PERFORM pg_temp.each_who('close twice',ARRAY['ED','ADM'],pg_temp.close_rpc('wipC'),
    'ERR:P0001:WIP_ALREADY_CLOSED');
  PERFORM pg_temp.each_who('reopen to false',ARRAY['ED','ADM'],pg_temp.upd('is_closed=false','wipC'),
    'ERR:P0001:WIP_CLOSE_REQUIRES_RPC');
  PERFORM pg_temp.each_who('reopen to NULL',ARRAY['ED','ADM'],pg_temp.upd('is_closed=NULL','wipC'),
    'ERR:P0001:WIP_CLOSE_REQUIRES_RPC');
  -- A closed row is no longer an M192 target, and no longer blocks a new interval.
  v_before:=pg_temp.consumption_state(v_mo);
  v_call:=pg_temp.try_role('authenticated',pg_temp.uid('con'),pg_temp.issue_193(v_mo,gen_random_uuid()));
  IF v_call->>'error' IS DISTINCT FROM 'OPEN_STAGE_WIP_LOG_NOT_FOUND'
     OR pg_temp.consumption_state(v_mo) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'GREEN_278_ROLES_CLOSED_ROW_STILL_TARGETED: %',v_call;
  END IF;
  PERFORM pg_temp.each_who('new interval over a CLOSED row',ARRAY['ED'],
    'WITH b AS (SELECT period_start ps,period_end pe FROM public.stage_wip_log WHERE id=''{wipC}''), '
    || 'i AS (INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end) '
    || 'SELECT ''{org1}'',''{moC}'',''{stage1}'',ps+1,pe FROM b RETURNING 1) '
    || 'SELECT to_jsonb(count(*)) FROM i','ONE');
  RAISE NOTICE 'GREEN_278_ROLES_CLOSE_RPC';
END
$close$;

-- ----------------------- ACL, owner and security mode of the new functions
-- The guard must stay SECURITY INVOKER: run as DEFINER, current_user would be the
-- owner for every caller and the owner test would stop separating them.
DO $acl$
DECLARE
  v_owner text:=(SELECT pg_get_userbyid(relowner) FROM pg_class
                 WHERE oid='public.stage_wip_log'::regclass);
  r record; g text;
BEGIN
  FOR r IN
    SELECT w.sig AS fn, w.sig::text AS name, w.definer, w.client_exec,
           p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner
    FROM (VALUES
      ('public.wardah_assert_stage_wip_editor_194(uuid,text)'::regprocedure,true,true),
      ('public.rpc_close_stage_wip_194(uuid)'::regprocedure,true,true),
      ('wardah_internal.guard_stage_wip_write_194()'::regprocedure,false,false)
    ) AS w(sig,definer,client_exec)
    JOIN pg_proc p ON p.oid=w.sig
  LOOP
    IF r.owner IS DISTINCT FROM v_owner OR r.prosecdef IS DISTINCT FROM r.definer THEN
      RAISE EXCEPTION 'GREEN_278_ROLES_FUNCTION_SHAPE[%]: owner=% definer=%',
        r.name,r.owner,r.prosecdef;
    END IF;
    IF r.definer AND NOT COALESCE(r.proconfig::text LIKE '%search_path=public, pg_temp%',false) THEN
      RAISE EXCEPTION 'GREEN_278_ROLES_SEARCH_PATH_NOT_PINNED[%]: %',r.name,r.proconfig;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p2,
                 aclexplode(COALESCE(p2.proacl,acldefault('f',p2.proowner))) a
               WHERE p2.oid=r.fn AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'GREEN_278_ROLES_PUBLIC_EXECUTE[%]',r.name;
    END IF;
    FOREACH g IN ARRAY ARRAY['anon','service_role'] LOOP
      IF has_function_privilege(g,r.fn,'EXECUTE') THEN
        RAISE EXCEPTION 'GREEN_278_ROLES_CLIENT_EXECUTE[% / %]',g,r.name;
      END IF;
    END LOOP;
    IF has_function_privilege('authenticated',r.fn,'EXECUTE') IS DISTINCT FROM r.client_exec THEN
      RAISE EXCEPTION 'GREEN_278_ROLES_AUTHENTICATED_EXECUTE[%]: want %',r.name,r.client_exec;
    END IF;
  END LOOP;
  RAISE NOTICE 'GREEN_278_ROLES_FUNCTION_ACL';
END
$acl$;

-- ------------------- legacy ambiguity, including a NULL is_closed member
DO $ambiguity$
DECLARE
  k text; v_mo uuid; v_before jsonb; v_call jsonb; v_event uuid;
BEGIN
  FOREACH k IN ARRAY ARRAY['moAmb','moAmbNull'] LOOP
    v_mo:=pg_temp.uid(k); v_event:=gen_random_uuid();
    IF (SELECT count(*) FROM public.stage_wip_log
        WHERE mo_id=v_mo AND CURRENT_DATE BETWEEN period_start AND period_end
          AND COALESCE(is_closed,false)=false)<>2 THEN
      RAISE EXCEPTION 'GREEN_278_ROLES_AMBIGUITY_FIXTURE_MISSING: %',k;
    END IF;
    v_before:=pg_temp.consumption_state(v_mo);
    v_call:=pg_temp.try_role('authenticated',pg_temp.uid('con'),pg_temp.issue_193(v_mo,v_event));
    IF v_call->>'sqlstate' IS DISTINCT FROM 'P0001'
       OR v_call->>'error' IS DISTINCT FROM 'AMBIGUOUS_OPEN_STAGE_WIP_LOG'
       OR pg_temp.consumption_state(v_mo) IS DISTINCT FROM v_before
       OR EXISTS (SELECT 1 FROM wardah_internal.material_issue_events WHERE event_id=v_event) THEN
      RAISE EXCEPTION 'GREEN_278_ROLES_AMBIGUOUS_ISSUE_ALLOWED[%]: %',k,v_call;
    END IF;
  END LOOP;
  RAISE NOTICE 'GREEN_278_ROLES_AMBIGUITY_INCLUDING_NULL_OPEN';
END
$ambiguity$;

-- The receipt still points at a real WIP row after every attempt above.
DO $link$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wardah_internal.material_issue_events e
                 JOIN public.stage_wip_log w ON w.id::text=e.result->>'stage_wip_log_id'
                 WHERE e.event_id=pg_temp.uid('evA'))
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=pg_temp.uid('wipA'))<>100 THEN
    RAISE EXCEPTION 'GREEN_278_ROLES_RECEIPT_LINK_BROKEN';
  END IF;
  RAISE NOTICE 'GREEN_278_ROLE_MATRIX';
END
$link$;
ROLLBACK;
