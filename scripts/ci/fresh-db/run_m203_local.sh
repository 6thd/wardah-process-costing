#!/usr/bin/env bash
# Local-only runner for the pre-M202 CRLF script, migration 203 and the revised
# M202 acceptance (including its membership contract), on a disposable PG17.
#   PGHOST=127.0.0.1 PGPORT=55xxx PGUSER=postgres PGPASSWORD=... \
#     bash scripts/ci/fresh-db/run_m203_local.sh
# Disposable cluster only: 202 creates the cluster-wide role wardah_qc_entry_202.
# No remote connection, no secret: it refuses URL/service/PGHOSTADDR settings and
# any non-loopback PGHOST. Nothing here writes supabase_migrations.schema_migrations.
#
# Chains (cutoff-189 baseline pair, then 190..201 from the repository):
#   base        190..201                      CRLF unit tests, 203 pre-image drift mutants
#   restored    base -> CRLF script -> 202 -> 203   203 acceptance, concurrency, revised 202 acceptance
#   alternate   base -> 203 -> 202            203 acceptance (203 may precede 202)
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
if [[ -n "${DATABASE_URL:-}" || -n "${PGSERVICE:-}" || -n "${SUPABASE_DB_URL:-}" || -n "${PGHOSTADDR:-}" ]]; then
  echo 'REFUSED: remote connection configuration present' >&2; exit 2
