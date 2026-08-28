# Wardah ERP — Execution Ledger

**Purpose:** durable restart checkpoint for active and unfinished product, security, financial-reporting, manufacturing, and repository-alignment work.

**Current anchor:** `main@21b9bbfc92a00ff29776a4c418f54d6a3ecab97f` (after PR #196; repository cutoff 182, Production cutoff 181)

> This file is the live execution checkpoint. Historical plans keep their original phase names and evidence, but new work must use the namespaced IDs below. A phase is not considered complete because a chat or old plan says so; completion requires repository/PR/migration/test evidence recorded here.

## Status vocabulary

- `DONE` — merged/applied/verified as required by the work type.
- `ACTIVE` — current implementation/review work.
- `PARTIAL` — some accepted outputs landed, but the phase definition is not fully met.
- `BLOCKED` — known prerequisite prevents safe continuation.
- `QUEUED` — approved direction, not started.
- `AUDIT_REQUIRED` — old plan/spec claims progress or an old baseline; current `main`/Production must be re-verified before relying on it.
- `SUPERSEDED` — retained for history; do not resume from it directly.

## Phase namespaces — do not use bare P0/P1/P2/P3

| Namespace | Source | Meaning |
|---|---|---|
| `CORE-P*` | `docs/improvements/*` | July 2026 cross-cutting manufacturing/accounting improvement program |
| `MFG-P*` | `docs/features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md` | advanced manufacturing/process-costing roadmap |
| `ALIGN-P*` | `docs/architecture/PRODUCT_SHAPE_ALIGNMENT_PLAN_20260826.md` | product/repository/IA alignment roadmap |
| `SEC-*` | GitHub security issues | exact PostgreSQL/RBAC boundary remediation |
| `FINREP-*` | financial-reporting program | authoritative financial statements/reporting work |

## Current focus

1. `ALIGN-P0` — PR #192 is ready for review, synchronized with `main@21b9bbf`, and establishes the truthful product/repository map and live documentation checkpoint.
2. `ALIGN-P1` — **DONE.** PR #193 merged to `main` as `6811ca1`; see the inventory row below.
3. PR #194 — **DONE (repository only).** Merged as `cdbe648c` under an explicit sequencing exception; Migration 182 is not applied to Production.
4. PR #196 — **DONE.** The complete read-only pre-182 Production snapshot and postflight contract are merged as `21b9bbf`; Issue #195 tracks orphan historical account references separately.
5. Security prerequisite wave before financial statements: `SEC-172` as Migration 183 on top of 182, then `SEC-162`, `SEC-161`, and `SEC-171` if scope remains focused.
6. Reconcile `FINREP-SPEC` against the current DB/repository baseline.
7. `FINREP-1` — authoritative financial reporting round.

No Production mutation is authorized by this ledger.

## Active / unfinished work inventory

| ID | Status | Evidence / current truth | Next action / gate |
|---|---|---|---|
| `ALIGN-P0` | ACTIVE | PR #192 is ready for review and contains the product-alignment plan, durable ledger, historical pre-`ALIGN-P1` route×Sidebar×permission inventory with its post-#193 reconciliation, live docs index, and a superseded marker on the old repository reorganization plan. Its branch has current `main@21b9bbf...` merged in. | Review #192. No file moves/runtime changes. After normal merge authorization, this checkpoint is closed. |
| `ALIGN-P1` | DONE | PR #193 (`feat/align-p1-product-catalog`) merged to `main` as `6811ca196dfea8e460b2ac0104dbe8c917ca8e04`. Delivered `src/config/product-catalog.ts` as the single navigation source of truth, `src/components/layout/sidebar.tsx` driven from it (655 lines of hand-maintained item list/`MODULE_CODES` duplication/`hasModuleAccess()` module-prefix check removed), decorative badges removed, `inventory.categories`/`manufacturing.routing`/`quality` correctly `hidden`/`planned` instead of GA. Independent review caught two functional-authorization dead ends after the first pass (collapsed-sidebar icon linking a permission-only group to a root the caller couldn't enter; a childless-but-visible group rendering as a dead button) — both closed via `landingHref`, which mirrors `ModuleGuard`'s own root check and falls back to the first visible child. Covered by DOM-level tests (`sidebar-landing-href.test.tsx`), a catalog invariant test across 8 permission scenarios, and a regression guard on the `moduleItem` hidden-child requirement filter. | None. Sidebar navigation is now driven by the same exact route-permission contracts as `ModuleGuard`, closing a recurring "visible-but-forbidden" class of bug from earlier RBAC rounds. |
| PR `#190` | DONE | Production/Staging/Preview topology documentation merged to `main` as `608633c1b96f13df9fde9f2fbd1689dee3959695`. | Preserve its `CLAUDE.md` policy; no duplicate follow-up required unless CI/review finds a defect. |
| PR `#193` | DONE | ALIGN-P1 application PR merged to `main` as `6811ca196dfea8e460b2ac0104dbe8c917ca8e04`. | See `ALIGN-P1` row above for scope/evidence. |
| PR `#194` | DONE (repository) | Trial Balance correctness PR merged to `main` as `cdbe648cb2c64d9c4cbcf39daf4dcc7b24376e01` from reviewed head `8dc8f36e...`. It adds repository Migration 182, moves `rpc_get_trial_balance` to the legal ledger, honors configured fiscal-year fallback, and preserves the existing membership-only guard. The user explicitly approved landing 182 before `SEC-172` so the later security migration hardens the correct definition rather than being overwritten by it. Production ledger remains at 181. | Apply 182 only under separate Production authorization and run the authenticated postflight now recorded on `main` by PR #196. |
| PR `#196` | DONE | One-file documentation PR merged as `21b9bbfc92a00ff29776a4c418f54d6a3ecab97f`. It records the complete read-only pre-182 Production snapshot, expected orphan-code metadata, postflight total, sequencing exception, and Issue #195. | None. It does not authorize Production mutation. |
| Issue `#195` | QUEUED | Production has historical posted legal-ledger lines whose NULL `account_id` and short codes do not resolve to the canonical six-digit `gl_accounts` catalog. Migration 182 restores their amounts but cannot repair their account linkage. | Establish an evidence-backed historical-to-canonical mapping and design a controlled backfill; no guessing and no monetary rewrite. |
| `SEC-172` | QUEUED | Financial report RPC reads are tenant/member scoped without exact financial read permissions. Direct prerequisite for the financial-reporting round. | Implement as Migration 183 on top of Migration 182's legal-ledger definition; preserve the composite contract below, require exact direct-RPC authorization acceptance, and create `TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md`. Production apply requires separate authorization. |
| `SEC-162` | QUEUED | Fiscal-period generation/status mutation boundary lacks exact RBAC. | Design exact period permissions; DB-first migration/acceptance. |
| `SEC-161` | QUEUED | `gl_accounts` mutations have broad org boundary and overlapping CoA permission families. | Decide canonical CoA permission family before changing RLS/RPCs. |
| `SEC-171` | QUEUED | Client can insert into trusted audit stream. | Separate trusted server audit from client telemetry or close direct INSERT. |
| `FINREP-SPEC` | AUDIT_REQUIRED | `docs/FINANCIAL_REPORTING_ENGINE_SPEC.md` still declares repository/Production cutoff 152 and migration numbering from that era, while the repository cutoff is now 182 and the verified Production cutoff remains 181. Its accounting design may remain useful, but its deployment sequence cannot be executed as written. | Before `FINREP-1`, reconcile the specification against current `main`, Production ledger, canonical GL model, fiscal-period state, and open security issues. Do not reuse old migration numbers. |
| `FINREP-1` | BLOCKED | Trial balance/account statement/reconciliation UI already exists, but `SEC-172` and `FINREP-SPEC` reconciliation must be closed before treating report reads/design as a safe current product boundary. | After prerequisites: Trial Balance authority → GL/account statement → Income Statement → Balance Sheet → Cash Flow → comparison/export/print. |

### Mandatory composite contract for Migration 183

`rpc_get_trial_balance` will have a cumulative live contract, not a last-file-wins
contract:

1. Migration 182 owns the legal-ledger body, fiscal-year fallback, completeness
   semantics, return shape, grants, and existing membership isolation.
2. Migration 183 must reproduce that body and add the exact financial-read
   permission required by `SEC-172`; it may not revert any 182 behavior.
3. The existing Ledger Truth workflow watches `sql/migrations/**` and must remain
   relevant to 183. LT-2 and Cases A–E are the regression net for accidental
   replacement of the 182 body.
4. The 183 PR must add `TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md`, following the
   established 170–173 chain-document pattern. Any later `CREATE OR REPLACE` of
   the function must restate both layers together.

## Reconstructed historical phase state

### `CORE-P*` — July cross-cutting improvement program

The document under `docs/improvements/README.md` is an execution history, not a current-state authority. Later migrations and security work supersede several implementation assumptions.

| ID | Reconstructed state | Evidence | What remains |
|---|---|---|---|
| `CORE-P0` | PARTIAL / historical | Error swallowing was removed; atomic journal/event-posting groundwork and posted-entry protection were delivered historically. | Re-audit old fallback paths and old naming against current canonical RPC/RLS before declaring the original P0 definition closed. |
| `CORE-P1` | PARTIAL / historical | MO state machine/reservation and fiscal-period foundations were delivered historically; later RBAC/security issues prove authorization boundaries are not fully closed. | Current security issues, especially period/RBAC boundaries, supersede the old claim of completion. |
| `CORE-P2` | PARTIAL / historical | Cost of Production report, subledger↔GL reconciliation, and selected React Query conversions landed historically. | Report-read permissions are still open (`#172`); do not call financial/reporting P2 fully hardened. |
| `CORE-P3` | PARTIAL / historical | Shared UI foundations (PageHeader/Empty/Error/Loading/print) were introduced and applied to selected screens. | Financial statements remain a separate `FINREP-*` program; broad UI adoption is not complete. |

### `MFG-P*` — advanced manufacturing roadmap

| ID | Status on current `main` | Current evidence | Next action |
|---|---|---|---|
| `MFG-P0` | PARTIAL | Fake `postStageToGL` success path is removed, but the roadmap still records unchecked P0 documentation/demo tasks. | Reconcile roadmap/limitations in a later focused docs pass; keep stub/demo truth explicit. |
| `MFG-P1` | NOT DONE | Current `process-costing-service.ts` still calculates `unitCost = totalCost / goodQty` client-side and directly UPSERTs `stage_costs`; it does not make the legal EUP/FIFO/Scrap RPC the sole calculation boundary. | Later focused manufacturing round: verify live `upsert_stage_cost` signature/permissions, then DB-first if needed and UI follow-up. |
| `MFG-P2` | NOT DONE | `postStageToGL` remains intentionally absent; no legal stage-posting handler is active. | First choose S2-A vs S2-B accounting policy in ADR; do not restore a fake button. |
| `MFG-P3` | NOT DONE / AUDIT_REQUIRED | `labor_time_logs` + `moh_applied` are still written by the process-costing service; the roadmap requires reconciling them with MES/conversion costing before MO completion can be considered complete. | Audit current `rpc_complete_manufacturing_order` on current DB chain, then design conversion/OH integration. |

The CodeFactor decomposition PRs around Stage Costing were behavior-preserving quality refactors. They do **not** count as completion of `MFG-P1/P2/P3`.

## Restart protocol

When resuming work after an interruption:

1. Read this file first.
2. Read current `main` SHA and compare it with `Current anchor`.
3. List open PRs and issues referenced by `ACTIVE/BLOCKED` rows.
4. Re-verify any `AUDIT_REQUIRED` row before coding.
5. Work on one namespaced phase in one focused PR (or DB PR → Production apply/verify → UI PR when DB-first applies).
6. Update this ledger in the same PR when status/evidence changes, or in the immediately-following documentation reconciliation PR.
7. Never infer Production state from a merged repository PR; Production ledger/live checks remain separate evidence.
8. Never merge a PR or write Production merely because this ledger says `QUEUED/ACTIVE`.

## Next checkpoint

`ALIGN-P0` is complete only when:

- the product/repository alignment plan is stored in the repository;
- `docs/INDEX.md` links only to real current resources;
- old reorganization plans are clearly historical/superseded;
- route × Sidebar × permission readiness inventory is captured;
- PR #190 is recorded with its real current status;
- this ledger points to the resulting PR/head.

`ALIGN-P1` is closed: PR #193 merged to `main` as `6811ca1`. PR #194 then merged as `cdbe648c` under the documented sequencing exception; repository Migration 182 still awaits separately authorized Production application and postflight. Next security work is `SEC-172` as Migration 183 on top of 182, followed by `SEC-162` → `SEC-161` → `SEC-171`, before `FINREP-SPEC` reconciliation and `FINREP-1`. Manufacturing (`MFG-P1`/`MFG-P2`/`MFG-P3`) remains a separate, still-unfinished track — see the inventory above.
