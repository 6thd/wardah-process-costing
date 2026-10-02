-- M199 manufacturing quality control — behavioral acceptance (disposable PG17).
-- Runs after the shared manufacturing fixture
-- (docs/db/manufacturing-inventory-red-20260925/00_fixture.sql) and inside one
-- transaction that is rolled back, so it leaves no state behind.
\set ON_ERROR_STOP on
BEGIN;
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

-- ---------------------------------------------------------------- identities
CREATE FUNCTION pg_temp.inspector() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a4'::uuid $$;
CREATE FUNCTION pg_temp.qmanager()  RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a5'::uuid $$;
CREATE FUNCTION pg_temp.producer()  RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a6'::uuid $$;
CREATE FUNCTION pg_temp.outsider()  RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a7'::uuid $$;
CREATE FUNCTION pg_temp.org2()      RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-000000000002'::uuid $$;

-- ------------------------------------------------------------------ helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'M199_ACCEPTANCE_FAIL: %', p_label; END IF;
  RAISE NOTICE 'ok  %', p_label;
END $fn$;

-- The call must fail and its message must contain p_expect.
CREATE FUNCTION pg_temp.denied(p_uid uuid, p_sql text, p_expect text, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb := pg_temp.try_as(p_uid, p_sql);
BEGIN
  IF (v->>'ok')::boolean OR position(p_expect IN COALESCE(v->>'error','')) = 0 THEN
    RAISE EXCEPTION 'M199_ACCEPTANCE_FAIL: % expected % got %', p_label, p_expect, v;
  END IF;
  RAISE NOTICE 'ok  % (%)', p_label, p_expect;
END $fn$;

-- Owner-context call (the quarantined legacy RPCs are closed to clients; this
-- stands in for the future reviewed completion path) with a user identity.
CREATE FUNCTION pg_temp.owner_try(p_uid uuid, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_res jsonb; v_state text; v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE p_sql INTO v_res;
    RETURN jsonb_build_object('ok', true, 'result', v_res);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN jsonb_build_object('ok', false, 'sqlstate', v_state, 'error', v_msg);
  END;
END $fn$;

CREATE FUNCTION pg_temp.policy_version() RETURNS bigint LANGUAGE sql AS $$
  SELECT version FROM wardah_internal.quality_policies WHERE org_id = pg_temp.org() $$;

CREATE FUNCTION pg_temp.set_policy(p_policy jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT pg_temp.as_user(pg_temp.admin(), format(
    'SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, %s)',
    pg_temp.org(), p_policy, pg_temp.policy_version()));
$fn$;

CREATE FUNCTION pg_temp.policy(p_gate text, p_scope text DEFAULT 'final_only',
  p_conditional boolean DEFAULT false, p_sod boolean DEFAULT true,
  p_admins boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object('release_gate_mode', p_gate, 'inspection_scope', p_scope,
    'allow_conditional_release', p_conditional, 'segregation_of_duties', p_sod,
    'admins_subject_to_quality_controls', p_admins);
$fn$;

CREATE FUNCTION pg_temp.mo(p_number text, p_qty numeric DEFAULT 10,
  p_status text DEFAULT 'in_progress', p_creator uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $fn$
  INSERT INTO public.manufacturing_orders(org_id, order_number, product_id, quantity, status, created_by)
  VALUES (pg_temp.org(), p_number, pg_temp.fg(), p_qty, p_status,
          COALESCE(p_creator, pg_temp.admin()))
  RETURNING id;
$fn$;

CREATE FUNCTION pg_temp.version(p_mo uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT maintenance_version FROM public.manufacturing_orders WHERE id = p_mo $$;

CREATE FUNCTION pg_temp.hold_sql(p_mo uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_set_mo_quality_hold(%L::uuid, %L, %s, %L)',
    p_mo, p_action, pg_temp.version(p_mo), p_reason);
$fn$;

CREATE FUNCTION pg_temp.inspect_sql(p_mo uuid, p_request uuid, p_payload jsonb)
RETURNS text LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_record_quality_inspection(%L::uuid, %L::uuid, %L::jsonb)',
    p_mo, p_request, p_payload);
$fn$;

CREATE FUNCTION pg_temp.final(p_result text, p_passed numeric, p_failed numeric,
  p_disposition text DEFAULT NULL, p_corrective text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $fn$
  SELECT jsonb_strip_nulls(jsonb_build_object('inspection_type', 'FINAL', 'result', p_result,
    'passed_quantity', p_passed, 'failed_quantity', p_failed,
    'disposition', p_disposition, 'corrective_action', p_corrective));
$fn$;

CREATE FUNCTION pg_temp.complete_sql(p_mo uuid, p_qty numeric) RETURNS text
LANGUAGE sql AS $fn$
  SELECT format($q$SELECT public.rpc_complete_manufacturing_order(jsonb_build_object(
    'mo_id', %L, 'tenant_id', %L, 'completed_quantity', %s, 'allow_zero_cost', 'true'))$q$,
    p_mo, pg_temp.org(), p_qty);
$fn$;

CREATE FUNCTION pg_temp.fg_stock() RETURNS numeric LANGUAGE sql AS $$
  SELECT stock_quantity FROM public.products WHERE id = pg_temp.fg() $$;

-- ------------------------------------------------------------------ fixture
INSERT INTO public.organizations(id, name, code) VALUES (pg_temp.org2(), 'QC Org 2', 'QC-ORG2');
INSERT INTO auth.users(id, email) VALUES
  (pg_temp.inspector(), 'qc-inspector@example.test'),
  (pg_temp.qmanager(),  'qc-manager@example.test'),
  (pg_temp.producer(),  'qc-producer@example.test'),
  (pg_temp.outsider(),  'qc-outsider@example.test');
INSERT INTO public.user_organizations(user_id, org_id, role, is_active, is_org_admin) VALUES
  (pg_temp.inspector(), pg_temp.org(),  'user', true, false),
  (pg_temp.qmanager(),  pg_temp.org(),  'user', true, false),
  (pg_temp.producer(),  pg_temp.org(),  'user', true, false),
  (pg_temp.outsider(),  pg_temp.org2(), 'admin', true, true);
INSERT INTO public.roles(id, org_id, name, name_ar, is_active) VALUES
  ('ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), 'QC Inspector', 'مراقب', true),
  ('ed000000-0000-4000-8000-0000000000b5', pg_temp.org(), 'QC Manager', 'مدير جودة', true);
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b4'::uuid, id FROM public.permissions
WHERE permission_key IN ('manufacturing.quality_inspections.read','manufacturing.quality_inspections.create');
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b5'::uuid, id FROM public.permissions
WHERE permission_key LIKE 'manufacturing.quality_inspections.%';
INSERT INTO public.user_roles(user_id, role_id, org_id, expires_at) VALUES
  (pg_temp.inspector(), 'ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), NULL),
  (pg_temp.producer(),  'ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), NULL),
  (pg_temp.qmanager(),  'ed000000-0000-4000-8000-0000000000b5', pg_temp.org(), NULL);

-- ------------------------------------------------- 1. catalog and defaults
SELECT pg_temp.ok((SELECT count(*) FROM public.permissions p JOIN public.modules m ON m.id = p.module_id
  WHERE m.name = 'manufacturing' AND p.permission_key = m.name || '.' || p.resource || '.' || p.action
    AND p.resource = 'quality_inspections') = 3, 'three quality keys follow module.resource.action');
SELECT pg_temp.ok((SELECT count(*) FROM wardah_internal.quality_policies
  WHERE org_id IN (pg_temp.org(), pg_temp.org2()) AND release_gate_mode = 'off'
    AND inspection_scope = 'final_only' AND NOT allow_conditional_release
    AND segregation_of_duties AND admins_subject_to_quality_controls) = 2,
  'new organizations are seeded with the safe default policy');

SELECT pg_temp.ok(
  (pg_temp.as_user(pg_temp.reader(), format('SELECT public.rpc_get_quality_policy(%L::uuid)', pg_temp.org()))
     #>> '{capabilities,can_read}')::boolean IS FALSE, 'reader without the key cannot read quality');
SELECT pg_temp.ok(
  (pg_temp.as_user(pg_temp.admin(), format('SELECT public.rpc_get_quality_policy(%L::uuid)', pg_temp.org()))
     -> 'capabilities') = '{"can_manage_policy":true,"can_read":true,"can_inspect":false,"can_approve_conditional":false}'::jsonb,
  'org admin manages policy but needs an explicit grant to inspect by default');
SELECT pg_temp.ok(
  (pg_temp.as_user(pg_temp.inspector(), format('SELECT public.rpc_get_quality_policy(%L::uuid)', pg_temp.org()))
     -> 'capabilities') = '{"can_manage_policy":false,"can_read":true,"can_inspect":true,"can_approve_conditional":false}'::jsonb,
  'inspector capabilities');
SELECT pg_temp.denied(pg_temp.outsider(), format('SELECT public.rpc_get_quality_policy(%L::uuid)', pg_temp.org()),
  'NOT_ORG_MEMBER', 'another tenant cannot read this policy');

-- --------------------------------------------------------- 2. policy writes
SELECT pg_temp.denied(pg_temp.inspector(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, 1)',
  pg_temp.org(), pg_temp.policy('all_orders')), 'NOT_ORG_ADMIN', 'non-admin cannot change policy');
SELECT pg_temp.denied(pg_temp.admin(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, 99)',
  pg_temp.org(), pg_temp.policy('all_orders')), 'QUALITY_POLICY_VERSION_CONFLICT', 'stale policy version');
SELECT pg_temp.denied(pg_temp.admin(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, 1)',
  pg_temp.org(), pg_temp.policy('all_orders') || '{"extra":1}'), 'QUALITY_POLICY_UNKNOWN_KEY', 'unknown policy key');
SELECT pg_temp.denied(pg_temp.admin(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, 1)',
  pg_temp.org(), pg_temp.policy('sometimes')), 'QUALITY_POLICY_INVALID', 'invalid gate mode');
SELECT pg_temp.denied(pg_temp.admin(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, 1)',
  pg_temp.org(), pg_temp.policy('off') - 'segregation_of_duties'), 'QUALITY_POLICY_INVALID', 'missing policy key');
SELECT pg_temp.ok((pg_temp.set_policy(pg_temp.policy('off')) ->> 'version')::bigint = 2,
  'admin saves policy and the version increments');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = pg_temp.org()
  AND action = 'manufacturing.quality_policy.update'), 'policy change is audited');

-- -------------------------------------------------- 3. direct table surface
SELECT pg_temp.denied(pg_temp.inspector(), 'SELECT to_jsonb(count(*)) FROM public.quality_inspections',
  'permission denied', 'no direct SELECT');
SELECT pg_temp.denied(pg_temp.inspector(), format($q$WITH i AS (INSERT INTO public.quality_inspections
  (org_id, mo_id, inspection_number, result) VALUES (%L, %L, 'X-1', 'PASS') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM i$q$, pg_temp.org(), pg_temp.mo('QC-DIRECT')),
  'permission denied', 'no direct INSERT');
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.quality_inspections', 'SELECT'),
  'anon has no table privilege');

-- --------------------------------------------- 4. quality hold and return
CREATE TEMP TABLE m(k text PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO m VALUES ('a', pg_temp.mo('QC-A'));
SELECT pg_temp.denied(pg_temp.reader(), pg_temp.hold_sql((SELECT id FROM m WHERE k='a'), 'hold'),
  'QUALITY_INSPECT_PERMISSION_DENIED', 'reader cannot place a quality hold');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.hold_sql((SELECT id FROM m WHERE k='a'), 'hold'),
  'QUALITY_INSPECT_PERMISSION_DENIED', 'org admin without explicit grant cannot hold (admins subject)');
SELECT pg_temp.denied(pg_temp.inspector(), format('SELECT public.rpc_set_mo_quality_hold(%L::uuid, ''hold'', 999, NULL)',
  (SELECT id FROM m WHERE k='a')), 'QUALITY_MO_VERSION_CONFLICT', 'stale MO version');
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='a'), 'hold'))
  ->> 'qc_cycle')::int = 1, 'inspector holds the order: cycle 1');
