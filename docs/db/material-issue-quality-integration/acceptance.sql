\set ON_ERROR_STOP on
-- Shared M192/M198/M199 behavior on the canonical disposable chain.
BEGIN;
\ir ../posted-history-193/_fixture.sql

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b1', id FROM public.permissions
WHERE permission_key IN ('manufacturing.material_issue_setup.prepare','manufacturing.material_reservation.reserve')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b2', id FROM public.permissions
WHERE permission_key IN ('manufacturing.quality_inspections.create','manufacturing.quality_inspections.read')
ON CONFLICT DO NOTHING;

CREATE FUNCTION pg_temp.shared_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.manufacturing_orders t),
  'reservations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_reservations t),
  'consumption',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_consumption t),
  'wip',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stage_wip_log t),
  'bins',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.bins t),
  'sle',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_ledger_entries t),
  'gl_entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.gl_entries t),
  'gl_entry_lines',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.gl_entry_lines t),
  'product_stock',(SELECT jsonb_agg(jsonb_build_object('id',id,'stock_quantity',stock_quantity) ORDER BY id) FROM public.products),
  'events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_id) FROM wardah_internal.material_issue_events t),
  'setup_events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_id) FROM wardah_internal.material_issue_maintenance_events t),
  'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.audit_logs t));
$$;
CREATE FUNCTION pg_temp.shared_ok(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'QC_MATERIAL_SHARED_FAIL: %',label; END IF;
 RAISE NOTICE 'QC_MATERIAL_SHARED_OK %',label;
END $$;
CREATE FUNCTION pg_temp.shared_denied(actor uuid, command text, diagnostic text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_state jsonb:=pg_temp.shared_state(); answer jsonb;
BEGIN
 answer:=pg_temp.try_as(actor,command);
 IF (answer->>'ok')::boolean OR answer->>'sqlstate'<>'P0001' OR answer->>'error' IS DISTINCT FROM diagnostic THEN
  RAISE EXCEPTION 'QC_MATERIAL_SHARED_WRONG_DENIAL: expected=% answer=%',diagnostic,answer;
 END IF;
 PERFORM pg_temp.shared_ok(pg_temp.shared_state()=before_state,'denial leaves no effects: '||diagnostic);
END $$;

DO $$
DECLARE
 mo uuid; initial_version bigint; hold_version bigint; return_version bigint;
 event uuid:=gen_random_uuid(); receipt jsonb; replay jsonb; answer jsonb;
 state_before jsonb; reserve_command jsonb; issue_command text;
BEGIN
 SELECT v INTO STRICT mo FROM wardah_internal.issue_scope_test_ids WHERE k='mo';
 SELECT maintenance_version INTO initial_version FROM public.manufacturing_orders WHERE id=mo;
 -- Capture the complete request once: a later reservation must never change it.
 issue_command:=pg_temp.issue_193(mo,event);
 receipt:=pg_temp.as_user(pg_temp.consumer(),issue_command);
 PERFORM pg_temp.shared_ok(receipt->>'event_id'=event::text,'initial material event posted');
 PERFORM pg_temp.shared_ok((SELECT maintenance_version=initial_version FROM public.manufacturing_orders WHERE id=mo),
  'consumption preserves maintenance version');

 answer:=pg_temp.as_user(pg_temp.reader(),format('SELECT public.rpc_set_mo_quality_hold(%L::uuid,''hold'',%s,NULL)',mo,initial_version));
 SELECT maintenance_version INTO hold_version FROM public.manufacturing_orders WHERE id=mo;
 PERFORM pg_temp.shared_ok(hold_version=initial_version+1 AND
  (SELECT status='quality_check' FROM public.manufacturing_orders WHERE id=mo),'QC hold advances parent version');
 PERFORM pg_temp.shared_denied(pg_temp.consumer(),replace(issue_command,event::text,gen_random_uuid()::text),'MANUFACTURING_ORDER_NOT_IN_PROGRESS');
 state_before:=pg_temp.shared_state();
 replay:=pg_temp.as_user(pg_temp.consumer(),issue_command);
 PERFORM pg_temp.shared_ok(replay=receipt AND pg_temp.shared_state()=state_before,'recorded material event replays during QC hold');

 SELECT jsonb_build_object('operation','reserve','mo_id',mo,'item_id',pg_temp.raw_item(),
  'uom_id',base_uom_id,'quantity',2,'expected_version',hold_version)
 INTO reserve_command FROM public.products WHERE id=pg_temp.raw();
 PERFORM pg_temp.shared_denied(pg_temp.consumer(),format(
  'SELECT public.rpc_manage_material_issue_setup(%L::uuid,%L::uuid,%L::jsonb,%L::uuid)',
  pg_temp.org(),gen_random_uuid(),reserve_command,pg_temp.consumer()),'ISSUE_SETUP_MO_NOT_ELIGIBLE');

 answer:=pg_temp.as_user(pg_temp.reader(),format(
  'SELECT public.rpc_set_mo_quality_hold(%L::uuid,''return'',%s,''shared acceptance'')',mo,hold_version));
 SELECT maintenance_version INTO return_version FROM public.manufacturing_orders WHERE id=mo;
 PERFORM pg_temp.shared_ok(return_version=hold_version+1 AND
  (SELECT status='in_progress' FROM public.manufacturing_orders WHERE id=mo),'QC return advances parent version');
 PERFORM pg_temp.shared_denied(pg_temp.consumer(),format(
  'SELECT public.rpc_manage_material_issue_setup(%L::uuid,%L::uuid,%L::jsonb,%L::uuid)',
  pg_temp.org(),gen_random_uuid(),reserve_command,pg_temp.consumer()),'ISSUE_SETUP_STALE_VERSION');
 reserve_command:=reserve_command||jsonb_build_object('expected_version',return_version);
 answer:=pg_temp.as_user(pg_temp.consumer(),format(
  'SELECT public.rpc_manage_material_issue_setup(%L::uuid,%L::uuid,%L::jsonb,%L::uuid)',
  pg_temp.org(),gen_random_uuid(),reserve_command,pg_temp.consumer()));
 PERFORM pg_temp.shared_ok((SELECT maintenance_version=return_version+1 FROM public.manufacturing_orders WHERE id=mo),
  'refreshed M198 reservation advances the parent exactly once');
 state_before:=pg_temp.shared_state();
 replay:=pg_temp.as_user(pg_temp.consumer(),issue_command);
 PERFORM pg_temp.shared_ok(replay=receipt AND pg_temp.shared_state()=state_before,'recorded material event replays after return and reserve');
 answer:=pg_temp.as_user(pg_temp.consumer(),replace(issue_command,event::text,gen_random_uuid()::text));
 PERFORM pg_temp.shared_ok((SELECT count(*)=2 FROM public.material_consumption WHERE mo_id=mo),
  'new material event posts after QC return');
END $$;
SELECT 'QC_MATERIAL_SHARED_ACCEPTANCE_PASS';
ROLLBACK;
