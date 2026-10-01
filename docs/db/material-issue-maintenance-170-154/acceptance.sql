\set ON_ERROR_STOP on
BEGIN;
\ir ../posted-history-193/_fixture.sql
CREATE FUNCTION pg_temp.maintenance_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'mo',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.manufacturing_orders t),
 'wo',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.work_orders t),
 'res',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_reservations t),
 'wip',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stage_wip_log t),
 'mc',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_consumption t),
 'bins',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.bins t),
 'sle',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_ledger_entries t),
 'receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_id) FROM wardah_internal.material_issue_events t),
 'maintenance',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_id) FROM wardah_internal.material_issue_maintenance_events t),
 'audit',(SELECT count(*) FROM public.audit_logs));
$$;
CREATE FUNCTION pg_temp.command_sql(p_command jsonb,p_event uuid DEFAULT gen_random_uuid(),p_org uuid DEFAULT pg_temp.org())
RETURNS text LANGUAGE sql AS $$ SELECT format('SELECT public.rpc_manage_material_issue_setup(%L::uuid,%L::uuid,%L::jsonb,%L::uuid)',p_org,p_event,p_command,pg_temp.consumer()) $$;
CREATE FUNCTION pg_temp.maintenance_denied(p_actor uuid,p_command jsonb,p_state text,p_message text,
 p_event uuid DEFAULT gen_random_uuid(),p_org uuid DEFAULT pg_temp.org())
RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_state jsonb:=pg_temp.maintenance_state(); r jsonb;
BEGIN
 r:=pg_temp.try_as(p_actor,pg_temp.command_sql(p_command,p_event,p_org));
 IF (r->>'ok')::boolean OR r->>'sqlstate' IS DISTINCT FROM p_state OR r->>'error' IS DISTINCT FROM p_message THEN
  RAISE EXCEPTION 'MAINTENANCE_EXPECTED_PRECISE_DENIAL: %',r; END IF;
 IF pg_temp.maintenance_state() IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'MAINTENANCE_DENIAL_HAS_EFFECTS'; END IF;
END $$;
DO $$
DECLARE command jsonb; result jsonb; saved jsonb; state jsonb; entity jsonb; mo uuid; wo uuid; res uuid;
 event uuid:=gen_random_uuid(); version bigint; template record; new_role uuid; key text;