SELECT pg_temp.ok((SELECT status FROM public.manufacturing_orders WHERE id = (SELECT id FROM m WHERE k='a')) = 'quality_check',
  'order is in quality_check');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='a'), 'return'),
  'QUALITY_RETURN_REASON_REQUIRED', 'return to production needs a reason');

-- ------------------------------------------------- 5. recording inspections
SELECT pg_temp.denied(pg_temp.reader(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('PASS', 10, 0)), 'QUALITY_INSPECT_PERMISSION_DENIED', 'reader cannot inspect');
SELECT pg_temp.denied(pg_temp.outsider(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('PASS', 10, 0)), 'NOT_ORG_MEMBER', 'another tenant admin cannot inspect');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('PASS', 8, 2)), 'QUALITY_DISPOSITION_REQUIRED', 'rejected units need a disposition');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('FAIL', 0, 10, 'scrap')), 'QUALITY_CORRECTIVE_ACTION_REQUIRED', 'FAIL needs corrective action');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('PASS', 0, 0)), 'QUALITY_INVALID_QUANTITY', 'zero inspected quantity');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('CONDITIONAL', 8, 2, 'use_as_is', 'deviation')), 'QUALITY_CONDITIONAL_RELEASE_DISABLED',
  'conditional release is off by default');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('PASS', 8, 2, 'use_as_is')), 'QUALITY_USE_AS_IS_REQUIRES_CONDITIONAL', 'use_as_is only with CONDITIONAL');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('PASS', 10, 0) || jsonb_build_object('stage_id', pg_temp.stage())),
  'QUALITY_STAGE_NOT_ALLOWED', 'FINAL inspection takes no stage');

