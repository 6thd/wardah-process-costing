# M195–M203 Production application — 2026-10-21

**Status: applied once each to Production `uutfztmqvajmsxnrqeiv` on 2026-10-21 (10:45–11:20 UTC), with the scoped CRLF script between 201 and 202.**
Every pre-registered check passed and the owner closed the application phase after an independent read-only review. This record states what was
applied and checked, and what it does **not** establish. It contains no connection data, no business data and no raw evidence; the sealed evidence
is kept outside the repository and is referenced below by name and SHA-256 only.

## What was applied

Source bytes: the ten files of `main@034aad391f1009e514aa26b1f0b0069391fc3740` (PR #318 merged), read back and compared byte for byte before the window.
Each migration was sent once through `apply_migration` (one file per call, no retry); the CRLF script ran once through psql (session pooler).

| # | File | Bytes | SHA-256 | Ledger version | `statements` / bytes / SHA-256 of `statements[1]` | Catalog signature after the step | pre / post (checks/failed) |
|---|---|---|---|---|---|---|---|
| 1 | `sql/migrations/195_material_issue_scope.sql` | 8844 | `a059271918c5d42fc3edf11f4ff1b0f99a3ae00882c4b673baa467dd10428102` | `20261021110437` | 1 / 8844 / matches file | `f948ac8902950aba…` = expected E_01 | PASS (39/0) / PASS (44/0) |
| 2 | `sql/migrations/196_material_issue_maintenance.sql` | 31781 | `88578735da82ebb1c9082b79be7621259ccd2584cdd7943abc467ec9533eed33` | `20261021110625` | 1 / 31781 / matches file | `b2508640e603c0a9…` = expected E_02 | PASS (39/0) / PASS (42/0) |
| 3 | `sql/migrations/197_material_issue_stale_version.sql` | 20155 | `f1536d9b2a339bc79b1e687118c0a10d9c650f7feb10d84e5ce405f8b90b7f2d` | `20261021110723` | 1 / 20155 / matches file | `89079d5cb3acc242…` = expected E_03 | PASS (39/0) / PASS (42/0) |
| 4 | `sql/migrations/198_material_issue_parent_version.sql` | 21983 | `2e0fe396acdbb0a490b8b0b28366d81101926319a7b43a40f51c5e785f716723` | `20261021110816` | 1 / 21983 / matches file | `e57efb9539a88d93…` = expected E_04 | PASS (39/0) / PASS (57/0) |
| 5 | `sql/migrations/199_manufacturing_quality_control.sql` | 52414 | `77c80daf12c4a33fc24e9b2361f3b23fe9f46767658e6391ff4b7719078dd9ba` | `20261021110932` | 1 / 52414 / matches file | `475d3a00681ae30c…` = expected E_05 | PASS (39/0) / PASS (42/0) |
| 6 | `sql/migrations/200_gl_event_mapping_write_closure.sql` | 11830 | `0370bce8ec17e15061396d3a6272947c27195df1a0a39c63d62e05f65acbb866` | `20261021111047` | 1 / 11830 / matches file | `da6d55fd271f458b…` = expected E_06 | PASS (39/0) / PASS (42/0) |
| 7 | `sql/migrations/201_manufacturing_settings_permissions.sql` | 28903 | `74bdecc4d004d5b7c9b50a70935e125d5c28878743e844e842ca55e9e9df24bf` | `20261021111156` | 1 / 28903 / matches file | `46be6d8ba044d058…` = expected E_07 | PASS (39/0) / PASS (42/0) |
| 8 | `scripts/ops/pre_m202_validate_mo_transition_crlf.sql` | 9398 | `502ffed43144fde0a76332f450dd84a96dfb8b783fd0912d556bbfdb33e00046` | — (script, no ledger row) | — | `7da7faa53aa70911…` = expected E_08 | PASS (39/0) / PASS (44/0) |
| 9 | `sql/migrations/202_qc_privileged_write_closure.sql` | 79938 | `9ffb7b45d406b1daccbd0df03c4f9a837b430e38d66c7907f7e2ce10410fe777` | `20261021111813` | 1 / 79938 / matches file | `177c227f58847e94…` = expected E_09 | PASS (40/0) / PASS (46/0) |
| 10 | `sql/migrations/203_stage_wip_mo_lock_under_m195_containment.sql` | 11899 | `7ef383c1ddbd46812dc1421bcf06cae5f00fdaf95f77a18998e89a39daff19bb` | `20261021111915` | 1 / 11899 / matches file | `0ff30477a6dd662e…` = expected E_10 | PASS (40/0) / PASS (48/0) |

Ledger after the window: **96 rows** (87 before; 195–203 once each, no other change). CRLF outcome: `PRE_M202_CRLF_REPLACED`.
Window state: HALT not recorded; 0 STOP verdicts of 25.

## Checks that ran in the window (all PASS)

- Opening: tool definitions and project identity; B0 freshness (compared sections and catalog signature equal to the state read right after B0);
  W0 (adopted pins) once immediately before step 1.
- Per step: no active session or open transaction before and after; server identity unchanged; ledger row by name with one statement whose size
  and SHA-256 equal the file; catalog signature equal to the pre-built expected state E_k (TP-9); data invariants of plan §3.7; writers/settings sections
  unchanged. Extra: owners of the two new RPCs after 195; §3.6 frozen-198 readback (22 functions); §3.5 containment after 195 and 203;
  `qc_assert_closed_graph_202()` completed after 202 and 203; §3.8 attributes of `wardah_lock_mo_for_stage_wip_203` after 203.
- B1 after the CRLF script and before 202: `pg_dump`, roles capture, TOC, and a local restore whose compared sections and B1-state assertions all matched.

## What this does not establish

- **Atomicity for every failure.** N23 (2026-10-15, throwaway hosted project) proved the specific B2 cases (ledger-insert rejection and preflight refusal
  roll the whole file back). The 2026-10-21 window proved the real application of the pinned bytes with the approved checks. Neither proves the
  behaviour under a dropped connection, a killed session, a lost response or a platform timeout — none of these occurred.
- **Restore to Production.** B0 and B1 were restored only into local disposable PostgreSQL 17 databases. A restore of the hosted project was never tried.
- **Client readiness.** Database deployment is independent of the Vercel deployment of the web client. No client was deployed, and no writer or user
  was resumed. The G9 containment of 195 is in force: MO/WO/reservation maintenance through the twelve legacy functions and direct table writes is
  revoked for `PUBLIC`, `anon`, `authenticated` and `service_role` until a compatible client is accepted and a separate resume decision is taken.
- **Older descriptions.** Statements written before 2026-10-21 that 195–203 are "repository only / not applied" (including the PR #318 description
  and the 199/202 runbook status lines) describe the state at the time they were written; this record supersedes them for current Production status.

## Evidence (outside the repository)

| Item | SHA-256 of its `SHA256SUMS` |
|---|---|
| Window run `evidence_window_20261021T104513Z` | `d6a6717fda89357195c2ddd07501d5a5120f001d6d2f2a4d00ef2f2caae261e5` |
| Window package q2 `window_package` | `6695e140f82b8158dfe8d42078d6cae7f141ecc93d5bb8ae5e9c7ae4007f3c09` |
| Closeout `work_phase_r_closeout_20261021T113516Z` | `d1bfab6a142d532ae11adfea0f9070b07974aa488cda41bed326dffee75c7784` |
| Evidence register v29 | `9d1a2d8fd69c5ece9531b6737983b4ca7c740010bd2eb5d9b44115aeb09ec3e4` |
