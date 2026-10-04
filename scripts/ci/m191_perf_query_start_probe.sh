#!/usr/bin/env bash
# M191 performance harness pre-flight: prove on the benchmark's own disposable
# PostgreSQL server that pg_stat_activity (pid, query_start) is a reliable
# identity for one measured RPC call before the per-call Lock-wait attribution
# in m191_perf_report.py relies on it. Fails closed on any violation.
#
# Proves:
#   P1  sequential statements on one persistent session each receive a distinct,
#       strictly increasing query_start equal to that statement's
#       statement_timestamp() (microsecond resolution suffices even for trivial
#       back-to-back statements);
#   P2  query_start stays constant for the whole time one statement waits on a
#       row lock;
#   P3  the next statement on the same backend never inherits the previous
#       statement's query_start, even when it too waits on a row lock;
#   P4  two backends with an identical application_name remain distinct by pid;
#   P5  the sampler's own backend never appears in the Lock-wait samples even
#       when it carries the very same application_name as the waiters.
# Disposable PostgreSQL only. Never connects to Production or Staging.
set -Eeuo pipefail

DB=${1:?database name required}
OUT=${2:?output directory required}
SAMPLE_INTERVAL=${M191_PERF_SAMPLE_INTERVAL:-0.02}
export PGDATABASE="$DB"
PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
mkdir -p "$OUT"
rm -f "$OUT/held"
APP=m191perf-probe-identical-application-name

fail() { echo "M191_QUERY_START_PROBE_FAIL: $*" >&2; exit 1; }
us_now() { echo "(extract(epoch FROM statement_timestamp())*1000000)::bigint"; }

"${PSQL[@]}" -c "
DROP TABLE IF EXISTS public.zz_m191_qs_probe;
CREATE TABLE public.zz_m191_qs_probe(id integer PRIMARY KEY, v integer NOT NULL);
INSERT INTO public.zz_m191_qs_probe VALUES (1,0);"

# ---- P1: trivial back-to-back statements on one persistent session ----------
{
  for _ in $(seq 1 500); do
    echo "SELECT (extract(epoch FROM query_start)*1000000)::bigint || '|' || $(us_now) FROM pg_stat_activity WHERE pid=pg_backend_pid();"
  done
} >"$OUT/p1.sql"
"${PSQL[@]}" -f "$OUT/p1.sql" >"$OUT/p1.out"
[[ "$(wc -l <"$OUT/p1.out")" -eq 500 ]] || fail "P1 expected 500 rows"
awk -F'|' '
  $1 != $2 { print "P1 query_start " $1 " <> statement_timestamp " $2; bad=1 }
  NR > 1 && $1 <= prev { print "P1 query_start not strictly increasing: " prev " -> " $1; bad=1 }
  { prev=$1 }
  END { exit bad }' "$OUT/p1.out" || fail "P1 sequential query_start identity violated"

# ---- P2-P5: blocked statements sampled by the harness-format sampler --------
cat >"$OUT/sampler.sql" <<SQL
\pset tuples_only on
\pset format unaligned
SELECT 'SAMPLER_PID' || E'\t' || pg_backend_pid();
SELECT 'T' || E'\t' || (extract(epoch FROM clock_timestamp())*1000000)::bigint
UNION ALL
SELECT 'L' || E'\t' || (extract(epoch FROM clock_timestamp())*1000000)::bigint || E'\t' ||
  application_name || E'\t' || pid::text || E'\t' ||
  coalesce((extract(epoch FROM query_start)*1000000)::bigint::text,'') || E'\t' ||
  coalesce(wait_event_type,'') || E'\t' || coalesce(wait_event,'') || E'\t' ||
  coalesce(array_to_string(pg_blocking_pids(pid),','),'')
FROM pg_stat_activity
WHERE application_name = '$APP'
  AND state='active'
  AND wait_event_type='Lock';
\watch $SAMPLE_INTERVAL
SQL
PGAPPNAME="$APP" "${PSQL[@]}" -f "$OUT/sampler.sql" >"$OUT/locks.tsv" 2>"$OUT/sampler.err" &
sampler=$!
for _ in $(seq 1 250); do
  grep -q $'^T\t' "$OUT/locks.tsv" 2>/dev/null && break
  kill -0 "$sampler" 2>/dev/null || fail "sampler exited early"
  sleep 0.02
done
grep -q $'^T\t' "$OUT/locks.tsv" || fail "sampler produced no tick"

hold() { # hold row 1 for $1 seconds in its own transaction
  "${PSQL[@]}" -c "BEGIN; SELECT 1 FROM public.zz_m191_qs_probe WHERE id=1 FOR UPDATE; SELECT pg_sleep($1); COMMIT;" >/dev/null
}

