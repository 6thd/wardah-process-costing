# M191 — Pre-Production Performance Characterization

**Status:** authoritative evidence is run `36191681776` on benchmark head
`260b540dfbd50245b8e0ef27e94e5a986958adea` (see the last section:
durable pooled p50 plus per-call sampled Lock attribution). Fresh
independent closure review pending. Run `36157102264` remains documented as
the prior corrected run. Runs through benchmark head
`1b0d4b77a44f2344c0136a145ad1b740144e8406` are diagnostic only and must not
be used for the owner rollout decision.

**Authority:** docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md section 8.

**Production/Staging:** not used. Evidence is produced only on disposable
PostgreSQL 17 databases in one GitHub Actions runner.

## Final measurement method

The final workflow runs **four repetitions**, each with a new pair of databases
built in the same PostgreSQL 17 service:

- pre191: baseline 189 + Migration 190;
- post191: the identical chain plus Migration 191.

To reduce simple runner/cache ordering bias, the measurement order is balanced:

- repetitions 1 and 3: pre191 -> post191;
- repetitions 2 and 4: post191 -> pre191.

Each repetition uses:

- 4 persistent psql workers;
- 200 measured iterations per worker;
- 10 excluded warm-up iterations per worker;
- 20 ms Lock-wait sampling.

That yields **3,200 measured calls per workload per state**, while preserving
raw results per repetition so runner noise can be inspected.

## Workloads

1. core_hot_same_warehouse — same product and same bin.
2. core_hot_multiwarehouse — same product, separate bin per worker. This is
   the product-row/product-projection lock-wait proxy because no bin is shared.
3. core_distinct_sku — separate product/bin per worker; parallelism control.
4. outgoing_hot_same_warehouse — canonical outgoing stock helper.
5. manual_movement_hot_same_warehouse — real manual movement RPC.
6. goods_receipt_hot_same_warehouse — real Goods Receipt RPC.
7. manufacturing_consumption_hot_same_warehouse — real M190/M191 consumption
   RPC with one MO/reservation per worker, avoiding a shared-MO header bottleneck.

## Measurements

For both states and every workload the report records pooled operations/sec,
pooled p50/p95/p99/max latency, per-repetition throughput/p50/p95 ranges,
sampled Lock-wait time normalized per 100 operations, the worst observed
per-call sampled Lock-wait estimate (from benchmark head `260b540`), and the
longest consecutive same-backend sampled Lock-wait streak.

The lock numbers are sampling estimates, not exact PostgreSQL wait accounting.
The streak metric groups consecutive Lock samples for one backend and may span
multiple statements, wait-event types and blocking backends. It is **not** the
duration of one lock wait or one SQL statement. Raw samples retain application
name, backend PID, wait event and pg_blocking_pids output.

## Fail-closed execution

The harness fails on any RPC/worker error, timeout, 40P01/deadlock, setup
failure or timed-call count mismatch.

Every workload now snapshots its target stock state before warm-up and asserts
after execution the exact expected bin quantity/value delta, stock-queue
quantity/value delta, SLE row-count delta, SLE quantity delta and SLE
stock-value-difference delta. Queue totals must equal bin totals for these
positive rate-10 fixtures. Product projection must equal summed bins except for
the single explicitly bounded pre-191 hot-multiwarehouse projection defect.

The workflow also records and compares pre/post starting cardinalities for
products, bins, reservations and SLE rows for every workload.

One baseline exception is deliberate: pre-191 core_hot_multiwarehouse is the
known lost-product-projection race that M191 fixes. Its product-vs-bin gap is
recorded rather than required to pass GREEN reconciliation. Negative stock or
any unrelated invariant failure still fails the run. The deterministic M191 RED
suite remains the proof; this benchmark does not depend on scheduler luck.

## Earlier diagnostic evidence — not the final gate

Successful pilot workflow run: 36132439989.

The 120-call/workload pilot showed:

- distinct-SKU throughput essentially unchanged (+0.7%);
- hot-SKU multiwarehouse throughput -30.4%;
- hot-SKU multiwarehouse p95 4.257 ms -> 11.651 ms;
- sampled lock-wait proxy 60 ms -> 300 ms;
- smaller/moderate deltas on outgoing, manual movement and manufacturing
  consumption;
- a noisy Goods Receipt p95 increase despite essentially unchanged throughput.

Those figures justify the larger balanced run; they are not used alone as the
Production decision.

## Decision semantics

No arbitrary percentage threshold is invented because Wardah has no established
SLO for these RPCs.

A material regression must be quantified and reviewed before Production. An
unexplained lock-wait/latency regression remains a rollout blocker until
understood. The remedy may not be to weaken M191's correctness lock contract
without a separately reviewed design.

After the final workflow succeeds, this document must be updated with the exact
run ID, artifact digest, pooled table and interpretation, then receive
independent review before section 8 is classified as closed.

This document and workflow do not authorize Production or Staging mutation.


## Independent review correction

