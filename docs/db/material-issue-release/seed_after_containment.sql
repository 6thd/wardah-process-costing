\set ON_ERROR_STOP on
-- Owner-only test data AFTER containment. Never grant a quarantined client RPC.
BEGIN;
INSERT INTO public.organizations(id,name,code) VALUES
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','Issue scope foreign organization','ISSUE-SCOPE-FOREIGN');
CREATE TABLE wardah_internal.issue_scope_test_ids(k text PRIMARY KEY,v uuid);
REVOKE ALL ON wardah_internal.issue_scope_test_ids FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE number text; created jsonb; mo uuid; org uuid:='ed000000-0000-4000-8000-000000000001';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'OWNER_ONLY_DISPOSABLE_SEED'; END IF;
 PERFORM set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-0000000000a1',true);
 PERFORM set_config('request.jwt.claims','{"sub":"ed000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
 FOREACH number IN ARRAY ARRAY['ISSUE-SCOPE-1','ISSUE-SCOPE-2'] LOOP
  created:=public.rpc_create_mo_with_reservation(
   jsonb_build_object('org_id',org,'order_number',number,'product_id','ed000000-0000-4000-8000-0000000000c2','quantity',5),
   jsonb_build_array(jsonb_build_object('item_id','ed000000-0000-4000-8000-0000000000d1','quantity',100)),org);
  IF NOT COALESCE((created->>'success')::boolean,false) THEN RAISE EXCEPTION 'OWNER_SEED_CREATION_FAILED'; END IF;
  mo:=(created->>'mo_id')::uuid;
  PERFORM public.rpc_transition_mo_status(mo,'confirmed',NULL,org);
  PERFORM public.rpc_transition_mo_status(mo,'in_progress',NULL,org);
  INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end)
  VALUES(org,mo,'ed000000-0000-4000-8000-0000000000f1',date_trunc('month',CURRENT_DATE)::date,
   (date_trunc('month',CURRENT_DATE)+interval '1 month -1 day')::date);
  INSERT INTO public.work_orders(org_id,mo_id,work_center_id,work_order_number,operation_sequence,operation_name,planned_quantity,status)
  VALUES(org,mo,'ed000000-0000-4000-8000-0000000000f2',number||'-WO1',1,'RED op',5,'IN_PROGRESS');
  INSERT INTO wardah_internal.issue_scope_test_ids VALUES(CASE number WHEN 'ISSUE-SCOPE-1' THEN 'mo' ELSE 'mo2' END,mo);
 END LOOP;
END $$;
COMMIT;