fi
case "${PGHOST:-}" in ''|localhost|127.0.0.1|/*) ;; *) echo 'REFUSED: nonlocal PGHOST' >&2; exit 2;; esac
if [[ "$(psql -X -tAc 'SHOW server_version_num' -d postgres)" != 17* ]]; then
  echo 'REFUSED: requires PostgreSQL 17' >&2; exit 2
fi
if [[ "$(psql -X -tAc "SELECT count(*) FROM pg_roles WHERE rolname = 'wardah_qc_entry_202'" -d postgres)" != 0 ]]; then
  echo 'REFUSED: role wardah_qc_entry_202 already exists in this cluster (use a fresh disposable cluster)' >&2; exit 2
fi
P="wardah_m203_$$"
TASK_DIR="$(mktemp -d)"
cleanup() {
  for d in $(psql -X -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${P}%'" -d postgres 2>/dev/null); do
    dropdb --if-exists "$d" >/dev/null 2>&1 || true
  done
  psql -X -qc 'DROP ROLE IF EXISTS wardah_qc_entry_202' -d postgres >/dev/null 2>&1 || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT
cd "$ROOT"
echo "checkout: $(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "server: $(psql -X -tAc 'SHOW server_version' -d postgres)"

PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
# run_checked LABEL DB FILE OUT MARKER [WORKDIR]: psql exit 0, no ERROR/FATAL/PANIC line, marker present.
run_checked() {
  local label="$1" db="$2" file="$3" out="$4" marker="$5" dir="${6:-.}" rc=0
  ( cd "$dir" && psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$file" ) >"$out" 2>&1 || rc=$?
  if [[ "$rc" != 0 ]]; then
    echo "REFUSED: $label psql exit code $rc" >&2; grep -E '(ERROR|FATAL|PANIC):' "$out" | head -3 >&2 || true; return 1
  fi
  if grep -qE '(ERROR|FATAL|PANIC):' "$out"; then echo "REFUSED: $label emitted a psql error although the exit code was 0" >&2; return 1; fi
  if ! grep -q -- "$marker" "$out"; then echo "REFUSED: $label marker $marker missing" >&2; return 1; fi
  echo "$label: psql rc=0, no psql error, marker ok: $marker"
}
# run_py LABEL DB OUT MARKER SCRIPT: python check with PGDATABASE, exit 0 and marker.
run_py() {
  local label="$1" db="$2" out="$3" marker="$4" script="$5" rc=0
  PGDATABASE="$db" WARDAH_DRIFT_DIR="$TASK_DIR" python3 "$script" >"$out" 2>&1 || rc=$?
  if [[ "$rc" != 0 ]] || ! grep -q -- "$marker" "$out"; then
    echo "REFUSED: $label rc=$rc or marker $marker missing" >&2; tail -5 "$out" >&2; return 1
  fi
  echo "$label: exit 0, marker ok: $marker"
}
copy_db() { createdb -T "$1" "$2"; }

PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline 190)"
pair_field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(pair_field BASELINE_CUTOFF)" == 189 ]] || { echo 'REFUSED: requires the cutoff-189 baseline' >&2; exit 2; }
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 | awk -F_ '$1 <= 201' > "$TASK_DIR/order.txt"
[[ "$(cut -d_ -f1 "$TASK_DIR/order.txt" | paste -sd,)" == 190,191,192,193,194,195,196,197,198,199,200,201 ]] \
  || { echo 'REFUSED: chain must be 190..201 after the cutoff-189 baseline' >&2; exit 2; }

createdb "${P}_base"
"${PSQL[@]}" -d "${P}_base" -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
"${PSQL[@]}" -d "${P}_base" -f "$(pair_field BASELINE_PATH)" >/dev/null 2>&1
"${PSQL[@]}" -d "${P}_base" -f "$(pair_field REFERENCE_PATH)" >/dev/null
REPORT="$TASK_DIR/chain.txt" PGDATABASE="${P}_base" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$TASK_DIR/order.txt"

# --- base: CRLF unit tests and 203 pre-image drift mutants (each on its own copy)
copy_db "${P}_base" "${P}_crlf"
run_py 'CRLF unit tests' "${P}_crlf" "$TASK_DIR/crlf.out" PRE_M202_CRLF_CHECKS_PASS scripts/ci/fresh-db/pre_m202_crlf_compatibility_tests.py
copy_db "${P}_base" "${P}_drift"
run_py '203 pre-image drift' "${P}_drift" "$TASK_DIR/drift.out" STAGE_WIP_203_PREIMAGE_DRIFT_PASS scripts/ci/fresh-db/acceptance_203_preimage_drift.py

# --- restored order: CRLF script (no-op on a fresh DB) -> 202 -> 203
copy_db "${P}_base" "${P}_a"
run_checked 'CRLF script' "${P}_a" scripts/ops/pre_m202_validate_mo_transition_crlf.sql "$TASK_DIR/a_crlf.out" PRE_M202_CRLF_NOOP
"${PSQL[@]}" -d "${P}_a" -f sql/migrations/202_qc_privileged_write_closure.sql >/dev/null
run_checked '203 apply' "${P}_a" sql/migrations/203_stage_wip_mo_lock_under_m195_containment.sql "$TASK_DIR/a_203.out" COMMIT
run_checked '203 acceptance (restored order)' "${P}_a" scripts/ci/fresh-db/acceptance_203_stage_wip_mo_lock.sql "$TASK_DIR/a_acc203.out" STAGE_WIP_203_ACCEPTANCE_PASS
run_py '203 concurrency' "${P}_a" "$TASK_DIR/a_conc.out" STAGE_WIP_203_CONCURRENCY_PASS scripts/ci/fresh-db/acceptance_203_stage_wip_lock_concurrency.py
# Revised M202 acceptance (try_role/try_as/try_connected controls and the membership
# contract) on the post-203 catalog; the base fixture it needs is loaded after 202.
"${PSQL[@]}" -d "${P}_a" -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
run_checked 'M202 acceptance on the post-203 catalog' "${P}_a" acceptance.sql "$TASK_DIR/a_acc202.out" \
  M202_QC_PRIVILEGED_WRITE_CLOSURE_ACCEPTANCE_PASS docs/db/qc-privileged-write-closure-202
for m in 'try_role control: probe set-role denial ran once' 'try_as control: a role-setup failure raises' \
         'try_connected control: a probe error mentioning session authorization ran once' \
         'try_connected control: mutated_connected rejects a setup failure' \
         'entry role membership is empty or only the admin-only DDL-owner edge'; do
  grep -q -- "$m" "$TASK_DIR/a_acc202.out" || { echo "REFUSED: acceptance notice missing: $m" >&2; exit 1; }
done
echo "M202 acceptance ok-notices: $(grep -c 'NOTICE:  ok ' "$TASK_DIR/a_acc202.out"); probe identities: $(grep -c 'probe_identity' "$TASK_DIR/a_acc202.out")"

# --- alternate order: 203 before 202 (the cluster-wide role belongs to one database at a time)
dropdb "${P}_a"; psql -X -qc 'DROP ROLE wardah_qc_entry_202' -d postgres
copy_db "${P}_base" "${P}_b"
run_checked '203 apply (before 202)' "${P}_b" sql/migrations/203_stage_wip_mo_lock_under_m195_containment.sql "$TASK_DIR/b_203.out" COMMIT
"${PSQL[@]}" -d "${P}_b" -f sql/migrations/202_qc_privileged_write_closure.sql >/dev/null
run_checked '203 acceptance (203 before 202)' "${P}_b" scripts/ci/fresh-db/acceptance_203_stage_wip_mo_lock.sql "$TASK_DIR/b_acc203.out" STAGE_WIP_203_ACCEPTANCE_PASS
echo 'M203_LOCAL_RUN_PASS crlf=unit drift=3 order=restored+alternate acceptance_202=post-203'