The first balanced run on `2359d0bd64269a06d4cda1f2fda57536362c644d`
completed, but an independent reviewer correctly identified a P1 benchmark
acceptance gap: a workload could have left bins/product projection internally
consistent while SLE/value/queue effects were incomplete. The same review also
required durable fixture cardinalities and final-run metadata in this document.

The harness has therefore been hardened before any final rerun. The prior
balanced numbers remain diagnostic only. A new exact-head run must succeed with
the stronger effect accounting before section 8 can be considered for closure.

## Superseded characterization — diagnostic evidence only

The final benchmark bytes were frozen at:

`1b0d4b77a44f2344c0136a145ad1b740144e8406`

That head includes the fail-closed lock-sampler health fix and the workflow
trigger correction that prevents a later evidence-only Markdown update from
recursively creating a new benchmark run.

Final workflow:

- run: `36149385284`
- result: **SUCCESS**
- artifact: `10869779961`
- artifact digest:
  `sha256:06cc4dc025c99caf7d8c72db454f3fb2e3223866a66fc8f72fa4615afa05809a`
- PostgreSQL server: **17.11**
- environment: disposable GitHub Actions PostgreSQL only; no Production or
  Staging access.

The sampler is now fail-closed: the benchmark waits for an explicit
`M191_PERF_SAMPLER_READY` marker before starting measured workers, requires
the sampler process to remain alive through the measured window, and rejects
sampler connection/psql errors. A legitimate zero Lock-wait result is therefore
distinguishable from a sampler that never ran.

All four repetitions passed the stronger stock-effect accounting. Every
workload proved its expected bin quantity/value delta, queue quantity/value,
SLE row-count delta, SLE quantity delta, and SLE
`stock_value_difference` delta. The reporter also persisted workload-start
fixture cardinalities and required pre/post cardinality equality.

### Final pooled measurements

| Workload | Pre ops/s | Post ops/s | Delta ops/s | Pre p95 ms | Post p95 ms | Delta p95 | Pre p99 ms | Post p99 ms | Pre Lock ms/100 ops | Post Lock ms/100 ops |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| distinct SKU | 1177.76 | 1154.75 | -2.0% | 3.068 | 3.205 | +4.5% | 13.792 | 14.786 | 0.0 | 0.0 |
| hot SKU / multiwarehouse | 1004.51 | 672.04 | **-33.1%** | 4.291 | 7.726 | **+80.1%** | 14.906 | 23.076 | 105.0 | 297.5 |
| hot SKU / same warehouse | 729.21 | 661.73 | -9.3% | 7.061 | 8.742 | +23.8% | 18.898 | 23.512 | 282.5 | 280.0 |
| Goods Receipt | 138.06 | 135.35 | -2.0% | 38.695 | 40.777 | +5.4% | 90.083 | 93.356 | 2005.0 | 2077.5 |
| manual movement | 654.42 | 600.99 | -8.2% | 8.122 | 9.749 | +20.0% | 23.236 | 32.067 | 290.0 | 335.0 |
| manufacturing consumption | 430.75 | 371.33 | -13.8% | 17.765 | 15.944 | -10.3% | 44.171 | 52.517 | 460.0 | 617.5 |
| outgoing | 674.26 | 630.84 | -6.4% | 7.441 | 8.609 | +15.7% | 25.927 | 27.387 | 315.0 | 320.0 |

The superseded run's longest consecutive same-backend sampled Lock-wait streak
for the post-191 hot-multiwarehouse proxy was **200 ms**. This was a sampling
streak that could span multiple statements/blockers, **not** a single 200 ms
lock wait.

### Repeat-to-repeat envelope

The dominant hot-multiwarehouse delta was reproducible across all four fresh
pairs:

- pre throughput: **987.81–1026.53 ops/s**
- post throughput: **642.50–708.03 ops/s**
- pre p95: **3.945–4.575 ms**
- post p95: **6.762–8.833 ms**

The distinct-SKU control retained parallelism:

- pre throughput: **1152.20–1199.50 ops/s**
- post throughput: **1083.01–1198.17 ops/s**
- sampled Lock wait: **0 ms/100 operations in both states**

### Fixture cardinalities

| Workload | Org products | Org bins | Target products | Target bins | Org reservations | Target reservations | Org SLE rows | Target SLE rows |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| distinct SKU | 6 | 9 | 4 | 4 | 0 | 0 | 480 | 0 |
| hot SKU / multiwarehouse | 6 | 9 | 1 | 4 | 0 | 0 | 240 | 0 |
| hot SKU / same warehouse | 6 | 9 | 1 | 1 | 0 | 0 | 0 | 0 |
| Goods Receipt | 2 | 2 | 1 | 1 | 0 | 0 | 0 | 0 |
| manual movement | 6 | 9 | 1 | 1 | 0 | 0 | 960 | 480 |
| manufacturing consumption | 3 | 2 | 1 | 1 | 4 | 4 | 0 | 0 |
| outgoing | 6 | 9 | 1 | 1 | 0 | 0 | 720 | 240 |

