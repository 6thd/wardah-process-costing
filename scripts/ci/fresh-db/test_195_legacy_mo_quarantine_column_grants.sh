#!/usr/bin/env bash
# Real PG negative controls for the all-column quarantine boundary.
set -Eeuo pipefail
PROBE=${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/acceptance_195_legacy_mo_quarantine.sql"}
[[ -f "$PROBE" ]] || exit 2
[[ -z "${DATABASE_URL:-}${SUPABASE_DB_URL:-}${PGSERVICE:-}${PGHOSTADDR:-}" ]] || exit 2
[[ "${PGHOST:-}" == 127.0.0.1 || "${PGHOST:-}" == localhost ]] || exit 2
[[ "${PGDATABASE:-}" == wardah_fresh || "${PGDATABASE:-}" == wardah_issue_parent_198_canonical_* ]] || exit 2
TASK_DIR=$(mktemp -d /tmp/wardah-quarantine-column-controls.XXXXXX)
trap 'rm -rf "$TASK_DIR"' EXIT
positive() {
  psql -X -v ON_ERROR_STOP=1 -f "$PROBE" > "$TASK_DIR/positive.out" 2>&1
  grep -q 'M195_198_LEGACY_MO_QUARANTINE_PASS' "$TASK_DIR/positive.out"
}
positive
controls=0
for client in authenticated anon service_role; do
  for table in manufacturing_orders work_orders material_reservations; do
    # The probe starts its own transaction. On the expected error, psql exits
    # and rolls back the injected grant; on an unexpected pass its ROLLBACK
    # also removes the grant. No mutation is committed in either direction.
    if psql -X -v ON_ERROR_STOP=1 -v probe_path="$PROBE" \
        > "$TASK_DIR/negative.out" 2>&1 <<SQL
BEGIN;
GRANT UPDATE(notes) ON public.$table TO $client;
\i :probe_path
SQL
    then
      echo "QUARANTINE_COLUMN_GRANT_FALSE_GREEN: role=$client table=$table" >&2
      exit 1
    fi
    grep -Fq "LEGACY_MO_QUARANTINE_TABLE_GRANT_REMAINS: role=$client table=$table privilege=UPDATE" \
      "$TASK_DIR/negative.out"
    positive
    controls=$((controls+1))
    echo "QUARANTINE_COLUMN_GRANT_REFUSED role=$client table=$table restored=true"
  done
done
[[ "$controls" == 9 ]]
echo 'QUARANTINE_COLUMN_GRANT_CONTROLS_PASS controls=9'