CREATE TEMP TABLE r(k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
INSERT INTO r VALUES ('first', pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql(
  (SELECT id FROM m WHERE k='a'), 'ed000000-0000-4000-8000-00000000f001', pg_temp.final('PASS', 8, 2, 'scrap'))));
SELECT pg_temp.ok((SELECT v->>'inspection_number' = 'QI-000001' AND (v->>'replayed')::boolean IS FALSE
  AND (v #>> '{release,released_quantity}')::numeric = 8 FROM r WHERE k='first'),
  'first FINAL inspection numbered QI-000001, releases the 8 accepted units');
SELECT pg_temp.ok((SELECT inspector_id = pg_temp.inspector() AND qc_cycle = 1 AND disposition = 'scrap'
  FROM public.quality_inspections WHERE id = (SELECT (v->>'inspection_id')::uuid FROM r WHERE k='first')),
  'inspector identity and cycle are server-assigned');
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql(
  (SELECT id FROM m WHERE k='a'), 'ed000000-0000-4000-8000-00000000f001', pg_temp.final('PASS', 8, 2, 'scrap')))
  ->> 'replayed')::boolean, 'same request replays without a second row');
SELECT pg_temp.ok((SELECT count(*) FROM public.quality_inspections WHERE mo_id = (SELECT id FROM m WHERE k='a')) = 1,
  'replay wrote nothing');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'),
  'ed000000-0000-4000-8000-00000000f001', pg_temp.final('PASS', 10, 0)),
  'QUALITY_REQUEST_ID_REUSED', 'request id reused with a different payload');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = pg_temp.org()
  AND action = 'manufacturing.quality_inspection.create'), 'inspection is audited');

