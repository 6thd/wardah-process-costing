#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[[ -z "${DATABASE_URL:-}${PGSERVICE:-}${SUPABASE_DB_URL:-}${PGHOSTADDR:-}" ]] || exit 2
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]+$ && "$PGPORT" -ge 55000 ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_version_num')" == 17* ]] || exit 2
python3 docs/db/material-issue-release/verify_package.py
python3 docs/db/material-issue-parent-version-198/verify_candidate.py
python3 docs/db/material-issue-parent-version-198/test_candidate.py
DB="wardah_issue_parent_198_$$"; MIGRATIONS="$(mktemp -d /tmp/wardah-m198-migrations.XXXXXX)"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"; export PGDATABASE="$DB"
psql -X -v ON_ERROR_STOP=1 -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline)"
field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(field BASELINE_CUTOFF)" == 189 ]] || exit 2
psql -X -v ON_ERROR_STOP=1 -q -f "$(field BASELINE_PATH)" >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$(field REFERENCE_PATH)" >/dev/null
cp sql/migrations/*.sql docs/db/material-issue-release/migrations/*.sql "$MIGRATIONS/"
cp docs/db/material-issue-parent-version-198/candidate.sql "$MIGRATIONS/198_material_issue_parent_version.sql"
python3 scripts/ci/fresh-db/build_apply_order.py "$MIGRATIONS" 189 > /tmp/wardah-m198-order.txt
[[ "$(cut -d_ -f1 /tmp/wardah-m198-order.txt | paste -sd,)" == 190,191,192,193,194,195,196,197,198 ]] || exit 2
REPORT=/tmp/wardah-m198-chain.txt bash scripts/ci/fresh-db/run_chain.sh "$MIGRATIONS" /tmp/wardah-m198-order.txt
psql -X -At -v ON_ERROR_STOP=1 -c "SELECT json_agg(json_build_object('fn',p.oid::regprocedure::text,'src',p.prosrc) ORDER BY p.oid) FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang JOIN pg_namespace n ON n.oid=p.pronamespace WHERE l.lanname='plpgsql' AND n.nspname NOT IN ('pg_catalog','information_schema')" | python3 scripts/ci/check_retryable_raise_sqlstate.py
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql | python3 docs/db/material-issue-parent-version-198/verify_readback.py --expected-owner postgres
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/material-issue-release/seed_after_containment.sql >/dev/null
python3 docs/db/material-issue-parent-version-198/acceptance.py
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql | python3 docs/db/material-issue-parent-version-198/verify_readback.py --expected-owner postgres
printf '%s\n' 'M198_PROPOSED_CHAIN_PASS=9 — disposable only; not allocation, application or release'
