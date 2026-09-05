# Wardah ERP — Astra Remediation TODO

**Created:** 2026-09-05  
**Audit source:** [`ASTRA_ARCHITECTURE_RED_TEAM_AUDIT_20260905.md`](./ASTRA_ARCHITECTURE_RED_TEAM_AUDIT_20260905.md)  
**Current repository anchor at creation:** `main@c1b92e1d03b8e24c2cc6d170ecf7f0d6f02ade36`  
**Database baseline:** cutoff 189 published by PR #227.  
**Mode:** Stabilization. One executable remediation PR active at a time.

## Status vocabulary

- `OPEN` — tracked; not started.
- `PROOF_REQUIRED` — strong evidence exists but deterministic RED/live proof is required before implementation.
- `CONTRACT_REQUIRED` — implementation must wait for an approved behavioral/accounting contract.
- `ACTIVE` — the single currently approved implementation track.
- `BLOCKED` — prerequisite unresolved.
- `DONE` — evidence chain is complete for the required environment(s).

## Finding register

| ID | Severity | Confidence | Status | Tracking | Next gate |
|---|---|---|---|---|---|
| F1 | S0 | Confirmed from reviewed source | OPEN | #154 + #170 | Design exact material-consumption permission boundary and RED direct-call matrix. |
| F2 | S0 | Strong evidence | PROOF_REQUIRED | #228 | Deterministic first-bin concurrency RED test. |
| F3 | S0 | Strong evidence | PROOF_REQUIRED | #229 | Lost-response retry RED + same-event concurrency RED + lifecycle proof. |
| F4 | S0 | Confirmed from reviewed source | CONTRACT_REQUIRED | #230 | Approve numerical completion/WIP/FG/GL contract before implementation. |
| F5 | S1 | Confirmed from reviewed source | BLOCKED / existing dependency | FU-6 / #222 | Define selected-org server channel and two-membership acceptance contract. |

## Stabilization queue

The queue below is deliberately serialized to prevent parallel architectural drift.

1. **Documentation package** — this audit + tracker + current checkpoint. No runtime change.
2. **F1 / ASTRA-1** — material-consumption authorization boundary.
3. **F2 / ASTRA-2** — RED concurrency proof, then fix only if reproduced.
4. **F3 / ASTRA-3A** — DB retry/idempotency contract.
5. **F3 / ASTRA-3B** — consumer propagation after DB contract is accepted.
6. **F4 / ASTRA-4** — completion contract + worked accounting case + gap tests; dependent implementation comes later.
7. **F5 / ASTRA-5** — FU-6 selected-org contract, coordinated with #222 rather than folded into HR feature PRs.

## Parked work while the stabilization queue is active

- PR #221 stays Draft while #222/FU-6 is unresolved.
- PR #220 is not part of the Astra remediation wave and should not become a parallel architectural track.
- PR #219 is an older cutoff-187 documentation branch and must not be treated as current baseline authority after cutoff 189 publication.
- No new feature/audit branch should pre-empt the active S0 remediation unless it is a production incident or explicitly authorized priority change.

This parking rule does not close or discard those PRs; it only prevents simultaneous execution drift.

## F1 checklist — exact material-consumption authorization

- [ ] Inventory all consumers of `rpc_consume_reserved_materials_v2` and direct `material_consumption` mutations.
- [ ] Decide the exact canonical permission key(s); do not map to a nearest key without semantic proof.
- [ ] RED: active member without permission fails on direct RPC.
- [ ] RED: active member without permission fails on direct table mutation path.
- [ ] GREEN: explicitly granted ordinary role succeeds only for its organization.
- [ ] Org-admin behavior matches the central RBAC contract.
- [ ] Cross-org denial.
- [ ] Inactive/expired role denial.
- [ ] Revocation takes effect server-side.
- [ ] Posted/final consumption records cannot be mutated outside the approved lifecycle.
- [ ] Existing reservation/stock/cost atomicity regressions remain green.
- [ ] Additive migration only.
- [ ] Separate Production authorization before apply.

## F2 checklist — first-bin concurrency

- [ ] Start with no bin for target org/product/warehouse.
- [ ] Run two independent incoming transactions concurrently.
- [ ] RED proof captured before implementation.
- [ ] Both SLE effects persist.
- [ ] Final bin quantity/value equals the sum of both effects.
- [ ] Product aggregate matches bins.
- [ ] Existing-bin concurrency passes.
- [ ] Two-warehouse same-product case passes.
- [ ] Incoming/outgoing ordering/deadlock case passes.
- [ ] No global unrelated-voucher uniqueness rule introduced.
- [ ] Historical `ADJ-000001` remains out of scope.
- [ ] Separate Production authorization before any migration apply.

## F3 checklist — retry-safe partial consumption

### DB contract

- [ ] RED lost-response replay.
- [ ] RED same-event concurrent submissions.
- [ ] Stable business-event identity defined.
- [ ] Same key + different payload fails closed.
- [ ] Distinct legitimate second partial consumption remains allowed.
- [ ] MO lifecycle/status guard defined and tested.
- [ ] Stock + reservation + cost effects are atomic.
- [ ] Rollback leaves no partial effects.
- [ ] Legacy/bypassable endpoints audited.

### Consumer contract

- [ ] Generate event identity once per intended event.
- [ ] Preserve identity across retries.
- [ ] Never generate a new identity solely because a retry occurs.
- [ ] No silent fallback to a non-idempotent endpoint.
- [ ] Simulated lost response + retry succeeds exactly once.

## F4 checklist — manufacturing completion truth

Before implementation, approve a numerical worked case specifying:

- [ ] input materials and valuation;
- [ ] direct labor;
- [ ] manufacturing overhead;
- [ ] normal/abnormal scrap policy where applicable;
- [ ] ending WIP and equivalent-unit assumptions;
- [ ] completed FG quantity and UoM;
- [ ] FG warehouse receipt/SLE/bin effect;
- [ ] completed unit cost;
- [ ] WIP relief;
- [ ] required debit/credit entries;
- [ ] Draft versus Posted GL success state;
- [ ] retry/idempotency behavior;
- [ ] full rollback behavior.

Guardrails:

- [ ] Do not fix by toggling `auto_post` alone.
- [ ] Do not directly increment additional cached stock totals as a substitute for ledger truth.
- [ ] Do not sum all stage totals without an approved transferred-in/WIP policy.
- [ ] Do not mix historical-data repair into the contract PR.

## F5 checklist — selected organization / FU-6

- [ ] Define the request-scoped server-visible selected-organization channel.
- [ ] DB validates membership for the selected organization.
- [ ] Two active memberships: selected A uses A.
- [ ] Same user: selected B uses B.
- [ ] Unauthorized organization fails closed.
- [ ] Inactive membership fails closed.
- [ ] Permission differences between A/B are respected.
- [ ] A→B switch while a request is in flight does not surface stale A data in B context.
- [ ] Single-org compatibility remains intact.
- [ ] Coordinate with #222 and #156; do not hide the platform fix inside PR #221.

## Closure evidence required per finding

A checkbox list alone is not completion. Each finding must record links/SHAs for the applicable evidence:

- RED artifact/test;
- design/contract decision;
- migration or implementation PR;
- GREEN/regression CI;
- merged SHA;
- isolated/Staging verification where applicable;
- separately authorized Production apply where applicable;
- Production readback/postflight where applicable.

## Authority

This tracker orders work; it does **not** authorize merges or Production writes. Those remain separate explicit decisions.