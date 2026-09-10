# Shared harness helpers for the M191 Slice 12 runtime battery.
set -Eeuo pipefail
: "${PGDATABASE:?}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
tmp=/var/tmp/pg17/rt
mkdir -p "$tmp"

fail() { echo "SLICE12_FAIL[$CURRENT_SCENARIO]: $1" >&2; exit 1; }
num_eq() { awk -v a="$1" -v b="$2" 'BEGIN { exit (a == b) ? 0 : 1 }'; }

wait_for_file() {
  local f=$1 tries=${2:-400}
  for _ in $(seq 1 "$tries"); do [[ -f "$f" ]] && return 0; sleep 0.05; done
  return 1
}

# Wait until exactly $1 backends in application_name list $2 are Lock-waiting.
wait_for_lock_waiters() {
  local expected=$1 names=$2 tries=${3:-400} waiting=0
  for _ in $(seq 1 "$tries"); do
    waiting=$("${PSQL[@]}" <<SQL
SELECT count(*) FROM pg_stat_activity
WHERE application_name IN ($names) AND state='active' AND wait_event_type='Lock';
SQL
)
    [[ "$waiting" == "$expected" ]] && { printf '%s' "$waiting"; return 0; }
    sleep 0.05
  done
  printf '%s' "$waiting"; return 1
}

# Record what a waiter is blocked on + who blocks it (real backend evidence).
blocking_evidence() {
  local name=$1
  "${PSQL[@]}" <<SQL
SELECT coalesce(string_agg(
  'waiter='||a.application_name||' pid='||a.pid||
  ' wait='||a.wait_event_type||':'||a.wait_event||
  ' blocked_by='||coalesce(array_to_string(pg_blocking_pids(a.pid),','),'none')||
  ' rel='||coalesce((SELECT string_agg(DISTINCT c.relname,',')
                     FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
                     WHERE l.pid=a.pid AND NOT l.granted),'-')
  , ' ; '), 'NO_WAITER')
FROM pg_stat_activity a
WHERE a.application_name = '$name' AND a.state='active' AND a.wait_event_type='Lock';
SQL
}

# §12 mandatory reconciliation for one (product) scope.
reconcile_product() {
  local scenario=$1 org=$2 product=$3
  local row
  row=$("${PSQL[@]}" <<SQL
WITH b AS (
  SELECT warehouse_id, actual_qty, stock_value, valuation_rate, stock_queue
  FROM public.bins WHERE org_id='$org' AND product_id='$product'
), s AS (
  SELECT warehouse_id, SUM(actual_qty) q, SUM(stock_value_difference) v, COUNT(*) n
  FROM public.stock_ledger_entries WHERE org_id='$org' AND product_id='$product'
  GROUP BY warehouse_id
)
SELECT
  (SELECT coalesce(string_agg(
     'wh='||b.warehouse_id::text||
     ' bin_qty='||b.actual_qty::text||
     ' bin_val='||b.stock_value::text||
     ' bin_rate='||coalesce(b.valuation_rate::text,'-')||
     ' queue='||coalesce(b.stock_queue::text,'-')||
     ' sle_qty='||coalesce(s.q::text,'0')||
     ' sle_val='||coalesce(s.v::text,'0')||
     ' sle_rows='||coalesce(s.n::text,'0'), E'\n    ' ORDER BY b.warehouse_id))
   FROM b LEFT JOIN s ON s.warehouse_id=b.warehouse_id)
  ||E'\n    product_stock_quantity='||coalesce((SELECT stock_quantity::text FROM public.products WHERE id='$product'),'-')
  ||' product_cost_price='||coalesce((SELECT cost_price::text FROM public.products WHERE id='$product'),'-')
  ||' sum_bins='||coalesce((SELECT SUM(actual_qty)::text FROM b),'0')
  ||' negatives='||(SELECT count(*) FROM b WHERE actual_qty < 0)::text
SQL
)
  echo "  RECON[$scenario] $row"
  # Global pass rules
  local pq sb neg
  pq=$("${PSQL[@]}" -c "SELECT coalesce(stock_quantity,0) FROM public.products WHERE id='$product'")
  sb=$("${PSQL[@]}" -c "SELECT coalesce(SUM(actual_qty),0) FROM public.bins WHERE org_id='$org' AND product_id='$product'")
  neg=$("${PSQL[@]}" -c "SELECT count(*) FROM public.bins WHERE org_id='$org' AND product_id='$product' AND actual_qty<0")
  num_eq "$pq" "$sb" || fail "$scenario: products.stock_quantity ($pq) <> SUM(bins.actual_qty) ($sb)"
  [[ "$neg" == "0" ]] || fail "$scenario: unexpected negative stock in $neg bin(s)"
}

# Granted relation-level locks held by a backend (proves what it already owns).
held_relations() {
  "${PSQL[@]}" <<SQL
SELECT coalesce(string_agg(DISTINCT c.relname||':'||l.mode, ',' ORDER BY c.relname||':'||l.mode),'none')
FROM pg_locks l
JOIN pg_class c ON c.oid = l.relation
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE a.application_name = '$1' AND l.granted
  AND c.relname IN ('products','bins','material_reservations','stock_ledger_entries');
SQL
}
