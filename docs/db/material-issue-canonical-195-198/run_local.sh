#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
HARNESS="$(realpath "${1:?Pass the pinned reviewed harness checkout}")"
# Every refusal names its reason; exit 2 stays the fail-closed code.
refuse() { printf 'CANONICAL_RUNNER_REFUSED: %s\n' "$1" >&2; exit 2; }
[[ -z "${DATABASE_URL:-}${PGSERVICE:-}${SUPABASE_DB_URL:-}${PGHOSTADDR:-}" ]] \
  || refuse 'connection URL/service/PGHOSTADDR override is set'
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]+$ && "$PGPORT" -ge 55000 ]] \
  || refuse "endpoint must be PGHOST=127.0.0.1 and PGPORT>=55000 (got ${PGHOST:-unset}:${PGPORT:-unset})"
SERVER_VERSION="$(psql -X -At -d postgres -c 'SHOW server_version_num')"
[[ "$SERVER_VERSION" == 17* ]] || refuse "server must be PostgreSQL 17 (got $SERVER_VERSION)"
python3 docs/db/material-issue-canonical-195-198/verify_package.py --harness "$HARNESS"
(cd "$HARNESS"
 python3 docs/db/material-issue-release/verify_package.py
 python3 docs/db/material-issue-parent-version-198/verify_candidate.py
 python3 docs/db/material-issue-parent-version-198/test_candidate.py)
DB="wardah_issue_parent_198_canonical_$$"
TASK_DIR="$(mktemp -d /tmp/wardah-canonical-195-198.XXXXXX)"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$TASK_DIR"; }
trap cleanup EXIT
createdb "$DB"; export PGDATABASE="$DB"
psql -X -v ON_ERROR_STOP=1 -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
# The reviewed proof is anchored to the cutoff-189 pair and stops at M198. A
# later Baseline or migration must not change what this proves (the
# posted-history-193 runner cuts its order the same way); the newest pair is
# not selected, and any migration after 198 is outside this canonical proof.
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline 190)"
field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(field BASELINE_CUTOFF)" == 189 ]] \
  || refuse "anchored baseline cutoff must be 189 (got $(field BASELINE_CUTOFF))"
psql -X -v ON_ERROR_STOP=1 -q -f "$(field BASELINE_PATH)" >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$(field REFERENCE_PATH)" >/dev/null
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 > "$TASK_DIR/full-order.txt"
awk -F_ '$1 <= 198' "$TASK_DIR/full-order.txt" > "$TASK_DIR/order.txt"
APPLY_ORDER="$(cut -d_ -f1 "$TASK_DIR/order.txt" | paste -sd,)"
[[ "$APPLY_ORDER" == 190,191,192,193,194,195,196,197,198 ]] \
  || refuse "apply order after cutoff 189 must be 190..198 (got $APPLY_ORDER)"
REPORT="$TASK_DIR/chain.txt" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$TASK_DIR/order.txt"
psql -X -v ON_ERROR_STOP=1 -f scripts/ci/fresh-db/acceptance_195_legacy_mo_quarantine.sql
(cd "$HARNESS" && python3 scripts/ci/test_check_retryable_raise_sqlstate.py)
psql -X -At -v ON_ERROR_STOP=1 -c "SELECT json_agg(json_build_object('fn',p.oid::regprocedure::text,'src',p.prosrc) ORDER BY p.oid) FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang JOIN pg_namespace n ON n.oid=p.pronamespace WHERE l.lanname='plpgsql' AND n.nspname NOT IN ('pg_catalog','information_schema')" | (cd "$HARNESS" && python3 scripts/ci/check_retryable_raise_sqlstate.py)
psql -X -qAt -v ON_ERROR_STOP=1 -f "$HARNESS/docs/db/material-issue-release/catalog_readback.sql" | (cd "$HARNESS" && python3 docs/db/material-issue-parent-version-198/verify_readback.py --expected-owner postgres)
psql -X -v ON_ERROR_STOP=1 -q -f "$HARNESS/docs/db/manufacturing-inventory-red-20260925/00_fixture.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$HARNESS/docs/db/material-issue-release/seed_after_containment.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -f "$HARNESS/docs/db/material-issue-229/acceptance.sql"
python3 docs/db/material-issue-canonical-195-198/prepare_reconciliation.py \
  --harness "$HARNESS" --output "$TASK_DIR/reconciliation_m198.sql"
psql -X -v ON_ERROR_STOP=1 -f "$TASK_DIR/reconciliation_m198.sql"
(cd "$HARNESS" && python3 docs/db/material-issue-parent-version-198/acceptance.py)
psql -X -qAt -v ON_ERROR_STOP=1 -f "$HARNESS/docs/db/material-issue-release/catalog_readback.sql" | (cd "$HARNESS" && python3 docs/db/material-issue-parent-version-198/verify_readback.py --expected-owner postgres)
printf '%s\n' 'CANONICAL_MATERIAL_ISSUE_PG17_PASS chain=9 readback=22 release_ready=false'
