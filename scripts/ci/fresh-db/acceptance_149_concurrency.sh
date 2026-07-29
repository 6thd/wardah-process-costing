#!/usr/bin/env bash
set -Eeuo pipefail

DB=${PGDATABASE:-wardah_fresh}
PSQL=(psql -v ON_ERROR_STOP=1 -X -d "$DB")
ORG=48111111-1111-1111-1111-111111111111
ADMIN=48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
VENDOR=48f00000-0000-0000-0000-000000000001
PRODUCT=48d00000-0000-0000-0000-000000000001
UOM=48400000-0000-0000-0000-000000000002
WAREHOUSE=48a00000-0000-0000-0000-000000000001

# A dedicated 12-base-unit receipt keeps this test independent from quantities
# consumed by the sequential acceptance file.
"${PSQL[@]}" <<SQL
SELECT set_config('request.jwt.claim.sub','$ADMIN',false);
SELECT public.rpc_create_uom_purchase_order(jsonb_build_object(
  'org_id','$ORG','vendor_id','$VENDOR','order_number','U149-PO-RACE',
  'order_date','2026-07-29','lines',jsonb_build_array(jsonb_build_object(
    'product_id','$PRODUCT','uom_id','$UOM','qty_entered',1,
    'unit_price_entered',120,'discount_percentage',0,'tax_percentage',15))));
CREATE TEMP TABLE race_po AS
SELECT po.id po_id,pol.id pol_id
FROM public.purchase_orders po
JOIN public.purchase_order_lines pol ON pol.purchase_order_id=po.id
WHERE po.order_number='U149-PO-RACE';
SELECT public.rpc_approve_purchase_order('$ORG',(SELECT po_id FROM race_po));
SELECT public.rpc_post_goods_receipt(jsonb_build_object(
  'tenant_id','$ORG','vendor_id','$VENDOR','purchase_order_id',(SELECT po_id FROM race_po),
  'warehouse_id','$WAREHOUSE','receipt_date','2026-07-29','idempotency_key','U149-GR-RACE',
  'lines',jsonb_build_array(jsonb_build_object(
    'product_id','$PRODUCT','purchase_order_line_id',(SELECT pol_id FROM race_po),
    'uom_id','$UOM','qty_entered',1,'unit_cost_entered',120,
    'quality_status','accepted'))));
SQL