These are intentionally small deterministic CI fixtures, not a claim to model
Production cardinality. Their purpose is same-runner before/after lock-cost
characterization under controlled contention.

### Interpretation requiring independent confirmation

The material regression is concentrated in
`core_hot_multiwarehouse`: one product is shared while each worker uses a
different bin. That is precisely the workload M191 intentionally changes from
warehouse-local concurrency to product-prefix serialization so the shared
product projection cannot race. The -33.1% throughput and +80.1% p95 are
therefore a measured cost of the correctness boundary, not an unexplained
cross-system slowdown.

The controls support that interpretation:

- distinct SKU remains close to baseline and has zero sampled Lock wait;
- Goods Receipt is close to flat;
- outgoing is a small/moderate delta;
- same-bin contention already serialized before M191 and changes much less
  than the same-product/different-bin proxy;
- manual movement is moderately slower;
- manufacturing consumption shows lower throughput but improved p95, with its
  ordered reservation-universe prepass and product prefix both included in the
  measured path.

The pre-191 hot-multiwarehouse lost-product-projection condition was observed
in **1/4** repetitions. This remains observational corroboration only; the
deterministic RED acceptance suite is the defect proof.

No percentage in this report is a newly invented SLO. The open review question
is whether the explained serialization cost is operationally acceptable for
Wardah's expected same-SKU cross-warehouse contention. The correctness lock
contract must not be weakened merely to improve these measurements.

### Gate disposition

**SUPERSEDED:** a later independent review found that the prior throughput
window included client connection/setup overhead and that warm-up occurred in
different psql sessions. The table above is retained for provenance only and
must not be used for the owner rollout decision.

A documentation-only persistence commit follows the benchmark head above. It
does not alter the harness, reporter, workflow execution logic, Migration 191,
or the measured artifact, and by design does not trigger a recursive benchmark
run.

No Production/Staging apply, rollout, or baseline regeneration is authorized
by this evidence.

## Second independent review remediation

A fresh external review of PR #258 at
`9399979e945b71b8d1fb87b0725cca817bf6f2b1` found one P2 in the benchmark
measurement boundary, not in Migration 191 itself. The earlier warm-up used
different psql connections from the measured calls, and the client wall clock
included fixed process/connection/session setup cost.

The remediation now uses one persistent psql session per worker for setup,
warm-up and measurement. After untimed warm-up, every worker waits at a barrier.
Measured latency starts only after that barrier, and throughput is derived from
server-side timestamps bracketing the measured SQL window. Lock-wait sampling
also starts after warm-up.

The product-projection proof is path-aware and discriminating:

- cost_price is seeded to a deliberately wrong sentinel before each workload,
  so a stale cost projection cannot pass by coincidence;
- incoming, manual-in and Goods Receipt must restore the derived cost_price and
  preserve products.stock_value, because incoming does not own that field;
- outgoing and manufacturing consumption must restore cost_price and reconcile
  products.stock_value to summed bin value;
- the known pre-191 hot-multiwarehouse exception relaxes stock_quantity only.

The reporter now fails closed unless the artifact declares the persistent
same-session model and the corrected server-clock measurement boundary.

The required four-repetition PostgreSQL 17 characterization has now completed
successfully on the corrected benchmark bytes. Its frozen evidence is recorded
below. Production and Staging remain untouched and out of scope.

## Prior corrected characterization (run 36157102264) — superseded as authoritative

> Superseded as the authoritative §8 evidence by run `36191681776` (last
> section), which adds durable pooled p50 and per-call Lock attribution on
> otherwise identical run shape, workloads and effect assertions. This run's
> artifact predates the per-call sampler format; its pooled p50 values,
> re-derived from the raw `Time:` samples of artifact `10874176137`
> (3,200 per workload/state), were pre/post: distinct SKU 1.365/1.385 ms,
> hot multiwarehouse 1.985/3.064 ms, hot same warehouse 2.927/3.054 ms,
> Goods Receipt 22.824/23.113 ms, manual movement 3.311/3.535 ms,
> manufacturing consumption 4.144/5.897 ms, outgoing 3.266/3.259 ms. They are
> recorded for provenance only; the durable p50 table below uses the new run.

**Benchmark/workflow head:**  
`e177503feb527c174653dfff4cf6aa281bdeedc5`

**Workflow run:** `36157102264` — **SUCCESS**  
**Artifact:** `10874176137`  
**Artifact digest:**  
`sha256:04acdf8fc984911392735c69e423400419e6d7e1740dfe732db1aa3320c2f224`

**PostgreSQL server:** 17.11  
**Scope:** disposable GitHub Actions databases only. Production and Staging
were not accessed.

All four fresh before/after repetitions, the pooled reporter, effect
reconciliation and artifact upload succeeded. The run shape was:

