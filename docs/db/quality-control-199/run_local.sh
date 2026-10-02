#!/usr/bin/env bash
# Disposable PostgreSQL 17 only: RED through M198, then M199 GREEN.
#   PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=... \
#     bash docs/db/quality-control-199/run_local.sh
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
if [[ -n "${DATABASE_URL:-}" || -n "${PGSERVICE:-}" || -n "${SUPABASE_DB_URL:-}" || -n "${PGHOSTADDR:-}" ]]; then
  echo 'REFUSED: remote connection configuration present' >&2; exit 2
fi
case "${PGHOST:-}" in ''|localhost|127.0.0.1|/*) ;; *) echo 'REFUSED: nonlocal PGHOST' >&2; exit 2;; esac
if [[ "$(psql -X -tAc 'SHOW server_version_num' -d postgres)" != 17* ]]; then
  echo 'REFUSED: requires PostgreSQL 17' >&2; exit 2
fi
DB="wardah_quality_199_$$"
TASK_DIR="$(mktemp -d)"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$TASK_DIR"; }
trap cleanup EXIT
cd "$ROOT"
echo "checkout: $(git rev-parse HEAD)"
echo "server: $(psql -X -tAc 'SHOW server_version' -d postgres)"
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline)"
pair_field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
CUTOFF="$(pair_field BASELINE_CUTOFF)"
echo "baseline: $(pair_field BASELINE_PATH) cutoff: $CUTOFF"
createdb "$DB"
export PGDATABASE="$DB"
PSQL=(psql -X -v ON_ERROR_STOP=1)
"${PSQL[@]}" -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
"${PSQL[@]}" -q -f "$(pair_field BASELINE_PATH)" >/dev/null 2>&1
"${PSQL[@]}" -q -f "$(pair_field REFERENCE_PATH)" >/dev/null
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations "$CUTOFF" > "$TASK_DIR/full.txt"
# Stay valid after later migrations: apply exactly the chain up to M199.
sed -n '1,/^199_manufacturing_quality_control.sql$/p' "$TASK_DIR/full.txt" > "$TASK_DIR/order.txt"
if [[ "$(tail -n 1 "$TASK_DIR/order.txt")" != '199_manufacturing_quality_control.sql' ]]; then
  echo 'REFUSED: M199 missing from the apply order' >&2; exit 2
fi
sed -i '$d' "$TASK_DIR/order.txt"
REPORT="$TASK_DIR/chain.txt" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$TASK_DIR/order.txt"
"${PSQL[@]}" -q -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
"${PSQL[@]}" -f "$HERE/red.sql"
"${PSQL[@]}" -q -f sql/migrations/199_manufacturing_quality_control.sql >/dev/null
"${PSQL[@]}" -f "$HERE/acceptance.sql"
# The catalog-wide DEFINER contract must stay green with M199 installed.
bash scripts/ci/fresh-db/selftest_definer_guard_contract.sh
"${PSQL[@]}" -q -f scripts/ci/fresh-db/acceptance_reference_rbac.sql >/dev/null
python3 "$HERE/concurrency.py" "$DB"
echo 'GREEN_M199_QUALITY_CONTROL_ACCEPTANCE'
