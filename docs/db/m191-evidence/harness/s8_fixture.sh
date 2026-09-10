# shellcheck shell=bash
source "$SCRATCH/lib.sh"
org='00002295-f2f2-0000-0000-000000000001'
usr='00002295-f2f2-0000-0000-000000000002'
A='00002295-0000-0000-0000-00000000000a'   # A < B
B='00002295-0000-0000-0000-00000000000b'
W='00002295-0000-0000-0000-0000000000c9'
VEND='00002295-0000-0000-0000-0000000000d1'
CUST='00002295-0000-0000-0000-0000000000d2'
INV='00002295-0000-0000-0000-0000000000d3'
ILA='00002295-0000-0000-0000-0000000000e1'
ILB='00002295-0000-0000-0000-0000000000e2'

purge_org_documents "$org"
"${PSQL[@]}" <<SQL
DELETE FROM public.sales_invoice_lines WHERE org_id='$org';
DELETE FROM public.sales_invoices WHERE org_id='$org';
DELETE FROM public.customers WHERE org_id='$org';
DELETE FROM public.vendors WHERE org_id='$org';
DELETE FROM public.stock_ledger_entries WHERE org_id='$org';
DELETE FROM public.bins WHERE org_id='$org';
DELETE FROM public.products WHERE org_id='$org';
DELETE FROM public.warehouses WHERE org_id='$org';
DELETE FROM public.user_organizations WHERE org_id='$org';
DELETE FROM public.organizations WHERE id='$org';
DELETE FROM auth.users WHERE id='$usr';
INSERT INTO public.organizations (id,name,code) VALUES ('$org','M191 S12 FixE','M191-S12-E');
INSERT INTO auth.users (id,email) VALUES ('$usr','m191-s12-e@wardah-e2e.invalid');
INSERT INTO public.user_organizations (user_id,org_id,is_active,role,is_org_admin) VALUES ('$usr','$org',true,'admin',true);
INSERT INTO public.products (id,org_id,code,name,is_stockable,base_uom_id,cost_price)
SELECT p.id,'$org',p.code,p.name,true,u.id,10 FROM (VALUES
 ('$A'::uuid,'S12-E-A','FixE A'),('$B'::uuid,'S12-E-B','FixE B')) AS p(id,code,name)
CROSS JOIN LATERAL (SELECT id FROM public.uoms WHERE org_id IS NULL AND is_active AND NOT is_product_specific LIMIT 1) u;
INSERT INTO public.warehouses (id,org_id,code,name) VALUES ('$W','$org','S12-WH-E','FixE WH');
INSERT INTO public.bins (id,org_id,product_id,warehouse_id,actual_qty,reserved_qty,valuation_rate,stock_value,stock_queue) VALUES
 ('00002295-0000-0000-0000-0000000000f1','$org','$A','$W',100,0,10,1000,'[{"qty":100,"rate":10}]'::jsonb),
 ('00002295-0000-0000-0000-0000000000f2','$org','$B','$W',100,0,10,1000,'[{"qty":100,"rate":10}]'::jsonb);
DELETE FROM public.gl_event_mappings WHERE org_id='$org';
DELETE FROM public.gl_accounts WHERE org_id='$org';
INSERT INTO public.gl_accounts (id,org_id,code,name,category,subtype,normal_balance,allow_posting,is_active) VALUES
 ('00002295-0000-0000-0000-000000000091'::uuid,'$org','1300','Inventory','ASSET','INVENTORY','DEBIT',true,true),
 ('00002295-0000-0000-0000-000000000092'::uuid,'$org','2150','GRNI','LIABILITY','PAYABLE','CREDIT',true,true),
 ('00002295-0000-0000-0000-000000000093'::uuid,'$org','5100','COGS','EXPENSE','COGS','DEBIT',true,true);
INSERT INTO public.gl_event_mappings (org_id,event_code,debit_account_code,credit_account_code,is_active) VALUES
 ('$org','GR_RECEIPT','1300','2150',true),
 ('$org','COGS_DELIVERY','5100','1300',true);
INSERT INTO public.vendors (id,org_id,code,name) VALUES ('$VEND','$org','S12-V1','FixE Vendor');
INSERT INTO public.customers (id,org_id,code,name) VALUES ('$CUST','$org','S12-C1','FixE Customer');
INSERT INTO public.sales_invoices (id,org_id,invoice_number,customer_id,subtotal,total_amount)
VALUES ('$INV','$org','S12-E-INV-1','$CUST',1000,1000);
INSERT INTO public.sales_invoice_lines (id,org_id,invoice_id,product_id,quantity,unit_price,line_number) VALUES
 ('$ILA','$org','$INV','$A',50,20,1),('$ILB','$org','$INV','$B',50,20,2);
SQL

GR_LINES_AB="jsonb_build_array(
  jsonb_build_object('product_id','$A','qty_entered',5,'unit_cost',10),
  jsonb_build_object('product_id','$B','qty_entered',5,'unit_cost',10))"
DN_LINES_BA="jsonb_build_array(
  jsonb_build_object('sales_invoice_line_id','$ILB','qty_entered',3),
  jsonb_build_object('sales_invoice_line_id','$ILA','qty_entered',3))"

pairE() { # $1 scenario $2 call1 $3 call2
  local sc=$1 c1=$2 c2=$3
  local r="$tmp/$sc"; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
  PGAPPNAME="$sc-1" "${PSQL[@]}" >"$r-1.out" 2>"$r-1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$usr',true);
SELECT set_config('request.jwt.claims','{"sub":"$usr","role":"authenticated"}',true);
$c1
\! touch $r-1.ready
\! bash -c 'while [ ! -f "$r-1.release" ]; do sleep 0.05; done'
COMMIT;
SQL
  E1PID=$!
  wait_for_file "$r-1.ready" || fail "$sc: backend 1 never completed: $(tr -d '\n' < "$r-1.err")"
  PGAPPNAME="$sc-2" "${PSQL[@]}" >"$r-2.out" 2>"$r-2.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$usr',true);
SELECT set_config('request.jwt.claims','{"sub":"$usr","role":"authenticated"}',true);
$c2
COMMIT;
SQL
  E2PID=$!
  local w; w=$(wait_for_lock_waiters 1 "'$sc-2'") || fail "$sc: backend 2 never blocked (waiters=$w) - HARNESS_FAIL"
  echo "  EVIDENCE[$sc] $(blocking_evidence "$sc-2")"
  touch "$r-1.release"
  ST1=0; ST2=0; wait "$E1PID" || ST1=$?; wait "$E2PID" || ST2=$?
  grep -qi 'deadlock detected\|40P01' "$r-1.err" "$r-2.err" && fail "$sc: 40P01 deadlock"
  ERR1=$(tr -d '\n' < "$r-1.err"); ERR2=$(tr -d '\n' < "$r-2.err")
  echo "  STATUS[$sc] b1=$ST1 b2=$ST2 ${ERR1:+err1=$ERR1} ${ERR2:+err2=$ERR2}"
}

