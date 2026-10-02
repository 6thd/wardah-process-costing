# Independent FAIL and narrow repair of PR #308

Status: repair evidence, **not independent acceptance or merge authorization**.
Parent: `90f3e07b12fe1556c6799673a9aef8c4cd5961fa`, tree
`a5a98e4b1b6cc1e55ada7c082341c2f9a902f9da`; base #301 remains `0e462611`.

## Review disposition

The independent review returned FAIL for the shared acceptance fixture. It
reproduced 22/40 successes: selecting a reservation again with `ORDER BY id LIMIT 1`
changed the request after a random-ID reservation was inserted. The replay then
raised MATERIAL_ISSUE_EVENT_CONFLICT, or the final new event tried to consume 10
against the new two-unit reservation and raised CONSUMPTION_EXCEEDS_RESERVATION.
These were test-construction defects, not M198/M199 product defects. The review's
234 readback mutations, byte/source preservation, RBAC, full QC and frontend
checks remain attributed independent evidence for the unchanged portions.

I independently checked hosted job 110993825828, run 37053928039: its log contains
MATERIAL_ISSUE_EVENT_CONFLICT; the shared step failed and the later vendor Auth
browser step was skipped. Test & Build succeeded, but Sonar failed and Codacy was
action_required at this parent. The PR's earlier "CI pending" wording was stale.

## Exact repair boundary

- Capture issue_193's complete command once before consumption. Reuse it unchanged
  for both exact-receipt replays; generate new events by replacing only its event UUID.
- Add gl_entries, gl_entry_lines and product stock_quantity to shared_state.
- Add owner-only local replay controls: force the pre-existing reservation ID to
  the lowest/highest UUID **before** any consumption reference exists, then execute
  the unchanged 11-assertion acceptance 30 times for each order. Every transaction
  rolls back. The setup only arranges fixture ordering; it replaces no function.
- Separately reintroduce each old construction site with the original reservation
  sorting last. Require its exact original failure, then roll back. This catches
  a partial repair that fixes replay but leaves the final new event unstable.
- Return the policy invalidation Promise and Promise.all for both QC invalidations
  in useQuality.ts. React Query can await them; no floating promise is suppressed.
- Keep source preservation fail-closed: only those literal promise edits are allowed
  beyond the four-conflict parent union. The old hook body is independently refused.
- Require `QC_REPLAY_DETERMINISM_PASS runs=60 mutants=2` in the combined workflow.

No migration, baseline, original QC acceptance/concurrency, canonical 195–198,
RBAC inventory or original branch is edited. No blanket analyzer exclusion or
test timeout increase is introduced.

## Executor local results

PGDG PG17.11/client17.11; Python3.12/psycopg3.3.6; Node24.19. A startup-only
UID/file-owner adapter is used in this managed root sandbox. This is not stock
postgres:17 or hosted evidence. Packages were checked against the TLS PGDG index SHA-256.

- Shared actual chain 190–199 passes, including the 72 quarantine probes, nine
  column-grant controls and two 22-function readbacks with four mutants each.
- 60/60 forced-order executions pass, each with all 11 assertions.
- Old replay construction is refused with MATERIAL_ISSUE_EVENT_CONFLICT.
- Old final-event construction is refused with CONSUMPTION_EXCEEDS_RESERVATION.
- TypeScript passes; affected hook/QC/settings tests pass 17/17 in four files.
- Source union passes; restoring the old hook is refused with quality promise repair drift.
- Build/password gate passes (files=79); RBAC/classification/baseline passes unchanged
  at 365 candidates / 339 signatures.
- Full Vitest at the default five-second timeout: 4959 pass / two timeouts in
  unchanged CompanySettings and SettingsOverview tests. The 60-second CLI comparison
  passes 4961/4961 tests across 337 files in 144.43s; no repository timeout setting is modified.
- Neither a longer local timeout nor the repaired local SQL constitutes a green
  corrected-head GitHub check set. Hosted checks must be verified at that head.

## Gates preserved

Independent re-review and corrected-head CI are required. Native QC browser on
199 and shared races remain open. Full QC review, service_role inspection-write
boundary, 33 owner decisions, eight operational gates, hosted/target identity,
pause/in-flight/pending recovery, current #278, devices/monitoring, DB-first paired
cutover and NO-GO/M192 holds remain open. No target access, merge or release occurred.
