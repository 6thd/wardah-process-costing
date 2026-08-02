#!/usr/bin/env bash
# Concurrency acceptance for Migration 168.
#
# Two sessions racing on the same voucher must not produce a lost update, a
# second cancellation of the same GL entry, or a duplicated audit record. Runs
# after acceptance_168_voucher_atomic_lifecycle.sql and reuses its committed
# fixtures; the preconditions below fail loudly rather than silently passing on
# a database where that suite never ran.
set -Eeuo pipefail

DB=${PGDATABASE:-wardah_fresh}
PSQL=(psql -v ON_ERROR_STOP=1 -X -d "$DB")

ORG=88111111-1111-1111-1111-111111111111
ADMIN=88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
CANCELLER=88cccccc-cccc-cccc-cccc-cccccccccccc
CUSTOMER=88d00000-0000-0000-0000-000000000001
INVOICE=88b10000-0000-0000-0000-000000000001
CASH=88a10000-0000-0000-0000-000000000001
SESSION_A=wardah_v168_session_a

fail() {
  echo "ACCEPTANCE_168_CONCURRENCY_FAIL: $1" >&2
  exit 1
}

"${PSQL[@]}" -tAc "
  SELECT EXISTS (
    SELECT 1 FROM public.user_organizations
    WHERE user_id='$CANCELLER' AND org_id='$ORG' AND is_active
  )" | grep -qx t \
  || fail 'primary acceptance fixtures are missing'

create_draft() {
  local amount=$1
  "${PSQL[@]}" -tAc "
    SELECT set_config('request.jwt.claim.sub','$ADMIN',false);
    SELECT set_config('request.jwt.claims','{\"org_id\":\"$ORG\"}',false);
    SET ROLE authenticated;
    SELECT public.rpc_create_customer_receipt(jsonb_build_object(
      'customer_id','$CUSTOMER',
      'amount',$amount,
      'payment_method','cash',
      'payment_account_id','$CASH',
      'lines', jsonb_build_array(jsonb_build_object(
        'invoice_id','$INVOICE','allocated_amount',$amount))
    ))->>'receipt_id';
  " | tail -1
}

# Wait until session A demonstrably holds its row lock on the voucher table,
# instead of trusting the scheduler to have started it.
wait_for_lock() {
  local pid=$1
  for _ in $(seq 1 100); do
    if "${PSQL[@]}" -tAc "
      SELECT EXISTS (
        SELECT 1 FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE a.application_name = '$SESSION_A'
          AND l.relation = 'public.customer_collections'::regclass
          AND l.mode = 'RowShareLock'
          AND l.granted
      )" | grep -qx t; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      fail 'session A exited before taking the voucher lock'
    fi
    sleep 0.1
  done
  fail 'session A never took the voucher lock'
}

# ---------------------------------------------------------------------------
# Race 1: two cancellations of the same voucher.
# ---------------------------------------------------------------------------
CANCEL_TARGET=$(create_draft 90)
[ -n "$CANCEL_TARGET" ] || fail 'could not create the cancel race fixture'

cat >/tmp/v168-cancel-a.sql <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','$CANCELLER',false);
SELECT set_config('request.jwt.claims','{"org_id":"$ORG"}',false);
SET LOCAL ROLE authenticated;
SELECT public.rpc_cancel_customer_receipt('$CANCEL_TARGET','concurrency session A');
SELECT pg_sleep(2);
COMMIT;
SQL

cat >/tmp/v168-cancel-b.sql <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','$CANCELLER',false);
SELECT set_config('request.jwt.claims','{"org_id":"$ORG"}',false);
SET LOCAL ROLE authenticated;
SELECT public.rpc_cancel_customer_receipt('$CANCEL_TARGET','concurrency session B');
COMMIT;
SQL

PGAPPNAME="$SESSION_A" "${PSQL[@]}" -f /tmp/v168-cancel-a.sql >/tmp/v168-cancel-a.out 2>&1 &
a_pid=$!
wait_for_lock "$a_pid"

set +e
"${PSQL[@]}" -f /tmp/v168-cancel-b.sql >/tmp/v168-cancel-b.out 2>&1
b_status=$?
set -e
wait "$a_pid" || fail "session A failed: $(cat /tmp/v168-cancel-a.out)"
[ "$b_status" -eq 0 ] || fail "session B failed: $(cat /tmp/v168-cancel-b.out)"