-- ------------------------------------------------------ 6. immutable history
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), 'WITH u AS (UPDATE public.quality_inspections SET result = ''FAIL'' RETURNING 1) SELECT to_jsonb(count(*)) FROM u')
  ->> 'error') = 'QUALITY_INSPECTION_IMMUTABLE', 'even the owner cannot rewrite an inspection');
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), 'WITH d AS (DELETE FROM public.quality_inspections RETURNING 1) SELECT to_jsonb(count(*)) FROM d')
  ->> 'error') = 'QUALITY_INSPECTION_IMMUTABLE', 'even the owner cannot delete an inspection');

-- --------------------------------------------------- 7. reads through RPCs
SELECT pg_temp.ok(jsonb_array_length(pg_temp.as_user(pg_temp.inspector(), format(
  'SELECT public.rpc_list_quality_inspections(%L::uuid, NULL, 50)', pg_temp.org()))) = 1, 'inspector lists inspections');
SELECT pg_temp.denied(pg_temp.reader(), format('SELECT public.rpc_list_quality_inspections(%L::uuid)', pg_temp.org()),
  'QUALITY_READ_PERMISSION_DENIED', 'reader cannot list inspections');
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.inspector(), format('SELECT public.rpc_get_mo_quality_status(%L::uuid)',
  (SELECT id FROM m WHERE k='a'))) #>> '{release,required}')::boolean IS FALSE, 'gate off: release not required');

-- -------------------------------------- 8. gate OFF keeps completion unchanged
INSERT INTO m VALUES ('off', pg_temp.mo('QC-OFF'));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='off'), 10))
  ->> 'ok')::boolean, 'gate off: in_progress -> done completes as before');

-- ------------------------------------------------ 9. gate ON (all orders)
SELECT pg_temp.set_policy(pg_temp.policy('all_orders'));
INSERT INTO m VALUES ('b', pg_temp.mo('QC-B'));
CREATE TEMP TABLE s(k text PRIMARY KEY, v numeric) ON COMMIT DROP;
INSERT INTO s VALUES ('fg_before', pg_temp.fg_stock());
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='b'), 10))
  ->> 'error') = 'QUALITY_CHECK_STATUS_REQUIRED', 'gate on: completion straight from in_progress is blocked');