GRL=$("${PSQL[@]}" -tAc "
  SELECT grl.id
  FROM public.goods_receipts gr
  JOIN public.goods_receipt_lines grl ON grl.goods_receipt_id=gr.id
  WHERE gr.idempotency_key='U149-GR-RACE'")
if [[ -z "$GRL" ]]; then
  echo 'ACCEPTANCE_149_RACE_FAIL: race GRN line not found' >&2
  exit 1
fi

# The first request sleeps only after the RPC has locked the PO/GRN rows and
# reaches its invoice insert. The second request therefore blocks on the real
# row lock rather than merely being scheduled later.
"${PSQL[@]}" <<'SQL'
CREATE OR REPLACE FUNCTION public.wardah_test_delay_ap_race()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_number='U149-RACE-A' THEN
    PERFORM pg_sleep(2);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_wardah_test_delay_ap_race ON public.supplier_invoices;
CREATE TRIGGER trg_wardah_test_delay_ap_race
BEFORE INSERT ON public.supplier_invoices
FOR EACH ROW EXECUTE FUNCTION public.wardah_test_delay_ap_race();
SQL

cat > /tmp/u149-race-a.sql <<SQL
SELECT set_config('request.jwt.claim.sub','$ADMIN',false);
SELECT public.rpc_create_matched_supplier_invoice(jsonb_build_object(
  'org_id','$ORG','vendor_id','$VENDOR','invoice_number','U149-RACE-A',
  'invoice_date','2026-07-29','idempotency_key','u149-race-a',
  'lines',jsonb_build_array(jsonb_build_object(
    'goods_receipt_line_id','$GRL','quantity_base',12,'unit_price',10,
    'discount_percentage',0,'tax_percentage',15))));
SQL
cat > /tmp/u149-race-b.sql <<SQL
SELECT set_config('request.jwt.claim.sub','$ADMIN',false);
SELECT public.rpc_create_matched_supplier_invoice(jsonb_build_object(
  'org_id','$ORG','vendor_id','$VENDOR','invoice_number','U149-RACE-B',
  'invoice_date','2026-07-29','idempotency_key','u149-race-b',
  'lines',jsonb_build_array(jsonb_build_object(
    'goods_receipt_line_id','$GRL','quantity_base',12,'unit_price',10,
    'discount_percentage',0,'tax_percentage',15))));
SQL

start_ms=$(date +%s%3N)
set +e
"${PSQL[@]}" -f /tmp/u149-race-a.sql >/tmp/u149-race-a.out 2>/tmp/u149-race-a.err &
pid_a=$!
sleep 0.25
b_start_ms=$(date +%s%3N)
"${PSQL[@]}" -f /tmp/u149-race-b.sql >/tmp/u149-race-b.out 2>/tmp/u149-race-b.err &
pid_b=$!
wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e
end_ms=$(date +%s%3N)
b_elapsed=$((end_ms-b_start_ms))
total_elapsed=$((end_ms-start_ms))

"${PSQL[@]}" <<'SQL'
DROP TRIGGER IF EXISTS trg_wardah_test_delay_ap_race ON public.supplier_invoices;
DROP FUNCTION IF EXISTS public.wardah_test_delay_ap_race();
SQL

successes=0
[[ $status_a -eq 0 ]] && successes=$((successes+1))
[[ $status_b -eq 0 ]] && successes=$((successes+1))
if [[ $successes -ne 1 ]]; then
  echo "ACCEPTANCE_149_RACE_FAIL: expected one success, got A=$status_a B=$status_b" >&2
  cat /tmp/u149-race-a.err /tmp/u149-race-b.err >&2 || true
  exit 1
fi

if [[ $status_a -ne 0 ]]; then loser_err=/tmp/u149-race-a.err; else loser_err=/tmp/u149-race-b.err; fi
if ! grep -q 'AP_QUANTITY_EXCEEDS_RECEIPT' "$loser_err"; then
  echo 'ACCEPTANCE_149_RACE_FAIL: loser did not fail on the locked remaining balance' >&2
  cat "$loser_err" >&2
  exit 1
fi

# B starts 250ms after A, while A sleeps for 2s after owning the locks. A B
# elapsed time materially below 1.5s would mean it did not wait on that lock.
if [[ $b_elapsed -lt 1500 ]]; then
  echo "ACCEPTANCE_149_RACE_FAIL: second session did not demonstrably wait (${b_elapsed}ms)" >&2
  exit 1
fi

read -r invoice_count allocation_sum journal_count remaining <<<$(${PSQL[@]} -tA -F' ' -c "
  WITH auth AS MATERIALIZED (
    SELECT set_config('request.jwt.claim.sub','$ADMIN',false)
  )
  SELECT
    (SELECT count(*) FROM public.supplier_invoices
      WHERE invoice_number IN ('U149-RACE-A','U149-RACE-B')),
    (SELECT COALESCE(sum(a.quantity_base),0)
       FROM public.supplier_invoice_receipt_allocations a
       JOIN public.supplier_invoices si ON si.id=a.supplier_invoice_id
      WHERE si.invoice_number IN ('U149-RACE-A','U149-RACE-B')),
    (SELECT count(*) FROM public.gl_entries ge
       JOIN public.supplier_invoices si ON si.journal_entry_id=ge.id
      WHERE si.invoice_number IN ('U149-RACE-A','U149-RACE-B')),
    public.wardah_receipt_line_uninvoiced_base('$GRL')
  FROM auth")

if [[ "$invoice_count" != 1 || "$allocation_sum" != 12.000000 || "$journal_count" != 1 || "$remaining" != 0.000000 ]]; then
  echo "ACCEPTANCE_149_RACE_FAIL: persisted state invoices=$invoice_count allocation=$allocation_sum journals=$journal_count remaining=$remaining" >&2
  exit 1
fi

echo "ACCEPTANCE_149_RACE_PASS: one winner; second waited ${b_elapsed}ms; total ${total_elapsed}ms"
