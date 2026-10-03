#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[[ -z "${DATABASE_URL:-}${PGSERVICE:-}${SUPABASE_DB_URL:-}${PGHOSTADDR:-}" ]] || exit 2
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]+$ && "$PGPORT" -ge 55000 ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_version_num')" == 17* ]] || exit 2
python3 docs/db/material-issue-release/verify_package.py
DB="wardah_issue_maintenance_proposed_$$"
MIGRATION_DIR="$(mktemp -d /tmp/wardah-issue-proposed-migrations.XXXXXX)"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"; export PGDATABASE="$DB"
psql -X -v ON_ERROR_STOP=1 -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline)"
field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(field BASELINE_CUTOFF)" == 189 ]] || exit 2
psql -X -v ON_ERROR_STOP=1 -q -f "$(field BASELINE_PATH)" >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$(field REFERENCE_PATH)" >/dev/null
cp sql/migrations/*.sql "$MIGRATION_DIR/"
cp docs/db/material-issue-release/migrations/*.sql "$MIGRATION_DIR/"
python3 scripts/ci/fresh-db/build_apply_order.py "$MIGRATION_DIR" 189 > /tmp/wardah-proposed-migrations-order.txt
[[ "$(wc -l < /tmp/wardah-proposed-migrations-order.txt)" == 8 ]] || exit 2
[[ "$(cut -d_ -f1 /tmp/wardah-proposed-migrations-order.txt | paste -sd,)" == 190,191,192,193,194,195,196,197 ]] || exit 2
REPORT=/tmp/wardah-proposed-migrations-chain.txt bash scripts/ci/fresh-db/run_chain.sh "$MIGRATION_DIR" /tmp/wardah-proposed-migrations-order.txt
# Effective installed bodies only: M196's 40001 raises are replaced by M197.
python3 scripts/ci/test_check_retryable_raise_sqlstate.py
psql -X -At -v ON_ERROR_STOP=1 -c "SELECT json_agg(json_build_object('fn',p.oid::regprocedure::text,'src',p.prosrc) ORDER BY p.oid)
 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE l.lanname='plpgsql' AND n.nspname NOT IN ('pg_catalog','information_schema')" \
 | python3 scripts/ci/check_retryable_raise_sqlstate.py
# Export only catalog data; no business RPC runs in this read-only transaction.
python3 docs/db/material-issue-release/test_readback.py
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql \
 | python3 docs/db/material-issue-release/verify_catalog_readback.py --expected-owner postgres
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql \
 | python3 docs/db/material-issue-release/test_readback.py --installed
# Migration installation precedes any fixture, as in both browser runners.
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/material-issue-release/seed_after_containment.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f docs/db/material-issue-229/acceptance.sql
# Preserve all frozen assertions; only their intentional stale SQLSTATE changes.
CHECK_DIR="$(mktemp -d /tmp/wardah-issue-compat-checks.XXXXXX)"
mkdir -p "$CHECK_DIR/material-issue-maintenance-170-154" "$CHECK_DIR/posted-history-193" "$CHECK_DIR/manufacturing-inventory-red-20260925"
cp docs/db/posted-history-193/_fixture.sql "$CHECK_DIR/posted-history-193/"
cp docs/db/manufacturing-inventory-red-20260925/_helpers.sql "$CHECK_DIR/manufacturing-inventory-red-20260925/"
python3 docs/db/material-issue-release/compatibility_checks.py acceptance > "$CHECK_DIR/material-issue-maintenance-170-154/acceptance.sql"
psql -X -v ON_ERROR_STOP=1 -f "$CHECK_DIR/material-issue-maintenance-170-154/acceptance.sql"
psql -X -v ON_ERROR_STOP=1 -f docs/db/material-issue-maintenance-170-154/reconciliation_acceptance.sql
python3 docs/db/material-issue-release/compatibility_checks.py races > "$CHECK_DIR/material-issue-maintenance-170-154/races.py"
python3 "$CHECK_DIR/material-issue-maintenance-170-154/races.py"
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/reconciliation_readback.sql \
 | python3 docs/db/material-issue-release/probe_reconciliation_readback.py
printf '%s\n' 'MATERIAL_ISSUE_PROPOSED_CANONICAL_CHAIN_PASS=8 — disposable only; not allocation/sign-off/application'
