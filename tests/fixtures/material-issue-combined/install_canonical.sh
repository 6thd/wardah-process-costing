#!/usr/bin/env bash
# Install the PR's canonical SQL in the already-created disposable browser DB.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[[ -z "${DATABASE_URL:-}${PGSERVICE:-}${SUPABASE_DB_URL:-}${PGHOSTADDR:-}" ]] || exit 2
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]+$ && "$PGPORT" -ge 55000 ]] || exit 2
[[ "${PGDATABASE:-}" == wardah_issue_parent_198_canonical_browser_* || "${PGDATABASE:-}" == wardah_issue_parent_198_canonical_auth_browser_* ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_version_num')" == 17* ]] || exit 2
[[ "${WARDAH_PARENT_VERSION_198:-}" == true ]] || exit 2
python3 docs/db/material-issue-canonical-195-198/verify_package.py
TASK_DIR="$(mktemp -d /tmp/wardah-client-canonical.XXXXXX)"
trap 'rm -rf "$TASK_DIR"' EXIT
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline 190)"
field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(field BASELINE_CUTOFF)" == 189 ]] || exit 2
psql -X -v ON_ERROR_STOP=1 -q -f "$(field BASELINE_PATH)" >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$(field REFERENCE_PATH)" >/dev/null
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 > "$TASK_DIR/full-order.txt"
awk -F_ '$1 <= 198' "$TASK_DIR/full-order.txt" > "$TASK_DIR/order.txt"
[[ "$(cut -d_ -f1 "$TASK_DIR/order.txt" | paste -sd,)" == 190,191,192,193,194,195,196,197,198 ]] || exit 2
REPORT="$TASK_DIR/chain.txt" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$TASK_DIR/order.txt"
psql -X -v ON_ERROR_STOP=1 -f scripts/ci/fresh-db/acceptance_195_legacy_mo_quarantine.sql
bash scripts/ci/fresh-db/test_195_legacy_mo_quarantine_column_grants.sh
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql | python3 docs/db/material-issue-parent-version-198/verify_readback.py --expected-owner postgres
printf '%s\n' 'MATERIAL_ISSUE_CLIENT_CANONICAL_DB_PASS chain=9 readback=22 quarantine=72 controls=9'
