#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[[ -z "${DATABASE_URL:-}${PGSERVICE:-}${SUPABASE_DB_URL:-}${PGHOSTADDR:-}" ]] || exit 2
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]+$ && "$PGPORT" -ge 55000 ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_version_num')" == 17* ]] || exit 2
DB="wardah_issue_parent_198_canonical_browser_$$"
BRIDGE_PID=''; VITE_PID=''
cleanup() {
 [[ -z "$BRIDGE_PID" ]] || kill "$BRIDGE_PID" 2>/dev/null || true
 [[ -z "$VITE_PID" ]] || kill "$VITE_PID" 2>/dev/null || true
 dropdb --if-exists "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT
createdb "$DB"; export PGDATABASE="$DB"
psql -X -v ON_ERROR_STOP=1 -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
bash tests/fixtures/material-issue-combined/install_canonical.sh
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/material-issue-release/seed_after_containment.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b1',id FROM public.permissions WHERE permission_key IN
('manufacturing.material_issue_setup.prepare','manufacturing.material_reservation.reserve','manufacturing.material_reservation.release',
 'manufacturing.orders.create','manufacturing.orders.update','manufacturing.stage_costs.create') ON CONFLICT DO NOTHING;
SQL
python3 tests/fixtures/material-issue-combined/bridge.py > /tmp/wardah-combined-bridge.txt 2>&1 & BRIDGE_PID=$!
node node_modules/vite/bin/vite.js --config tests/fixtures/material-issue-combined/vite.config.ts > /tmp/wardah-combined-vite.txt 2>&1 & VITE_PID=$!
for ((attempt=0; attempt<60; attempt++)); do
 if curl --fail --silent http://127.0.0.1:4177/ >/dev/null && curl --fail --silent http://127.0.0.1:4178/state >/dev/null; then break; fi
 sleep 0.25
done
curl --fail --silent http://127.0.0.1:4177/ >/dev/null
curl --fail --silent http://127.0.0.1:4178/state >/dev/null
timeout --kill-after=5 180 node tests/fixtures/material-issue-combined/verify.mjs
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql | python3 docs/db/material-issue-parent-version-198/verify_readback.py --expected-owner postgres
