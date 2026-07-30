#!/usr/bin/env bash
set -Eeuo pipefail

DB=${PGDATABASE:-wardah_fin153}
PSQL=(psql -v ON_ERROR_STOP=1 -X -d "$DB")

ORG=53111111-1111-1111-1111-111111111111
ENTRY=53e00000-0000-0000-0000-000000000020
DEBIT_ACCOUNT=53a00000-0000-0000-0000-000000000001
CREDIT_ACCOUNT=53a00000-0000-0000-0000-000000000002
WRITER_APP=wardah_f153_writer

cat >/tmp/f153-writer.sql <<SQL
BEGIN;
INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   status, total_debit, total_credit)
VALUES
  ('$ENTRY', '$ORG', 'F153-CONCURRENT-WRITER', '2026-07-30', 'manual',
   'Writer holds parent before inserting children', 'draft', 33.33, 33.33);
SELECT pg_sleep(2);
INSERT INTO public.gl_entry_lines
  (id, org_id, tenant_id, entry_id, line_number, account_id,
   debit, credit, debit_amount, credit_amount, currency_code, description)
VALUES
  ('53b00000-0000-0000-0000-000000000020', '$ORG', '$ORG', '$ENTRY', 1,
   '$DEBIT_ACCOUNT', 33.33, 0, 0, 0, 'SAR', 'Concurrent debit'),
  ('53b00000-0000-0000-0000-000000000021', '$ORG', '$ORG', '$ENTRY', 2,
   '$CREDIT_ACCOUNT', 0, 33.33, 0, 0, 'SAR', 'Concurrent credit');
COMMIT;
SQL

set +e
writer_start_ms=$(date +%s%3N)
PGAPPNAME="$WRITER_APP" "${PSQL[@]}" -f /tmp/f153-writer.sql \
  >/tmp/f153-writer.out 2>/tmp/f153-writer.err &
writer_pid=$!
set -e

# Do not rely on scheduler timing. Wait until the writer session demonstrably owns
# the granted RowExclusiveLock on the parent table before starting migration 153.
lock_seen=false
for _ in $(seq 1 100); do
  if "${PSQL[@]}" -tAc "
    SELECT EXISTS (
      SELECT 1
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE a.application_name = '$WRITER_APP'
        AND l.relation = 'public.gl_entries'::regclass
        AND l.mode = 'RowExclusiveLock'
        AND l.granted
    )" | grep -qx t; then
    lock_seen=true
    break
  fi

  if ! kill -0 "$writer_pid" 2>/dev/null; then
    echo 'ACCEPTANCE_153_CONCURRENCY_FAIL: writer exited before parent lock was observed' >&2
    cat /tmp/f153-writer.err >&2 || true
    wait "$writer_pid" || true
    exit 1
  fi
  sleep 0.05
done

if [[ "$lock_seen" != true ]]; then
  echo 'ACCEPTANCE_153_CONCURRENCY_FAIL: timed out waiting for writer RowExclusiveLock on gl_entries' >&2
  kill "$writer_pid" 2>/dev/null || true
  wait "$writer_pid" || true
  exit 1
fi

migration_start_ms=$(date +%s%3N)
set +e
PGAPPNAME=wardah_f153_migration "${PSQL[@]}" \
  -f sql/migrations/153_financial_gl_legal_amount_contract.sql \
  >/tmp/f153-migration.out 2>/tmp/f153-migration.err &
migration_pid=$!

wait "$migration_pid"; migration_status=$?
migration_end_ms=$(date +%s%3N)
wait "$writer_pid"; writer_status=$?
writer_end_ms=$(date +%s%3N)
set -e

migration_elapsed=$((migration_end_ms-migration_start_ms))
writer_elapsed=$((writer_end_ms-writer_start_ms))

if [[ $writer_status -ne 0 || $migration_status -ne 0 ]]; then
  echo "ACCEPTANCE_153_CONCURRENCY_FAIL: writer=$writer_status migration=$migration_status" >&2
  cat /tmp/f153-writer.err /tmp/f153-migration.err >&2 || true
  exit 1
fi

# The writer sleeps for two seconds after owning the parent lock. Since migration
# starts only after that granted lock is observed, an elapsed time materially below
# 1.5s means it did not demonstrably wait on the parent-first lock acquisition.
if [[ $migration_elapsed -lt 1500 ]]; then
  echo "ACCEPTANCE_153_CONCURRENCY_FAIL: migration did not wait on parent lock (${migration_elapsed}ms)" >&2
  exit 1
fi

read -r header_count line_count legal_debit legal_credit legacy_debit legacy_credit trigger_state <<<$(${PSQL[@]} -tA -F' ' -c "
  SELECT
    (SELECT count(*) FROM public.gl_entries WHERE id='$ENTRY'),
    (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id='$ENTRY'),
    (SELECT coalesce(sum(debit),0) FROM public.gl_entry_lines WHERE entry_id='$ENTRY'),
    (SELECT coalesce(sum(credit),0) FROM public.gl_entry_lines WHERE entry_id='$ENTRY'),
    (SELECT coalesce(sum(debit_amount),0) FROM public.gl_entry_lines WHERE entry_id='$ENTRY'),
    (SELECT coalesce(sum(credit_amount),0) FROM public.gl_entry_lines WHERE entry_id='$ENTRY'),
    (SELECT tgenabled FROM pg_trigger
      WHERE tgrelid='public.gl_entry_lines'::regclass
        AND tgname='trg_protect_posted_gl_entry_lines'
        AND NOT tgisinternal)")

if [[ "$header_count" != 1 || "$line_count" != 2 \
   || "$legal_debit" != 33.33 || "$legal_credit" != 33.33 \
   || "$legacy_debit" != 0.00 || "$legacy_credit" != 0.00 \
   || "$trigger_state" != O ]]; then
  echo "ACCEPTANCE_153_CONCURRENCY_FAIL: header=$header_count lines=$line_count legal=$legal_debit/$legal_credit legacy=$legacy_debit/$legacy_credit trigger=$trigger_state" >&2
  exit 1
fi

# The historical fixture must have been backfilled in the same migration run.
read -r historical_debit historical_credit <<<$(${PSQL[@]} -tA -F' ' -c "
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0)
  FROM public.gl_entry_lines
  WHERE entry_id='53e00000-0000-0000-0000-000000000001'")
if [[ "$historical_debit" != 125.50 || "$historical_credit" != 125.50 ]]; then
  echo "ACCEPTANCE_153_CONCURRENCY_FAIL: historical backfill=$historical_debit/$historical_credit" >&2
  exit 1
fi

echo "ACCEPTANCE_153_CONCURRENCY_PASS: observed writer lock; migration waited ${migration_elapsed}ms; writer ${writer_elapsed}ms"