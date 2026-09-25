# M191 — Pre-Production Performance Characterization

**Status:** harness introduced; numeric evidence must come from the dedicated
GitHub Actions run before this gate is closed.

**Authority:** docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md section 8.

**Production/Staging:** not used. Evidence is produced only on disposable
PostgreSQL 17 databases in one GitHub Actions runner.

## Method

The workflow builds two databases in the same PostgreSQL 17 service:

- pre191: baseline 189 + Migration 190;
- post191: the identical chain plus Migration 191.

It seeds the same fixtures and runs the same workload parameters on both.

## Workloads

1. core_hot_same_warehouse — same product and same bin.
2. core_hot_multiwarehouse — same product, separate bin per worker. This is
   the product-row/product-projection lock-wait proxy because no bin is shared.
3. core_distinct_sku — separate product/bin per worker; parallelism control.
4. outgoing_hot_same_warehouse — canonical outgoing stock helper.
5. manual_movement_hot_same_warehouse — real manual movement RPC.
6. goods_receipt_hot_same_warehouse — real Goods Receipt RPC.
7. manufacturing_consumption_hot_same_warehouse — real M190/M191 consumption
   RPC with one MO/reservation per worker to avoid a shared-MO header bottleneck.

Default CI shape: 4 persistent psql workers, 30 measured iterations per worker,
5 excluded warm-up iterations per worker, and 20 ms Lock-wait sampling.

## Measurements

For both states and every workload the generated report records operations/sec,
p50/p95/p99/max latency, sampled aggregate Lock-wait time, and the sampled
worst Lock-wait episode.

The lock numbers are explicitly sampling estimates. Raw samples retain
application name, backend PID, wait event and pg_blocking_pids output.

## Fail-closed execution

The harness fails on any RPC/worker error, timeout, 40P01/deadlock, setup
failure, timed-call count mismatch, or post-workload product/bin
reconciliation failure.

No arbitrary percentage threshold is invented because Wardah has no
established SLO for these RPCs. A material regression must instead be
quantified and reviewed before Production; an unexplained regression remains
a rollout blocker until understood.

## Completion procedure

After the workflow completes, retain the raw artifact, copy exact values and
workflow run ID into this document, record the interpretation of material
deltas, obtain independent review, and only then classify section 8 as closed.

This document and workflow do not authorize Production or Staging mutation.
