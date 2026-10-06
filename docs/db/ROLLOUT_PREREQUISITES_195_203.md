# DB-application prerequisites vs separate holds — shortlist (status 2026-10-06)

## Status (2026-10-06)
| Item | Status |
|---|---|
| P3 Part A (changed acceptance on the restored clone) | **Closed and VERIFIED FROM RAW LOGS by Codex** (log SHA-256 `020aa5fe…ab63`; 241 ok, 2292 identities with zero mismatches, PASS then ROLLBACK, fingerprints identical). Clone evidence only; Codex did not execute SQL; not Production evidence. |
| P3 Part B (ledger-capture inspection) | **VERIFIED FROM RAW LOGS by Codex**: 87 rows, one element each, 190–194 once each, 195+ absent, no CR; extra ledger columns. Clone evidence only. |
| P4a execution-role compatibility (G8) | **Open.** A Studio self-hosted reference handler exists but is not shown to be the hosted handler. |
| P4b atomicity decision (G11) | **Open (owner decision).** |
| P1, P2, P5–P9 | Open; unchanged. |

Order is fixed: 195, 196, 197, 198, 199, 200, 201, scoped CRLF script (no ledger row), 202, 203. Early 203 is an optional alternative that must be named in the owner's release; it is not an in-window choice. Nothing here authorizes application.

## A. Genuine prerequisites to applying the DB migrations (all required before step 1)
| # | Prerequisite | Who | Evidence that closes it |
|---|---|---|---|
| P1 | **Owner release decision** naming: the window, the fixed step list, whether any alternative order is allowed, the functional impact of 195 (MO/WO/reservation writes and 12 legacy RPCs revoked for all clients, incl. Admin; 196 drops `trigger_update_mo_status`; 199 drops two `quality_inspections` policies; 202 creates a cluster-wide role), acknowledgement that the 195–198 "REVIEW CANDIDATE / never apply" headers are stale provenance, and the ledger-hole policy (P4b). | Owner | Written release (plan G1, G9, G10) |
| P2 | **Repository-first:** the correction (203, scoped CRLF script, acceptance fixes, plan, MANIFEST) reviewed and merged to `main`, and `sha256sum` of each applied file read from `main` equals the plan table. 203 and the CRLF script exist nowhere but the review candidate today. | Codex review; owner merge | `main` commit + hash output (G2) |
| P3 | **Local evidence for the changed bytes:** the changed r5 `acceptance.sql` rerun once on the owner's restored clone, plus the read-only ledger-capture inspection of that clone. Done; raw logs inspected by Codex. | Local agent / Codex | Sanitized raw logs |
| P4a | **Execution-role compatibility proven before any target action (gate G8):** evidence about the `apply_migration` path itself (for example an owner-authorized throwaway-project test, option O1, or an official statement of the role) accepted by the owner and Codex. Unverified today. A written risk acceptance does not close it. | Owner + Codex | Evidence + acceptance |
| P4b | **Atomicity decision (gate G11):** the owner decides in writing what happens if the catalog is changed and no ledger row exists. May be an explicit risk acceptance (option O2). | Owner | Written decision |
| P5 | **Fresh live preflight (read-only):** ledger shows 190–194 once each and no 195+ row; recorded baseline of every business invariant (zero not presumed); `pg_stat_activity` observation; no role `wardah_qc_entry_202`. | Executor | Query outputs (G3, G6, G7) |
| P6 | **Backup B0** fresh with restore rehearsal passed; **B1** after the CRLF script's outcome and before 202. | Owner/local agent | Dump + restore reports (G4) |
| P7 | **Maintenance window as an operator control:** clients informed, no employee WIP creation; nothing implements a pause (the G05 fence is a proposal). | Owner | Window log (G6) |
| P8 | **Step-8 operator designated:** the CRLF script runs through `psql` over a direct/session connection as `postgres`; it cannot run through the MCP tools. | Owner | Name + captured output |
| P9 | **Independent read-only verifier** designated for the post-apply ledger/catalog readback. | Owner | Name |

## B. Not prerequisites to the DB application (remain separate holds)
| Item | Status |
|---|---|
| Any UI merge or deploy | Not required (DB-only). The QC UI (#304, stale `199` file) and the #301 client stay unmerged/unmounted; the isolated material-issue UI stays hard-disabled (`gate.ts`). UI merges follow the DB-first rule only after the DB state is applied and verified. |
| M192 material-issue event hold (incl. Org Admin and pilot events) | Stays in force. |
| Whole-QC rollout | Release gate ships `off`; G05 pause/drain contract is proposed, not implemented; hosted Supabase rehearsal on a rebuilt Staging is open (Staging UNVERIFIED); whole-catalog acceptance not claimed. |
| `service_role` direct-write policy on material-issue effect tables; cross-device duplicate-event decision; ledger-tooling hardening | Separate rollout-scope decisions. |
| Baseline regeneration, CLAUDE.md live-state update, the Production application record (M195–M203) | After the live ledger shows the rows and an independent readback; separate PRs. |
| Staging parity | Not a gate for this DB application; Staging is UNVERIFIED and not used. |

## C. Things that look like prerequisites and are not
- Zero stock/projection mismatch (record the observed baseline instead).
- A restore rehearsal for every step (B0 and B1 only).
- A hosted-shape rerun of early 203 (only if the owner names that order).
