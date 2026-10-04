# Wardah ERP — Astra Architecture Red-Team Audit #1

**Date:** 2026-09-05  
**Static review anchor:** `main@05c7c9c46c5379d711fbc14a5ee4884cab6ef053` (after PR #226)  
**Current repository baseline after publication:** PR #227 merged as `c1b92e1d03b8e24c2cc6d170ecf7f0d6f02ade36`; baseline cutoff 189.  
**Review mode:** static source/schema/test review only. PostgreSQL/CI were not executed by Astra and Production was not read directly during the audit.

> `Confirmed` below means the reviewed source proves the stated contract/code condition. It does **not** mean the live Production state was independently re-verified by Astra. `Strong evidence` requires a deterministic RED reproduction before being promoted to a confirmed runtime defect.

## Executive verdict

Wardah has strong protections in the legal GL path, but the manufacturing cycle is not yet one unified contract across inventory truth, manufacturing cost, accounting state, and tenant identity.

Highest-value interventions:

1. close the material-consumption authorization boundary;
2. prove and, if reproduced, close the first-bin concurrency race;
3. make partial material consumption retry-safe;
4. define one authoritative manufacturing-completion contract;
5. define how the UI-selected organization reaches PostgreSQL safely.

The audit does **not** recommend a broad rewrite or historical-data repair as the first response.

## Critical findings

| ID | Severity | Confidence | Finding | Primary tracking |
|---|---|---|---|---|
| F1 | S0 | Confirmed from reviewed source | Sensitive material-consumption writes can be authorized by organization membership rather than an exact operation permission; direct `material_consumption` write surface also needs reconciliation. | #154 + #170 |
| F2 | S0 | Strong evidence | First creation of a bin may be vulnerable to a concurrent lost update because `FOR UPDATE` cannot lock a row that does not exist yet. | #228 |
| F3 | S0 | Strong evidence | Partial reserved-material consumption has no reviewed stable business-event identity to distinguish a retry from a new legitimate partial consumption, and the reviewed path lacks an explicit MO lifecycle guard. | #229 |
| F4 | S0 | Confirmed from reviewed source | Manufacturing `Completed` is not one proved atomic contract across FG SLE/bin receipt, complete manufacturing cost, WIP/scrap treatment, and GL posting state. | #230 |
| F5 | S1 | Confirmed from reviewed source | UI, service, and DB tenant-identity sources can disagree for a user with multiple active organizations; no unauthorized cross-tenant disclosure was demonstrated by this audit. | FU-6 / #222 |

## Evidence summary

### F1 — material-consumption authorization boundary

Reviewed source showed `rpc_consume_reserved_materials_v2` using membership-level authorization while `material_consumption` also had authenticated write paths based on organization membership. The concern is not merely UI visibility: a server-side mutation boundary should require the exact business permission and preserve tenant isolation as a separate invariant.

Existing issues #154 and #170 already cover the MES/material-reservation permission family. Do not open a duplicate umbrella issue; implement the narrow consumption boundary under those existing tracks.

### F2 — first-bin concurrency

The reviewed incoming stock helpers read a bin with `FOR UPDATE`, derive a balance, then write through an upsert path. A missing row is not protected by a row lock before it exists. This is sufficient for a serious race hypothesis but not for declaring an end-to-end runtime bug without a deterministic concurrency test.

Issue #228 therefore requires **RED first**, starting from no bin for the same organization/product/warehouse and asserting both SLE effects plus the final aggregate bin/product truth.

### F3 — retry-safe partial consumption

The reviewed consumption path applies stock/cost/reservation effects without a reviewed stable event identity. If a 10-unit consume succeeds and its response is lost, replaying the same business event may be indistinguishable from a valid second 10-unit partial consume.

Issue #229 requires RED replay/concurrency proof, payload consistency for reused keys, an MO lifecycle guard, and separate DB/consumer delivery boundaries if the risk is reproduced.

### F4 — authoritative manufacturing completion

The reviewed completion path does not prove that a successful manufacturing completion simultaneously means:

- finished goods were received into the canonical stock-ledger/bin truth;
- materials + labor + manufacturing overhead + valid adjustments were costed correctly;
- ending WIP/scrap were treated under one approved process-costing policy;
- the resulting GL state is the intended Draft/Posted state;
- retries cannot duplicate any cross-domain effect.

Issue #230 is intentionally a **contract-first** item. The first artifact must be a numerical accounting/manufacturing acceptance case before implementation changes.

### F5 — tenant identity / FU-6

The reviewed system has multiple tenant-identity sources: UI state/local storage, service helpers over active memberships, and DB helpers/claims. For multi-org users these can disagree. The audit did not demonstrate access to an organization for which the user lacks membership, but it did establish correctness/availability ambiguity.

Issue #222 already contains the concrete HR multi-membership failure and the required selected-organization contract. F5 therefore maps to FU-6/#222 rather than creating a duplicate issue.

## Architecture observations worth preserving

- Migrations 179, 182/183, and 184 materially strengthen legal-ledger idempotency, Trial Balance authority, authorization, and GL integrity. These protections should be preserved in every manufacturing/accounting follow-up.
- Passing GL integrity tests does not prove that every operational event produced the correct accounting event or inventory valuation.
- Manufacturing completion currently deserves architectural treatment because it crosses manufacturing, inventory, costing, and accounting truth domains.
- Test names must not be treated as broader proof than their fixtures. In particular, a race test that starts with an existing bin does not close the no-bin creation race.
- Historical remediation and prospective invariant hardening are separate workstreams. Do not guess historical accounting mappings to make prospective tests green.

## Recommended execution sequence

### ASTRA-1 — F1 material-consumption authorization

**Tracking:** #154 + #170  
**Type:** DB/security  
**Goal:** exact permission guard for the consumption operation and closure/reconciliation of bypassable direct-write paths.  
**Must preserve:** tenant isolation, reservation invariants, atomic stock/cost effects.  
**Production:** separate explicit authorization required for any migration apply.

### ASTRA-2 — F2 first-bin concurrency

**Tracking:** #228  
**Type:** inventory/database  
**Gate:** deterministic RED reproduction before fix design.  
**Acceptance:** both concurrent SLE effects survive and final bin/product aggregate equals the sum without lost quantity/value.  
**Production:** separate explicit authorization required for any migration apply.

### ASTRA-3A — F3 DB retry/idempotency contract

**Tracking:** #229  
**Type:** manufacturing/inventory/database  
**Gate:** RED lost-response replay and same-event concurrency proof.  
**Contract:** stable event identity, payload-match validation, MO lifecycle guard, atomic effects.

### ASTRA-3B — F3 consumer event identity

**Tracking:** #229  
**Type:** application consumer  
**Gate:** only after the DB contract is accepted.  
**Contract:** generate one event identity per intended business event and retain it across retries; no silent legacy fallback.

### ASTRA-4 — F4 manufacturing completion contract

**Tracking:** #230  
**Type:** architecture/accounting/manufacturing  
**First PR:** contract + numerical worked case + gap tests, not an implementation rewrite.  
**Must decide:** FG warehouse/UoM, SLE/bin receipt, materials/labor/OH, ending WIP, scrap, GL Draft/Posted state, idempotency, rollback semantics.

### ASTRA-5 — F5 selected-organization contract

**Tracking:** FU-6 / #222  
**Type:** tenant architecture/RLS  
**First scope:** one representative consumer plus two-active-membership tests; no repository-wide helper rewrite in one PR.  
**Acceptance:** selected Org A/B is the effective DB organization, unauthorized org fails closed, stale response from the previous org is not surfaced.

## Astra vs delegate policy

Use **ASTRA** for:

- permission-boundary design and bypass analysis;
- concurrency/locking design;
- idempotency-event design;
- manufacturing completion/WIP/GL contract;
- tenant-identity contract;
- final adversarial review.

Use **DELEGATE** for:

- bounded implementation after the contract is approved;
- mechanical consumer updates;
- test implementation from an already-approved matrix;
- routine documentation formatting.

## Closure rule

No finding is `DONE` because a patch exists or CI is green.

A finding may close only when the applicable chain is evidenced:

`RED/proof → approved contract → focused fix → GREEN/regression → merge → staging/isolated verification → separate Production authorization if required → Production apply/readback if required`.

## Current stop point

Documentation/tracking is the only work authorized by this audit package. No Astra finding implementation, PR merge, migration, or Production write is authorized by this document.