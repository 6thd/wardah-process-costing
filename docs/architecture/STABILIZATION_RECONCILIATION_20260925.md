# Wardah ERP — Stabilization Documentation Reconciliation

**Date:** 2026-09-25  
**Anchor:** `main@e3869c2f6f7485c423281e42dfc72504edca30e8`  
**Scope:** documentation/status reconciliation only. No runtime code, migration, PR merge, Production write, or Staging write.

## Why this reconciliation exists

Execution moved materially beyond the 2026-09-05 restart documents while several durable plans stayed on old anchors or a side documentation branch. This file records what is current, what is historical, and which obligations must not be lost.

## Authoritative/current documents after this package

1. `CURRENT_STABILIZATION_20260925.md` — current restart point.
2. `CANONICAL_MANUFACTURING_EXECUTION_CONTRACT.md` — manufacturing #229/#234/#230 design contract.
3. `SCANNER_V2_ARCHITECTURE.md` — Scanner v2 architectural boundary and replacement criteria.
4. `GENSPARK_FINAL_REPORTING_PACKAGE.md` — final evidence/reporting gate contract.
5. `F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md` — M191 evidence requirements, including performance characterization.
6. GitHub PR/Issue state — authoritative for moving workflow status; re-verify before acting.

## Historical but retained

- `CURRENT_STABILIZATION_20260905.md` — historical checkpoint.
- `ASTRA_REMEDIATION_TODO_20260905.md` — historical remediation plan plus original acceptance criteria.
- `EXECUTION_LEDGER.md` — valuable historical execution ledger whose top anchor is older than the current wave.

Historical documents remain useful for provenance; they are not current restart authority.

## Reconciled obligations

| Obligation | Current source | State |
|---|---|---|
| F1 exact material-consumption authorization | PR #233 / M190 | repository implementation landed; broader #154/#170 scopes remain |
| F2 stock concurrency | #241 + #246 | unmerged closure track |
| M191 contention cost | M191 Evidence Gates §8 | **evidence report not located; preserve as Production gate** |
| Scanner v2 architecture | #247 + architecture doc | Slices 1–4 landed; mandatory migration gate not complete |
| Scanner lexical session-state boundary | #252 | open |
| retry-safe partial consumption | #229 | open |
| canonical backflush | #234 | open |
| authoritative completion | #230 | open |
| selected-org server contract | #222 / FU-6 | open |
| Process Costing live-path alignment | Advanced Manufacturing Roadmap MFG-P1 | open |
| integrated manufacturing simulation | Simulation Lab acceptance | open |

### Post-merge update — 2026-09-25 (anchor `main@0761d567`)

The table above was written at `main@e3869c2f`. Current state of the rows that moved, plus rows added by the manufacturing/inventory re-derivation:

| Obligation | Current source | State |
|---|---|---|
| F2 stock concurrency | #241 (merged to `main` as `0761d567`), with #246 merged into it | **repository closed**; Production application not claimed |
| M191 contention cost | PR #258 (Draft) | evidence collected in #258; independent closure review and owner rollout disposition pending |
| retry-safe partial consumption | #229 | **RED reproduced** (duplicate replay; cancelled/done/draft/on_hold consumption) |
| authoritative completion | #230 | **RED reproduced** (no FG SLE/bin; pending-cost contamination; read-only member reaches `done`) |
| Process Costing live-path alignment | MFG-P1 → **#260** | **RED reproduced**: live service schema-incompatible; `upsert_stage_cost` aborts `42702` |
| warehouse-local physical count | **#259** (new) | contract gap confirmed |
| stock transfer submit | #160 | closed `42501` path confirmed; containment in the PR-B branch |
| Staging environment trust | — | **UNVERIFIED / REBUILD RECOMMENDED** |

Details: `MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md` and `docs/db/manufacturing-inventory-red-20260925/README.md`.

## Anti-drift rules

- Never infer Production from `main`.
- Never infer Staging from a PR branch.
- Never equate a closed issue with an applied migration.
- Never call Scanner v2 mandatory until the real migration-to-PostgreSQL-to-policy chain is wired into non-bypassable CI.
- Never call manufacturing end-to-end accepted before #229/#234/#230 and integrated simulation close.
- Never treat M190's F1 slice as closure of all #154/#170 scope.
- Never drop the M191 performance/lock-wait gate merely because correctness acceptance is green.
