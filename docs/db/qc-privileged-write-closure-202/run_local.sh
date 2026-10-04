#!/usr/bin/env bash
# M202 disposable PostgreSQL 17 acceptance: RED on M190..M201, preflight/atomicity
# controls, GREEN on 202, mutants, regression suites and concurrency.
#   PGHOST=127.0.0.1 PGPORT=55xxx PGUSER=postgres \
#     bash docs/db/qc-privileged-write-closure-202/run_local.sh
# Disposable cluster only: 202 creates the cluster-wide role wardah_qc_entry_202.
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
P="wardah_qc202_$$"
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
echo "checkout: $(git rev-parse HEAD)"
echo "server: $(psql -X -tAc 'SHOW server_version' -d postgres)"
M202=sql/migrations/202_qc_privileged_write_closure.sql
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
q1() { psql -X -tAq -d "$1" -c "$2"; }

PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline 190)"
pf() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
CUTOFF="$(pf BASELINE_CUTOFF)"
[[ "$CUTOFF" == 189 ]] || { echo 'REFUSED: requires the cutoff-189 baseline' >&2; exit 2; }
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations "$CUTOFF" > "$TASK_DIR/full.txt"
sed -n '1,/^201_manufacturing_settings_permissions.sql$/p' "$TASK_DIR/full.txt" > "$TASK_DIR/order201.txt"
sed '$d' "$TASK_DIR/order201.txt" > "$TASK_DIR/order200.txt"
[[ "$(tail -n 1 "$TASK_DIR/order201.txt")" == 201_manufacturing_settings_permissions.sql ]] \
  || { echo 'REFUSED: 201 missing from the apply order' >&2; exit 2; }
[[ "$(cut -d_ -f1 "$TASK_DIR/order201.txt" | paste -sd,)" == '190,191,192,193,194,195,196,197,198,199,200,201' ]] \
  || { echo 'REFUSED: expected exactly M190..M201 before 202' >&2; exit 2; }
grep -qx '202_qc_privileged_write_closure.sql' "$TASK_DIR/full.txt" \
  || { echo 'REFUSED: 202 is not part of the canonical apply order' >&2; exit 2; }

build_chain() { # $1 db, $2 order file, $3 with-fixture
  createdb "$1"
  "${PSQL[@]}" -d "$1" -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
  "${PSQL[@]}" -d "$1" -f "$(pf BASELINE_PATH)" >/dev/null 2>&1
  "${PSQL[@]}" -d "$1" -f "$(pf REFERENCE_PATH)" >/dev/null
  REPORT="$TASK_DIR/chain_$1.txt" PGDATABASE="$1" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$2" | tail -1
  if [[ "${3:-}" == fixture ]]; then
    "${PSQL[@]}" -d "$1" -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
  fi
}
copy_db() { createdb -T "$1" "$2"; }

# ---------------------------------------------------------------- RED (pre-202)
build_chain "${P}_base" "$TASK_DIR/order201.txt" fixture
copy_db "${P}_base" "${P}_red"
(cd "$HERE" && psql -X -v ON_ERROR_STOP=1 -d "${P}_red" -f red.sql 2>&1 | tee "$TASK_DIR/red.out" | grep -E 'ERROR|M202_RED' )
grep -q 'M202_RED_REPRODUCED forged_gate_open=1 null_shadow=1 high_seq_shadow=1' "$TASK_DIR/red.out"
dropdb "${P}_red"

ACL_SQL="SELECT md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text,'') || p.proowner::regrole::text, ';' ORDER BY p.oid::regprocedure::text))
  FROM pg_proc p WHERE p.oid IN (
    to_regprocedure('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)'),
    to_regprocedure('public.rpc_set_material_issue_wo_statuses(uuid,text[])'),
    to_regprocedure('public.rpc_set_quality_policy(uuid,jsonb,bigint)'),
    to_regprocedure('public.rpc_get_quality_policy(uuid)'),
    to_regprocedure('public.create_role_from_template(uuid,uuid,character varying,uuid)'))"
ACL_BEFORE="$(q1 "${P}_base" "$ACL_SQL")"
BODY_SQL="SELECT md5(string_agg(md5(p.prosrc), ';' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p WHERE p.oid IN (
    to_regprocedure('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)'),
    to_regprocedure('public.rpc_set_material_issue_wo_statuses(uuid,text[])'),
    to_regprocedure('public.rpc_set_quality_policy(uuid,jsonb,bigint)'),
    to_regprocedure('public.rpc_get_quality_policy(uuid)'),
    to_regprocedure('public.create_role_from_template(uuid,uuid,character varying,uuid)'))"