- 4 repetitions;
- fresh pre191/post191 database pair per repetition;
- balanced order: repetitions 1/3 pre->post, 2/4 post->pre;
- 4 persistent psql workers;
- **the same psql connection performs warm-up and measurement**;
- 10 untimed warm-up calls per worker;
- 200 measured calls per worker/repetition;
- **3,200 measured calls per workload/state** pooled;
- server-side measurement start/end timestamps after the warm-up barrier;
- 20 ms Lock-wait sampling begun only after warm-up;
- exact stock/SLE/queue and path-owned product-projection postconditions.

The prior setup/connection timing P2 is therefore removed from the measurement
boundary: process spawn, database connection, authentication/session SETs and
warm-up are excluded from throughput wall time and from measured latency.

The product-projection concern is also covered fail-closed:

- every workload validates `products.stock_quantity`;
- `products.cost_price` is seeded to a deliberately incorrect sentinel before
  each workload and must be restored to the rate freshly derived from bins;
- incoming/manual-in/Goods Receipt explicitly assert that
  `products.stock_value` is **preserved unchanged**, because canonical incoming
  deliberately does not own that field;
- outgoing and manufacturing consumption assert both the exact
  `products.stock_value` delta and equality with summed bin value;
- the pre-191 hot-multiwarehouse known-RED exception relaxes only
  `stock_quantity`, never valuation projections.

### Final pooled measurements

| Workload | Pre ops/s | Post ops/s | Delta ops/s | Pre p95 ms | Post p95 ms | Delta p95 | Pre p99 ms | Post p99 ms | Pre Lock ms/100 ops | Post Lock ms/100 ops |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| distinct SKU | 2541.37 | 2491.13 | -2.0% | 2.239 | 2.313 | +3.3% | 2.712 | 2.958 | 0.0 | 0.0 |
| hot SKU / multiwarehouse | 1876.58 | 1259.71 | **-32.9%** | 3.161 | 4.053 | **+28.2%** | 4.117 | 5.343 | 76.9 | 196.9 |
| hot SKU / same warehouse | 1310.37 | 1271.05 | -3.0% | 4.244 | 4.039 | -4.8% | 5.667 | 4.913 | 192.5 | 206.2 |
| Goods Receipt | 173.83 | 171.01 | -1.6% | 24.797 | 25.529 | +3.0% | 27.009 | 28.604 | 1676.2 | 1709.4 |
| manual movement | 1155.13 | 1094.65 | -5.2% | 4.664 | 4.696 | +0.7% | 6.416 | 5.562 | 221.2 | 235.6 |
| manufacturing consumption | 747.11 | 650.68 | -12.9% | 10.144 | 8.250 | -18.7% | 16.150 | 10.817 | 334.4 | 406.2 |
| outgoing | 1172.24 | 1185.11 | +1.1% | 4.393 | 4.165 | -5.2% | 5.938 | 5.064 | 228.1 | 208.1 |

The post-191 hot-multiwarehouse proxy's **longest consecutive same-backend
sampled Lock-wait streak was 400 ms**. This streak comprised consecutive
20 ms Lock samples and may span multiple statements, wait-event types and
blocking backends; it is **not a single 400 ms lock wait**.

For context, the largest single measured statement latency in that frozen
post-191 hot-multiwarehouse evidence was **11.866 ms**. A statement's measured
latency includes any lock waiting incurred by that call, so this is the
appropriate scale for a single measured operation. The 400 ms streak remains
useful only as a contention-persistence sampling signal.

### Repeat-to-repeat envelope

The corrected longer windows materially reduced the runner-noise problem that
appeared in the first short-window remediation run.

| Workload | Pre ops/s range | Post ops/s range | Pre p95 range ms | Post p95 range ms |
|---|---:|---:|---:|---:|
| distinct SKU | 2487.27–2573.19 | 2461.74–2530.24 | 2.203–2.261 | 2.253–2.349 |
| hot SKU / multiwarehouse | 1842.97–1917.53 | 1223.85–1281.22 | 3.031–3.224 | 3.920–4.124 |
| hot SKU / same warehouse | 1295.42–1319.84 | 1247.75–1284.61 | 3.850–4.622 | 3.952–4.411 |
| Goods Receipt | 171.84–177.00 | 164.72–174.57 | 23.993–25.842 | 24.419–27.756 |
| manual movement | 1116.24–1178.26 | 1079.99–1106.98 | 4.279–5.033 | 4.618–4.801 |
| manufacturing consumption | 699.28–766.40 | 601.73–691.63 | 9.637–11.662 | 7.097–9.513 |
| outgoing | 1146.97–1207.56 | 1159.20–1204.72 | 4.120–4.649 | 4.104–4.291 |

### Fixture cardinalities at workload start

| Workload | Org products | Org bins | Target products | Target bins | Org reservations | Target reservations | Org SLE rows | Target SLE rows |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| distinct SKU | 6 | 9 | 4 | 4 | 0 | 0 | 1680 | 0 |
| hot SKU / multiwarehouse | 6 | 9 | 1 | 4 | 0 | 0 | 840 | 0 |
| hot SKU / same warehouse | 6 | 9 | 1 | 1 | 0 | 0 | 0 | 0 |
| Goods Receipt | 2 | 2 | 1 | 1 | 0 | 0 | 0 | 0 |
| manual movement | 6 | 9 | 1 | 1 | 0 | 0 | 3360 | 1680 |
| manufacturing consumption | 3 | 2 | 1 | 1 | 4 | 4 | 0 | 0 |
| outgoing | 6 | 9 | 1 | 1 | 0 | 0 | 2520 | 840 |

