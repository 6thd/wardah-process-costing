# M191 — Pre-Production Performance Characterization

**Status:** corrected balanced characterization pending on this Draft PR.
Independent review found that quantity-only reconciliation did not prove
SLE/value/queue continuity. Earlier runs are diagnostic only and do not close
the section 8 gate.

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
