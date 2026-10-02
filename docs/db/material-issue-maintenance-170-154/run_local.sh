#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
if [[ -n "${DATABASE_URL:-}${PGSERVICE:-}${SUPABASE_DB_URL:-}" ]]; then
 echo 'REFUSED_REMOTE_CONNECTION_CONFIGURATION' >&2; exit 2
fi
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]+$ && "$PGPORT" -ge 55000 ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_version_num')" == 17* ]] || exit 2
DB="wardah_issue_maintenance_$$"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"
export PGDATABASE="$DB"
HERE=docs/db/material-issue-maintenance-170-154
echo "LOCAL_DISPOSABLE_DB=$DB HEAD=$(git rev-parse HEAD)"
psql -X -v ON_ERROR_STOP=1 -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline)"
field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(field BASELINE_CUTOFF)" == 189 ]] || exit 2
psql -X -v ON_ERROR_STOP=1 -q -f "$(field BASELINE_PATH)" > /tmp/wardah-maintenance-baseline.log 2>&1
psql -X -v ON_ERROR_STOP=1 -q -f "$(field REFERENCE_PATH)" >/dev/null
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 > /tmp/wardah-maintenance-order.txt
[[ "$(wc -l < /tmp/wardah-maintenance-order.txt)" == 5 ]] || exit 2
bash scripts/ci/fresh-db/run_chain.sh sql/migrations /tmp/wardah-maintenance-order.txt
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/material-issue-229/seed.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/material-issue-229/195_material_issue_scope_candidate.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$HERE/candidate.sql"
psql -X -v ON_ERROR_STOP=1 -f docs/db/material-issue-229/acceptance.sql
psql -X -v ON_ERROR_STOP=1 -f "$HERE/acceptance.sql"
psql -X -v ON_ERROR_STOP=1 -f "$HERE/reconciliation_acceptance.sql"
python3 "$HERE/races.py"
echo 'MATERIAL_ISSUE_MAINTENANCE_LOCAL_PASS'
