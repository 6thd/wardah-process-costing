#!/usr/bin/env bash
set -Eeuo pipefail

MAIN_DB=${PGDATABASE:-wardah_fin153}
REJECT_DB=${REJECT_DB:-wardah_fin153_reject}
BASELINE_DIR=${BASELINE_DIR:-sql/baseline}

pair=$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh "$BASELINE_DIR")
pair_field() { printf '%s\n' "$pair" | sed -n "s/^$1=//p"; }
BASELINE=$(pair_field BASELINE_PATH)
REFERENCE=$(pair_field REFERENCE_PATH)
CUTOFF=$(pair_field BASELINE_CUTOFF)
CUTOFF=${CUTOFF:-0}

if [[ -z "$BASELINE" || -z "$REFERENCE" ]]; then
  echo 'FINANCIAL_GL_153_GATE_FAIL: baseline pair could not be resolved' >&2
  exit 1
fi
if [[ "$CUTOFF" != 152 ]]; then
  echo "FINANCIAL_GL_153_GATE_FAIL: expected cutoff 152, got $CUTOFF" >&2
  exit 1
fi

echo "Financial GL 153 gate: baseline=$BASELINE reference=$REFERENCE cutoff=$CUTOFF"

setup_pre153_db() {
  local db=$1
  local shim=scripts/ci/fresh-db/supabase_shim.sql
  local effective_shim=$shim

  dropdb --if-exists "$db"
  createdb "$db"

  # Supabase client roles are cluster-wide, while auth/storage schemas are
  # database-local. The positive and reject paths use two databases in the same
  # PostgreSQL service, so only the first setup may execute CREATE ROLE.
  if psql -X -d postgres -tAc "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')" | grep -qx t; then
    effective_shim=/tmp/f153-supabase-shim-with-existing-roles.sql
    sed '/^CREATE ROLE \(anon\|authenticated\|service_role\|supabase_admin\) NOLOGIN;$/d' \
      "$shim" > "$effective_shim"
  fi

  psql -v ON_ERROR_STOP=1 -X -d "$db" -f "$effective_shim" -q
  psql -v ON_ERROR_STOP=1 -X -d "$db" -f "$BASELINE" -q
  psql -v ON_ERROR_STOP=1 -X -d "$db" -f "$REFERENCE" -q
  psql -v ON_ERROR_STOP=1 -X -d "$db" \
    -f scripts/ci/fresh-db/setup_153_pre_migration_fixture.sql -q
}

# ----------------------------------------------------------------------
# Positive path: a real two-session writer/migration race, then acceptance.
# ----------------------------------------------------------------------
setup_pre153_db "$MAIN_DB"
PGDATABASE="$MAIN_DB" bash scripts/ci/fresh-db/acceptance_153_concurrency.sh
psql -v ON_ERROR_STOP=1 -X -d "$MAIN_DB" \
  -f scripts/ci/fresh-db/acceptance_153_financial_gl_contract.sql

# ----------------------------------------------------------------------
# Negative preflight: a mixed legal+legacy value must abort the transaction.
# ----------------------------------------------------------------------
setup_pre153_db "$REJECT_DB"
psql -v ON_ERROR_STOP=1 -X -d "$REJECT_DB" <<'SQL'
UPDATE public.gl_entry_lines
SET debit_amount = debit
WHERE id = '53b00000-0000-0000-0000-000000000003';
SQL

set +e
psql -v ON_ERROR_STOP=1 -X -d "$REJECT_DB" \
  -f sql/migrations/153_financial_gl_legal_amount_contract.sql \
  >/tmp/f153-reject.out 2>/tmp/f153-reject.err
reject_status=$?
set -e

if [[ $reject_status -eq 0 ]]; then
  echo 'FINANCIAL_GL_153_GATE_FAIL: mixed-source migration unexpectedly succeeded' >&2
  exit 1
fi
if ! grep -q 'GL_153_MIXED_AMOUNT_SOURCE' /tmp/f153-reject.err; then
  echo 'FINANCIAL_GL_153_GATE_FAIL: reject path did not fail on GL_153_MIXED_AMOUNT_SOURCE' >&2
  cat /tmp/f153-reject.err >&2 || true
  exit 1
fi

read -r precision constraint_count compat_trigger posted_trigger <<<$({
  psql -X -d "$REJECT_DB" -tA -F' ' -c "
    SELECT
      (SELECT numeric_precision FROM information_schema.columns
       WHERE table_schema='public' AND table_name='gl_entries' AND column_name='total_debit'),
      (SELECT count(*) FROM pg_constraint
       WHERE conrelid='public.gl_entry_lines'::regclass
         AND conname LIKE 'gl_entry_lines_legal_%'),
      (SELECT count(*) FROM pg_trigger
       WHERE tgrelid='public.gl_entry_lines'::regclass
         AND tgname='trg_wardah_gl_line_legal_compat' AND NOT tgisinternal),
      (SELECT tgenabled FROM pg_trigger
       WHERE tgrelid='public.gl_entry_lines'::regclass
         AND tgname='trg_protect_posted_gl_entry_lines' AND NOT tgisinternal)"
})

if [[ "$precision" != 12 || "$constraint_count" != 0 \
   || "$compat_trigger" != 0 || "$posted_trigger" != O ]]; then
  echo "FINANCIAL_GL_153_GATE_FAIL: reject rollback precision=$precision constraints=$constraint_count compat=$compat_trigger posted=$posted_trigger" >&2
  exit 1
fi

echo 'FINANCIAL_GL_153_REJECT_PREFLIGHT_PASS'
echo 'FINANCIAL_GL_153_FRESH_DB_GATE_PASS'