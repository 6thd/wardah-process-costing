# M191 — Pre-Production Performance Characterization

**Status:** remediation rerun pending after a second independent review found
a P2 measurement-boundary defect in the prior characterization. Runs through
benchmark head `1b0d4b77a44f2344c0136a145ad1b740144e8406` are diagnostic only and
do not close the section 8 gate.

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
- 50 measured iterations per worker;
- 10 excluded warm-up iterations per worker;
- 20 ms Lock-wait sampling.

That yields **800 measured calls per workload per state**, while preserving
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
pooled p50/p95/p99/max latency, per-repetition throughput/p95 ranges, sampled
Lock-wait time normalized per 100 operations, and the worst sampled episode.

The lock numbers are sampling estimates, not exact PostgreSQL wait accounting.
Raw samples retain application name, backend PID, wait event and
pg_blocking_pids output.

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

The post-191 worst sampled Lock-wait episode in the hot-multiwarehouse proxy
was **200 ms**.

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

A new four-repetition PostgreSQL 17 characterization is required before any
new numeric result is called final. Production and Staging remain untouched and
out of scope.