SELECT pg_temp.ok(pg_temp.fg_stock() = (SELECT v FROM s WHERE k='fg_before'),
  'blocked completion rolled back the finished-goods stock posting');
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='b'), 'hold'));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='b'), 10))
  ->> 'error') = 'QUALITY_RELEASE_REQUIRED', 'gate on: no FINAL inspection, no release');
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='b'), gen_random_uuid(),
  pg_temp.final('FAIL', 4, 6, 'rework', 'retune sealing temperature')));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='b'), 4))
  ->> 'error') = 'QUALITY_RELEASE_REJECTED', 'gate on: a failed FINAL blocks completion');

-- Rework cycle: the PASS of a previous cycle can never release the order.
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='b'), 'return', 'rework sealing'));
SELECT pg_temp.ok((SELECT status FROM public.manufacturing_orders WHERE id = (SELECT id FROM m WHERE k='b')) = 'in_progress',
  'returned to production');
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='b'), 'hold'))
  ->> 'qc_cycle')::int = 2, 'second hold opens cycle 2');
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='b'), 4))
  ->> 'error') = 'QUALITY_RELEASE_REQUIRED', 'cycle-1 inspections do not release cycle 2');
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='b'), gen_random_uuid(),
  pg_temp.final('PASS', 9, 1, 'scrap')));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='b'), 10))
  ->> 'error') = 'QUALITY_RELEASE_QUANTITY_EXCEEDED', 'cannot complete more than the released quantity');
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='b'), 9))
  ->> 'ok')::boolean, 'completes the 9 released units');
SELECT pg_temp.ok(pg_temp.fg_stock() = (SELECT v FROM s WHERE k='fg_before') + 9,
  'only released units entered finished goods');

-- Every completion path inherits the gate, not just the completion RPC.
INSERT INTO m VALUES ('direct', pg_temp.mo('QC-DIRECT-DONE', 10, 'quality_check'));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), format(
  'WITH u AS (UPDATE public.manufacturing_orders SET status = ''done'' WHERE id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u',
  (SELECT id FROM m WHERE k='direct'))) ->> 'error') = 'QUALITY_RELEASE_REQUIRED',
  'a raw status update to done is gated too');

-- ------------------------------------------------ 10. segregation of duties
INSERT INTO m VALUES ('own', pg_temp.mo('QC-OWN', 10, 'in_progress', pg_temp.producer()));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='own'), 'hold'));
SELECT pg_temp.denied(pg_temp.producer(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='own'), gen_random_uuid(),
  pg_temp.final('PASS', 10, 0)), 'QUALITY_SEGREGATION_OF_DUTIES', 'the producer cannot inspect their own order');
INSERT INTO public.stage_wip_log(org_id, mo_id, stage_id, period_start, period_end, created_by)
VALUES (pg_temp.org(), (SELECT id FROM m WHERE k='a'), pg_temp.stage(), CURRENT_DATE, CURRENT_DATE, pg_temp.qmanager());
SELECT pg_temp.denied(pg_temp.qmanager(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='a'), gen_random_uuid(),
  pg_temp.final('PASS', 10, 0)), 'QUALITY_SEGREGATION_OF_DUTIES', 'whoever wrote stage WIP cannot inspect');
SELECT pg_temp.set_policy(pg_temp.policy('all_orders', 'final_only', false, false));
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.producer(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='own'),
  gen_random_uuid(), pg_temp.final('PASS', 10, 0))) ->> 'result') = 'PASS', 'SoD off: producer may inspect');

-- Admins not subject: Org Admin bypass applies and SoD does not bind admins.
SELECT pg_temp.set_policy(pg_temp.policy('all_orders', 'final_only', false, true, false));
INSERT INTO m VALUES ('adm', pg_temp.mo('QC-ADM'));
SELECT pg_temp.as_user(pg_temp.admin(), pg_temp.hold_sql((SELECT id FROM m WHERE k='adm'), 'hold'));
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.admin(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='adm'),
  gen_random_uuid(), pg_temp.final('PASS', 10, 0))) ->> 'result') = 'PASS',
  'admins not subject: admin inspects the order they created');
SELECT pg_temp.set_policy(pg_temp.policy('all_orders'));