BODY_BEFORE="$(q1 "${P}_base" "$BODY_SQL")"

# --------------------------------------------- preflight and atomicity controls
expect_refusal() { # $1 label, $2 db, $3 expected text
  local out
  if out="$("${PSQL[@]}" -d "$2" -f "$M202" 2>&1)"; then
    echo "CONTROL FAIL: $1 was not refused" >&2; exit 1
  fi
  if ! grep -qF "$3" <<<"$out"; then
    echo "CONTROL FAIL: $1 refused with the wrong error (wanted $3):" >&2; echo "$out" | head -3 >&2; exit 1
  fi
  echo "control ok: $1 refused ($3)"
}
cat > "$TASK_DIR/drift.tpl" <<'TPL'
DO $d$ DECLARE d text := pg_get_functiondef('__SIG__'::regprocedure);
BEGIN EXECUTE replace(d, E'\nBEGIN\n', E'\nBEGIN\n  -- drift\n'); END $d$;
TPL
apply_drift() { # $1 db, $2 signature: change one body by a comment line (prosrc md5 differs)
  sed "s|__SIG__|$2|" "$TASK_DIR/drift.tpl" | psql -X -v ON_ERROR_STOP=1 -q -d "$1" >/dev/null
}

build_chain "${P}_c200" "$TASK_DIR/order200.txt"
expect_refusal 'chain without M201' "${P}_c200" 'M202_REQUIRES_M201'

for sig in 'public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)' \
           'public.rpc_set_material_issue_wo_statuses(uuid,text[])' \
           'public.rpc_set_quality_policy(uuid,jsonb,bigint)' \
           'public.rpc_get_quality_policy(uuid)' \
           'public.create_role_from_template(uuid,uuid,character varying,uuid)'; do
  copy_db "${P}_base" "${P}_ctl"
  apply_drift "${P}_ctl" "$sig"
  expect_refusal "post-201 body drift of $sig" "${P}_ctl" "M202_UNEXPECTED_M201_BODY"
  dropdb "${P}_ctl"
done
# The pre-201 (M199) text of the two quality functions M201 replaced must be refused too.
python3 - "$TASK_DIR" <<'PY'
import re, sys, pathlib
d = pathlib.Path(sys.argv[1])
src = pathlib.Path('sql/migrations/199_manufacturing_quality_control.sql').read_text()
for name, fn in (('rpc_get_quality_policy', 'public.rpc_get_quality_policy'),
                 ('rpc_set_quality_policy', 'public.rpc_set_quality_policy')):
    m = re.search(r"CREATE FUNCTION " + re.escape(fn) + r"\(.*?\$fn\$;", src, re.S)
    assert m, name
    (d / f'pre201_{name}.sql').write_text(m.group(0).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1) + '\n')
PY
for name in rpc_get_quality_policy rpc_set_quality_policy; do
  copy_db "${P}_base" "${P}_ctl"
  psql -X -v ON_ERROR_STOP=1 -qf "$TASK_DIR/pre201_$name.sql" -d "${P}_ctl" >/dev/null
  expect_refusal "pre-201 (M199) body of $name re-installed" "${P}_ctl" "M202_UNEXPECTED_M201_BODY"
  dropdb "${P}_ctl"
done
for sig in 'public.rpc_record_quality_inspection(uuid,uuid,jsonb)' \
           'public.rpc_list_quality_inspections(uuid,uuid,integer)'; do
  copy_db "${P}_base" "${P}_ctl"
  apply_drift "${P}_ctl" "$sig"
  expect_refusal "M199 body drift of $sig" "${P}_ctl" "M202_UNEXPECTED_M199_BODY"
  dropdb "${P}_ctl"
done
copy_db "${P}_base" "${P}_ctl"
apply_drift "${P}_ctl" 'wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)'
expect_refusal 'M199 body drift of the evaluator' "${P}_ctl" 'M202_UNEXPECTED_M199_BODY'
dropdb "${P}_ctl"
copy_db "${P}_base" "${P}_ctl"
psql -X -qc 'REVOKE USAGE ON SCHEMA public FROM PUBLIC' -d "${P}_ctl"
expect_refusal 'public schema without PUBLIC USAGE' "${P}_ctl" 'M202_PUBLIC_SCHEMA_USAGE_REQUIRED'
dropdb "${P}_ctl"
copy_db "${P}_base" "${P}_ctl"
psql -X -qc 'GRANT SELECT ON public.quality_inspections TO authenticated' -d "${P}_ctl"
expect_refusal 'authenticated holds a table privilege' "${P}_ctl" 'M202_REQUIRES_M199'
dropdb "${P}_ctl"

