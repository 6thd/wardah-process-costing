\set ON_ERROR_STOP on
BEGIN;
\ir ../posted-history-193/_fixture.sql
CREATE FUNCTION pg_temp.reconcile_sql(c jsonb,e uuid,o uuid DEFAULT pg_temp.org(),a uuid DEFAULT pg_temp.consumer())
RETURNS text LANGUAGE sql AS $$ SELECT format('SELECT public.rpc_reconcile_material_issue_setup(%L,%L,%L,%L)',o,e,c,a) $$;
CREATE FUNCTION pg_temp.financial_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'mo',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.manufacturing_orders t),
 'wo',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.work_orders t),
 'res',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_reservations t),
 'wip',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stage_wip_log t),
 'mc',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_consumption t),
 'bins',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.bins t),
 'sle',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_ledger_entries t),
 'issue',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_id) FROM wardah_internal.material_issue_events t));
$$;
CREATE FUNCTION pg_temp.reconcile_denied(a uuid,q text,s text,m text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; before_state jsonb:=pg_temp.financial_state(); n bigint; audit_n bigint;
BEGIN
 SELECT count(*) INTO n FROM wardah_internal.material_issue_maintenance_events;
 SELECT count(*) INTO audit_n FROM public.audit_logs;
 r:=pg_temp.try_as(a,q);
 IF (r->>'ok')::boolean OR r->>'sqlstate' IS DISTINCT FROM s OR r->>'error' IS DISTINCT FROM m THEN
  RAISE EXCEPTION 'RECONCILE_EXPECTED_DENIAL: %',r; END IF;
 IF before_state IS DISTINCT FROM pg_temp.financial_state()
 OR n<>(SELECT count(*) FROM wardah_internal.material_issue_maintenance_events)
 OR audit_n<>(SELECT count(*) FROM public.audit_logs) THEN RAISE EXCEPTION 'RECONCILE_DENIAL_HAS_EFFECTS'; END IF;
END $$;
DO $$ DECLARE c jsonb; e uuid:=gen_random_uuid(); r jsonb; saved jsonb; state jsonb; n bigint;
 mo uuid:=(SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo');
BEGIN
 c:=jsonb_build_object('operation','reserve','mo_id',mo,'item_id',pg_temp.raw_item(),
  'uom_id',(SELECT base_uom_id FROM public.products WHERE id=pg_temp.raw()),'quantity',1);
 PERFORM pg_temp.reconcile_denied(pg_temp.consumer(),pg_temp.reconcile_sql(c,e),'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED');
 PERFORM pg_temp.reconcile_denied(pg_temp.admin(),pg_temp.reconcile_sql(c,e,pg_temp.org(),pg_temp.admin()),'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED');
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT 'ed000000-0000-4000-8000-0000000000b1',id
 FROM public.permissions WHERE permission_key IN ('manufacturing.material_reservation.reserve','manufacturing.material_reservation.release','manufacturing.material_issue_setup.prepare') ON CONFLICT DO NOTHING;
 PERFORM pg_temp.reconcile_denied(pg_temp.consumer(),pg_temp.reconcile_sql(c,e,NULL),'P0001','INVALID_ISSUE_SETUP_COMMAND');
 PERFORM pg_temp.reconcile_denied(pg_temp.consumer(),pg_temp.reconcile_sql(c,e,'ffffffff-ffff-4fff-8fff-ffffffffffff'),'P0001','NOT_ORG_MEMBER');
 PERFORM pg_temp.reconcile_denied(pg_temp.consumer(),pg_temp.reconcile_sql(c,e,pg_temp.org(),pg_temp.reader()),'42501','ISSUE_SETUP_IDENTITY_CHANGED');
 state:=pg_temp.financial_state();
 r:=pg_temp.as_user(pg_temp.consumer(),pg_temp.reconcile_sql(c,e));
 IF r->>'state'<>'closed' OR r->'receipt'<>'null'::jsonb OR r->>'actor_id'<>pg_temp.consumer()::text
 OR state IS DISTINCT FROM pg_temp.financial_state() THEN RAISE EXCEPTION 'FENCE_RESULT_OR_EFFECT_INVALID'; END IF;
 SELECT count(*) INTO n FROM public.audit_logs;
 IF pg_temp.as_user(pg_temp.consumer(),pg_temp.reconcile_sql(c,e)) IS DISTINCT FROM r
 OR n<>(SELECT count(*) FROM public.audit_logs) THEN RAISE EXCEPTION 'FENCE_REPLAY_HAS_EFFECTS'; END IF;
 PERFORM pg_temp.reconcile_denied(pg_temp.consumer(),format('SELECT public.rpc_manage_material_issue_setup(%L,%L,%L,%L)',pg_temp.org(),e,c,pg_temp.consumer()),'P0001','ISSUE_SETUP_EVENT_CLOSED');
 PERFORM pg_temp.reconcile_denied(pg_temp.consumer(),pg_temp.reconcile_sql(c||jsonb_build_object('quantity',2),e),'P0001','ISSUE_SETUP_EVENT_PAYLOAD_MISMATCH');
 -- Same org, same explicit grant, different actor must not inspect/close events.
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT 'ed000000-0000-4000-8000-0000000000b2',id
 FROM public.permissions WHERE permission_key='manufacturing.material_reservation.reserve' ON CONFLICT DO NOTHING;
 PERFORM pg_temp.reconcile_denied(pg_temp.reader(),pg_temp.reconcile_sql(c,e,pg_temp.org(),pg_temp.reader()),'P0001','ISSUE_SETUP_EVENT_ACTOR_MISMATCH');
 e:=gen_random_uuid();
 saved:=pg_temp.as_user(pg_temp.consumer(),format('SELECT public.rpc_manage_material_issue_setup(%L,%L,%L,%L)',pg_temp.org(),e,c,pg_temp.consumer()));
 state:=pg_temp.financial_state();
 r:=pg_temp.as_user(pg_temp.consumer(),pg_temp.reconcile_sql(c,e));
 IF r->>'state'<>'applied' OR r->'receipt' IS DISTINCT FROM saved OR state IS DISTINCT FROM pg_temp.financial_state() THEN
  RAISE EXCEPTION 'APPLIED_RECONCILIATION_DIVERGED'; END IF;
 DELETE FROM public.role_permissions rp USING public.permissions p WHERE p.id=rp.permission_id
 AND rp.role_id='ed000000-0000-4000-8000-0000000000b1' AND p.permission_key='manufacturing.material_reservation.reserve';
 PERFORM pg_temp.reconcile_denied(pg_temp.consumer(),pg_temp.reconcile_sql(c,e),'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED');
 PERFORM pg_temp.reconcile_denied(pg_temp.consumer(),pg_temp.reconcile_sql(c,gen_random_uuid()),'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED');
END $$;
SELECT 'RECONCILE_FENCE_RECEIPT_SCOPE_PERMISSION_NO_FINANCIAL_EFFECT_PASS' AS result;
ROLLBACK;
