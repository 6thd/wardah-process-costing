#!/usr/bin/env bash
# Deterministic concurrency proof for Migration 200.
#
# rpc_set_gl_event_mapping takes an advisory lock, but the retained
# service-role writer (rpc_upsert_event_mapping, or any service_role write)
# does not. The RPC's audit before-image and its 'created' flag must still be
# exact when such a writer creates the same key concurrently.
#
# Session W (a writer that does not take the advisory lock) inserts the key
# and holds its transaction open. Session A (an org admin) then calls the
# RPC for the same key. A must block on W's uncommitted row — observed in
# pg_stat_activity, not inferred from timing — and, once W commits, report
# created = false with W's committed values as the audit before-image.
set -Eeuo pipefail

: "${PGDATABASE:?PGDATABASE must be set}"

PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
tmp_prefix=/tmp/gl-event-200-race
org_id='52000200-0000-0000-0000-0000000000d1'
admin_id='52000200-0000-0000-0000-0000000000d2'

rm -f "${tmp_prefix}"-*.ready "${tmp_prefix}"-*.out "${tmp_prefix}"-*.err

"${PSQL[@]}" <<SQL
INSERT INTO public.organizations (id, name, code)
VALUES ('$org_id', 'GL Event 200 Race', 'GLE200-RACE');

INSERT INTO auth.users (id, email)
VALUES ('$admin_id', 'gle200-race-admin@example.test');

INSERT INTO public.user_organizations (user_id, org_id, role, is_active)
VALUES ('$admin_id', '$org_id', 'admin', true);

INSERT INTO public.gl_accounts (org_id, code, name, category, subtype, normal_balance, is_active) VALUES
  ('$org_id', '131100', 'Raw materials', 'ASSET', 'inventory', 'DEBIT', true),
  ('$org_id', '134100', 'WIP', 'ASSET', 'inventory', 'DEBIT', true);
SQL

writer_ready="${tmp_prefix}-writer.ready"
PGAPPNAME='gle200-writer' "${PSQL[@]}" >"${tmp_prefix}-writer.out" 2>"${tmp_prefix}-writer.err" <<SQL &
BEGIN;
INSERT INTO public.gl_event_mappings (org_id, event_code, work_center_code, debit_account_code, credit_account_code, description)
VALUES ('$org_id', 'MATERIAL_ISSUE', NULL, '131100', '134100', 'service writer');
\! touch $writer_ready
SELECT pg_sleep(3);
COMMIT;
SQL
writer_pid=$!

for _ in $(seq 1 100); do
  [[ -f "$writer_ready" ]] && break
  sleep 0.05
done
if [[ ! -f "$writer_ready" ]]; then
  wait "$writer_pid" || true
  echo 'GL_EVENT_200_CONCURRENCY_FAIL: writer did not become ready' >&2
  exit 1
fi

PGAPPNAME='gle200-admin' "${PSQL[@]}" >"${tmp_prefix}-admin.out" 2>"${tmp_prefix}-admin.err" <<SQL &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$admin_id', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"$admin_id","role":"authenticated","org_id":"$org_id"}', true);
SELECT public.rpc_set_gl_event_mapping('$org_id', 'MATERIAL_ISSUE', '134100', '131100');
COMMIT;
SQL
admin_pid=$!

waiting=0
for _ in $(seq 1 100); do
  waiting=$("${PSQL[@]}" <<SQL
SELECT count(*)
FROM pg_stat_activity
WHERE application_name = 'gle200-admin'
  AND state = 'active'
  AND wait_event_type = 'Lock';
SQL
)
  [[ "$waiting" == '1' ]] && break
  sleep 0.05
done

writer_status=0
admin_status=0
wait "$writer_pid" || writer_status=$?
wait "$admin_pid" || admin_status=$?

if [[ "$waiting" != '1' ]]; then
  echo 'GL_EVENT_200_CONCURRENCY_FAIL: the admin call never waited on the uncommitted writer' >&2
  exit 1
fi
echo 'GL_EVENT_200_RACE_WAIT_OBSERVED'

if [[ $writer_status -ne 0 || $admin_status -ne 0 ]]; then
  cat "${tmp_prefix}-writer.err" "${tmp_prefix}-admin.err" >&2
  echo "GL_EVENT_200_CONCURRENCY_FAIL: writer=$writer_status admin=$admin_status" >&2
  exit 1
fi

result=$(grep -m1 '"created"' "${tmp_prefix}-admin.out" || true)
echo "admin result: $result"

"${PSQL[@]}" <<SQL
DO \$check\$
DECLARE
  v_result jsonb := NULLIF('$result', '')::jsonb;
BEGIN
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'GL_EVENT_200_CONCURRENCY_NO_RESULT';
  END IF;
  IF (v_result ->> 'created')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'GL_EVENT_200_CONCURRENCY_CREATED_WRONG: %', v_result;
  END IF;

  IF (SELECT count(*) FROM public.gl_event_mappings
      WHERE org_id = '$org_id' AND event_code = 'MATERIAL_ISSUE') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.gl_event_mappings
       WHERE org_id = '$org_id' AND event_code = 'MATERIAL_ISSUE'
         AND debit_account_code = '134100' AND credit_account_code = '131100'
         AND description = 'service writer') THEN
    RAISE EXCEPTION 'GL_EVENT_200_CONCURRENCY_ROW_WRONG';
  END IF;

  IF (SELECT count(*) FROM public.audit_logs
      WHERE org_id = '$org_id' AND action = 'accounting.gl_event_mapping.set') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.audit_logs
       WHERE org_id = '$org_id' AND action = 'accounting.gl_event_mapping.set'
         AND old_data ->> 'debit_account_code' = '131100'
         AND old_data ->> 'credit_account_code' = '134100'
         AND new_data ->> 'debit_account_code' = '134100'
         AND new_data ->> 'credit_account_code' = '131100'
         AND user_id = '$admin_id') THEN
    RAISE EXCEPTION 'GL_EVENT_200_CONCURRENCY_AUDIT_BEFORE_IMAGE_WRONG';
  END IF;

  RAISE NOTICE 'GL_EVENT_200_RACE_OK: created=false and the committed writer row is the audit before-image';
END
\$check\$;
SQL

echo 'GL_EVENT_200_RACE_OK'
echo 'GL_EVENT_200_CONCURRENCY_PASS'