audit_rows=$("${PSQL[@]}" -tAc "
  SELECT count(*) FROM public.audit_logs
  WHERE action='voucher_cancelled' AND entity_id='$CANCEL_TARGET'")
[ "$audit_rows" = "1" ] \
  || fail "concurrent cancel wrote $audit_rows audit records, expected exactly 1"

cancel_state=$("${PSQL[@]}" -tAc "
  SELECT status FROM public.customer_collections WHERE id='$CANCEL_TARGET'")
[ "$cancel_state" = "cancelled" ] \
  || fail "voucher ended in state '$cancel_state' after the cancel race"

grep -q 'duplicate.*true\|"duplicate": true' /tmp/v168-cancel-b.out \
  || fail 'the losing cancel did not return the idempotent duplicate result'

# ---------------------------------------------------------------------------
# Race 2: two edits of the same draft. The loser must wait for the winner and
# then replace the complete allocation set, never interleave with it.
# ---------------------------------------------------------------------------
EDIT_TARGET=$(create_draft 80)
[ -n "$EDIT_TARGET" ] || fail 'could not create the edit race fixture'

cat >/tmp/v168-edit-a.sql <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','$ADMIN',false);
SELECT set_config('request.jwt.claims','{"org_id":"$ORG"}',false);
SET LOCAL ROLE authenticated;
SELECT public.rpc_update_customer_receipt_draft('$EDIT_TARGET', jsonb_build_object(
  'amount', 60,
  'lines', jsonb_build_array(jsonb_build_object(
    'invoice_id','$INVOICE','allocated_amount',60))));
SELECT pg_sleep(2);
COMMIT;
SQL

cat >/tmp/v168-edit-b.sql <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','$ADMIN',false);
SELECT set_config('request.jwt.claims','{"org_id":"$ORG"}',false);
SET LOCAL ROLE authenticated;
SELECT public.rpc_update_customer_receipt_draft('$EDIT_TARGET', jsonb_build_object(
  'amount', 40,
  'lines', jsonb_build_array(jsonb_build_object(
    'invoice_id','$INVOICE','allocated_amount',40))));
COMMIT;
SQL

PGAPPNAME="$SESSION_A" "${PSQL[@]}" -f /tmp/v168-edit-a.sql >/tmp/v168-edit-a.out 2>&1 &
a_pid=$!
wait_for_lock "$a_pid"

set +e
"${PSQL[@]}" -f /tmp/v168-edit-b.sql >/tmp/v168-edit-b.out 2>&1
b_status=$?
set -e
wait "$a_pid" || fail "edit session A failed: $(cat /tmp/v168-edit-a.out)"
[ "$b_status" -eq 0 ] || fail "edit session B failed: $(cat /tmp/v168-edit-b.out)"

read -r final_amount line_count total <<<"$("${PSQL[@]}" -tA -F' ' -c "
  SELECT c.amount::numeric(18,2),
         (SELECT count(*) FROM public.customer_collection_lines l
           WHERE l.collection_id = c.id),
         (SELECT coalesce(sum(l.allocated_amount),0)::numeric(18,2)
            FROM public.customer_collection_lines l
           WHERE l.collection_id = c.id)
  FROM public.customer_collections c WHERE c.id='$EDIT_TARGET'")"

[ "$final_amount" = "40.00" ] \
  || fail "lost update: header amount is $final_amount, expected the later writer's 40.00"
[ "$line_count" = "1" ] \
  || fail "interleaved replacement left $line_count allocation lines, expected 1"
[ "$total" = "40.00" ] \
  || fail "allocation total is $total, expected it to match the surviving header"

edit_audits=$("${PSQL[@]}" -tAc "
  SELECT count(*) FROM public.audit_logs
  WHERE action='voucher_draft_updated' AND entity_id='$EDIT_TARGET'")
[ "$edit_audits" = "2" ] \
  || fail "concurrent edits wrote $edit_audits audit records, expected exactly 2"

leaked=$("${PSQL[@]}" -tAc "
  SELECT coalesce(current_setting('wardah.voucher_lines_write', true),'')
       || '/' || coalesce(current_setting('wardah.voucher_gl_cancel', true),'')")
[ "$leaked" = "/" ] \
  || fail "an internal GUC leaked into a fresh session: $leaked"

echo 'VOUCHER_ATOMIC_168_CONCURRENCY_PASS'
