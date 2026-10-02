#!/usr/bin/env bash
# Combined behavior, not hosted identity or release authorization.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[[ -z "${DATABASE_URL:-}${PGSERVICE:-}${SUPABASE_DB_URL:-}${PGHOSTADDR:-}" ]] || exit 2
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]+$ && "$PGPORT" -ge 55000 ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_version_num')" == 17* ]] || exit 2
python3 docs/db/material-issue-canonical-195-198/verify_package.py
TASK_DIR="$(mktemp -d /tmp/wardah-qc-material.XXXXXX)"
DB="wardah_issue_parent_198_canonical_qc_$$"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$TASK_DIR"; }
trap cleanup EXIT
createdb "$DB"; export PGDATABASE="$DB"
psql -X -q -v ON_ERROR_STOP=1 -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline 190)"
field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(field BASELINE_CUTOFF)" == 189 ]] || exit 2
psql -X -q -v ON_ERROR_STOP=1 -f "$(field BASELINE_PATH)" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -f "$(field REFERENCE_PATH)" >/dev/null
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 | awk -F_ '$1<=199' > "$TASK_DIR/order.txt"
[[ "$(cut -d_ -f1 "$TASK_DIR/order.txt" | paste -sd,)" == 190,191,192,193,194,195,196,197,198,199 ]] || exit 2
REPORT="$TASK_DIR/chain.txt" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$TASK_DIR/order.txt"
readback() {
 psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql |
  python3 docs/db/material-issue-quality-integration/verify_readback.py
}
readback
psql -X -q -v ON_ERROR_STOP=1 -f scripts/ci/fresh-db/acceptance_195_legacy_mo_quarantine.sql
bash scripts/ci/fresh-db/test_195_legacy_mo_quarantine_column_grants.sh
psql -X -q -v ON_ERROR_STOP=1 -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/seed_after_containment.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f docs/db/material-issue-quality-integration/acceptance.sql
python3 docs/db/material-issue-quality-integration/test_replay_determinism.py
readback
echo 'QC_MATERIAL_SHARED_PG17_PASS chain=10 readback=22'