-- ------------------------------------------------ 11. conditional release
SELECT pg_temp.set_policy(pg_temp.policy('all_orders', 'final_only', true));
INSERT INTO m VALUES ('c', pg_temp.mo('QC-C'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='c'), 'hold'));
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='c'), gen_random_uuid(),
  pg_temp.final('CONDITIONAL', 7, 3, 'use_as_is', 'cosmetic deviation accepted')),
  'QUALITY_CONDITIONAL_PERMISSION_DENIED', 'conditional release needs approve_conditional');
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.qmanager(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='c'),
  gen_random_uuid(), pg_temp.final('CONDITIONAL', 7, 3, 'use_as_is', 'cosmetic deviation accepted')))
  #>> '{release,released_quantity}')::numeric = 10, 'quality manager releases conditionally (7 + 3 use-as-is)');
SELECT pg_temp.set_policy(pg_temp.policy('all_orders'));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='c'), 10))
  ->> 'error') = 'QUALITY_CONDITIONAL_RELEASE_DISABLED', 'turning conditional release off blocks it at completion');

-- --------------------------------------------- 12. stage + final inspection
SELECT pg_temp.set_policy(pg_temp.policy('all_orders', 'stages_and_final'));
INSERT INTO m VALUES ('st', pg_temp.mo('QC-ST'));
INSERT INTO public.stage_wip_log(org_id, mo_id, stage_id, period_start, period_end)
VALUES (pg_temp.org(), (SELECT id FROM m WHERE k='st'), pg_temp.stage(), CURRENT_DATE, CURRENT_DATE);
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='st'), gen_random_uuid(),
  jsonb_build_object('inspection_type','IN_PROCESS','result','PASS','passed_quantity',10,'failed_quantity',0)),
  'QUALITY_STAGE_REQUIRED', 'in-process inspection names its stage');
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='st'), 'hold'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='st'), gen_random_uuid(),
  pg_temp.final('PASS', 10, 0)));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='st'), 10))
  ->> 'error') = 'QUALITY_STAGE_INSPECTION_REQUIRED', 'stage scope: each WIP stage needs a passing in-process inspection');
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='st'), gen_random_uuid(),
  jsonb_build_object('inspection_type','IN_PROCESS','result','PASS','passed_quantity',10,'failed_quantity',0,
                     'stage_id', pg_temp.stage())));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='st'), 10))
  ->> 'ok')::boolean, 'stage scope satisfied: completion passes');

-- ------------------------------------------------ 13. routing-flagged gate
SELECT pg_temp.set_policy(pg_temp.policy('routing_flagged'));
INSERT INTO m VALUES ('nr', pg_temp.mo('QC-NOROUTE'));
SELECT pg_temp.ok((pg_temp.owner_try(pg_temp.admin(), pg_temp.complete_sql((SELECT id FROM m WHERE k='nr'), 10))
  ->> 'ok')::boolean, 'routing_flagged: an order without an inspection routing is not gated');

-- ------------------------------------------------ 14. template expansion
INSERT INTO public.role_templates(id, name, name_ar, permission_keys, category) VALUES
  ('ed000000-0000-4000-8000-0000000000d9', 'QC Wildcard Probe', 'اختبار', ARRAY['manufacturing.%'], 'manufacturing');
INSERT INTO m VALUES ('role_wild', (pg_temp.as_user(pg_temp.admin(), format(
  'SELECT to_jsonb(public.create_role_from_template(%L::uuid, %L::uuid, ''Wildcard probe''))',
  pg_temp.org(), 'ed000000-0000-4000-8000-0000000000d9')) #>> '{}')::uuid);
INSERT INTO m VALUES ('role_qi', (pg_temp.as_user(pg_temp.admin(), format(
  'SELECT to_jsonb(public.create_role_from_template(%L::uuid, %L::uuid, ''Inspector from template''))',
  pg_temp.org(), (SELECT id FROM public.role_templates WHERE name = 'Quality Inspector'))) #>> '{}')::uuid);
SELECT pg_temp.ok((SELECT count(*) FROM public.role_permissions WHERE role_id = (SELECT id FROM m WHERE k='role_wild')) > 0
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = (SELECT id FROM m WHERE k='role_wild') AND p.resource = 'quality_inspections'),
  'a manufacturing.% template grants other manufacturing keys but no quality key');
SELECT pg_temp.ok((SELECT count(*) FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = (SELECT id FROM m WHERE k='role_qi') AND p.resource = 'quality_inspections') = 2,
  'the Quality Inspector template names its two keys exactly');

SELECT 'M199_QUALITY_CONTROL_ACCEPTANCE_PASS' AS result;
ROLLBACK;
