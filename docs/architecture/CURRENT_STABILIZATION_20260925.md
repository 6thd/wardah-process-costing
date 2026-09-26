# Wardah ERP — Current Stabilization Checkpoint

**Date:** 2026-09-25  
**Repository anchor:** `main@e3869c2f6f7485c423281e42dfc72504edca30e8` after PR #255  
**Mode:** STABILIZATION — serialized execution  
**Purpose:** authoritative restart point for the current #246/#241 closure, Scanner v2 transition, and the manufacturing re-entry contract.

> This checkpoint supersedes `CURRENT_STABILIZATION_20260905.md` as the current restart point.  
> It records repository/PR/Issue state only. It does **not** infer current Production state from repository merges, and it authorizes no merge or Production/Staging mutation.

## 0A. Post-#258 closure update — 2026-09-26 (anchor `main@3c43f3d460ce499bab29dd78e1355ca645dd9a06`)

This update supersedes older workflow-status statements below where they differ:

- **PR #258 is merged to `main`** as `3c43f3d4`. Its authoritative benchmark implementation head is `260b540d`, run `36191681776`, artifact `10888402016`, PostgreSQL 17.11.
- The final independent closure review found **no current P1/P2 blocker** and classified **M191 §8 performance characterization as technically complete for owner review**.
- The measured same-product/different-bin cost remains documented rather than hidden (hot multiwarehouse throughput about **-31.4%**, p50 **+54.4%**); distinct-SKU remains near baseline with zero post-M191 sampled Lock wait.
- Statements below saying #258 is Draft/Open, that the §8 report is missing, or that M191 remains unmerged are historical snapshot text and are superseded by the dated reconciliation blocks.
- **Repository closure is not live rollout.** No Production or Staging application is implied. A live migration-ledger/readback preflight and separate explicit authorization remain required before any M190/M191 Production action.

## 0. Post-merge reconciliation block — 2026-09-25 (anchor `main@0761d567965e7977ea2702166143ea6c2f1dc1da`)

Sections 1–11 below were written at `main@e3869c2f` and remain as that snapshot. Where they differ, the following supersedes them:

- **PR #246 is merged** into the #241 branch (2026-09-25T10:04Z, `a3ab0cb`) and is historical. It is not an open track.
- **PR #241 is merged to `main`** (2026-09-25T11:43Z, `0761d567`). **Migration 191 is on `main`.** M190 SHA256 `0fa01345…ba2f` and M191 SHA256 `637a81ca…3f40` are unchanged.
- **PR #258** (Draft/Open) is the active **M191 pre-Production performance and owner-rollout gate** (§3 below). It is not closed by this block, and its four files are not touched by any other workstream.
- **Repository merge ≠ Production application.** No Production readback was performed for this block. The Production state is whatever a separately authorized live ledger readback shows.
- **Operational order:** M190 must be present **exactly once** in the live ledger, with its postflight passing, before M191 is considered. M191 is never applied first. Apply only the migrations the live ledger is missing.
- **Staging trust status: UNVERIFIED / REBUILD RECOMMENDED.** See `MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md` §3 for the acceptance list.
- **Manufacturing remains unfinished.** #229, #234 and #230 are open, with RED evidence reproduced on a disposable PG17 DB (`docs/db/manufacturing-inventory-red-20260925/`). **MFG-P1 is unfinished**: SQL engine existence ≠ live path completion, and on the cutoff-189 schema the engine entry point itself aborts (#260). A new warehouse-local physical-count contract is tracked in #259.
- The full reconciliation, the rejected "lock-order M192" claim, the delivery plan (PR-A / PR-B / C1–C7) and the owner decisions are in [`MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md`](./MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md).

## 1. Truth boundaries

Keep these states separate:

1. **Repository state** — what exists on `main` or an open PR branch.
2. **Fresh/disposable DB proof** — PostgreSQL acceptance evidence.
3. **Staging state** — separately verified environment state; never inferred from a PR.
4. **Production state** — only the live migration ledger/readback is authoritative.
5. **Review state** — a green review on one SHA does not transfer automatically to a newer SHA.

The generated `CLAUDE.md` DATABASE_STATE block remains a 2026-09-05 snapshot at cutoff 189.  
Current `main` contains Migration 190, but this checkpoint does **not** claim that Production is at 190.  
Migration 191 exists only on open PR #241 and is not present on `main`.

## 2. Current release/security closure

### PR #246 — Scanner v1 hardening / architectural-boundary record

- State at this checkpoint: **Open + Draft + unmerged**.
- Exact head observed during reconciliation: `c0e6172e293279d6e364149686849e09d1e2fe3f`.
- Base: PR #241 branch at `c65b2deab0ab642e9f9ca5c73b06f610e2f8284f`.
- Scope remains scanner/test hardening only; Migration 191 production SQL must remain byte-identical.
- #246 is not Scanner v2 implementation. It is the durable Scanner v1 hardening/boundary record.
- No merge/Ready transition is authorized by this checkpoint.

### PR #241 — Migration 191 F2 stock-write concurrency closure

- State at this checkpoint: **Open + Ready + unmerged**.
- Exact synchronized head: `c65b2deab0ab642e9f9ca5c73b06f610e2f8284f`.
- Canonical M191 SHA256: `637a81caeaebea60693476222611b373dc1e738cd6b10c634bf4c236227f3f40`.
- Issue #228 is closed, but closing the issue is not equivalent to merging/applying M191.
- After any authorized #246 integration into #241, capture the new #241 SHA and rerun exact-head acceptance/rollback plus fresh independent review before a merge decision.

## 3. M191 operational evidence gap

`docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md §8` requires pre-Production contention characterization:

