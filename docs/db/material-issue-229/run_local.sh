#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
if [[ -n "${DATABASE_URL:-}" || -n "${PGSERVICE:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
 echo 'REFUSED: remote connection configuration present' >&2; exit 2
fi
case "${PGHOST:-}" in ''|localhost|127.0.0.1|/*) ;; *) echo 'REFUSED: nonlocal PGHOST' >&2; exit 2;; esac
[[ "$(psql -X -tAc 'SHOW server_version_num' -d postgres)" == 17* ]] || exit 2
DB="wardah_issue_scope_$$"
ORDER="$(mktemp)"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -f "$ORDER"; }
trap cleanup EXIT
cd "$ROOT"
echo "checkout: $(git rev-parse HEAD)"
echo "server: $(psql -X -tAc 'SHOW server_version' -d postgres)"
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline)"
pair_field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
CUTOFF="$(pair_field BASELINE_CUTOFF)"
[[ "$CUTOFF" == 189 ]] || exit 2
createdb "$DB"
PSQL=(psql -X -v ON_ERROR_STOP=1 -d "$DB")
"${PSQL[@]}" -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
"${PSQL[@]}" -q -f "$(pair_field BASELINE_PATH)" >/dev/null 2>&1
"${PSQL[@]}" -q -f "$(pair_field REFERENCE_PATH)" >/dev/null
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations "$CUTOFF" > "$ORDER"
[[ "$(wc -l < "$ORDER")" == 5 && "$(tail -1 "$ORDER")" == '194_stage_wip_posted_cost_boundary.sql' ]] || exit 2
PGDATABASE="$DB" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$ORDER"
"${PSQL[@]}" -q -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
"${PSQL[@]}" -q -f "$HERE/seed.sql" >/dev/null
"${PSQL[@]}" -q -f "$HERE/195_material_issue_scope_candidate.sql" >/dev/null
"${PSQL[@]}" -f "$HERE/acceptance.sql"
echo 'ISSUE_SCOPE_LOCAL_ACCEPTANCE_PASS'
