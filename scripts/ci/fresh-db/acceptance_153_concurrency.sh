#!/usr/bin/env bash
set -Eeuo pipefail

DB=${PGDATABASE:-wardah_fin153}
PSQL=(psql -v ON_ERROR_STOP=1 -X -d "$DB")

ORG=53111111-1111-1111-1111-111111111111
ENTRY=53e00000-0000-0000-0000-000000000020
DEBIT_ACCOUNT=53a00000-0000-0000-0000-000000000001
CREDIT_ACCOUNT=53a00000-0000-0000-0000-000000000002

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

start_ms=$(date +%s%3N)
set +e
"${PSQL[@]}" -f /tmp/f153-writer.sql \
  >/tmp/f153-writer.out 2>/tmp/f153-writer.err &
writer_pid=$!

# Ensure the writer has acquired a RowExclusive lock on gl_entries before the
# migration requests the parent-first SHARE ROW EXCLUSIVE lock.
sleep 0.25
migration_start_ms=$(date +%s%3N)
"${PSQL[@]}" -f sql/migrations/153_financial_gl_legal_amount_contract.sql \
  >/tmp/f153-migration.out 2>/tmp/f153-migration.err &
migration_pid=$!

wait "$writer_pid"; writer_status=$?
wait "$migration_pid"; migration_status=$?
set -e

end_ms=$(date +%s%3N)
migration_elapsed=$((end_ms-migration_start_ms))
total_elapsed=$((end_ms-start_ms))

if [[ $writer_status -ne 0 || $migration_status -ne 0 ]]; then
  echo "ACCEPTANCE_153_CONCURRENCY_FAIL: writer=$writer_status migration=$migration_status" >&2
  cat /tmp/f153-writer.err /tmp/f153-migration.err >&2 || true
  exit 1
fi

# The writer sleeps for two seconds after owning the parent lock. A migration
# elapsed time materially below 1.5s means it did not demonstrably wait.
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

echo "ACCEPTANCE_153_CONCURRENCY_PASS: migration waited ${migration_elapsed}ms; total ${total_elapsed}ms"