These remain controlled CI fixtures, not Production-scale capacity claims.

### Interpretation pending independent closure review

The material delta remains concentrated in the intentional same-product /
different-bin contention shape:

- throughput: **-32.9%**;
- p95: **+28.2%**;
- sampled Lock wait: **76.9 -> 196.9 ms/100 operations**.

That workload shares one product projection while using separate warehouse
bins. M191 intentionally adds the products-first serialization boundary there
to prevent the pre-191 shared-product projection race.

The controls remain consistent with that interpretation:

- distinct SKU: **-2.0% throughput**, **+3.3% p95**, and zero sampled Lock
  wait in both states;
- same-product/same-bin was already contended and changes only modestly;
- Goods Receipt is near flat;
- outgoing is near flat/slightly faster;
- manual movement shows a small throughput cost;
- manufacturing consumption shows lower throughput but improved p95 while
  including its ordered reservation-universe prepass and product prefix.

The pre-191 lost-product-projection condition was observed in **1/4**
repetitions. That is observational corroboration only; the deterministic RED
acceptance suite remains the proof of the defect.

### Gate disposition

**Evidence collection after the measurement-boundary and projection
remediation is complete. A fresh independent closure review of these exact
bytes and this exact artifact is still required before §8 is classified
closed.**

No performance percentage here is an invented SLO. No result authorizes
Production or Staging mutation, M191 deployment, rollout, or baseline
regeneration.

## Authoritative characterization — durable p50 and per-call Lock attribution (2026-09-25)

