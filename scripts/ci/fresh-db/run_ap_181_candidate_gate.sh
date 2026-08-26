#!/usr/bin/env bash
set -Eeuo pipefail

DB=${PGDATABASE:-wardah_ap181}
BASELINE_DIR=${BASELINE_DIR:-sql/baseline}

pair=$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh "$BASELINE_DIR")
pair_field() { printf '%s\n' "$pair" | sed -n "s/^$1=//p"; }
BASELINE=$(pair_field BASELINE_PATH)
REFERENCE=$(pair_field REFERENCE_PATH)
CUTOFF=$(pair_field BASELINE_CUTOFF)
CUTOFF=${CUTOFF:-0}

if [[ -z "$BASELINE" || -z "$REFERENCE" ]]; then
  echo 'AP_181_GATE_FAIL: baseline pair could not be resolved' >&2
  exit 1
fi

echo "AP 181 gate: baseline=$BASELINE reference=$REFERENCE cutoff=$CUTOFF"
dropdb --if-exists "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -X -d "$DB" -f scripts/ci/fresh-db/supabase_shim.sql -q
psql -v ON_ERROR_STOP=1 -X -d "$DB" -f "$BASELINE" -q
psql -v ON_ERROR_STOP=1 -X -d "$DB" -f "$REFERENCE" -q

python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations "$CUTOFF" > /tmp/ap181-chain-order.txt
if [[ -s /tmp/ap181-chain-order.txt ]]; then
  REPORT=/tmp/ap181-chain-report.txt PGDATABASE="$DB" \
    bash scripts/ci/fresh-db/run_chain.sh sql/migrations /tmp/ap181-chain-order.txt
  cat /tmp/ap181-chain-report.txt
fi

if ! psql -X -d "$DB" -tAc \
  "SELECT to_regprocedure('public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)') IS NOT NULL" \
  | grep -qx t; then
  echo 'AP_181_GATE_FAIL: missing candidate read RPC' >&2
  exit 1
fi

# Reuse the legal purchase-order / accepted-GRN fixtures and the matched-invoice
# allocation contract rather than manufacturing parallel state by hand.
psql -v ON_ERROR_STOP=1 -X -d "$DB" \
  -f scripts/ci/fresh-db/acceptance_148_uom_partial_receipts.sql
psql -v ON_ERROR_STOP=1 -X -d "$DB" \
  -f scripts/ci/fresh-db/acceptance_149_ap_three_way_match.sql

# The 181 suite reads the exact persisted 148/149 facts, including the 10.5-unit
# allocation created by the 149 happy path, and proves the remaining 37.5 units.
psql -v ON_ERROR_STOP=1 -X -d "$DB" \
  -f scripts/ci/fresh-db/acceptance_181_supplier_invoice_candidates.sql

# Existing AP closure and concurrency suites remain mandatory regression proof.
psql -v ON_ERROR_STOP=1 -X -d "$DB" \
  -f scripts/ci/fresh-db/acceptance_149_issue_46_closure.sql
PGDATABASE="$DB" bash scripts/ci/fresh-db/acceptance_149_concurrency.sh

psql -v ON_ERROR_STOP=1 -X -d "$DB" <<'SQL'
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)'::regprocedure
  ) INTO v_def;

  IF v_def NOT LIKE '%SECURITY DEFINER%'
     OR v_def NOT LIKE '%SET search_path TO ''public'', ''pg_temp''%'
     OR v_def NOT LIKE '%purchasing.purchase_orders.read%'
     OR v_def NOT LIKE '%purchasing.purchase_invoices.read%' THEN
    RAISE EXCEPTION 'AP_181_GATE_FAIL: final function definition drift';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AP_181_GATE_FAIL: final execute surface drift';
  END IF;
END $$;
SELECT 'AP_181_FRESH_DB_GATE_PASS' AS result;
SQL
