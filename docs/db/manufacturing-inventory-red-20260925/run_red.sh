#!/usr/bin/env bash
# Manufacturing / inventory RED evidence runner — DISPOSABLE PostgreSQL ONLY.
#
# Builds a brand-new database from the canonical baseline pair + every
# migration after its cutoff (the same helpers ci-cd.yml uses), loads the RED
# fixture, runs every probe, and drops the database again.
#
#   PGHOST=/var/run/postgresql PGPORT=5433 PGUSER=postgres \
#     bash docs/db/manufacturing-inventory-red-20260925/run_red.sh
#
# Exit 0 means every probe REPRODUCED its defect on this checkout (RED
# confirmed). A probe that raises *_NOT_REPRODUCED means the defect is gone or
# changed: re-review before editing the probe, and never weaken its invariant.
#
# Safety: refuses any PGHOST that is not a local socket directory, localhost or
# 127.0.0.1, and refuses a DATABASE_URL/PGSERVICE environment. It never touches
# an existing database.
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

if [ -n "${DATABASE_URL:-}" ] || [ -n "${PGSERVICE:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then
  echo "REFUSED: DATABASE_URL/PGSERVICE/SUPABASE_DB_URL is set; this runner is for disposable local PostgreSQL only" >&2
  exit 2
fi
case "${PGHOST:-}" in
  ''|localhost|127.0.0.1|/*) ;;
  *) echo "REFUSED: PGHOST=${PGHOST} is not local" >&2; exit 2 ;;
esac

DB="wardah_mfg_red_$$"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -d "$DB")
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cd "$ROOT"
PAIR=$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline)
pair_field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
BASELINE=$(pair_field BASELINE_PATH)
REFERENCE=$(pair_field REFERENCE_PATH)
CUTOFF=$(pair_field BASELINE_CUTOFF)

echo "== server: $(psql -X -tAc 'show server_version' -d postgres)"
echo "== checkout: $(git rev-parse HEAD)"
echo "== baseline: $BASELINE (cutoff $CUTOFF)"

createdb "$DB"
"${PSQL[@]}" -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
"${PSQL[@]}" -f "$BASELINE" >/dev/null 2>&1
"${PSQL[@]}" -f "$REFERENCE" >/dev/null
ORDER_FILE="$(mktemp)"
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations "$CUTOFF" > "$ORDER_FILE"
echo "== migrations after cutoff: $(tr '\n' ' ' < "$ORDER_FILE")"
REPORT="$(mktemp)" PGDATABASE="$DB" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$ORDER_FILE"
rm -f "$ORDER_FILE"

"${PSQL[@]}" -f "$HERE/00_fixture.sql" >/dev/null

STATUS=0
for probe in A_completion_fg_divergence B_completion_cost_contamination \
             C_consumption_retry_lifecycle D_completion_authorization \
             E_multiwarehouse_physical_count F_stock_transfer_closed_path \
             GH_direct_table_surfaces I_process_costing_schema_rpc; do
  echo
  echo "================ $probe"
  RC=0
  OUT=$("${PSQL[@]}" -f "$HERE/$probe.sql" 2>&1) || RC=$?
  printf '%s\n' "$OUT" | sed 's/^psql:[^ ]* //'
  if [ "$RC" -ne 0 ] || ! printf '%s\n' "$OUT" | grep -q '_REPRODUCED *$'; then
    echo "!! $probe did not reproduce (psql exit $RC)"
    STATUS=1
  fi
done

echo
echo "================ R_projection_readback (read-only; fixture org rows only)"
"${PSQL[@]}" -f "$HERE/R_projection_readback.sql"

exit "$STATUS"
