source "$SCRATCH/lib.sh"
org='00002294-f2f2-0000-0000-000000000001'
admin='00002294-f2f2-0000-0000-000000000002'
P1='00002294-0000-0000-0000-0000000000a1'
P2='00002294-0000-0000-0000-0000000000a2'
W='00002294-0000-0000-0000-0000000000a9'
purge_org_documents "$org"
"${PSQL[@]}" <<SQL
DELETE FROM public.stock_adjustment_items WHERE organization_id='$org';
DELETE FROM public.stock_adjustments WHERE organization_id='$org';
DELETE FROM public.stock_ledger_entries WHERE org_id='$org';
DELETE FROM public.bins WHERE org_id='$org';
DELETE FROM public.products WHERE org_id='$org';
DELETE FROM public.warehouses WHERE org_id='$org';
DELETE FROM public.user_organizations WHERE org_id='$org';
DELETE FROM public.organizations WHERE id='$org';
DELETE FROM auth.users WHERE id='$admin';
INSERT INTO public.organizations (id,name,code) VALUES ('$org','M191 S12 FixCD','M191-S12-CD');
INSERT INTO auth.users (id,email) VALUES ('$admin','m191-s12-cd@wardah-e2e.invalid');
INSERT INTO public.user_organizations (user_id,org_id,is_active,role,is_org_admin)
VALUES ('$admin','$org',true,'admin',true);
INSERT INTO public.products (id,org_id,code,name,is_stockable,base_uom_id,cost_price)
SELECT p.id,'$org',p.code,p.name,true,u.id,10 FROM (VALUES
 ('$P1'::uuid,'S12-CD-P1','FixCD P1'),('$P2'::uuid,'S12-CD-P2','FixCD P2')) AS p(id,code,name)
CROSS JOIN LATERAL (SELECT id FROM public.uoms WHERE org_id IS NULL AND is_active AND NOT is_product_specific LIMIT 1) u;
INSERT INTO public.warehouses (id,org_id,code,name) VALUES ('$W','$org','S12-WH-CD','FixCD WH');
DELETE FROM public.gl_accounts WHERE org_id='$org';
INSERT INTO public.gl_accounts (id,org_id,code,name,category,subtype,normal_balance,allow_posting,is_active) VALUES
 ('00002294-0000-0000-0000-0000000000f1','$org','1300','Inventory','ASSET','INVENTORY','DEBIT',true,true),
 ('00002294-0000-0000-0000-0000000000f2','$org','4900','Inventory Gain','REVENUE','OTHER_INCOME','CREDIT',true,true),
 ('00002294-0000-0000-0000-0000000000f3','$org','5900','Inventory Loss','EXPENSE','OTHER_EXPENSE','DEBIT',true,true);
INSERT INTO public.bins (id,org_id,product_id,warehouse_id,actual_qty,reserved_qty,valuation_rate,stock_value,stock_queue)
VALUES ('00002294-0000-0000-0000-0000000000b1','$org','$P1','$W',100,0,10,1000,'[{"qty":100,"rate":10}]'::jsonb),
       ('00002294-0000-0000-0000-0000000000b2','$org','$P2','$W',100,0,10,1000,'[{"qty":100,"rate":10}]'::jsonb);
SQL

# Build a DRAFT multi-product adjustment. $1=adj_id $2=number $3..=products
make_adj() {
  local adj=$1 num=$2; shift 2
  "${PSQL[@]}" <<SQL
DELETE FROM public.stock_adjustment_items WHERE adjustment_id='$adj';
DELETE FROM public.stock_adjustments WHERE id='$adj';
INSERT INTO public.stock_adjustments
 (id,organization_id,org_id,adjustment_number,adjustment_date,posting_date,adjustment_type,reason,warehouse_id,status,total_items,created_by)
VALUES ('$adj','$org','$org','$num',CURRENT_DATE,CURRENT_DATE,'PHYSICAL_COUNT','S12 Fix C/D control','$W','DRAFT',0,'$admin');
UPDATE public.stock_adjustments SET inventory_account_id='00002294-0000-0000-0000-0000000000f1',
  increase_account_id='00002294-0000-0000-0000-0000000000f2',
  decrease_account_id='00002294-0000-0000-0000-0000000000f3' WHERE id='$adj';
SQL
  for p in "$@"; do
    "${PSQL[@]}" <<SQL
INSERT INTO public.stock_adjustment_items
 (adjustment_id,organization_id,product_id,warehouse_id,current_qty,new_qty,difference_qty,current_rate,new_rate,value_difference)
VALUES ('$adj','$org','$p','$W',100,105,5,10,10,50);
SQL
  done
  "${PSQL[@]}" -c "UPDATE public.stock_adjustments SET total_items=(SELECT count(*) FROM public.stock_adjustment_items WHERE adjustment_id='$adj') WHERE id='$adj';"
}

as_admin() { # run sql as the admin identity
  "${PSQL[@]}" <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','$admin',true);
$1
COMMIT;
SQL
}
