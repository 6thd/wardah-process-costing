#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
[[ -z "${DATABASE_URL:-}${PGSERVICE:-}${SUPABASE_DB_URL:-}${PGHOSTADDR:-}" ]] || exit 2
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" == 55432 && "${PGUSER:-}" == postgres && "${PGPASSWORD:-}" == postgres ]] || exit 2
[[ "$(psql -X -At -d postgres -c 'SHOW server_version_num')" == 17* ]] || exit 2
DB="wardah_issue_parent_198_canonical_auth_browser_$$"; AUTH_CONTAINER="wardah-auth-fixture-$$"; REST_CONTAINER="wardah-rest-fixture-$$"
BRIDGE_PID=''; VITE_PID=''
cleanup() {
 [[ -z "$BRIDGE_PID" ]] || kill "$BRIDGE_PID" 2>/dev/null || true
 [[ -z "$VITE_PID" ]] || kill "$VITE_PID" 2>/dev/null || true
 docker logs "$AUTH_CONTAINER" > /tmp/wardah-real-auth-service.txt 2>&1 || true
 docker logs "$REST_CONTAINER" > /tmp/wardah-real-rest-service.txt 2>&1 || true
 docker rm -f "$AUTH_CONTAINER" "$REST_CONTAINER" >/dev/null 2>&1 || true
 dropdb --if-exists "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT
createdb "$DB"; export PGDATABASE="$DB"
export WARDAH_AUTH_JWT_SECRET="$(openssl rand -hex 32)"
export WARDAH_AUTH_PASSWORD="$(openssl rand -hex 24)"
export WARDAH_REST_PASSWORD="$(openssl rand -hex 24)"
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
 printf '::add-mask::%s\n' "$WARDAH_AUTH_JWT_SECRET" "$WARDAH_AUTH_PASSWORD" "$WARDAH_REST_PASSWORD"
fi
python3 tests/fixtures/material-issue-real-auth/setup.py shim > /tmp/wardah-auth-bootstrap.sql
psql -X -v ON_ERROR_STOP=1 -q -f /tmp/wardah-auth-bootstrap.sql >/dev/null
docker run --detach --network host --name "$AUTH_CONTAINER" \
 -e GOTRUE_API_HOST=127.0.0.1 -e GOTRUE_API_PORT=55999 \
 -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_NAMESPACE=auth \
 -e "GOTRUE_DB_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/$DB?search_path=auth" \
 -e GOTRUE_SITE_URL=http://127.0.0.1:4177 -e API_EXTERNAL_URL=http://127.0.0.1:55999 \
 -e "GOTRUE_JWT_SECRET=$WARDAH_AUTH_JWT_SECRET" \
 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
 -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_EXP=3600 \
 -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
 supabase/gotrue:v2.196.0 >/dev/null
for ((attempt=0; attempt<120; attempt++)); do
 if curl --fail --silent http://127.0.0.1:55999/health > /tmp/wardah-real-auth-health.json; then break; fi
 sleep 0.25
done
python3 tests/fixtures/material-issue-real-auth/setup.py accounts
bash tests/fixtures/material-issue-combined/install_canonical.sh
python3 tests/fixtures/material-issue-real-auth/setup.py fixture > /tmp/wardah-auth-business-fixture.sql
psql -X -v ON_ERROR_STOP=1 -q -f /tmp/wardah-auth-business-fixture.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f docs/db/material-issue-release/seed_after_containment.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -v fixture_password="$WARDAH_REST_PASSWORD" -q <<'SQL'
-- Supabase compatibility functions for PostgREST's real JWT claims JSON.
-- Local environment adapter only; no business/canonical migration is edited.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub',true),''), NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role',true),''), NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'role','anon') $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wardah_fixture_authenticator') THEN
 CREATE ROLE wardah_fixture_authenticator NOINHERIT; END IF; END $$;
ALTER ROLE wardah_fixture_authenticator LOGIN PASSWORD :'fixture_password';
GRANT authenticated,anon TO wardah_fixture_authenticator;
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b1',id FROM public.permissions WHERE permission_key IN
('manufacturing.material_issue_setup.prepare','manufacturing.material_reservation.reserve','manufacturing.material_reservation.release',
 'manufacturing.orders.create','manufacturing.orders.update','manufacturing.stage_costs.create') ON CONFLICT DO NOTHING;
SQL
docker run --detach --network host --name "$REST_CONTAINER" \
 -e "PGRST_DB_URI=postgres://wardah_fixture_authenticator:$WARDAH_REST_PASSWORD@127.0.0.1:55432/$DB" \
 -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
 -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions -e PGRST_DB_MAX_ROWS=1000 \
 -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT=55998 \
 -e "PGRST_JWT_SECRET=$WARDAH_AUTH_JWT_SECRET" \
 postgrest/postgrest:v14.17 >/dev/null
export WARDAH_LOCAL_ANON_KEY="$(python3 tests/fixtures/material-issue-real-auth/setup.py anon)"
python3 tests/fixtures/material-issue-combined/bridge.py > /tmp/wardah-real-auth-bridge.txt 2>&1 & BRIDGE_PID=$!
node node_modules/vite/bin/vite.js --config tests/fixtures/material-issue-real-auth/vite.config.ts > /tmp/wardah-real-auth-vite.txt 2>&1 & VITE_PID=$!
for ((attempt=0; attempt<120; attempt++)); do
 if curl --fail --silent http://127.0.0.1:4177/ >/dev/null && curl --fail --silent http://127.0.0.1:55998/ >/dev/null; then break; fi
 sleep 0.25
done
WARDAH_REAL_AUTH=true timeout --kill-after=5 180 node tests/fixtures/material-issue-combined/verify.mjs
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql | python3 docs/db/material-issue-parent-version-198/verify_readback.py --expected-owner postgres
# No JWTs/passwords in uploaded diagnostics.
docker logs "$AUTH_CONTAINER" > /tmp/wardah-real-auth-vendor.txt 2>&1
printf '%s\n' 'MATERIAL_ISSUE_LOCAL_REAL_AUTH_POSTGREST_BROWSER_RECONCILIATION_PASS'
