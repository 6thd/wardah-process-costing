# Wardah ERP — Current Stabilization Checkpoint

**Date:** 2026-09-05  
**Repository anchor:** `main@c1b92e1d03b8e24c2cc6d170ecf7f0d6f02ade36` after PR #227  
**Production/baseline cutoff:** 189 (`189_hr_read_rbac_alignment`) as published by PR #227  
**Purpose:** short current restart checkpoint while the older `EXECUTION_LEDGER.md` still contains historical anchors from the earlier 181/182 period.

> Until `EXECUTION_LEDGER.md` is fully reconciled in a dedicated historical-ledger cleanup, use this file together with `CLAUDE.md` and the Astra tracker as the current stabilization restart point. Do not infer Production state from repository merges alone.

## Current operating mode

**STABILIZATION — serialized execution.**

Rules:

1. One executable remediation PR active at a time.
2. Documentation-only PRs may coexist if they do not change runtime behavior.
3. No new feature track pre-empts the S0 queue unless there is a production incident or explicit priority change.
4. No PR merge without explicit authorization.
5. No Production migration/write without separate explicit Production authorization.
6. Additive migrations only; never rewrite applied migration history.
7. RED/proof before a speculative concurrency/idempotency fix.
8. Contract-first for cross-domain manufacturing/accounting changes.

## Current baseline state

- PR #227 is merged.
- `main` at checkpoint creation: `c1b92e1d03b8e24c2cc6d170ecf7f0d6f02ade36`.
- Published schema baseline cutoff: 189.
- Published Production migration: `189_hr_read_rbac_alignment`.
- Astra Audit #1 reviewed the immediately preceding source anchor `05c7c9c...`; the audit itself was static and did not perform Production verification.

## Active Astra remediation queue

| Order | Finding | State | Tracking | Gate |
|---:|---|---|---|---|
| 1 | F1 — material-consumption authorization | OPEN / NEXT | #154 + #170 | exact permission design + RED direct-call matrix |
| 2 | F2 — first-bin concurrency | PROOF_REQUIRED | #228 | deterministic no-bin RED |
| 3 | F3 — retry-safe partial consumption | PROOF_REQUIRED | #229 | lost-response/same-event RED |
| 4 | F4 — manufacturing completion truth | CONTRACT_REQUIRED | #230 | approved numerical FG/WIP/cost/GL contract |
| 5 | F5 — selected-org tenant contract | BLOCKED / dependency | FU-6 / #222 | request-scoped server tenant contract |

Primary documents:

- `ASTRA_ARCHITECTURE_RED_TEAM_AUDIT_20260905.md`
- `ASTRA_REMEDIATION_TODO_20260905.md`

## Parked PRs

### PR #221 — HR reports

- Keep Draft.
- Existing platform dependency #222/FU-6 must be resolved/sequenced first.
- Do not absorb the DB/RLS tenant fix into this frontend/service PR.

### PR #220 — attendance check-in wiring

- Parked during the Astra S0 stabilization wave.
- Not discarded; it is simply not the current architectural priority.

### PR #219 — cutoff-187 documentation

- Older documentation branch based on the cutoff-187 period.
- It is not current baseline authority after PR #227 published cutoff 189.
- Treat as cleanup/supersession review, not as an active stabilization dependency.

## Existing issue mapping

- F1 maps to #154 (MES/work-order execution permissions) and #170 (material reservation/consume permission contract). No duplicate umbrella issue should be created.
- F2 is tracked by #228.
- F3 is tracked by #229.
- F4 is tracked by #230.
- F5 maps to FU-6/#222; coordinate with #156 for HR RBAC overlap.

## Next executable work after this documentation PR

**F1 only.**

Expected sequence:

1. inventory all material-consumption callers and direct-write paths;
2. choose the exact canonical permission contract;
3. add RED negative direct-RPC/table tests on an isolated DB;
4. design the smallest DB-first additive migration;
5. review the migration and regression matrix;
6. isolated/Staging verification;
7. request separate Production authorization before any apply;
8. Production postflight/readback after an authorized apply.

Do not start F2/F3/F4 implementation in parallel with F1.

## Restart protocol

After interruption:

1. Read `CLAUDE.md` database-state block.
2. Read this checkpoint.
3. Read the Astra remediation tracker.
4. Verify current `main` and open PR/Issue state directly on GitHub.
5. If `main` or Production cutoff moved, update the checkpoint before making architecture claims.
6. Resume only the single active remediation track.

## Authority

This checkpoint documents priority and sequencing. It does not authorize merge or Production mutation.