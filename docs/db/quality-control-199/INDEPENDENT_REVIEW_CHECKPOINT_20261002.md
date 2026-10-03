# M199 prerequisite repair: independent acceptance checkpoint

2026-10-02 UTC. The owner supplied an independent **PASS for the narrow repair**,
with no P1/P2 findings, at PR #306 head
`e29b4e5aa96556165f97b278f55591dc61c8044e`, tree
`67f7ec6e3da1fba3f8aaef28641a23e408733335`.
Parent/base is #303 `a312ab529919dc1815692dd7f06fab5f4270d804`, tree
`2a6024609a301c999cf4d50d0eed31b06dbc0287`. The review verifies one commit,
seven files, +354/-5. This document preserves that reviewed head; the evidence
clarifications are a separate documentation-only proposal.

## Independent evidence supplied by the reviewer

The reviewer used a local PGDG PostgreSQL 17.11 server as the postgres OS user,
without the executor's startup adapter. The report independently reproduces:

- Complete repaired QC runner: two real prefix refusals, fourteen mutations,
  all seventy unchanged assertions, four DEFINER mutants, reference RBAC and
  concurrency PASS.
- Original M199 falsely accepted on real 196/197 chains, including its own QC
  acceptance; the new oracle fails on the original migration.
- Direct repaired-file refusals occur at the end of the first preflight block,
  before the first write; no QC table, permission seed or inspection RPC remains.
- Exact canonical M198 body fingerprint and trigger predicates; missing setup
  and renamed helper refused; duplicate inspection rows still refused on M198.
- Deliberately broken control inputs (wrong diagnostic, syntax error, swapped
  diagnostic, committed mutation) are caught as false green, unexpected refusal
  or residue. Local connection/start-state refusals and marker failures hold.
- Pinned bytes, 7/7 package tests, 6/6 delegation, 441/441 scanner self-tests,
  canonical chain/readback PASS, post-199 quarantine 72/72 and column controls 9/9.
- Post-199 effective client write privileges on the three quarantined tables
  remain closed; compile, shell syntax and diff checks pass.

These are attributed reviewer results, not new executor runs. Bandit and Radon
were not independently rerun. Both executor and reviewer used PGDG locally;
neither result establishes a stock postgres:17 GitHub run of M199 at this head.

## Remote and source recheck after the report

- GitHub main remains `3acea30d83e182a2651b60b8696a658137bc0c92`; it contains
  canonical 195–198. The review's `origin/main=94400e1b` was an older local ref.
  The evidence now names the frozen commit, parent blobs and pinned hashes.
- #301/#302/#303/#304 and #306 heads remain unchanged, open and unmerged.
- All four checks observed at exact #306 head succeeded: Codacy (zero issues),
  Vercel Preview Comments, multi-org HR isolation and prospective ledger race.
  These are not the targeted M199 workflow or full main-targeted CI.
- An explicit executor scan with
  `sql/baseline/000_schema_baseline_20260717.sql` (cutoff 121) scans 69 migrations
  and passes. Default selection uses `next(glob(...))` without sorting and can
  choose a different cutoff. The invocation is documented for reproduction;
  the accepted scanner code is untouched.

## Non-blocking advisories retained

| ID | Item | Disposition |
|---|---|---|
| R01 | Generic main preservation wording | Clarified to exact `3acea30d` and #303/pinned hashes; no canonical bytes changed |
| R02 | Scanner count/selection | Evidence pins cutoff 121 and records 69; deterministic default selection remains a separate scanner follow-up |
| R03 | Setup RPC owner/ACL not pinned by M199 preflight | No SQL broadening; require canonical catalog readback and owner/grant assessment in combined/target acceptance |
| R04 | M199 workflow omits 195–198 paths | Retain as a workflow follow-up; combined acceptance must include every dependency path |
| R05 | Snapshot omits pg_description | Snapshot is restoration evidence; source/error placement proves ordering. Comment coverage can be strengthened separately |
| R06 | FOR EACH STATEMENT / AFTER controls absent from committed list | Reviewer tested both; tgtype predicate refused both. Fourteen committed controls remain unchanged |
| R07 | Pre-existing service_role INSERT/UPDATE on quality_inspections | Record explicitly for whole-QC security/owner review. No claim that M199 closes every privileged writer; no grant restored or live probe made |
| R08 | Stock-image hosted M199 acceptance missing | Still open; existing stacked PR does not trigger its main-only workflow |

## Continuation and holds

The narrow prerequisite review is closed at the frozen head. Independent
whole-QC review and shared QC/material-issue browser/database acceptance remain
open. Prepare an isolated combined #301/#304 tree, resolve the four known
conflicts, regenerate the union mutation inventory and preserve both features.
Incorporate the accepted prerequisite repair without modifying its source branch.

Run exact-tree integration controls for new material issue under QC hold,
recorded-event replay, stale parent versions after return and shared races. Keep
QC/classic callers, generated types, readbacks and production hard-disable in
scope. Do not claim the M198-only canonical PASS covers M199 interactions.

All 33 owner decisions, eight operational gates, NO-GO/M192/DB-first holds and
paired-cutover requirements remain. No repository merge, target migration,
Production/Staging access, deployment or release is authorized by this PASS.
The wider coordination record is [#305](https://github.com/6thd/wardah-process-costing/pull/305).
