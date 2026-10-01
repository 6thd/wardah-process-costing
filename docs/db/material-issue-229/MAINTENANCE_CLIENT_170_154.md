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

The inventory delta is exactly two signatures: the setup write RPC and its scoped
base-UOM read RPC. Baseline 358 candidates/332 signatures is pinned after inspection;
classification stays `follow_up_required` because the DB candidate is unapplied.
No scanner suppression, coverage threshold, accepted P2 test or original browser
fixture assertion is changed. The only existing-workflow changes add the companion #291/#292 bases
to two PR branch filters (identical final lists keep the combined tree compatible); push filters, jobs and Production deployment condition remain.

Local checks: type-check passed; final focused gateway/consumer/recovery, original UI
and sidebar suites passed 70/70. The affected-file rerun passed 104/104, including
all six files failing in the full snapshot. Production build passed with the flag
set: DEMO_PASSWORD_BUILD_GATE_PASS files=78 and no new setup/read RPC names or
original issue-options RPC names in the compiled JavaScript. An earlier full coverage snapshot had
4772 passes/8 failures (seven 5-second timeouts and one withPermission assertion across
six files); it is not a green full-suite claim and preceded the recovery widget.
Final exact-head CI must provide the full suite/build/Sonar/RBAC/Codacy evidence.
No Chromium rerun or real-identity acceptance is claimed. Prior #292 browser evidence
is historical and simulated. Review the final exact revisions, not these prior counts.

NO-GO remains: independent companion DB/client review, operator compatibility/combined
tree acceptance, #278 application record, standard PG17/canonical sign-off, real browser
and identity reconciliation, owner grant/cross-device decisions and release approval.
