#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGDATABASE:?PGDATABASE must be set}"

org_id='99333333-1717-1717-1717-333333333333'
seed_user='99dddddd-171d-171d-171d-dddddddddddd'
race_user_a='99eeeeee-171e-171e-171e-eeeeeeeeeeee'
race_user_b='99ffffff-171f-171f-171f-ffffffffffff'
today_sql="(now() AT TIME ZONE 'utc')::date"
lock_ready='/tmp/ai-usage-171-lock-ready'
race_a='/tmp/ai-usage-171-race-a.out'
race_b='/tmp/ai-usage-171-race-b.out'
blocker_out='/tmp/ai-usage-171-blocker.out'

rm -f "$lock_ready" "$race_a" "$race_b" "$blocker_out"

psql -X -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO auth.users (id, email) VALUES
  ('$seed_user', 'ai171-seed@example.test'),
  ('$race_user_a', 'ai171-race-a@example.test'),
  ('$race_user_b', 'ai171-race-b@example.test');

INSERT INTO public.organizations (id, name, code)
VALUES ('$org_id', 'AiUsage171 Race Org', 'AI171-RACE');

INSERT INTO public.user_organizations (user_id, org_id, is_active) VALUES
  ('$seed_user', '$org_id', true),
  ('$race_user_a', '$org_id', true),
  ('$race_user_b', '$org_id', true);

INSERT INTO public.ai_usage_daily (
  org_id, user_id, usage_date, accepted_count
) VALUES (
  '$org_id', '$seed_user', $today_sql, 99
);
SQL

# Hold the exact advisory key used by the RPC so both callers are waiting
# concurrently before the quota decision is allowed to proceed.
psql -X -v ON_ERROR_STOP=1 -q >"$blocker_out" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock(
  hashtext('$org_id'::uuid::text),
  hashtext(($today_sql)::text)
);
\! touch /tmp/ai-usage-171-lock-ready
SELECT pg_sleep(2);
COMMIT;
SQL
blocker_pid=$!

for _ in $(seq 1 50); do
  [[ -f "$lock_ready" ]] && break
  sleep 0.1
done

if [[ ! -f "$lock_ready" ]]; then
  wait "$blocker_pid" || true
  echo 'CONCURRENCY_FAIL: advisory-lock blocker did not become ready' >&2
  exit 1
fi

run_quota_call() {
  local user_id=$1
  local output_file=$2
  psql -X -v ON_ERROR_STOP=1 -qAt >"$output_file" <<SQL
SET ROLE service_role;
SELECT allowed
FROM public.rpc_check_and_record_ai_usage(
  '$org_id'::uuid,
  '$user_id'::uuid
);
RESET ROLE;
SQL
}

run_quota_call "$race_user_a" "$race_a" &
race_pid_a=$!
run_quota_call "$race_user_b" "$race_b" &
race_pid_b=$!

race_status=0
wait "$race_pid_a" || race_status=1
wait "$race_pid_b" || race_status=1
wait "$blocker_pid" || race_status=1

if [[ "$race_status" -ne 0 ]]; then
  echo 'CONCURRENCY_FAIL: one or more psql sessions failed' >&2
  exit 1
fi

mapfile -t results < <(
  cat "$race_a" "$race_b" | tr -d '\r' | sed '/^[[:space:]]*$/d' | sort
)

if [[ "${#results[@]}" -ne 2 || "${results[0]}" != 'f' || "${results[1]}" != 't' ]]; then
  echo "CONCURRENCY_FAIL: expected exactly one false and one true; got: ${results[*]-<none>}" >&2
  exit 1
fi

final_counts=$(psql -X -v ON_ERROR_STOP=1 -qAt <<SQL
SELECT
  COALESCE(SUM(accepted_count), 0)::text || '|' ||
  COALESCE(SUM(rejected_count), 0)::text
FROM public.ai_usage_daily
WHERE org_id = '$org_id'
  AND usage_date = $today_sql;
SQL
)

if [[ "$final_counts" != '100|1' ]]; then
  echo "CONCURRENCY_FAIL: expected accepted|rejected = 100|1, got $final_counts" >&2
  exit 1
fi

printf 'AI_USAGE_DAILY_171_CONCURRENCY_PASS accepted|rejected=%s results=%s,%s\n' \
  "$final_counts" "${results[0]}" "${results[1]}"