BEGIN
 command:=jsonb_build_object('operation','create_order','order',jsonb_build_object('product_id',pg_temp.fg(),'quantity',5),
  'materials',jsonb_build_array(jsonb_build_object('item_id',pg_temp.raw_item(),'quantity',100)));
 PERFORM pg_temp.maintenance_denied(pg_temp.reader(),command,'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED');
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),command,'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED');
 PERFORM pg_temp.maintenance_denied(pg_temp.admin(),command,'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED');
 IF EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
  WHERE p.permission_key IN ('manufacturing.material_reservation.reserve','manufacturing.material_reservation.release','manufacturing.material_issue_setup.prepare'))
 THEN RAISE EXCEPTION 'AUTOMATIC_MAINTENANCE_GRANTS'; END IF;
 -- Every existing role template must remain unable to grant these new keys.
 FOR template IN SELECT id FROM public.role_templates LOOP
  new_role:=(pg_temp.as_user(pg_temp.admin(),format('SELECT to_jsonb(public.create_role_from_template(%L::uuid,%L::uuid,%L,NULL))',
   pg_temp.org(),template.id,'Maintenance-template-'||template.id::text))#>>'{}')::uuid;
  IF EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
   WHERE rp.role_id=new_role AND p.permission_key IN ('manufacturing.material_reservation.reserve','manufacturing.material_reservation.release','manufacturing.material_issue_setup.prepare'))
  THEN RAISE EXCEPTION 'TEMPLATE_SILENTLY_GRANTED_MAINTENANCE'; END IF;
 END LOOP;
 INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT 'ed000000-0000-4000-8000-0000000000b1',id FROM public.permissions WHERE permission_key IN
 ('manufacturing.material_reservation.reserve','manufacturing.material_reservation.release','manufacturing.material_issue_setup.prepare',
 'manufacturing.orders.create','manufacturing.orders.update','manufacturing.stage_costs.create') ON CONFLICT DO NOTHING;
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),command,'P0001','INVALID_ISSUE_SETUP_COMMAND',gen_random_uuid(),NULL);
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),command,'P0001','NOT_ORG_MEMBER',gen_random_uuid(),'ffffffff-ffff-4fff-8fff-ffffffffffff');
 saved:=pg_temp.try_as(pg_temp.consumer(),format('SELECT public.rpc_manage_material_issue_setup(%L,%L,%L,%L)',
  pg_temp.org(),gen_random_uuid(),command,pg_temp.reader()));
 IF saved->>'sqlstate'<>'42501' OR saved->>'error'<>'ISSUE_SETUP_IDENTITY_CHANGED' THEN RAISE EXCEPTION 'ACTOR_SUBSTITUTION_ALLOWED'; END IF;
 saved:=pg_temp.try_as(pg_temp.reader(),format('SELECT public.rpc_get_material_reservation_setup(%L,%L)',pg_temp.org(),pg_temp.raw_item()));
 IF saved->>'sqlstate'<>'42501' OR saved->>'error'<>'ISSUE_MAINTENANCE_PERMISSION_DENIED' THEN RAISE EXCEPTION 'READ_PERMISSION_DENIAL_FAILED'; END IF;
 saved:=pg_temp.as_user(pg_temp.consumer(),format('SELECT public.rpc_get_material_reservation_setup(%L,%L)',pg_temp.org(),pg_temp.raw_item()));
 IF saved->>'product_id'<>pg_temp.raw()::text OR saved->>'uom_id'<>(SELECT base_uom_id::text FROM public.products WHERE id=pg_temp.raw()) THEN
  RAISE EXCEPTION 'RESERVATION_OPTIONS_BASE_UOM_INVALID'; END IF;
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_build_object('operation','reserve',
  'mo_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','item_id',pg_temp.raw_item(),'quantity',1),'P0001','ISSUE_SETUP_MO_SCOPE_INVALID');
 -- Ordinary explicit-role actor can prepare; no Admin-only substitute.
 result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(command,event));
 mo:=(result->'entity'->>'id')::uuid; entity:=result->'entity';
 IF entity->>'status'<>'draft' OR (entity->>'auto_backflush')::boolean OR entity->>'created_by'<>pg_temp.consumer()::text THEN
  RAISE EXCEPTION 'UNSAFE_INITIAL_ORDER'; END IF;
 state:=pg_temp.maintenance_state();
 saved:=pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(command,event));
 IF saved IS DISTINCT FROM result OR pg_temp.maintenance_state() IS DISTINCT FROM state THEN RAISE EXCEPTION 'CREATE_RETRY_DUPLICATED_EFFECT'; END IF;
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),command||jsonb_build_object('materials','[]'::jsonb),
  'P0001','ISSUE_SETUP_EVENT_PAYLOAD_MISMATCH',event);
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_set(command,'{order,status}','"done"'),
  'P0001','INVALID_ISSUE_SETUP_ORDER');
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_set(command,'{materials,0,quantity}','0.0000001'),
  'P0001','INVALID_BASE_QUANTITY');
 FOR key IN SELECT unnest(ARRAY['confirmed','in_progress']) LOOP
  result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(jsonb_build_object('operation','set_order_status',
   'mo_id',mo,'status',key,'expected_version',entity->'maintenance_version'))); entity:=result->'entity';
 END LOOP;
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_build_object('operation','set_order_status','mo_id',mo,
  'status','done','expected_version',entity->'maintenance_version'),'P0001','ISSUE_SETUP_TERMINAL_TRANSITION_FORBIDDEN');
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_build_object('operation','create_work_order','mo_id',mo,
  'work_center_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','name','foreign','quantity',5),'P0001','ISSUE_SETUP_WORK_CENTER_SCOPE_INVALID');
 result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(jsonb_build_object('operation','create_work_order',
  'mo_id',mo,'work_center_id',pg_temp.wc(),'name','Manual issue eligibility','quantity',5)));
 wo:=(result->'entity'->>'id')::uuid;
 result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(jsonb_build_object('operation','set_work_order_status',
  'mo_id',mo,'work_order_id',wo,'status','IN_PROGRESS','expected_version',result->'entity'->'maintenance_version')));
 IF (SELECT status FROM public.manufacturing_orders WHERE id=mo)<>'in_progress' THEN RAISE EXCEPTION 'WO_MUTATED_PARENT'; END IF;
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_build_object('operation','set_work_order_status','mo_id',mo,
  'work_order_id',wo,'status','COMPLETED','expected_version',result->'entity'->'maintenance_version'),
  'P0001','ISSUE_SETUP_WO_TRANSITION_FORBIDDEN');
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_build_object('operation','set_work_order_status','mo_id',mo,
  'work_order_id',wo,'status','READY','expected_version',1),'40001','ISSUE_SETUP_STALE_VERSION');
 -- Guarded editor opens a pristine current-period row, no cost input.
 PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(jsonb_build_object('operation','open_stage_wip',
  'mo_id',mo,'stage_id',pg_temp.stage(),'period_start',CURRENT_DATE,'period_end',CURRENT_DATE)));
 result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(jsonb_build_object('operation','reserve','mo_id',mo,
  'item_id',pg_temp.raw_item(),'uom_id',(SELECT base_uom_id FROM public.products WHERE id=pg_temp.raw()),'quantity',20)));
 res:=(result->'entity'->>'id')::uuid; version:=(result->'entity'->>'maintenance_version')::bigint;
 result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(jsonb_build_object('operation','resize_reservation','mo_id',mo,
  'reservation_id',res,'quantity',25,'expected_version',version)));
 version:=(result->'entity'->>'maintenance_version')::bigint;
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_build_object('operation','resize_reservation','mo_id',mo,
  'reservation_id',res,'quantity',30,'expected_version',1),'40001','ISSUE_SETUP_STALE_VERSION');
 saved:=pg_temp.as_user(pg_temp.consumer(),format('SELECT public.rpc_consume_material_event(%L,%L,%L,jsonb_build_array(jsonb_build_object(''item_id'',%L,''reservation_id'',%L,''warehouse_id'',%L,''work_order_id'',%L,''uom_id'',%L,''quantity'',10,''consumption_type'',''MANUAL'')))',
  mo,pg_temp.stage(),gen_random_uuid(),pg_temp.raw_item(),res,pg_temp.w1(),wo,(SELECT base_uom_id FROM public.products WHERE id=pg_temp.raw())));
 IF (saved->>'material_cost_posted')::numeric<>100 THEN RAISE EXCEPTION 'M192_INTEGRATION_COST_FAILED'; END IF;
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_build_object('operation','release_reservation','mo_id',mo,
  'reservation_id',res,'quantity',15,'expected_version',version),'40001','ISSUE_SETUP_STALE_VERSION');
 SELECT maintenance_version INTO version FROM public.material_reservations WHERE id=res;
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),jsonb_build_object('operation','resize_reservation','mo_id',mo,
  'reservation_id',res,'quantity',30,'expected_version',version),'P0001','ISSUE_SETUP_HISTORICAL_RESERVATION_IMMUTABLE');
 command:=jsonb_build_object('operation','release_reservation','mo_id',mo,'reservation_id',res,'quantity',15,'expected_version',version);
 event:=gen_random_uuid(); result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(command,event));
 IF result->'entity'->>'status'<>'released' OR (result->'entity'->>'quantity_consumed')::numeric<>10
 OR (result->'entity'->>'quantity_released')::numeric<>15 THEN RAISE EXCEPTION 'RELEASE_LOST_HISTORY'; END IF;
 state:=pg_temp.maintenance_state();
 IF pg_temp.as_user(pg_temp.consumer(),pg_temp.command_sql(command,event)) IS DISTINCT FROM result
 OR pg_temp.maintenance_state() IS DISTINCT FROM state THEN RAISE EXCEPTION 'RELEASE_RETRY_HAS_EFFECTS'; END IF;
 IF (SELECT cost_material FROM public.stage_wip_log WHERE mo_id=mo)<>100
 OR (SELECT count(*) FROM public.material_consumption WHERE mo_id=mo)<>1 THEN RAISE EXCEPTION 'HISTORY_DIVERGED'; END IF;
 -- Revocation denies even a stored receipt; no role/template/Admin shortcut.
 DELETE FROM public.role_permissions rp USING public.permissions p WHERE p.id=rp.permission_id
  AND rp.role_id='ed000000-0000-4000-8000-0000000000b1' AND p.permission_key='manufacturing.material_reservation.release';
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),command,'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED',event);
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT 'ed000000-0000-4000-8000-0000000000b1',id
  FROM public.permissions WHERE permission_key='manufacturing.material_reservation.release';
 PERFORM pg_temp.as_user(pg_temp.admin(),format('SELECT public.rpc_replace_user_roles(jsonb_build_object(''org_id'',%L,''user_id'',%L,''role_ids'',jsonb_build_array(jsonb_build_object(''role_id'',''ed000000-0000-4000-8000-0000000000b1'',''expires_at'',(clock_timestamp()-interval ''1 second'')::text))))',pg_temp.org(),pg_temp.consumer()));
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),command,'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED',event);
 PERFORM pg_temp.as_user(pg_temp.admin(),format('SELECT public.rpc_replace_user_roles(jsonb_build_object(''org_id'',%L,''user_id'',%L,''role_ids'',jsonb_build_array(jsonb_build_object(''role_id'',''ed000000-0000-4000-8000-0000000000b1'',''expires_at'',NULL))))',pg_temp.org(),pg_temp.consumer()));
 UPDATE public.roles SET is_active=false WHERE id='ed000000-0000-4000-8000-0000000000b1';
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),command,'42501','ISSUE_MAINTENANCE_PERMISSION_DENIED',event);
 UPDATE public.roles SET is_active=true WHERE id='ed000000-0000-4000-8000-0000000000b1';
 UPDATE public.user_organizations SET is_active=false WHERE user_id=pg_temp.consumer();
 PERFORM pg_temp.maintenance_denied(pg_temp.consumer(),command,'P0001','NOT_ORG_MEMBER',event);
END $$;
SELECT 'MAINTENANCE_PERMISSIONS_RETRY_VERSIONS_M192_HISTORY_PASS' AS result;
ROLLBACK;
