-- M202 RED: the F1 counterexamples on the canonical chain through M201 (before 202).
-- Rolled back; leaves no state. Every defect below must REPRODUCE here and be
-- closed by acceptance.sql after 202 is applied.
\set ON_ERROR_STOP on
BEGIN;
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

CREATE FUNCTION pg_temp.inspector() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a4'::uuid $$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'M202_RED_FAIL: %', p_label; END IF;
  RAISE NOTICE 'red  %', p_label;
END $fn$;
CREATE FUNCTION pg_temp.mo(p_number text, p_status text DEFAULT 'in_progress') RETURNS uuid
LANGUAGE sql AS $fn$
  INSERT INTO public.manufacturing_orders(org_id, order_number, product_id, quantity, status, created_by)
  VALUES (pg_temp.org(), p_number, pg_temp.fg(), 10, p_status, pg_temp.admin()) RETURNING id;
$fn$;
CREATE FUNCTION pg_temp.release(p_mo uuid) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT wardah_internal.evaluate_quality_release_199(m.org_id, m.id, m.routing_id, m.status, NULL)
  FROM public.manufacturing_orders m WHERE m.id = p_mo $fn$;
-- Direct INSERT of a FINAL inspection by service_role with arbitrary evidence.
CREATE FUNCTION pg_temp.forge_as_service_role(p_mo uuid, p_number text, p_seq bigint,
  p_result text, p_passed numeric, p_failed numeric) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  INSERT INTO public.quality_inspections(org_id, mo_id, inspection_number, inspection_type,
    inspector_id, passed_quantity, failed_quantity, result, qc_cycle, inspection_seq, request_hash)
  VALUES (pg_temp.org(), p_mo, p_number, 'FINAL', pg_temp.inspector(), p_passed, p_failed,
    p_result, 1, p_seq, 'not-an-rpc-hash');
  EXECUTE 'RESET ROLE';
END $fn$;

INSERT INTO auth.users(id, email) VALUES (pg_temp.inspector(), 'qc-inspector@example.test');
INSERT INTO public.user_organizations(user_id, org_id, role, is_active, is_org_admin)
VALUES (pg_temp.inspector(), pg_temp.org(), 'user', true, false);
INSERT INTO public.roles(id, org_id, name, name_ar, is_active)
VALUES ('ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), 'QC Inspector', 'مراقب', true);
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b4'::uuid, id FROM public.permissions
WHERE permission_key IN ('manufacturing.quality_inspections.read','manufacturing.quality_inspections.create');
INSERT INTO public.user_roles(user_id, role_id, org_id, expires_at)
VALUES (pg_temp.inspector(), 'ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), NULL);
SELECT pg_temp.as_user(pg_temp.admin(), format(
  'SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, 1)', pg_temp.org(),
  '{"release_gate_mode":"all_orders","inspection_scope":"final_only","allow_conditional_release":false,"segregation_of_duties":true,"admins_subject_to_quality_controls":true}'::jsonb));

CREATE TEMP TABLE m(k text PRIMARY KEY, id uuid) ON COMMIT DROP;

-- RED 1 (F1): service_role forges release evidence and the gate opens.
INSERT INTO m VALUES ('f1', pg_temp.mo('RED-F1', 'quality_check'));
SELECT pg_temp.ok((pg_temp.release((SELECT id FROM m WHERE k='f1')) ->> 'ready')::boolean IS FALSE,
  'RED1 precondition: gate closed with no evidence');
SELECT pg_temp.ok(has_table_privilege('service_role', 'public.quality_inspections', 'INSERT'),
  'RED1 service_role holds INSERT on quality_inspections');
SELECT pg_temp.forge_as_service_role((SELECT id FROM m WHERE k='f1'), 'FORGED-1', 999, 'PASS', 10, 0);
SELECT pg_temp.ok((pg_temp.release((SELECT id FROM m WHERE k='f1')) ->> 'ready')::boolean IS TRUE,
  'RED1 forged FINAL PASS by service_role opens the release gate');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.audit_logs
  WHERE action = 'manufacturing.quality_inspection.create' AND entity_id IN
    (SELECT id::text FROM public.quality_inspections WHERE inspection_number = 'FORGED-1')),
  'RED1 the forged row has no RPC audit record');

-- RED 2: a NULL inspection_seq (NULLS FIRST under DESC) shadows a genuine FAIL.
INSERT INTO m VALUES ('nul', pg_temp.mo('RED-NULL'));
SELECT pg_temp.as_user(pg_temp.inspector(), format(
  'SELECT public.rpc_set_mo_quality_hold(%L::uuid, ''hold'', %s, NULL)', (SELECT id FROM m WHERE k='nul'),
  (SELECT maintenance_version FROM public.manufacturing_orders WHERE id = (SELECT id FROM m WHERE k='nul'))));
SELECT pg_temp.forge_as_service_role((SELECT id FROM m WHERE k='nul'), 'FORGED-NULL', NULL, 'PASS', 10, 0);
SELECT pg_temp.as_user(pg_temp.inspector(), format(
  'SELECT public.rpc_record_quality_inspection(%L::uuid, gen_random_uuid(), %L::jsonb)', (SELECT id FROM m WHERE k='nul'),
  '{"inspection_type":"FINAL","result":"FAIL","passed_quantity":0,"failed_quantity":10,"disposition":"scrap","corrective_action":"reject lot"}'::jsonb));
SELECT pg_temp.ok((pg_temp.release((SELECT id FROM m WHERE k='nul')) ->> 'ready')::boolean IS TRUE,
  'RED2 a NULL-sequence forged PASS shadows a later genuine FAIL');

-- RED 3: a high forged sequence shadows a later genuine FAIL and nothing can override it.
INSERT INTO m VALUES ('hi', pg_temp.mo('RED-HIGH'));
SELECT pg_temp.as_user(pg_temp.inspector(), format(
  'SELECT public.rpc_set_mo_quality_hold(%L::uuid, ''hold'', %s, NULL)', (SELECT id FROM m WHERE k='hi'),
  (SELECT maintenance_version FROM public.manufacturing_orders WHERE id = (SELECT id FROM m WHERE k='hi'))));
SELECT pg_temp.forge_as_service_role((SELECT id FROM m WHERE k='hi'), 'FORGED-HIGH', 999, 'PASS', 10, 0);
SELECT pg_temp.as_user(pg_temp.inspector(), format(
  'SELECT public.rpc_record_quality_inspection(%L::uuid, gen_random_uuid(), %L::jsonb)', (SELECT id FROM m WHERE k='hi'),
  '{"inspection_type":"FINAL","result":"FAIL","passed_quantity":0,"failed_quantity":10,"disposition":"scrap","corrective_action":"reject lot"}'::jsonb));
SELECT pg_temp.ok((pg_temp.release((SELECT id FROM m WHERE k='hi')) ->> 'ready')::boolean IS TRUE,
  'RED3 sequence 999 forged PASS shadows a later genuine FAIL');
SELECT pg_temp.ok(to_regclass('wardah_internal.quality_supersessions_202') IS NULL,
  'RED3 no supersession mechanism exists before 202');

DO $$ BEGIN RAISE NOTICE 'M202_RED_REPRODUCED forged_gate_open=1 null_shadow=1 high_seq_shadow=1'; END $$;
ROLLBACK;