**Benchmark/workflow head:** `260b540dfbd50245b8e0ef27e94e5a986958adea`  
**Base:** `main@0761d567965e7977ea2702166143ea6c2f1dc1da`  
**Workflow run:** `36191681776` — **SUCCESS**  
**Artifact:** `10888402016`  
**Artifact digest:**
`sha256:af073204bcfd26e6b09cab20b781fce841331e85a04ec2393387164c345b196b`  
**PostgreSQL server:** 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`)  
**Scope:** disposable GitHub Actions databases only. Production and Staging
were not accessed.

### Why this run exists

Section 8 lists "p50, p95, and p99 RPC latency" and "time waiting on
product-row locks (aggregate and worst observed call)". Run `36157102264`
computed pooled p50 but this document persisted only p95/p99, and its only
per-backend Lock figure was the consecutive same-backend **streak** (400 ms),
which can span several calls, wait episodes and blockers and therefore is not
a per-call value. Its largest statement latency (11.866 ms) bounds a call but
is not isolated Lock-wait time. Neither literally satisfied "worst observed
call".

Benchmark head `260b540` changes only the sampler/marker format and the
reporter. The run shape, workloads, fixtures, same-session measurement
boundary and every stock-effect assertion are unchanged.

### Run shape (unchanged)

- 4 repetitions, fresh pre191/post191 database pair per repetition;
- balanced order: repetitions 1/3 pre->post, 2/4 post->pre;
- 4 persistent psql workers; the same connection performs setup, warm-up,
  barrier and measured calls;
- 10 untimed warm-up calls per worker/repetition, excluded from latency,
  throughput and Lock metrics;
- 200 measured calls per worker/repetition = **3,200 measured calls per
  workload/state**;
- throughput wall time = earliest server-side measured START -> latest
  server-side measured END; process spawn, connect, auth/session SETs,
  warm-up and barrier are excluded;
- 20 ms Lock sampling, started after warm-up and proven ready before release.

All 4 x 2 characterizations passed every exact effect check (bin qty/value,
queue qty/value, SLE rows/qty/value, no negative stock, queue/bin
reconciliation, products.stock_quantity, cost_price sentinel repair, incoming
stock_value preservation, outgoing/consumption stock_value delta and
equality). The only exception remains the bounded pre-191
hot-multiwarehouse stock_quantity projection; it was observed in **0/4**
repetitions this run (1/4 in run `36157102264`). The deterministic RED suite
remains the defect proof.

### Per-call Lock attribution design

- **Call identity** is `(backend pid, pg_stat_activity.query_start)`.
  `query_start` is the statement start timestamp. It is fixed for one
  statement and new for every statement, so two sequential RPCs on one
  persistent worker cannot share it. application_name is never used for
  identity (worker names can be identical after NAMEDATALEN truncation, e.g.
  manufacturing consumption).
- Each worker's START/END marker statements also emit their backend PID and
  their own `statement_timestamp()` (== their `query_start`) in integer
  microseconds. A Lock sample counts only if its PID is a measured worker and
  `START.query_start < query_start < END.query_start`. So warm-up, sampler
  start-up and both marker statements can never become measured calls.
- Samples of one identity accumulate across wait episodes, wait events and
  blocker changes. Different PIDs never merge.
- The sampler emits a tick every iteration. The harness requires a tick
  before release and a tick after the latest END. The reporter requires tick
  coverage of the whole measured window, so a legitimate zero stays
  distinguishable from a sampler that did not run.
- Fail closed on: a Lock sample from a non-worker PID, missing or malformed
  query_start/PID, a non-Lock row, a legacy row without identity, a missing
  readiness marker or sampler file, missing marker identity, duplicate worker
  PIDs, a sample earlier than its statement start, or an identity whose
  observed span exceeds the longest measured call on that worker plus one
  interval (which would mean calls were merged).
- **Pre-flight on this same PostgreSQL 17.11 server** (artifact
  `query-start-probe.txt`): 500 back-to-back statements on one session each had
  a distinct, strictly increasing `query_start` equal to
  `statement_timestamp()`. A row-lock-blocked statement kept one `query_start`
  across 15 samples. The next statement on that backend, blocked again, got a
  new `query_start` (14 samples) and never inherited the previous one. A
  second backend with the identical application_name stayed distinct by PID
  (12 samples). The sampler's own backend never appeared.
  `M191_QUERY_START_PROBE_OK`.
- 18 reporter self-tests (artifact `reporter-selftest.txt`) cover:
  sequential calls on one PID (3 + 8 samples -> worst 8, not 11), one call
  across episodes and blocker changes, same name with different PIDs,
  missing/malformed/legacy identity, a fully sampled zero-Lock workload
  (0, not missing), out-of-window, warm-up and marker samples, non-worker
  PIDs and missing coverage. Against the same Case 1 input, the prior parser
  reported 220 ms (11 merged samples).

### Estimator and its limits

One estimator is used for both aggregate and per-call values: **each Lock
sample counts one nominal 20 ms interval.** Measured sampler cadence averaged at most
20.07 ms per workload run, with a largest single tick gap of 21.86 ms. The
current evidence does not enforce a hard maximum tick gap; 21.86 ms is the
largest gap observed in this authoritative run and is recorded as a robustness
limitation rather than hidden.

For these RPCs (p50 about 1.4–23 ms), a call normally gets 0 or 1 sample. The
per-call estimate is therefore **quantized**. "20 ms (1 sample)" means the call
was observed Lock-waiting at one sampling instant, not that it waited 20 ms.
Sub-interval waits are invisible to single calls and appear only
statistically in the aggregate. A call's real lock wait cannot exceed its own
measured latency, so the state's **max statement latency** is the hard upper
bound for any one call. The **observed span** (latest Lock sample of a call
minus its query_start) is a server-side lower bound on how long that call had
been running while still Lock-waiting.

### Lock classification

The sampler records PostgreSQL `wait_event_type='Lock'` for measured workers
only; it does not identify the locked relation or tuple. The recorded
wait-event mix is:

- hot multiwarehouse: `transactionid`/`tuple` only (pre 132/0, post 110/188).
  These are row-lock waits. Workers share exactly one product row and no bin,
  so this workload is the **product-row serialization proxy**. Pre-191 already
  serialized on its product projection UPDATE; M191's products-first lock
  adds `tuple` queueing.
- distinct SKU: the single pre-191 sample was `extend` (relation extension),
  not a row lock; post-191 had zero.
- Goods Receipt: `advisory` only (pre 2670, post 2724). This is the RPC's own
  advisory serialization, not a product-row wait.
- same-warehouse, manual movement, outgoing, consumption: `transactionid`/
  `tuple` row-lock waits on a shared bin **and** product. They cannot be
  separated into product-row versus bin-row waits.

So "product-row lock waiting" is represented honestly by the hot
multiwarehouse proxy. The other rows are total Lock-wait context.

### Authoritative pooled throughput and latency

| Workload | Pre ops/s | Post ops/s | Delta ops/s | Pre p50 ms | Post p50 ms | Delta p50 | Pre p95 ms | Post p95 ms | Delta p95 | Pre p99 ms | Post p99 ms | Pre max ms | Post max ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| distinct SKU | 2432.23 | 2439.70 | +0.3% | 1.395 | 1.405 | +0.7% | 2.389 | 2.330 | -2.5% | 3.754 | 3.076 | 11.846 | 11.831 |
| hot SKU / multiwarehouse | 1837.23 | 1260.45 | **-31.4%** | 1.975 | 3.050 | **+54.4%** | 3.345 | 4.077 | **+21.9%** | 4.987 | 5.214 | 12.048 | 6.874 |
| hot SKU / same warehouse | 1280.45 | 1264.42 | -1.3% | 2.942 | 3.021 | +2.7% | 4.492 | 4.268 | -5.0% | 6.477 | 5.760 | 10.948 | 10.266 |
| Goods Receipt | 174.75 | 171.06 | -2.1% | 22.668 | 23.105 | +1.9% | 25.050 | 25.536 | +1.9% | 28.595 | 28.591 | 35.243 | 33.721 |
| manual movement | 1168.78 | 1055.02 | -9.7% | 3.277 | 3.583 | +9.3% | 4.662 | 5.079 | +8.9% | 5.963 | 6.370 | 8.538 | 9.390 |
| manufacturing consumption | 757.92 | 667.77 | -11.9% | 3.944 | 5.742 | +45.6% | 10.323 | 7.764 | -24.8% | 15.550 | 9.525 | 30.716 | 16.663 |
| outgoing | 1191.21 | 1153.86 | -3.1% | 3.216 | 3.285 | +2.1% | 4.378 | 4.773 | +9.0% | 5.914 | 6.136 | 9.057 | 8.193 |

### Authoritative sampled Lock wait — aggregate and worst observed call

| Workload | Pre Lock ms/100 ops | Post Lock ms/100 ops | Pre / post calls with >=1 Lock sample | Pre worst per-call sampled estimate | Post worst per-call sampled estimate | Pre / post worst observed span ms | Pre / post max statement latency ms (per-call upper bound) |
|---|---:|---:|---:|---:|---:|---:|---:|
| distinct SKU | 0.6 | 0.0 | 1 / 0 | 20 ms (1 sample, `extend`) | 0 ms (0) | 0.955 / 0.000 | 11.846 / 11.831 |
| hot SKU / multiwarehouse | 82.5 | 186.2 | 132 / 298 | 20 ms (1 sample) | 20 ms (1 sample) | 5.961 / 4.181 | 12.048 / 6.874 |
| hot SKU / same warehouse | 186.2 | 191.9 | 298 / 307 | 20 ms (1) | 20 ms (1) | 8.124 / 6.675 | 10.948 / 10.266 |
| Goods Receipt | 1668.8 | 1702.5 | 2666 / 2715 | 40 ms (2) | 40 ms (2) | 23.274 / 23.684 | 35.243 / 33.721 |
| manual movement | 203.8 | 235.0 | 326 / 376 | 20 ms (1) | 20 ms (1) | 5.452 / 4.356 | 8.538 / 9.390 |
| manufacturing consumption | 327.5 | 391.9 | 524 / 627 | 20 ms (1) | 20 ms (1) | 19.525 / 10.257 | 30.716 / 16.663 |
| outgoing | 201.9 | 211.2 | 323 / 338 | 20 ms (1) | 20 ms (1) | 7.035 / 5.973 | 9.057 / 8.193 |

Out-of-window Lock samples excluded: **0** in every workload/state and
repetition. Sampler ticks inside the measured windows: 66–936 per
workload/state (pooled).

**Worst observed per-call product-row Lock-wait bound** (hot
multiwarehouse proxy): the 20 ms sampler cannot resolve the exact duration of
the worst individual lock wait. Every sampled waiting call had at most one Lock
sample, so a sample proves only that the call was waiting at that sampling
instant. The actual worst observed per-call lock wait is therefore **> 0 and
<= 12.048 ms pre-191 / <= 6.874 ms post-191**, bounded by the largest measured
statement latency in each state. The longest observed span of a waiting call was
5.961 ms pre-191 / 4.181 ms post-191. The increase from 132 to 298 calls with a
Lock sample and from 82.5 to 186.2 sampled ms/100 ops is evidence of higher
aggregate sampled Lock activity, but at 20 ms resolution it does **not**
independently prove whether the change came from more calls waiting, longer
individual waits, or both.

**Longest consecutive same-backend sampled Lock-wait streak** (a different
metric, kept for contention persistence only): hot multiwarehouse
**220 ms pre / 340 ms post** in this run (400 ms in run `36157102264`). Same
warehouse 400/440, Goods Receipt 440/620, manual 380/520, consumption
540/820, outgoing 400/460, distinct 20/0 ms. The streak grouping tolerates one
missed sampling tick (successive samples up to 2.5 nominal sampling intervals
apart), so a streak **may span multiple consecutive calls** on one backend. It
is **never** the lock wait of one call. For §8 "worst observed call", use the
per-call latency bound above, not the streak duration.

### Repeat-to-repeat envelope

| Workload | Pre ops/s range | Post ops/s range | Pre p50 range ms | Post p50 range ms | Pre p95 range ms | Post p95 range ms |
|---|---:|---:|---:|---:|---:|---:|
| distinct SKU | 2376.89–2526.68 | 2394.17–2499.88 | 1.373–1.418 | 1.393–1.417 | 2.260–2.580 | 2.241–2.430 |
| hot SKU / multiwarehouse | 1770.26–1895.25 | 1245.98–1270.13 | 1.961–1.998 | 3.034–3.066 | 3.112–3.716 | 3.923–4.271 |
| hot SKU / same warehouse | 1210.35–1316.82 | 1245.91–1278.94 | 2.909–3.051 | 3.015–3.030 | 4.098–5.289 | 4.084–4.379 |
| Goods Receipt | 173.02–176.85 | 163.99–174.10 | 22.278–22.968 | 22.697–24.168 | 24.476–25.291 | 24.528–26.010 |
| manual movement | 1131.66–1187.96 | 956.43–1115.50 | 3.245–3.348 | 3.486–4.003 | 4.447–4.985 | 4.475–5.565 |
| manufacturing consumption | 742.93–767.84 | 621.79–693.69 | 3.856–4.008 | 5.612–6.283 | 9.992–10.764 | 7.122–8.047 |
| outgoing | 1176.85–1210.50 | 1084.19–1181.85 | 3.171–3.243 | 3.246–3.456 | 4.241–4.428 | 4.240–5.395 |

Hot multiwarehouse per-repetition throughput deltas: -33.5%, -31.5%,
-31.0% and -29.6%. The ranges do not overlap: the lowest pre-191 run is
1770.26 ops/s and the highest post-191 run is 1270.13 ops/s.

### Fixture cardinalities at workload start (identical to run 36157102264)

| Workload | Org products | Org bins | Target products | Target bins | Org reservations | Target reservations | Org SLE rows | Target SLE rows |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| distinct SKU | 6 | 9 | 4 | 4 | 0 | 0 | 1680 | 0 |
| hot SKU / multiwarehouse | 6 | 9 | 1 | 4 | 0 | 0 | 840 | 0 |
| hot SKU / same warehouse | 6 | 9 | 1 | 1 | 0 | 0 | 0 | 0 |
| Goods Receipt | 2 | 2 | 1 | 1 | 0 | 0 | 0 | 0 |
| manual movement | 6 | 9 | 1 | 1 | 0 | 0 | 3360 | 1680 |
| manufacturing consumption | 3 | 2 | 1 | 1 | 4 | 4 | 0 | 0 |
| outgoing | 6 | 9 | 1 | 1 | 0 | 0 | 2520 | 840 |

### Raw artifact -> this report

Every pooled figure above was independently recomputed from the raw
`measured.worker*.log` `Time:` lines, the measurement markers and
`locks.tsv`, without the reporter. The recomputation covered ops/s,
p50/p95/p99/max, Lock ms/100 ops, calls with Lock samples and worst per-call
sample count, for all 14 workload/state pairs. All matched the reporter's
`M191_PERFORMANCE_REPORT.json`.

### Interpretation versus run 36157102264

- hot multiwarehouse: -31.4% throughput (was -32.9%), p95 +21.9% (was
  +28.2%), sampled Lock 82.5 -> 186.2 ms/100 ops (was 76.9 -> 196.9). This
  is consistent and reproducible in all four repetitions. It remains the
  deliberate same-product/different-bin products-first serialization cost.
  The new p50 (+54.4%) shows it shifts the typical call too, not only the
  tail.
- distinct SKU: +0.3% throughput with zero post-191 Lock samples, so there
  is no global serialization (was -2.0%).
- same warehouse -1.3% (was -3.0%), Goods Receipt -2.1% (was -1.6%): flat.
- manual movement -9.7% (was -5.2%) shows a **small/moderate reproducible
  throughput cost for owner review**, with one unusually slow post-191
  repetition (-19.0%) and the other three at -5.2%/-8.4%/-5.0%. Its current
  pre/post throughput and p50 ranges do not overlap, so the pooled delta should
  not be dismissed as runner noise. Sampled Lock changes remain comparatively
  small (203.8 -> 235.0 ms/100 ops).
- outgoing -3.1% (was +1.1%) is less conclusive: repetition 3 was -7.9% while
  the other three were -0.7%/-2.9%/-0.7%, and sampled Lock changed only
  201.9 -> 211.2 ms/100 ops. Record this as current-run variability rather than
  an established new lock-wait regression.
- manufacturing consumption: -11.9% throughput (was -12.9%), p95 improved
  (-24.8%) while p50 rose (+45.6%). That fits the added ordered
  reservation-universe prepass and product prefix: more fixed per-call work,
  and fewer long tail waits.

The sampler/marker change adds one tick row per iteration and one integer
per Lock row. It runs identically in both states, so the before/after
comparison stays fair. Absolute ops/s differs modestly from run
`36157102264` (e.g. distinct SKU pre-191 2432.23 vs 2541.37). That is runner
variance plus possibly this small sampler change, so only same-run
before/after deltas are interpreted.

### Gate disposition

Section 8's listed items now each have durable evidence here: ops/s; p50,
p95, p99 (plus max); product-row Lock waiting as aggregate (ms/100 ops) and
worst observed call (per-call sampled estimate with its explicit bounds);
the hot same-warehouse, hot multiwarehouse and distinct-SKU workloads plus
receipt, outgoing, manual-movement and manufacturing-consumption
representatives; fixture size; concurrency; iteration count; and warm-up
disclosure.

**A fresh independent closure review of these exact bytes and this exact
artifact is still required before §8 is classified closed.** No percentage
here is an SLO. The rollout decision on the measured hot-multiwarehouse cost
belongs to the owner. The remedy may not be to weaken M191's correctness
lock contract. Nothing here authorizes Production or Staging mutation, M191
deployment, rollout or baseline regeneration.