- operations/second;
- p50/p95/p99 RPC latency;
- product-row lock wait time;
- hot-SKU same-warehouse;
- hot-SKU multi-warehouse;
- distinct-SKU parallelism;
- representative stock/manufacturing writers where practical.

The preserved M191 evidence bundle proves extensive correctness, lock-order, rollback, and reconciliation behavior, but this reconciliation did not find a dedicated §8 throughput/lock-wait report.

**Current classification:** not a #246 closure blocker; treat as an explicit **Production rollout gate** unless a separately reviewed decision changes that classification.

Do not weaken the M191 correctness lock contract to improve a measurement result without a separate design review.

## 4. Scanner v2 transition

Scanner v2 Slices 1–4 are present on `main` through merged PR #251:

- PostgreSQL runtime EXECUTE-state probe;
- source/catalog binding;
- fail-closed policy engine;
- guard-evidence producer/classifier;
- component/integration tests and dedicated workflows.

But Scanner v2 has **not replaced Scanner v1 as the mandatory migration acceptance gate**:

- `.github/workflows/ci-cd.yml` still runs `scripts/ci/check_definer_guards.py`;
- the Slice 4 integration test explicitly starts from a runtime-evidence fixture;
- Scanner v2 workflows are path-scoped to scanner implementation/contracts rather than all relevant migration/security changes.

Track the remaining replacement work under **#247**.  
Legacy #243 is closed. The remaining declared `standard_conforming_strings=off` boundary is tracked by **#252**.

A future replacement claim requires one reproducible flow:

`migration -> disposable PostgreSQL 17 -> runtime evidence -> binding -> guard evidence -> policy verdict -> preserved artifact`

and CI triggers that cannot be bypassed by changing a relevant migration without touching scanner files.

## 5. Astra remediation reconciliation

| Finding | 2026-09-05 state | Current reconciled state | Tracking |
|---|---|---|---|
| F1 material-consumption authorization | OPEN / NEXT | **Repository implementation closed for F1 scope** via PR #233 / Migration 190 | #154 + #170 remain open for broader MES/reservation/count scopes |
| F2 first-bin concurrency | PROOF_REQUIRED | **Implementation/review track active in #241**; issue #228 closed; M191 still unmerged | #241 / #246 |
| F3 retry-safe partial consumption | PROOF_REQUIRED | **OPEN / CONTRACT + RED required** | #229 |
| F4 manufacturing completion truth | CONTRACT_REQUIRED | **OPEN; canonical contract now preserved in repository docs by this reconciliation PR** | #230 |
| F5 selected-org tenant contract | BLOCKED | **OPEN / dependency remains** | #222 / FU-6 |

Do not mark parent issues #154 or #170 fully DONE merely because F1's material-consumption slice landed.

## 6. Manufacturing re-entry contract

The governing design is `docs/features/manufacturing/CANONICAL_MANUFACTURING_EXECUTION_CONTRACT.md`.

Before implementation resumes, close **Phase 0 — contract closure**:

1. lifecycle matrix;
2. deterministic BOM selection + immutable MO snapshot;
3. backflush modes and default-disabled policy;
4. numerical #230 completion case covering FG/WIP/cost/GL;
5. executable RED harnesses where practical.

Then preserve this implementation order:

**#229 -> #234 -> #230 -> UI/MES alignment -> integrated manufacturing simulation**

Important frozen decisions:

- backflush remains supported but is orchestration into canonical consumption, not a second mutator;
- retries reuse a stable event identity;
- reservations remain authoritative;
- post-M191 products-first lock ordering survives;
- completion is one cross-domain success contract;
- final manufacturing readiness requires integrated simulation, not isolated green RPCs.

## 7. Process-costing alignment debt

The advanced manufacturing roadmap remains materially relevant:

- the live process-costing service still contains the simplified `unitCost = totalCost / goodQty` path;
- EUP/FIFO/Scrap SQL engine existence does not prove the live UI path uses it as the sole authority;
- #230 completion semantics must be reconciled with MFG-P1 before completion costing is implemented, otherwise Wardah risks two competing costing truths.

Do not solve this by another client-side formula or direct `stage_costs` write path.

## 8. Simulation boundary

Simulation acceptance is separate from Staging E2E.

The Simulation Lab contract requires, among other things:

- an isolated simulation environment;
- rebuild from stable `main`;
- proved Reset behavior;
- independently derived baselines/catalogs;
- RED proof for invariants before those invariants count toward a green verdict.

PR #255/Staging E2E success does not close the integrated manufacturing simulation phase.

## 9. Parked work

- #221 HR reports remains dependent on #222/FU-6; do not hide the platform fix inside the frontend/service PR.
- #220 attendance wiring remains outside the current security/manufacturing closure sequence.
- #219 is an older cutoff-187 documentation track and is not current baseline authority.
- Do not reopen every parked track simultaneously after #241/#246.

## 10. Restart protocol

After any interruption:

1. read this file;
2. read `CLAUDE.md`, treating its generated DATABASE_STATE as a dated snapshot unless freshly regenerated;
3. verify current `main`, #241, #246, #247, #252, #229, #230, #234, and #222 directly on GitHub;
4. read `STABILIZATION_RECONCILIATION_20260925.md`;
5. if returning to manufacturing, read the canonical manufacturing execution contract before coding;
6. if returning to scanner work, read the Scanner v2 architecture and #247;
7. keep one executable remediation track active at a time;
8. require explicit authorization for merge and separate explicit authorization for Production mutation.

## 11. Authority

This file is a restart/coordination contract only. It does not authorize:

- merging #246 or #241;
- changing PR Ready/Draft state;
- Production or Staging mutation;
- applying Migration 191;
- rewriting applied migration history.