# Holder A holds the row; waiter W runs: B (blocked), then C (blocked by a
# later holder). A second waiter W2 with the SAME application_name queues
# behind W on statement B, so W2 is a distinct backend with identical name.
hold 0.40 & ha=$!
sleep 0.10
cat >"$OUT/waiter.sql" <<SQL
SELECT 'A|' || pg_backend_pid() || '|' || $(us_now);
UPDATE public.zz_m191_qs_probe SET v=v+1 WHERE id=1 RETURNING 'B|' || pg_backend_pid() || '|' || $(us_now);
\! bash -c 'for _ in \$(seq 1 1000); do [ -f "$OUT/held" ] && exit 0; sleep 0.01; done; exit 1'
UPDATE public.zz_m191_qs_probe SET v=v+1 WHERE id=1 RETURNING 'C|' || pg_backend_pid() || '|' || $(us_now);
SQL
PGAPPNAME="$APP" "${PSQL[@]}" -f "$OUT/waiter.sql" >"$OUT/waiter.out" & wt=$!
sleep 0.05
PGAPPNAME="$APP" "${PSQL[@]}" -c "UPDATE public.zz_m191_qs_probe SET v=v+1 WHERE id=1 RETURNING 'D|' || pg_backend_pid() || '|' || $(us_now);" >"$OUT/waiter2.out" & w2=$!
wait "$ha"
# Waiter statement C must block on a fresh holder: the waiter pauses after B
# until this second holder owns the row, so C deterministically waits.
"${PSQL[@]}" -f - >/dev/null <<SQL & hb=$!
BEGIN;
SELECT 1 FROM public.zz_m191_qs_probe WHERE id=1 FOR UPDATE;
\\! touch '$OUT/held'
SELECT pg_sleep(0.30);
COMMIT;
SQL
wait "$wt" "$w2" "$hb"
sleep 0.10
kill "$sampler" 2>/dev/null || true
wait "$sampler" 2>/dev/null || true
if grep -qiE '(^|: )(ERROR|FATAL):' "$OUT/sampler.err"; then cat "$OUT/sampler.err" >&2; fail "sampler error"; fi

python3 - "$OUT" <<'PY'
import sys
from collections import defaultdict
out = sys.argv[1]
calls = {}
for f in ("waiter.out", "waiter2.out"):
    for line in open(f"{out}/{f}"):
        line = line.strip()
        if "|" in line:
            tag, pid, qs = line.split("|")
            calls[tag] = (int(pid), int(qs))
if set(calls) != {"A", "B", "C", "D"}:
    sys.exit(f"M191_QUERY_START_PROBE_FAIL: missing call markers {sorted(calls)}")
samples = defaultdict(list)
sampler_pid = None
for raw in open(f"{out}/locks.tsv"):
    parts = raw.rstrip("\n").split("\t")
    if parts[0] == "SAMPLER_PID":
        sampler_pid = int(parts[1])
    if parts[0] != "L":
        continue
    if len(parts) != 8 or not parts[4]:
        sys.exit(f"M191_QUERY_START_PROBE_FAIL: malformed sample {raw!r}")
    samples[(int(parts[3]), int(parts[4]))].append(parts)
by_call = {tag: samples.get(ident, []) for tag, ident in calls.items()}
wpid = calls["A"][0]
problems = []
if sampler_pid is None:
    problems.append("P5 sampler pid not recorded")
elif any(pid == sampler_pid for pid, _ in samples):
    problems.append("P5 sampler backend appeared in Lock-wait samples")
if not (calls["A"][0] == calls["B"][0] == calls["C"][0]):
    problems.append("P3 waiter statements did not share one backend")
if not (calls["A"][1] < calls["B"][1] < calls["C"][1]):
    problems.append("P3 sequential statements did not receive increasing query_start")
if calls["D"][0] == wpid:
    problems.append("P4 second waiter unexpectedly shares the first backend")
if len(by_call["B"]) < 5:
    problems.append(f"P2 statement B expected >=5 Lock samples, got {len(by_call['B'])}")
if len(by_call["C"]) < 3:
    problems.append(f"P3 statement C expected >=3 Lock samples, got {len(by_call['C'])}")
if len(by_call["D"]) < 3:
    problems.append(f"P4 same-name backend expected >=3 Lock samples, got {len(by_call['D'])}")
if by_call["A"]:
    problems.append("P3 non-blocking statement A was attributed Lock samples")
attributed = sum(len(v) for v in by_call.values())
total = sum(len(v) for v in samples.values())
if attributed != total:
    problems.append(f"P2/P5 {total - attributed} Lock samples matched no known statement identity")
for tag in ("B", "C", "D"):
    apps = {s[2] for s in by_call[tag]}
    if apps != {"m191perf-probe-identical-application-name"}:
        problems.append(f"P4 unexpected application names for {tag}: {apps}")
    for s in by_call[tag]:
        if int(s[1]) < calls[tag][1]:
            problems.append(f"{tag} sample precedes its statement start")
blockers_b = {s[7] for s in by_call["B"]} | {s[7] for s in by_call["D"]}
if problems:
    sys.exit("M191_QUERY_START_PROBE_FAIL: " + "; ".join(problems))
print(
    "M191_QUERY_START_PROBE_OK "
    f"sequential_distinct=500 B_samples={len(by_call['B'])} "
    f"C_samples={len(by_call['C'])} D_samples={len(by_call['D'])} "
    f"blocker_sets_seen={sorted(blockers_b)}"
)
PY

"${PSQL[@]}" -c "DROP TABLE public.zz_m191_qs_probe;"
