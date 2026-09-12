# shellcheck shell=bash
source "$SCRATCH/lib.sh"
org='00002296-f2f2-0000-0000-000000000001'
adm='00002296-f2f2-0000-0000-000000000002'   # org admin + consume permission
X='00002296-0000-0000-0000-00000000000a'     # X < Y
Y='00002296-0000-0000-0000-00000000000b'
FG='00002296-0000-0000-0000-00000000000f'
I1='00002296-0000-0000-0000-000000000101'
I2='00002296-0000-0000-0000-000000000102'
W='00002296-0000-0000-0000-0000000000c9'
VEND='00002296-0000-0000-0000-0000000000d1'
ROLE='00002296-0000-0000-0000-000000000301'
STAGE='00002296-0000-0000-0000-000000000401'
WC='00002296-0000-0000-0000-000000000501'

reset_fixture() {
# Reap leftover harness backends from a previous failed scenario: an
# idle-in-transaction holder would silently block the DELETEs below forever.
"${PSQL[@]}" -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
  WHERE datname=current_database() AND pid<>pg_backend_pid()
    AND application_name NOT IN ('psql','');" >/dev/null
"${PSQL[@]}" <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
DELETE FROM public.stock_adjustment_items WHERE organization_id='$org';
DELETE FROM public.stock_adjustments WHERE organization_id='$org';
DELETE FROM public.material_consumption WHERE org_id='$org';
DELETE FROM public.material_reservations WHERE org_id='$org';
DELETE FROM public.stage_wip_log WHERE org_id='$org';
DELETE FROM public.manufacturing_stages WHERE org_id='$org';
DELETE FROM public.work_orders WHERE org_id='$org';
DELETE FROM public.work_center_load WHERE work_center_id IN (SELECT id FROM public.work_centers WHERE org_id='$org');
DELETE FROM public.work_centers WHERE org_id='$org';
DELETE FROM public.manufacturing_orders WHERE org_id='$org';
DELETE FROM public.delivery_note_lines WHERE delivery_note_id IN (SELECT id FROM public.delivery_notes WHERE org_id='$org');
DELETE FROM public.delivery_notes WHERE org_id='$org';
DELETE FROM public.goods_receipt_lines WHERE goods_receipt_id IN (SELECT id FROM public.goods_receipts WHERE org_id='$org');
DELETE FROM public.goods_receipts WHERE org_id='$org';
DELETE FROM public.stock_ledger_entries WHERE org_id='$org';
DELETE FROM public.bins WHERE org_id='$org';
DELETE FROM public.item_product_map WHERE org_id='$org';
DELETE FROM public.user_roles WHERE org_id='$org';
DELETE FROM public.role_permissions WHERE role_id='$ROLE';
DELETE FROM public.roles WHERE org_id='$org';
DELETE FROM public.gl_event_mappings WHERE org_id='$org';
DELETE FROM public.gl_accounts WHERE org_id='$org';
DELETE FROM public.vendors WHERE org_id='$org';
DELETE FROM public.items WHERE org_id='$org';
DELETE FROM public.products WHERE org_id='$org';
DELETE FROM public.warehouses WHERE org_id='$org';
DELETE FROM public.user_organizations WHERE org_id='$org';
DELETE FROM public.organizations WHERE id='$org';
DELETE FROM public.audit_logs WHERE user_id='$adm' OR org_id='$org';
DELETE FROM auth.users WHERE id='$adm';
INSERT INTO public.organizations (id,name,code) VALUES ('$org','M191 S12 Reserve','M191-S12-R');
INSERT INTO auth.users (id,email) VALUES ('$adm','m191-s12-r@wardah-e2e.invalid');
INSERT INTO public.user_organizations (user_id,org_id,is_active,role,is_org_admin) VALUES ('$adm','$org',true,'admin',true);
INSERT INTO public.roles (id,org_id,name,name_ar,is_active) VALUES ('$ROLE','$org','S12 Consume','S12 استهلاك',true);
INSERT INTO public.role_permissions (role_id,permission_id)
SELECT '$ROLE',p.id FROM public.permissions p WHERE p.permission_key='manufacturing.material_consumption.consume';
INSERT INTO public.user_roles (user_id,role_id,org_id,expires_at) VALUES ('$adm','$ROLE','$org',NULL);
INSERT INTO public.products (id,org_id,code,name,is_stockable,base_uom_id,cost_price)
SELECT p.id,'$org',p.code,p.name,true,u.id,10 FROM (VALUES
 ('$X'::uuid,'S12-R-X','Reserve X'),('$Y'::uuid,'S12-R-Y','Reserve Y'),
 ('$FG'::uuid,'S12-R-FG','Reserve FG')) AS p(id,code,name)
CROSS JOIN LATERAL (SELECT id FROM public.uoms WHERE org_id IS NULL AND is_active AND NOT is_product_specific LIMIT 1) u;
INSERT INTO public.items (id,org_id,code,name) VALUES ('$I1','$org','S12-I1','Item 1'),('$I2','$org','S12-I2','Item 2');
INSERT INTO public.item_product_map (org_id,item_id,product_id,mapping_source,is_active,valid_from)
VALUES ('$org','$I1','$X','MANUAL',true,now()-interval '1 day'),
       ('$org','$I2','$Y','MANUAL',true,now()-interval '1 day');
INSERT INTO public.warehouses (id,org_id,code,name) VALUES ('$W','$org','S12-WH-R','Reserve WH');
INSERT INTO public.manufacturing_stages (id,org_id,code,name,order_sequence)
VALUES ('$STAGE','$org','S12-ST1','Stage 1',1);
INSERT INTO public.work_centers (id,org_id,code,name) VALUES ('$WC','$org','S12-WC','S12 Work Center');
INSERT INTO public.bins (id,org_id,product_id,warehouse_id,actual_qty,reserved_qty,valuation_rate,stock_value,stock_queue) VALUES
 ('00002296-0000-0000-0000-0000000000e1','$org','$X','$W',100,0,10,1000,'[{"qty":100,"rate":10}]'::jsonb),
 ('00002296-0000-0000-0000-0000000000e2','$org','$Y','$W',100,0,10,1000,'[{"qty":100,"rate":10}]'::jsonb);
-- Seed the product projection consistently with the seeded bins. Without this
-- the fixture starts life violating products.stock_quantity = SUM(bins), so any
-- scenario that legitimately does not touch stock would fail reconciliation on a
-- defect the fixture itself introduced at t0.
UPDATE public.products p SET stock_quantity=b.q, stock_value=b.v
FROM (SELECT product_id, SUM(actual_qty) q, SUM(stock_value) v FROM public.bins WHERE org_id='$org' GROUP BY product_id) b
WHERE p.id=b.product_id;
INSERT INTO public.vendors (id,org_id,code,name) VALUES ('$VEND','$org','S12-VR','Reserve Vendor');
INSERT INTO public.gl_accounts (id,org_id,code,name,category,subtype,normal_balance,allow_posting,is_active) VALUES
 ('00002296-0000-0000-0000-000000000091','$org','1300','Inventory','ASSET','INVENTORY','DEBIT',true,true),
 ('00002296-0000-0000-0000-000000000092','$org','2150','GRNI','LIABILITY','PAYABLE','CREDIT',true,true),
 ('00002296-0000-0000-0000-000000000093','$org','5100','COGS','EXPENSE','COGS','DEBIT',true,true);
INSERT INTO public.gl_event_mappings (org_id,event_code,debit_account_code,credit_account_code,is_active) VALUES
 ('$org','GR_RECEIPT','1300','2150',true),('$org','COGS_DELIVERY','5100','1300',true);
COMMIT;
SQL
}
as_user() {
  "${PSQL[@]}" <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
$1
COMMIT;
SQL
}
mk_wip() { # $1 mo_id -> ensure a stage_wip_log row exists for the stage
  "${PSQL[@]}" -c "INSERT INTO public.stage_wip_log (org_id,mo_id,stage_id,period_start,period_end)
    SELECT '$org','$1','$STAGE',date_trunc('month',CURRENT_DATE)::date,(date_trunc('month',CURRENT_DATE)+interval '1 month -1 day')::date
    WHERE NOT EXISTS (SELECT 1 FROM public.stage_wip_log WHERE mo_id='$1' AND stage_id='$STAGE');" >/dev/null
  # work_orders carries a load-maintenance trigger calling wardah_assert_org_member,
  # so insert under the explicit admin identity rather than bypassing the trigger.
  "${PSQL[@]}" <<WOSQL >/dev/null
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
INSERT INTO public.work_orders (org_id,mo_id,work_center_id,work_order_number,operation_sequence,operation_name,planned_quantity,status)
SELECT '$org','$1','$WC','S12-WO-'||left('$1',8),1,'S12 Operation',1,'READY'
WHERE NOT EXISTS (SELECT 1 FROM public.work_orders WHERE mo_id='$1');
COMMIT;
WOSQL
}
mo_payload() { # $1 order_number  $2 materials-jsonb
  echo "SELECT public.rpc_create_mo_with_reservation(
    jsonb_build_object('org_id','$org','order_number','$1','product_id','$FG','quantity',1),
    $2, NULL);"
}
