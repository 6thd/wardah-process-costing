#!/usr/bin/env bash
# Reproduce existing gaps only on an explicitly disposable loopback PG17 cluster.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
verify_sources() {
  python3 - "$ROOT" "$HERE/SOURCE_LOCK.json" <<'PY'
import hashlib
import json
from pathlib import Path
import sys
root=Path(sys.argv[1])
lock=json.loads(Path(sys.argv[2]).read_text())
if lock['main']!='3d01f99fae2fb294fa0586084c32f0cd6bdf21fe' or len(lock['sources'])!=44:
    raise SystemExit('REFUSED: source manifest identity')
expected_baselines={p for p in lock['sources'] if p.startswith('sql/baseline/000_schema_baseline_') and p.endswith('.sql')}
actual_baselines={p.relative_to(root).as_posix() for p in (root/'sql/baseline').glob('000_schema_baseline_*.sql')}
if actual_baselines!=expected_baselines:
    raise SystemExit('REFUSED: baseline candidate set drift')
for path,expected in lock['sources'].items():
    relative=Path(path)
    if relative.is_absolute() or '..' in relative.parts:
        raise SystemExit('REFUSED: source path outside root: '+path)
    if any((root/Path(*relative.parts[:index])).is_symlink() for index in range(1,len(relative.parts)+1)):
        raise SystemExit('REFUSED: symlinked source component: '+path)
    if (root/path).is_symlink() or not (root/path).is_file():
        raise SystemExit('REFUSED: reviewed source is not a regular file: '+path)
    if hashlib.sha256((root/path).read_bytes()).hexdigest()!=expected:
        raise SystemExit('REFUSED: reviewed source drift: '+path)
print('QC_REVIEW_SOURCES_PASS files=44')
PY
}
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" =~ ^[0-9]{5}$ ]] || { echo 'REFUSED: explicit loopback/port required' >&2; exit 2; }
((10#$PGPORT >= 55000 && 10#$PGPORT <= 65535)) || { echo 'REFUSED: disposable port bound' >&2; exit 2; }
for name in DATABASE_URL SUPABASE_DB_URL PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS; do
  [[ -z "${!name:-}" ]] || { echo "REFUSED: $name configured" >&2; exit 2; }
done
verify_sources
[[ "$(psql -X -d postgres -Atc 'SHOW server_version_num')" == 17* ]] || { echo 'REFUSED: requires PG17' >&2; exit 2; }
[[ "$(psql -X -d postgres -Atc 'SHOW server_encoding')" == UTF8 ]] || { echo 'REFUSED: requires UTF8' >&2; exit 2; }
DB="wardah_qc_privileged_199_$$"
OUT="$(mktemp -d)"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap cleanup EXIT
cd "$ROOT"
PAIR="$(bash scripts/ci/fresh-db/resolve_baseline_pair.sh sql/baseline 190)"
field() { printf '%s\n' "$PAIR" | sed -n "s/^$1=//p"; }
[[ "$(field BASELINE_CUTOFF)" == 189 ]] || { echo 'REFUSED: cutoff drift' >&2; exit 2; }
createdb "$DB"
export PGDATABASE="$DB"
PSQL=(psql -X -v ON_ERROR_STOP=1)
"${PSQL[@]}" -q -f scripts/ci/fresh-db/supabase_shim.sql >/dev/null
"${PSQL[@]}" -q -f "$(field BASELINE_PATH)" >"$OUT/baseline.txt" 2>&1
"${PSQL[@]}" -q -f "$(field REFERENCE_PATH)" >/dev/null
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 >"$OUT/all.txt"
sed -n '1,/^199_manufacturing_quality_control.sql$/p' "$OUT/all.txt" >"$OUT/order.txt"
[[ "$(cut -d_ -f1 "$OUT/order.txt" | paste -sd,)" == 190,191,192,193,194,195,196,197,198,199 ]] || { echo 'REFUSED: chain drift' >&2; exit 2; }
REPORT="$OUT/chain.txt" bash scripts/ci/fresh-db/run_chain.sh sql/migrations "$OUT/order.txt"
"${PSQL[@]}" -q -f docs/db/manufacturing-inventory-red-20260925/00_fixture.sql >/dev/null
"${PSQL[@]}" -f docs/db/quality-control-199/acceptance.sql >"$OUT/acceptance.txt" 2>&1
[[ "$(rg -c 'NOTICE:  ok  ' "$OUT/acceptance.txt")" == 70 ]] || { cat "$OUT/acceptance.txt"; exit 1; }
echo 'QC_ORIGINAL_ACCEPTANCE_PASS assertions=70'
"${PSQL[@]}" -v qc_mutate_insert=false -v qc_mutate_truncate=false -f "$HERE/privileged_red.sql"
for mutation in insert truncate; do
  insert=false; truncate=false
  if [[ "$mutation" == insert ]]; then insert=true; else truncate=true; fi
  if "${PSQL[@]}" -v "qc_mutate_insert=$insert" -v "qc_mutate_truncate=$truncate" -f "$HERE/privileged_red.sql" >"$OUT/$mutation.txt" 2>&1; then
    echo "FAIL: $mutation mutant survived" >&2; exit 1
  fi
  expected=SERVICE_ROLE_INSERT
  if [[ "$mutation" == truncate ]]; then expected=TRUNCATE_GUARD; fi
  rg -q "QC_PRIVILEGED_RED_MISSING: $expected" "$OUT/$mutation.txt" || { cat "$OUT/$mutation.txt"; exit 1; }
done
echo 'QC_PRIVILEGED_NONVACUITY_PASS insert_revoked=refused truncate_guard_removed=caught'
"${PSQL[@]}" -c 'BEGIN; REVOKE INSERT ON public.quality_inspections FROM service_role' \
  -f docs/db/quality-control-199/acceptance.sql >"$OUT/candidate.txt" 2>&1
[[ "$(rg -c 'NOTICE:  ok  ' "$OUT/candidate.txt")" == 70 ]] || { cat "$OUT/candidate.txt"; exit 1; }
echo 'QC_CANDIDATE_REVOKE_POSITIVES_PASS assertions=70 rollback=true'
[[ "$("${PSQL[@]}" -Atc "SELECT has_table_privilege('service_role','public.quality_inspections','INSERT')")" == t ]]
python3 "$HERE/pause_revoke.py" "$DB"
"${PSQL[@]}" -f scripts/ci/fresh-db/acceptance_195_legacy_mo_quarantine.sql >"$OUT/quarantine.txt" 2>&1
rg -q 'M195_198_LEGACY_MO_QUARANTINE_PASS' "$OUT/quarantine.txt" || { cat "$OUT/quarantine.txt"; exit 1; }
echo 'QC_REVIEW_QUARANTINE_PASS probes=72'
[[ "$("${PSQL[@]}" -Atc 'SELECT count(*) FROM public.quality_inspections')" == 0 ]]
verify_sources
echo 'QC_PRIVILEGED_REVIEW_REPRODUCED chain=10 original=70 red=2 controls=2 identity=simulated release_ready=false'
