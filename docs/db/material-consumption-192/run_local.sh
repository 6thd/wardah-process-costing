#!/usr/bin/env bash
# Run ONLY against a newly created disposable local PostgreSQL 17 database.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
if [[ -n "${DATABASE_URL:-}" || -n "${PGSERVICE:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
  echo 'REFUSED: remote connection configuration present' >&2; exit 2
fi
case "${PGHOST:-}" in ''|localhost|127.0.0.1|/*) ;; *) echo 'REFUSED: nonlocal PGHOST' >&2; exit 2;; esac
if [[ "$(psql -X -tAc 'SHOW server_version_num' -d postgres)" != 17* ]]; then
  echo 'REFUSED: requires PostgreSQL 17' >&2; exit 2
fi
DB="wardah_192_green_$$"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cd "$ROOT"
echo "checkout: $(git rev-parse HEAD)"
echo "server: $(psql -X -tAc 'SHOW server_version' -d postgres)"
# Historical M192 contract runner: pin the pre-190 baseline pair and stop at 192.
# Later chains (195+ quarantine the legacy fixture RPCs) are out of scope here.
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline 190)"
pair_field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
BASELINE="$(pair_field BASELINE_PATH)"
REFERENCE="$(pair_field REFERENCE_PATH)"
CUTOFF="$(pair_field BASELINE_CUTOFF)"
echo "baseline: $BASELINE cutoff: $CUTOFF"
createdb "$DB"
PSQL=(psql -X -v ON_ERROR_STOP=1 -d "$DB")
"${PSQL[@]}" -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
"${PSQL[@]}" -q -f "$BASELINE" >/dev/null 2>&1
"${PSQL[@]}" -q -f "$REFERENCE" >/dev/null
ORDER="$(mktemp)"
trap 'rm -f "$ORDER"; cleanup' EXIT
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations "$CUTOFF" | awk -F_ '$1<=192' > "$ORDER"
if [[ "$CUTOFF" != 189 || "$(cut -d_ -f1 "$ORDER" | paste -sd,)" != 190,191,192 ]]; then
  echo "REFUSED: historical M192 chain must be cutoff 189 + 190,191,192" >&2; exit 2
fi
echo "chain: $(cut -d_ -f1 "$ORDER" | paste -sd,)"
REPORT="$(mktemp)" PGDATABASE="$DB" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$ORDER"
"${PSQL[@]}" -q -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
"${PSQL[@]}" -f "$HERE/acceptance.sql"
"${PSQL[@]}" -f "$HERE/acceptance_matrix.sql"
python3 "$HERE/concurrency.py" "$DB"