# Atomicity: a graph that is already open fails the postflight; nothing may remain.
copy_db "${P}_base" "${P}_ctl"
psql -X -qc "CREATE FUNCTION public.zz_pre() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN RETURN NEW; END \$f\$;
  CREATE TRIGGER zz_pre BEFORE INSERT ON public.quality_inspections FOR EACH ROW EXECUTE FUNCTION public.zz_pre()" -d "${P}_ctl"
expect_refusal 'a pre-existing INSERT trigger opens the graph (postflight)' "${P}_ctl" 'QC_EXECUTION_GRAPH_OPEN_202: INSERT_TRIGGERS'
[[ "$(q1 "${P}_ctl" "SELECT (SELECT count(*) FROM pg_roles WHERE rolname='wardah_qc_entry_202') + (to_regclass('wardah_internal.qc_entry_markers_202') IS NOT NULL)::int + (to_regclass('wardah_internal.quality_supersessions_202') IS NOT NULL)::int + (to_regprocedure('public.rpc_supersede_quality_evidence_202(uuid,text,uuid,integer,text)') IS NOT NULL)::int")" == 0 ]] \
  || { echo 'CONTROL FAIL: failed 202 left objects behind' >&2; exit 1; }
[[ "$(q1 "${P}_ctl" "SELECT has_table_privilege('service_role','public.quality_inspections','INSERT')::int + (md5(prosrc)='499045298cf48632bd79325494307994')::int FROM pg_proc WHERE oid='public.rpc_record_quality_inspection(uuid,uuid,jsonb)'::regprocedure")" == 2 ]] \
  || { echo 'CONTROL FAIL: failed 202 changed the M199 state' >&2; exit 1; }
echo 'control ok: failed 202 rolled back completely (no role, tables or functions; service_role ACL and M199 body untouched)'
dropdb "${P}_ctl"
# Re-run and pre-existing role.
copy_db "${P}_base" "${P}_ctl"
"${PSQL[@]}" -d "${P}_ctl" -f "$M202" >/dev/null
expect_refusal 'second application' "${P}_ctl" 'M202_ALREADY_APPLIED'
dropdb "${P}_ctl"
psql -X -qc 'DROP ROLE IF EXISTS wardah_qc_entry_202' -d postgres
copy_db "${P}_base" "${P}_ctl"
psql -X -qc 'CREATE ROLE wardah_qc_entry_202 NOLOGIN' -d postgres
expect_refusal 'role already present in the cluster' "${P}_ctl" 'M202_ALREADY_APPLIED'
psql -X -qc 'DROP ROLE wardah_qc_entry_202' -d postgres
dropdb "${P}_ctl"
echo 'M202_PREFLIGHT_CONTROLS_PASS'

# ------------------------------------------------------------ apply 202 (GREEN)
"${PSQL[@]}" -d "${P}_base" -f "$M202"
[[ "$(q1 "${P}_base" "$ACL_SQL")" == "$ACL_BEFORE" ]] || { echo 'FAIL: ACL/owner of the five M201 functions changed' >&2; exit 1; }
[[ "$(q1 "${P}_base" "$BODY_SQL")" == "$BODY_BEFORE" ]] || { echo 'FAIL: a body of the five M201 functions changed' >&2; exit 1; }
echo 'M202_M201_FUNCTIONS_UNCHANGED owner+ACL+body of all five identical before and after'
copy_db "${P}_base" "${P}_acc"
(cd "$HERE" && psql -X -v ON_ERROR_STOP=1 -d "${P}_acc" -f acceptance.sql 2>&1 | tee "$TASK_DIR/acc.out" | grep -E 'ERROR|ACCEPTANCE_PASS')
grep -q 'M202_QC_PRIVILEGED_WRITE_CLOSURE_ACCEPTANCE_PASS' "$TASK_DIR/acc.out"
echo "acceptance assertions: $(grep -c 'NOTICE:  ok ' "$TASK_DIR/acc.out")"
dropdb "${P}_acc"
psql -X -v ON_ERROR_STOP=1 -d postgres -f "$HERE/owner_switch_mechanics.sql" 2>&1 | grep -E 'ERROR|MECHANICS'

