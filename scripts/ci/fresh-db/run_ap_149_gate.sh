#!/usr/bin/env bash
set -Eeuo pipefail

DB=${PGDATABASE:-wardah_ap149}
BASELINE_DIR=${BASELINE_DIR:-sql/baseline}

pair=$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh "$BASELINE_DIR")
pair_field() { printf '%s\n' "$pair" | sed -n "s/^$1=//p"; }
BASELINE=$(pair_field BASELINE_PATH)
REFERENCE=$(pair_field REFERENCE_PATH)
CUTOFF=$(pair_field BASELINE_CUTOFF)
CUTOFF=${CUTOFF:-0}

if [[ -z "$BASELINE" || -z "$REFERENCE" ]]; then
  echo 'AP_149_GATE_FAIL: baseline pair could not be resolved' >&2
  exit 1
fi

echo "AP 149 gate: baseline=$BASELINE reference=$REFERENCE cutoff=$CUTOFF"
dropdb --if-exists "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -X -d "$DB" -f scripts/ci/fresh-db/supabase_shim.sql -q
psql -v ON_ERROR_STOP=1 -X -d "$DB" -f "$BASELINE" -q
psql -v ON_ERROR_STOP=1 -X -d "$DB" -f "$REFERENCE" -q

python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations "$CUTOFF" > /tmp/ap149-chain-order.txt
if [[ -s /tmp/ap149-chain-order.txt ]]; then
  REPORT=/tmp/ap149-chain-report.txt PGDATABASE="$DB" \
    bash scripts/ci/fresh-db/run_chain.sh sql/migrations /tmp/ap149-chain-order.txt
  cat /tmp/ap149-chain-report.txt
fi

for fn in \
  'rpc_create_matched_supplier_invoice(jsonb)' \
  'rpc_create_matched_supplier_invoice_v149(jsonb)' \
  'wardah_receipt_line_uninvoiced_base(uuid)'
do
  if ! psql -X -d "$DB" -tAc "SELECT to_regprocedure('public.$fn') IS NOT NULL" | grep -qx t; then
    echo "AP_149_GATE_FAIL: missing function public.$fn" >&2
    exit 1
  fi
done

# The 149 suite deliberately reuses the full legal PO/GRN path from 148 rather
# than manufacturing receipt rows by hand.
psql -v ON_ERROR_STOP=1 -X -d "$DB" \
  -f scripts/ci/fresh-db/acceptance_148_uom_partial_receipts.sql
psql -v ON_ERROR_STOP=1 -X -d "$DB" \
  -f scripts/ci/fresh-db/acceptance_149_ap_three_way_match.sql
# Explicit closure evidence for every remaining acceptance item in issue #46.
psql -v ON_ERROR_STOP=1 -X -d "$DB" \
  -f scripts/ci/fresh-db/acceptance_149_issue_46_closure.sql
PGDATABASE="$DB" bash scripts/ci/fresh-db/acceptance_149_concurrency.sh

# Final invariants are independent of specific fixture identifiers.
psql -v ON_ERROR_STOP=1 -X -d "$DB" <<'SQL'
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.supplier_invoices si
  LEFT JOIN public.gl_entries ge ON ge.id=si.journal_entry_id
  WHERE si.match_status='matched'
    AND (si.status<>'approved' OR si.journal_entry_id IS NULL OR ge.status<>'posted');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AP_149_GATE_FAIL: % matched invoices lack approved+posted final state',v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT a.goods_receipt_line_id,
           sum(CASE WHEN a.reversal_of_allocation_id IS NULL
                    THEN a.quantity_base ELSE -a.quantity_base END) allocated,
           max(CASE WHEN grl.quality_status='accepted'
                    THEN grl.received_quantity ELSE 0 END) accepted
    FROM public.supplier_invoice_receipt_allocations a
    JOIN public.goods_receipt_lines grl ON grl.id=a.goods_receipt_line_id
    GROUP BY a.goods_receipt_line_id
    HAVING sum(CASE WHEN a.reversal_of_allocation_id IS NULL
                    THEN a.quantity_base ELSE -a.quantity_base END)
           > max(CASE WHEN grl.quality_status='accepted'
                      THEN grl.received_quantity ELSE 0 END)
  ) q;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AP_149_GATE_FAIL: % receipt lines are overallocated',v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gl_entries ge
  WHERE ge.reference_type='supplier_invoice'
    AND (round(ge.total_debit,2)<>round(ge.total_credit,2) OR ge.status<>'posted');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AP_149_GATE_FAIL: % AP journals are unbalanced or unposted',v_count;
  END IF;
END $$;
SELECT 'AP_149_FRESH_DB_GATE_PASS' AS result;
SQL
