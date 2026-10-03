# Next phase: owner decisions and operational evidence preparation

2026-10-03 UTC. This starts preparation after the two local proof gaps were
accepted at #310 `0e91e352`. It selects no business disposition, assigns no
operational owner and authorizes no live access, merge, application or release.

## Verified entry point

Main is `3d01f99fae2fb294fa0586084c32f0cd6bdf21fe`; #310 remains Draft/open at
`0e91e3527e8201ffae6f051cd31f8e4e3e7d9c86`. #308 is the frozen client reference.
#302 remains Draft/open at `314ab192d59df0448deb4b1ad5e579bdd83cd01b`:
its 33 records still have PENDING status, null owner/decision/approval and empty
verification lists. #278 remains open. These are repository metadata/source
observations on this date, not current target ledger or live behavior evidence.

Authoritative pending register:
[OWNER_DECISIONS.md](https://github.com/6thd/wardah-process-costing/blob/314ab192d59df0448deb4b1ad5e579bdd83cd01b/docs/db/material-issue-owner-disposition/OWNER_DECISIONS.md)
and [INVENTORY.json](https://github.com/6thd/wardah-process-costing/blob/314ab192d59df0448deb4b1ad5e579bdd83cd01b/docs/db/material-issue-owner-disposition/INVENTORY.json).
This packet maps all IDs without replacing or silently approving that register.

## First review and owner choices to resolve

1. Complete the **whole QC/security review** still excluded from #310's scoped
   PASS: all QC RPCs/settings, tenant and owner boundaries, explicit grants,
   expiry/revocation, segregation of duties, conditional/stage inspection,
   immutable history and privileged direct writes. A separately reviewed
   implementation is required for any resulting correction.
2. The owner selected **isolated non-PROD acceptance first** in the 2026-10-03
   conversation: prepare material-issue/QC acceptance before full manufacturing.
   This is a planning-scope decision only. No target environment, target access,
   route unavailability or MES/finished-goods/accounting alternative is approved.
   Narrow maintenance is not equivalent to full manufacturing. Keep required
   out-of-scope workflows blocked until each has an approved disposition.
3. For each route below choose a reviewed replacement, verified unavailability
   with an approved operator alternative, or retain it as a blocker. GW/DR
   boundaries may be excluded only with deployment-specific evidence. An
   unavailable required financial/MES operation may still block release.
4. Name accountable approvers for grants, device policy, pause/recovery and
   monitoring. Agree exact environment, builds, pending-work coverage and
   failure response before requesting any target access.

## QC privileged-write evidence already prepared

At accepted main, the baseline grants ALL on `quality_inspections` to
`service_role`. M199's table revoke names PUBLIC/anon/authenticated, leaving that
baseline grant outside the revoke. Its QC RPC EXECUTE grants exclude service_role,
and the UPDATE/DELETE trigger rejects history changes. **This is static evidence
for an unresolved direct-INSERT boundary, not a new live exploit reproduction or
whole-QC PASS.** RLS/grant inheritance and insertion effects need controlled
disposable-DB tests plus an owner policy decision; no grant is changed here.

Sources: [baseline grants](https://github.com/6thd/wardah-process-costing/blob/3d01f99fae2fb294fa0586084c32f0cd6bdf21fe/sql/baseline/000_schema_baseline_20260905_184634.sql)
and [canonical M199](https://github.com/6thd/wardah-process-costing/blob/3d01f99fae2fb294fa0586084c32f0cd6bdf21fe/sql/migrations/199_manufacturing_quality_control.sql).
Recommend reviewing removal of privileged direct insertion unless a named,
audited server integration requires it. That recommendation is not approval to
change canonical SQL, restore grants, or use a service-role workaround.

## All 33 route decisions: proposed preparation order

Every row remains PENDING. Batches indicate preparation order only; no row is
closed or approved. A is command/retry/cost integrity; B is broader MES and
reservation requirements; C is deployed/dynamic/scheduled coverage. C can be
investigated alongside A/B and must finish before compatibility is declared.

| ID | Batch | Evidence / owner choice to prepare |
| --- | --- | --- |
| RPC01 | A | Creation plus reservation atomicity; distinguish draft/manual pilot from existing production semantics |
| RPC02 | C | External/dynamic creation use; source absence is not non-use |
| RPC03 | C | Scheduler and expiry requirement; manual release does not replace automatic expiry |
| RPC04 | B | Automatic WO/routing generation; determine whether narrow manual WO can meet the approved requirement |
| RPC05 | B | Individual scheduling and a usable operator alternative |
| RPC06 | B | Automatic scheduling and required service level |
| RPC07 | B | Routing assignment and its downstream dependencies |
| RPC08 | B | Routing-driven release/WO creation; eligibility setter alone is insufficient |
| RPC09 | B | Start-operation execution, logging and labor semantics |
| RPC10 | B | Operation completion and dependent effects |
| RPC11 | A | Full MO transitions and legacy no-success/error fallbacks |
| RPC12 | B | FG receipt and GL completion; preserve #230/#260 accounting gates |
| DW01 | A | Actual create-hook consumers and approved creation semantics |
| DW02 | A | Allowed update fields; cache rollback versus real DB outcome |
| DW03 | A | Coherent costs/MO writes, explicit denials and partial-outcome recovery |
| DW04 | A | Production no-material creation plus development fallback/reservation failure |
| DW05 | A | First insert outcome and relationship retry deduplication |
| DW06 | A | Status fallback, no-success handling, extra fields and automatic dates |
| DW07 | B | Reservation batch atomicity, partial inserts, expiry and displayed version |
| DW08 | B | Reservation release quantity/version races and semantics |
| DW09 | B | Backflush settings ownership and behavior outside the pilot |
| DW10 | B | WO status/notes MES semantics and every affected consumer |
| DW11 | A | Both dynamic status retry edges; deny silent guarded-path bypass |
| CP01 | A | Pause's preceding logs/time writes and reconciliation after final denial; distinct from a server cutover pause |
| CP02 | B | Sequential bulk-release partial outcomes versus required batch atomicity |
| GW01 | C | Actual deployed table bindings for getTenantQuery |
| GW02 | C | Tenant proxy SELECT consumer and any deployed dynamic writer |
| GW03 | C | JavaScript withTenant imports, mappings and raw queries |
| GW04 | C | Concrete controller bindings and affected-table exclusions |
| DR01 | C | Actual names passed to the transaction RPC wrapper |
| DR02 | C | Secure TypeScript wrapper's different-name RPC bodies/dependencies |
| DR03 | C | Deployed voucher-reset two-name restriction remains outside M195 |
| DR04 | C | JavaScript secure wrapper imports and dynamic RPC names |

Each completed proposal needs target revision/scope, required business semantics,
named replacement or operator alternative, concurrency/replay/denial/partial
failure evidence, accountable approver and an explicit dated approval. Only
then update matching JSON fields in a reviewed follow-up. This document records
none of those approvals and cannot close a route merely from a permission error.

## Eight operational gates and concrete evidence deliverables

| ID | Deliverable before closure | Remaining approval / dependency |
| --- | --- | --- |
| G01 | Deployed, external, dynamic, scheduled and configured caller register, target revision and observed usage window | Owner confirms coverage; no unused inference from repository absence |
| G02 | Role/permission matrix with grant owner, expiry, renewal/revocation, real-identity positive/denial readback and monitoring owner | Explicit grants and approvers still unassigned |
| G03 | Approved device/operator policy and durable event inventory/recovery across participating devices | Version fencing is not a device lease or human-intent deduplication |
| G04 | Current #278 application/behavior record, exact client/DB identities and hosted browser/operator reconciliation | Existing repository application note is historical; fresh target evidence requires separate authorization |
| G05 | Tested server pause for every affected writer/retry, drained in-flight requests, pending-event reconciliation, paired cutover and recovery rehearsal | Mechanism/owners unspecified; UI flag off is insufficient |
| G06 | Exact main SQL hashes, verified target ledger/missing-only sequence, backup/rehearsal, before/after invariants and independent acceptance | Separate target/application sign-off; preserve M190-M199 dependency order |
| G07 | UI-only projection, compatibility closure, matching build/DB pair, reload/re-authentication and authorized operator acceptance | DB-first verification and separate client/release approval; #308 remains reference |
| G08 | Verified Production ledger containing canonical applied migrations, clean reconstruction and separate baseline workflow/PR | Baseline regeneration remains held |

## Pause and recovery rehearsal specification to prepare next

Select a mechanism only after G01/G02 identify all affected callers and owners.
Test on disposable or separately approved isolated infrastructure; no hosted
target is selected by this specification.

- Start a real in-flight writer, acquire the proposed pause, prove how existing
  transactions drain/abort legally, and prove all new writes and saved-event
  retries are fenced. UI disable alone and arbitrary sleeps are insufficient.
- Inventory pending records per participating user/org/profile/device. Reconcile
  each unchanged event/payload with authoritative receipts or protocol fences.
  Preserve IndexedDB history; never add a parent version to a saved command.
- Keep the pause through DB and matching-client switch. Prove old client builds
  cannot resume. Test stale rejection, lost-response replay, grant revocation,
  recovery and state comparisons before a named owner resumes access.
- On any failure retain the pause and preserved pending records. Do not perform
  a one-sided downgrade; require reviewed replay/data compatibility or fix-forward.

This is a required future oracle, not an implemented pause or a passed rehearsal.
See the accepted [paired cutover reference](https://github.com/6thd/wardah-process-costing/blob/383c3537237de06e577231f35d74a4ccdb124031/docs/db/material-issue-parent-version-198/CUTOVER.md).
Its candidate/allocation wording is historical; accepted main now contains the
canonical files. Its mixed-pair/pending-event requirements remain relevant.

## Review of this documentation delta

Verify the two added Markdown files only against main `3d01f99f`. Confirm the
attributed #310 result is limited to head `0e91e352`, all eight P3 notes remain
open, stock/GL wording is corrected, and all 33 IDs/eight G IDs match frozen
#302. Distinguish proposed evidence from implementation/approval. Re-resolve
#310/#308/main/#302 and report drift rather than silently changing the anchors.
No new local runtime, hosted identity or target proof is claimed here. **NO-GO,
M192, target-application and release holds remain in force.**
