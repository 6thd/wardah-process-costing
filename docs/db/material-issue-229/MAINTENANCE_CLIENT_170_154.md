# Isolated maintenance client candidate

Stacked on #292 at `e4aa486dae585679adc202c6ba47799015d529f0`; requires the separate
unallocated #170/#154 maintenance SQL candidate stacked on #291. It allocates/applies
no migration and leaves the #279 contract, generated database types and M192 hold
unchanged. Default runtime requires `!PROD && VITE_MATERIAL_ISSUE_ISOLATED === 'true'`.

`materialIssueMaintenance.ts` provides a typed candidate protocol overlay, durable
IndexedDB event claims, immutable retry, actor/org checks before and after transport,
receipt verification and explicit recovery. Storage failure prevents posting. Each
attempt remains unknown until a verified receipt or definite PostgreSQL rejection.
An unknown earlier attempt cannot be dismissed merely because a later attempt is
denied. Compare-and-delete protects a newer event from a late acknowledgement.
The server checks the actor supplied from the persisted event against `auth.uid()`.

An unknown attempt followed by a definite denial remains protected from dismissal.
The new explicit reconciliation action calls `rpc_reconcile_material_issue_setup`
with the saved command/event/actor. A verified applied receipt clears the slot; a
verified server `closed` fence also clears it and permits a fresh intent. The fence
prevents any delayed original/retry for that event from executing. This is an
explicit cancellation of a not-yet-applied intent, not automatic retry. Invalid,
denied or unavailable responses, changed identity and failed storage keep the slot.
Compare-delete cannot clear a newer event. Current exact maintenance authority is
required; revoked grants still need authorized support. Cross-device policy is not
decided by this per-event fence.

Every operation except create_order must supply a valid MO UUID before a durable
claim. Create_order cannot supply mo_id. Thus WIP without an MO cannot enter the
order-creation slot. Reconciliation can safely close already-saved malformed events.

Isolated compatibility consumers:

| Consumer | Guarded replacement |
|---|---|
| createOrder and useCreateManufacturingOrder | Draft MO plus initial material array in one event |
| updateStatus | Read scoped version, explicit nonterminal MO transition; no legacy catch/fallback |
| mesService.updateWorkOrderStatus | Read scoped version; eligibility only, no notes/terminal completion |
| mesService.createMaterialIssueWorkOrder | Explicit manual preparation API; not routing generation or MES start |
| reserveMaterials | Scoped read RPC supplies canonical base UOM, then one reserve event |
| releaseReservation | Scoped version/balance, one release event preserving consumed history |
| stageWipLogService.create | Pristine current-period WIP through unchanged M194 guards |

Missing candidate RPCs/errors never fall back in isolated mode. Existing general MES,
completion/cancellation, capacity/efficiency and WIP update/close flows are not restored.
Initial material arrays are atomic through creation. Standalone reservation maintenance
is one line per event: multi-line reserve, expiration overrides and release-all are
explicitly refused rather than implemented as partially successful client loops.
The existing WO preparation API still needs its operator UX acceptance; this document
does not claim general MES UI replacement or issue closure.

The isolated material-issue page now offers recovery for saved order creation and
the selected MO's preparation, independently of new-issue context. Dismissal calls
the all-attempts-rejected guard; no success is claimed for unresolved storage/events.
Late results after identity remount or permission revocation do not update the page.
Preparation-only recovery enumerates this actor/org's IndexedDB events rather than
the oldest 200 MOs. It includes recent and terminal MOs independently of read RPC
eligibility, refreshes after recovery and reports storage failures.

The inventory adds one reconciliation RPC signature to the prior two setup/read
signatures. Baseline 359 candidates/333 signatures is pinned after inspection;
classification stays `follow_up_required` because the DB candidate is unapplied.
No scanner suppression, coverage threshold, accepted P2 test or original browser
fixture assertion is changed. The only existing-workflow changes add the companion #291/#292 bases
to two PR branch filters (identical final lists keep the combined tree compatible); push filters, jobs and Production deployment condition remain.

Historical checks on the parent: type-check passed; focused gateway/consumer/recovery, original UI
and sidebar suites passed 70/70. The affected-file rerun passed 104/104, including
all six files failing in the full snapshot. Production build passed with the flag
set: DEMO_PASSWORD_BUILD_GATE_PASS files=78 and no new setup/read RPC names or
original issue-options RPC names in the compiled JavaScript. An earlier full coverage snapshot had
4772 passes/8 failures (seven 5-second timeouts and one withPermission assertion across
six files); it is not a green full-suite claim and preceded the recovery widget.
Final exact-head CI must provide the full suite/build/Sonar/RBAC/Codacy evidence.
No Chromium rerun or real-identity acceptance was claimed on the parent. Prior #292 browser evidence
is historical and simulated. Review the final exact revisions, not these prior counts.

Correction checks: the six focused gateway/consumer/recovery/original UI/sidebar
suites pass 105/105, including unknown-then-denied reconciliation, receipt/fence
verification, missing MO scope, late cleanup/newer event, storage/identity failure,
and pending recovery beyond 200 entries. Type-check and full CI outcomes are recorded
separately on the final head. Type-check passes. Production build with the flag
set passes the demo-password gate (78 files) and contains none of the issue read,
setup/manage or reconciliation RPC names.

Fresh native verification uses the unmodified Chrome Headless Shell 141.0.7390.37
downloaded from Google's Chrome for Testing archive. The Playwright download failed
and full Chrome could not launch under the workspace's Unix-socket restriction;
Headless Shell succeeds with the existing local fixture runner. The original five
scenarios pass with their assertions byte-identical. One missing local stub export
(`getEffectiveTenantId`) was supplied for the inherited maintenance module import.
The separate maintenance script verifies real IndexedDB reload, two-tab sharing,
unknown-then-denied retention, explicit fence/new intent and applied receipt recovery.
Fixture RPCs and identities remain simulated; server fence concurrency is proven
separately by the companion unmodified-PG17 CI, not by this browser simulator.
Neither fixture is run by existing Vitest/CI gates. No real identity or
database-connected browser acceptance is claimed.

```bash
WARDAH_BROWSER_EXECUTABLE=/path/to/chrome-headless-shell \
  bash tests/fixtures/material-issue-browser/run_local.sh
```

The runner executes both scripts; original screenshots and trace stay at the fixed
local evidence paths established by #292. The added script writes no filesystem
artifact. Its console pass markers are in `evidence/maintenance-correction-browser.txt`.

NO-GO remains: independent companion DB/client review, operator compatibility/combined
tree acceptance, #278 application record, standard PG17/canonical sign-off, real browser
and identity reconciliation, owner grant/cross-device decisions and release approval.
