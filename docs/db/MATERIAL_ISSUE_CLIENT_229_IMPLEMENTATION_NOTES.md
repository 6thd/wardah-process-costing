# #229 client implementation, first Draft slice (synchronized with M194)

Stacked on the reviewed #277 contract. This slice implements the event command's durable browser record, guarded same-browser retry and terminal acknowledgment, the two policy RPC adapters, and fail-closed retirement of obsolete service entry points. No new event button or settings control is mounted. It cannot lift the Production hold.

## Caller inventory

| Path | State in this slice |
| --- | --- |
| `inventoryTransactionService.consumeReservedMaterials` | Export retained for source compatibility, but throws `MATERIAL_ISSUE_LEGACY_RETIRED` before network access. The two mock-only tests that advertised a successful consumption were removed. |
| `mesService.consumeMaterial` / `useConsumeMaterial` | Unmounted hook remains; service throws `MATERIAL_ISSUE_LEGACY_RETIRED` before direct table INSERT. Must replace the hook before mounting any action. |
| `mesService.backflushMaterials` / `useBackflushMaterials` | Unmounted hook remains; service throws `BACKFLUSH_RETIRED_USE_REVIEWED_234_IMPLEMENTATION`. #234 owns future automatic consumption. |
| `rpc_consume_material_event` | New client adapter exclusively calls the event-bearing M192 signature. It is not yet connected to a UI. |
| `rpc_get/set_material_issue_wo_statuses` | Adapters validate full org/version/status shape and send canonical arrays. Settings UI remains to be built. |

## Browser record

`claimMaterialIssue` checks the unique `(user_id, mo_id)` slot and writes immutable command fields plus an unknown initial attempt in one IndexedDB readwrite transaction. Each send registers an attempt in a transaction before invoking the RPC. A lost response preserves the slot; a definitive first SQLSTATE rejection can be acknowledged only when every registered attempt has a conclusive allowlisted database rejection. Acknowledgment tombstones the old event in the same transaction that releases the slot. Success validates the returned event, MO, stage, org and consumption count before clearing the slot. An invalid response or storage failure is treated as an unknown outcome.

The record is local to one browser profile. A separate device, private window or cleared browser storage can bypass it. There is no server reconciliation or global intent key. Support must not infer rollback from receipt absence alone. The owner must accept this residual risk explicitly or commission an independently reviewed server-side intent mechanism before any limited launch.

## Review follow-up

The independent review of the first head found a late-success race and binary floating-point quantity rejection. A succeeding second tab now causes the first tab and later retries to return the validated stored success; an acknowledged rejection has a distinct local error. Decimal validation uses the JSON-number value rounded to six places. Tests now cover a two-response race, exact event ID and ordered multi-line payload, mismatch responses, PostgREST's returned network-error shape, error classification, independent policy fields, and actual retired service methods. At the earlier stacked head, the reviewed RBAC inventory replaced three old write signatures with three M192 event/policy RPC calls and reported 354/327. After combining this branch with M194's WIP-close RPC, the reviewed merged inventory is 354 candidates / 328 signatures (SHA-256 `12f4fc98681b1960fee68ba3fb052656b116afedfb39783f3cd9b98bc3d5face`).

The review of `b3ace12` found that the implementation behaved correctly but its suite remained green after splitting the acknowledgment or send registration into separate IndexedDB transactions, or after removing the stored-success guard against a late rejection. Follow-up acceptance checks now require a single readwrite transaction for acknowledgment and a retry's fresh read/write before fetch, exercise a registered retry racing acknowledgment, and cover both late-success/early-rejection orders. Scratch mutations splitting acknowledgment (M03), splitting registration (M04), and removing the success guard (M13) each make their corresponding new check red while the unmodified focused suite is green. Additional cases reject malformed success shapes, non-P0001 or non-exact rejection messages, invalid quantities/duplicate reservations, and failed policy reads. These are local `fake-indexeddb` checks, not evidence of real-tab or database behavior.

The independent review of `69b4e906` closed M03/M04/M13 but found that a split-transaction response settlement (M14) and stale-decision registration with a redundant re-read (M04b) still left the suite green. The next follow-up requires settlement of both success and definitive rejection to read and write within one readwrite transaction; registration may open only the actor lookup and the atomic read/write transaction before fetch. Both M14 and M04b turn these new tests red on scratch copies. The runtime remains unchanged and still needs a fresh independent acceptance decision.

The review of `7a61c2a` verified those mutations but showed a stronger M04b2 variant could make its decision from the earlier actor lookup while performing an unused read in the write transaction. Two behavioral interleavings now assert that simultaneous sends register distinct attempts, and that acknowledgment after the actor lookup prevents any later network call or revival of the tombstone. M04b2 makes both tests red on a scratch copy. The runtime remains unchanged; these local tests do not establish real-browser behavior.

At `a892f4a`, #279 merged current `main@94400e1` without rewriting history. The only merge conflict was the RBAC inventory baseline, recomputed and reviewed as 354 candidates / 328 signatures. Local type-check, build, inventory gate, 44 focused tests and five integration tests passed on the combined tree. Exact-head CI/CD and Sonar were still running at this note's update; they must pass before Ready.

## Still required before Ready or any Production event

1. Build and mount the permission-gated employee command and Org Admin policy settings UI, with accessible Arabic copy and a complete catalog load that fails closed on org switches. The currently unmounted hooks must be migrated or removed.
2. M194's #278 WIP cost/ownership/period guard is now applied on Production and documented in `M194_PRODUCTION_APPLICATION_20260930.md`. Before any new event, exercise the protected behavior with real identities in an isolated environment, reconfirm M193/M194 live catalog readbacks, and resolve the relevant #170/#154 write boundaries.
3. Run real-identity browser and Supabase PG17 acceptance for committed/lost replies, authorization and revocation, two tabs, old clients, settings, WIP and DB effects. Unit tests of the local record cannot establish these claims. Capture exact-head CI and owner risk decision.
4. Keep the operational hold on **all** new M192 material issue events, including Org Admin and pilots, until the separate release decision. Do not close #229 from this slice.
