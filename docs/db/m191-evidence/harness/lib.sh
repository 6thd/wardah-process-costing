# shellcheck shell=bash
# Shared harness helpers for the M191 Slice 12 runtime battery.
set -Eeuo pipefail
: "${PGDATABASE:?}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
# Scratch dir for rendezvous files. Overridable so the harness is not tied to
# one machine's layout; CI runners have no /var/tmp/pg17.
tmp=${HARNESS_TMP_DIR:-${TMPDIR:-/tmp}/m191-harness}
mkdir -p "$tmp"


# Unique per invocation. Several RPCs derive a deterministic GL idempotency key
# from the document identity (e.g. 'stock-adjustment:'||adjustment_id), and
# posted GL entries are immutable by contract (POSTED_ENTRY_IMMUTABLE), so a
# fixture may never purge them to re-run. Fresh identities per run are the only
# correct way to keep these scenarios repeatable.
RUN_NONCE=${RUN_NONCE:-$(date +%s)$RANDOM}

new_uuid() { "${PSQL[@]}" -c "SELECT gen_random_uuid()"; }

# Delete only NON-ledger documents belonging to a fixture org. gl_entries and
# gl_entry_lines are deliberately never touched: they are legal ledger history.
purge_org_documents() {
  "${PSQL[@]}" <<SQL
DELETE FROM public.delivery_note_lines WHERE delivery_note_id IN
  (SELECT id FROM public.delivery_notes WHERE org_id='$1');
DELETE FROM public.delivery_notes WHERE org_id='$1';
DELETE FROM public.goods_receipt_lines WHERE goods_receipt_id IN
  (SELECT id FROM public.goods_receipts WHERE org_id='$1');
DELETE FROM public.goods_receipts WHERE org_id='$1';
SQL
}

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

# Application names of the backends that are currently blocking $1, read from
# pg_blocking_pids. This is observed lock state, not a timing inference: a
# non-empty answer means the waiter is genuinely stuck behind those backends.
blockers_of() {
  "${PSQL[@]}" <<SQL
SELECT coalesce(string_agg(DISTINCT b.application_name, ',' ORDER BY b.application_name), '')
FROM pg_stat_activity a
CROSS JOIN LATERAL unnest(pg_blocking_pids(a.pid)) AS bp(pid)
JOIN pg_stat_activity b ON b.pid = bp.pid
WHERE a.application_name = '$1';
SQL
}

# Wait until $1 is blocked by at least one backend and echo their application
# names. Deliberately does NOT take an expectation: the caller records which
# row the function reached for FIRST, so a reversed acquisition order is
# observed and reported rather than merely timing out.
wait_for_any_blocker() {
  local waiter=$1 tries=${2:-400} seen=''
  for _ in $(seq 1 "$tries"); do
    seen=$(blockers_of "$waiter")
    [[ -n "$seen" ]] && { printf '%s' "$seen"; return 0; }
    sleep 0.05
  done
  printf '%s' "$seen"; return 1
}

# Wait until $1's observed blocker set is exactly $2 (comma-joined app names).
wait_for_blockers() {
  local waiter=$1 expected=$2 tries=${3:-400} seen=''
  for _ in $(seq 1 "$tries"); do
    seen=$(blockers_of "$waiter")
    [[ "$seen" == "$expected" ]] && { printf '%s' "$seen"; return 0; }
    sleep 0.05
  done
  printf '%s' "$seen"; return 1
}
