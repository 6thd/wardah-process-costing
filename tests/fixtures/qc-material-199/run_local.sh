#!/usr/bin/env bash
# Evidence only; install this checkout's SQL and mount a frozen client checkout.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$ROOT/tests/fixtures/qc-material-199"
[[ $# == 1 ]] || { echo 'USAGE: run_local.sh CLEAN_PINNED_CLIENT' >&2; exit 2; }
export WARDAH_QC_CLIENT="$(cd "$1" && pwd)"
cd "$ROOT"
[[ -z "${DATABASE_URL:-}${SUPABASE_DB_URL:-}${PGSERVICE:-}${PGHOSTADDR:-}" ]] || exit 2
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]+$ && "$PGPORT" -ge 55000 && "$PGPORT" -le 65535 ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_version_num')" == 17* ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_encoding')" == UTF8 ]] || exit 2
python3 "$HERE/verify_inputs.py" "$WARDAH_QC_CLIENT"
DB="wardah_issue_parent_198_canonical_qc199_browser_$$"; TASK_DIR="$(mktemp -d)"
BRIDGE_PID=''; VITE_PID=''
cleanup() {
 for pid in "$BRIDGE_PID" "$VITE_PID"; do [[ -z "$pid" ]] || kill "$pid" 2>/dev/null || true; done
 for pid in "$BRIDGE_PID" "$VITE_PID"; do [[ -z "$pid" ]] || wait "$pid" 2>/dev/null || true; done
 dropdb --if-exists "$DB" >/dev/null 2>&1 || true
 rm -rf "$TASK_DIR"
}
trap cleanup EXIT
createdb "$DB"; export PGDATABASE="$DB"
psql -X -v ON_ERROR_STOP=1 -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline 190)"
field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(field BASELINE_CUTOFF)" == 189 ]] || exit 2
psql -X -v ON_ERROR_STOP=1 -q -f "$(field BASELINE_PATH)" >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$(field REFERENCE_PATH)" >/dev/null
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 | awk -F_ '$1<=199' > "$TASK_DIR/order.txt"
[[ "$(cut -d_ -f1 "$TASK_DIR/order.txt" | paste -sd,)" == 190,191,192,193,194,195,196,197,198,199 ]] || exit 2
REPORT="$TASK_DIR/chain.txt" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$TASK_DIR/order.txt"
readback() {
 psql -X -qAt -v ON_ERROR_STOP=1 -f "$WARDAH_QC_CLIENT/docs/db/material-issue-release/catalog_readback.sql" | python3 "$HERE/verify_catalog.py" "$WARDAH_QC_CLIENT"
}
readback
psql -X -v ON_ERROR_STOP=1 -f scripts/ci/fresh-db/acceptance_195_legacy_mo_quarantine.sql
bash scripts/ci/fresh-db/test_195_legacy_mo_quarantine_column_grants.sh
psql -X -q -v ON_ERROR_STOP=1 -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -f "$WARDAH_QC_CLIENT/docs/db/material-issue-release/seed_after_containment.sql" >/dev/null
python3 "$HERE/seed.py"
python3 "$HERE/races.py"
python3 "$HERE/bridge.py" > "${WARDAH_QC_OUTPUT:-$TASK_DIR}/bridge.txt" 2>&1 & BRIDGE_PID=$!
node node_modules/vite/bin/vite.js --config "$HERE/vite.config.ts" > "${WARDAH_QC_OUTPUT:-$TASK_DIR}/vite.txt" 2>&1 & VITE_PID=$!
ready=false
for ((attempt=0;attempt<120;attempt++)); do
 if curl --fail --silent http://127.0.0.1:4177/ >/dev/null && curl --fail --silent http://127.0.0.1:4178/state >/dev/null; then ready=true; break; fi
 kill -0 "$BRIDGE_PID"; kill -0 "$VITE_PID"; sleep 0.25
done
[[ "$ready" == true ]] || { echo 'LOCAL_BROWSER_NOT_READY'; exit 1; }
# Optional external visual verification command runs in this same network namespace.
if [[ -n "${WARDAH_QC_VISUAL_CHECK:-}" ]]; then bash "$WARDAH_QC_VISUAL_CHECK"; fi
timeout --kill-after=5 180 node "$HERE/verify.mjs"
readback
python3 "$HERE/verify_inputs.py" "$WARDAH_QC_CLIENT"
printf '%s\n' 'QC_MATERIAL_NATIVE_199_PASS chain=10 readback=22 identity=simulated release_ready=false'