# ------------------------------------------------ regression: the M199 suite (70)
# The M199 suite pins the M199-era chain. Two expectations are stale for a reason
# unrelated to 202 and one is changed by 202 on purpose; both are patched on a copy:
#  1. M201 changed the non-admin policy-write denial from NOT_ORG_ADMIN;
#  2. a legacy-numbering row was seeded by a direct owner INSERT, which 202 refuses
#     by design — the seed disables the guard exactly as pre-202 data would exist.
mkdir -p "$TASK_DIR/r/docs/db/quality-control-199" "$TASK_DIR/r/docs/db/manufacturing-inventory-red-20260925"
cp docs/db/manufacturing-inventory-red-20260925/_helpers.sql "$TASK_DIR/r/docs/db/manufacturing-inventory-red-20260925/"
python3 - "$TASK_DIR/r/docs/db/quality-control-199/acceptance.sql" <<'PY'
import sys, pathlib
s = pathlib.Path('docs/db/quality-control-199/acceptance.sql').read_text()
a = "'NOT_ORG_ADMIN', 'non-admin cannot change policy'"
assert s.count(a) == 1
s = s.replace(a, "'MANUFACTURING_SETTINGS_UPDATE_DENIED', 'non-admin cannot change policy'")
a = """INSERT INTO public.quality_inspections(org_id, mo_id, inspection_number, inspection_type, result)
VALUES (pg_temp.org(), (SELECT id FROM m WHERE k='born_qc'),
        'QI-' || lpad((SELECT v FROM s WHERE k='next')::bigint::text, 6, '0'), 'RANDOM', 'PASS');"""
assert s.count(a) == 1
s = s.replace(a, "ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202;\n" + a
              + "\nALTER TABLE public.quality_inspections ENABLE ALWAYS TRIGGER qc_write_guard_202;")
pathlib.Path(sys.argv[1]).write_text(s)
PY
copy_db "${P}_base" "${P}_reg"
psql -X -v ON_ERROR_STOP=1 -d "${P}_reg" -f "$TASK_DIR/r/docs/db/quality-control-199/acceptance.sql" 2>&1 | tee "$TASK_DIR/reg.out" | grep -E 'ERROR' || true
[[ "$(grep -c 'NOTICE:  ok ' "$TASK_DIR/reg.out")" == 70 ]] || { echo 'FAIL: M199 regression is not 70/70' >&2; exit 1; }
echo 'M202_M199_REGRESSION_PASS 70/70'
dropdb "${P}_reg"

# ------------------------------------------- regression: M200/M201 suites on the 202 chain
for f in acceptance_201_manufacturing_settings_permissions.sql:MFG_SETTINGS_201_ACCEPTANCE_PASS \
         acceptance_200_201_contract_claims.sql:CLAIMS_200_201_PASS \
         acceptance_200_gl_event_mapping_write_closure.sql:GL_EVENT_200_ACCEPTANCE_PASS; do
  copy_db "${P}_base" "${P}_reg"
  psql -X -v ON_ERROR_STOP=1 -d "${P}_reg" -f "scripts/ci/fresh-db/${f%%:*}" > "$TASK_DIR/reg_${f%%:*}.out" 2>&1 || true
  grep -q "${f##*:}" "$TASK_DIR/reg_${f%%:*}.out" \
    || { echo "FAIL: ${f%%:*} did not pass on the 202 chain" >&2; tail -5 "$TASK_DIR/reg_${f%%:*}.out" >&2; exit 1; }
  echo "regression ok: ${f%%:*}"
  dropdb "${P}_reg"
done
PGDATABASE="${P}_base" bash scripts/ci/fresh-db/selftest_definer_guard_contract.sh >/dev/null
echo 'regression ok: DEFINER guard contract self-test'

# ------------------------------------------------------------------ concurrency
copy_db "${P}_base" "${P}_conc"
python3 "$HERE/concurrency.py" "${P}_conc" | tee "$TASK_DIR/conc.out" | tail -3
grep -q M202_CONCURRENCY_PASS "$TASK_DIR/conc.out"
echo 'GREEN_M202_QC_PRIVILEGED_WRITE_CLOSURE'
