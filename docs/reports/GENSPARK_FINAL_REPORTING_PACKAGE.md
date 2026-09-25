# Wardah ERP — Genspark Final Reporting Package

> **2026-09-25 evidence reconciliation:** current repository anchor is `main@e3869c2f6f7485c423281e42dfc72504edca30e8`. PR #241 is open/unmerged at `c65b2deab0ab642e9f9ca5c73b06f610e2f8284f`; PR #246 is open/Draft/unmerged at `c0e6172e293279d6e364149686849e09d1e2fe3f`. Scanner v2 Slices 1–4 are merged on main through #251, but mandatory migration-CI replacement remains open under #247; #243 is closed and #252 remains open. The M191 §8 throughput/lock-wait report was not located during this reconciliation, so G7 remains an explicit Production gate. Any older Round 9/10 snapshot below is historical unless superseded by this note.


**Document status:** Draft specification — not a final readiness verdict  
**Purpose:** Define the exact report package, evidence rules, closure gates, and update procedure for the final Genspark presentation/reporting cycle.  
**Repository:** `6thd/wardah-process-costing`  
**Current documentation branch:** `docs/manufacturing-canonical-execution-contract`  
**Related manufacturing contract:** `docs/features/manufacturing/CANONICAL_MANUFACTURING_EXECUTION_CONTRACT.md`  
**Primary tracked issues:** `#229`, `#230`, `#234`, `#241`, `#246`, `#247`, `#252`  

---

## 1. Why this document exists

The final Genspark material must not confuse four different questions:

1. **Did Migration 191 close the proven stock-write concurrency defect?**
2. **Did the acceptance/security scanner itself pass independent review?**
3. **Is the complete manufacturing lifecycle authoritative across inventory, costing, WIP, and GL?**
4. **Is Wardah ERP ready for Production use?**

Those are separate claims and must be reported separately.

A successful M191 review is **not** equivalent to full manufacturing readiness. A scanner defect is **not** automatically an M191 production-SQL defect. A green CI run is **not** a Production deployment. A source-confirmed architectural gap is **not** the same as an execution-proven runtime defect.

The Genspark package must preserve those distinctions explicitly.

---

## 2. Reporting package

The final package consists of **three reports plus one evidence annex**.

### Report A — Executive / Management Report

**Audience:** owner, management, external reviewers, non-specialist stakeholders.  
**Target:** concise, decision-oriented, evidence-backed.

Required sections:

1. Executive verdict.
2. What Wardah can currently prove.
3. What remains open.
4. Manufacturing readiness status.
5. Security/authorization status.
6. Inventory/concurrency status.
7. Accounting/WIP/GL readiness status.
8. Production blockers.
9. Final recommendation: `GO`, `CONDITIONAL GO`, or `NO-GO`.

The executive report must never use a single global word such as **"ready"** without naming the scope.

Examples of acceptable statements:

- `Inventory concurrency closure: proven on the frozen acceptance target.`
- `Manufacturing lifecycle readiness: not yet proven end-to-end.`
- `Production deployment: not authorized / not performed.`

Examples of prohibited statements:

- `Wardah is fully secure.`
- `Manufacturing is complete.`
- `M191 passed, therefore the ERP is Production-ready.`

---

### Report B — Technical / Architecture Report

**Audience:** architects, database reviewers, auditors, security reviewers, ERP engineers.

Required sections:

1. Exact repository / PR / SHA topology.
2. M191 concurrency design and lock ordering.
3. Canonical stock-write boundary.
4. ACL and fail-closed behavior.
5. Rollback / forward-reapply proof.
6. Scanner architecture, review history, and remaining limitations.
7. Multi-tenant/RLS scope boundary.
8. UI/API soft-fail vs hard-fail contract.
9. Contention/performance measurement status.
10. Manufacturing lifecycle contract.
11. Retry/idempotency model.
12. Backflush architecture.
13. Completion / FG / WIP / costing / GL contract.
14. Simulation Lab acceptance requirements.
15. Known limitations and technical debt.

This report is allowed to be detailed. It must distinguish:

- source proof,
- isolated database proof,
- CI proof,
- PostgreSQL oracle proof,
- Production readback,
- inference.

---

### Report C — Final Unified Decision Report

**Audience:** final decision meeting / final Genspark deliverable.

This is the authoritative synthesis of Reports A and B.

Required structure:

1. **Frozen evidence snapshot**
2. **Executive verdict**
3. **Proven values**
4. **Open risks**
5. **Manufacturing lifecycle readiness**
6. **Security and tenant isolation boundaries**
7. **Decision matrix**
8. **Release choreography**
9. **Production gates**
10. **Items explicitly not proven**
11. **Final owner decisions required**

No final unified report may be published while the target SHA is moving.

---

### Evidence Annex — not a fourth narrative report

The annex exists so Genspark does not have to infer evidence from prose.

It must contain:

- exact SHAs;
- migration hashes;
- test counts;
- workflow run IDs;
- PostgreSQL version;
- oracle counts;
- rollback result;
- independent reviewer verdicts;
- issue status table;
- Production/Staging access statement;
- unresolved limitations;
- links/paths to governing repository documentation.

---

## 3. Evidence classification

Every material claim must carry one of these statuses.

| Status | Meaning | Allowed wording |
|---|---|---|
| **PROVEN — execution** | Reproduced or validated by an executable test/oracle | `proven`, `reproduced`, `verified` |
| **PROVEN — source/catalog** | Current source/catalog directly establishes the fact | `confirmed from reviewed source/catalog` |
| **STRONG EVIDENCE** | Multiple facts support the risk, but full path not executed | `strongly supported`, not `proven end-to-end` |
| **PLANNED / CONTRACTED** | Design approved/documented but implementation not complete | `planned`, `contract defined` |
| **UNKNOWN / NOT MEASURED** | No sufficient current evidence | `not measured`, `not independently verified` |

A final report must never silently promote a lower evidence class to a higher one.

---

## 4. M191 — what the Genspark report may claim

The previous consolidated analysis established four distinct value categories for M191:

1. **Concurrency correctness** — closure of the demonstrated lost-update class.
2. **Reusable product-lock primitive** — deterministic product-first locking.
3. **ACL / fail-closed contract** — explicit execution-surface control and postflight verification.
4. **Provenance / rollback evidence** — frozen migration bytes and rollback/forward proof.

### Required M191 integrity anchor

Expected M191 SHA256:

`637a81caeaebea60693476222611b373dc1e738cd6b10c634bf4c236227f3f40`

The final report must re-read this value from the final frozen target before publication.

### RED scenario wording rule

The demonstrated RED case must be described narrowly:

> In a specific concurrent first-bin scenario, two successful writes left the stock ledger rows intact while bin/product projection reflected only 7 units/value 70 instead of the correct 12 units/value 120.

The observed `−41.67%` difference is **a property of that test fixture**, not a claim that Wardah loses 41.67% of stock generally.

### M191 scope boundary

A successful M191 closure does **not** itself prove:

- full RLS correctness;
- UI interpretation of all RPC failures;
- acceptable lock-wait/p95 under high contention;
- complete manufacturing costing;
- complete WIP accounting;
- complete GL posting semantics;
- Production deployment readiness.

---

## 5. Scanner / PR #246 reporting rule

The scanner is an **acceptance mechanism**, not the protected migration itself.

The final Genspark report must keep these conclusions separate:

- `M191 production SQL status`
- `scanner soundness status`
- `final #241 acceptance status`

Repeated scanner false-greens must be reported as evidence that the acceptance layer required hardening; they must not be rewritten as M191 production defects unless an independent review proves the production SQL itself is defective.

### Current reporting state

Reconciled 2026-09-25:

- PR #246 remains Open / Draft / unmerged at `c0e6172e293279d6e364149686849e09d1e2fe3f`.
- PR #241 remains Open / unmerged at `c65b2deab0ab642e9f9ca5c73b06f610e2f8284f`.
- Scanner v2 Slices 1–4 are merged on `main` through #251, but v2 is not yet the mandatory migration acceptance path.
- #243 is closed; #252 remains the declared `standard_conforming_strings=off` follow-up.
- G7 contention performance remains unproven until a §8 throughput/lock-wait artifact is recorded.

This remains a **draft snapshot**, not a final status. Replace it with the exact frozen final #246/#241 SHAs and independent verdicts before Genspark publication.

---

## 6. Manufacturing lifecycle readiness — mandatory final section

The final report must include a dedicated section called:

**Manufacturing Lifecycle Readiness — Remaining Canonical Contracts**

This section is mandatory even if M191 and the scanner are fully closed.

### #229 — Partial material consumption retry safety + lifecycle guard

Required end state:

- one stable business-event identity per consumption event;
- the same event identity reused across retries;
- same key + different payload fails closed;
- duplicate retry does not duplicate stock/cost/reservation effects;
- distinct legitimate partial consumption remains allowed;
- invalid/completed/cancelled MO states reject consumption according to the approved lifecycle;
- rollback leaves no partial stock/cost/reservation effect.

**Current classification until executed:** tracked / contract-required; not end-to-end closed.

### #230 — Authoritative manufacturing completion contract

`Completed` must have one meaning across:

- FG stock receipt;
- complete manufacturing cost;
- WIP relief / ending WIP;
- scrap/rework treatment;
- GL state and posting semantics;
- retry/idempotency;
- failure atomicity.

A numerical worked acceptance case is required before implementation is treated as complete.

**Current classification until executed:** architecture/contract blocker for full manufacturing readiness.

### #234 — Canonical backflush reimplementation

Backflush remains a supported product capability, but it must not become a second mutation engine.

Supported policy modes defined by the canonical manufacturing contract are:

- `disabled`
- `manual`
- `operation_complete`
- `mo_complete`

Regardless of trigger mode, backflush must converge on the same guarded canonical material-consumption core.

It must not:

- restore direct legacy `material_consumption` inserts;
- bypass `manufacturing.material_consumption.consume`;
- bypass reservation semantics;
- bypass SLE/bin valuation;
- bypass M191 product-lock ordering;
- invent a second idempotency scheme;
- select BOM rows through an ungoverned `LIMIT 1` rule.

Backflush design must remain consistent with #229 retry identity and #230 completion semantics.

---

## 7. Canonical manufacturing architecture for the final report

Genspark should visualize the manufacturing write path as:

```text
BOM / Routing / Work Order
        │
        ▼
Canonical BOM snapshot / approved material demand
        │
        ▼
Reservation boundary
        │
        ├──────────── manual consumption
        │
        └──────────── backflush policy trigger
                         disabled | manual | operation_complete | mo_complete
        │
        ▼
Stable consumption event identity
        │
        ▼
Canonical guarded consumption transaction
        │
        ├─ authorization / membership / permission
        ├─ lifecycle validation
        ├─ M191 product lock ordering
        ├─ reservation decrement
        ├─ valued stock ledger + bin mutation
        ├─ stage/WIP material cost
        └─ atomic rollback on failure
        │
        ▼
Authoritative completion contract
        │
        ├─ FG SLE/bin receipt
        ├─ materials + labor + OH
        ├─ scrap / rework
        ├─ ending WIP
        ├─ inventory valuation
        └─ GL posting state
```

This diagram is a **target contract** until the corresponding issues are implemented and accepted.

---

## 8. Integrated manufacturing simulation required before final readiness claim

The final Genspark report must not declare manufacturing end-to-end ready based only on isolated RPC tests.

A final integrated simulation must exercise at least:

1. canonical BOM selection/snapshot;
2. MO creation and reservation;
3. partial consumption;
4. lost-response retry using the same event identity;
5. second legitimate partial consumption using a different event identity;
6. manual or automatic backflush according to configured policy;
7. concurrent stock effects under M191 locking;
8. stage/WIP accumulation;
9. labor and manufacturing overhead;
10. scrap/rework treatment;
11. MO completion;
12. FG SLE/bin receipt;
13. inventory valuation;
14. WIP relief;
15. GL entry creation/posting state;
16. retry of completion without duplicate FG or GL effects;
17. full rollback on injected failure;
18. tenant/permission negative cases.

Required final reconciliation:

`BOM demand → reservations → consumed material → SLE/bin → WIP → FG → GL`

The simulation must independently compute expected values rather than trusting an application-produced reconciliation flag.

---

## 9. Final decision matrix

The final unified report must contain a matrix at least this strict:

| Gate | Requirement | Merge blocker? | Production blocker? |
|---|---|:---:|:---:|
| G1 — M191 correctness | exact-head acceptance + concurrency proof | yes for #241 | yes |
| G2 — M191 byte integrity | canonical hash unchanged | yes | yes |
| G3 — rollback/forward | RED returns after rollback; GREEN after reapply | yes | yes |
| G4 — scanner acceptance | fresh independent Astra + Codex on same frozen SHA | yes where scanner is mandatory | yes |
| G5 — RLS/tenant scope | independent tenant-isolation evidence | separate from M191 | yes |
| G6 — UI/API failure contract | soft vs hard failures handled correctly | not necessarily | yes |
| G7 — contention performance | lock-wait/p95/throughput measured | no | yes |
| G8 — quality gates | exact-head CI/Codacy/etc. status recorded | release policy | yes if policy requires |
| G9 — #229 | retry-safe consumption + lifecycle | no for M191 | yes for manufacturing readiness |
| G10 — #234 | canonical backflush implementation | no for M191 | yes if backflush is supported at launch |
| G11 — #230 | authoritative completion contract | no for M191 | yes for manufacturing readiness |
| G12 — integrated manufacturing simulation | end-to-end reconciliation | no for M191 | yes for manufacturing readiness |
| G13 — release choreography | #246 → #241 → frozen final review → main | yes | yes |
| G14 — Production authorization | explicit owner authorization | n/a | mandatory |

---

## 10. Release choreography to report

The Genspark report must show the release path as a controlled sequence, not a collection of green badges.

### Security/concurrency closure

1. Close #246 on a frozen SHA.
2. Obtain two fresh independent reviews on that exact SHA.
3. Merge #246 into the #241 branch only after explicit owner authorization.
4. Capture the new #241 SHA.
5. Freeze #241.
6. Re-run exact-head acceptance and rollback evidence.
7. Fresh Codex + fresh Astra review the exact same #241 SHA from scratch.
8. Merge #241 to `main` only after explicit owner authorization.

### Manufacturing readiness

After #241/#246 cleanup:

1. contract reconciliation;
2. #229 retry-safe/lifecycle implementation;
3. #234 canonical BOM/backflush implementation;
4. #230 authoritative completion implementation;
5. UI/MES consumer alignment;
6. integrated manufacturing simulation;
7. final financial/inventory/WIP/GL reconciliation;
8. final Genspark report publication.

No Production migration/write is implied by documentation or merge. Production remains a separately authorized action.

---

## 11. Production-readiness wording

The final verdict must use scoped readiness labels.

Recommended model:

| Domain | Allowed final status |
|---|---|
| Inventory concurrency | `PROVEN / NOT PROVEN` |
| Security scanner acceptance | `CLOSED / OPEN` |
| Tenant isolation | `PROVEN / PARTIAL / NOT PROVEN` |
| Manufacturing consumption | `READY / BLOCKED` |
| Backflush | `READY / QUARANTINED / DISABLED` |
| Manufacturing completion | `READY / BLOCKED` |
| WIP / process costing | `PROVEN / PARTIAL / NOT PROVEN` |
| GL integration | `PROVEN / PARTIAL / NOT PROVEN` |
| Performance | `MEASURED / NOT MEASURED` |
| Production deployment | `AUTHORIZED / NOT AUTHORIZED / APPLIED / NOT APPLIED` |

The overall ERP verdict may be `CONDITIONAL GO` only if every blocked domain is explicitly excluded from the launch scope. If manufacturing is claimed as supported, #229/#230/#234 and the integrated simulation must be closed.

---

## 12. Required visual assets for Genspark

The final Genspark package should contain these visuals:

1. **Executive readiness scorecard** — one row per domain, not one global percentage.
2. **M191 concurrency before/after diagram** — demonstrate stock ledger vs bin/product consistency.
3. **Product-lock ordering diagram** — products-first before bin mutation.
4. **Release stack diagram** — #246 → #241 → main → Production authorization.
5. **Manufacturing canonical flow** — BOM → reservation → consumption/backflush → WIP → completion → FG → GL.
6. **Risk heatmap** — impact × evidence strength, separating production defect from acceptance-tool defect.
7. **Decision-gate matrix** — merge blockers vs Production blockers.
8. **Evidence provenance panel** — source, PostgreSQL oracle, CI, independent review, Production readback.

Do not use decorative confidence percentages without a defined denominator.

---

## 13. Anti-overclaiming rules

The final report must obey all of the following:

- Never call a skipped deployment `successful deployment`.
- Never infer Production state from repository state.
- Never infer repository state from an old Production snapshot.
- Never treat a CI badge as proof of a business result outside that test's scope.
- Never turn `Strong evidence` into `execution-proven`.
- Never generalize a RED fixture's numerical loss percentage to live operations.
- Never claim tenant isolation from a SECURITY DEFINER scanner alone.
- Never claim manufacturing completion from material-consumption correctness alone.
- Never claim backflush readiness while the canonical backflush path remains quarantined/unimplemented.
- Never publish a final conclusion against a moving SHA.

---

## 14. Finalization checklist

Before generating the final Genspark package, replace every draft field below with current evidence.

### Repository / release

- [ ] final `main` SHA captured
- [ ] final #241 SHA captured
- [ ] final #246 SHA captured
- [ ] #246 independent Astra result captured
- [ ] #246 independent Codex result captured
- [ ] #241 independent Astra result captured
- [ ] #241 independent Codex result captured
- [ ] exact merge sequence recorded

### M191

- [ ] SHA256 rechecked
- [ ] exact-head acceptance rerun
- [ ] rollback rehearsal rerun
- [ ] forward reapply rerun
- [ ] no production-SQL drift

### Security / tenancy

- [ ] scanner status final
- [ ] #243 limitations explicitly listed
- [ ] RLS/tenant-isolation scope independently assessed

### Consumers / performance

- [ ] soft/hard RPC error handling audited
- [ ] lock-wait / p95 / throughput measured

### Manufacturing

- [ ] #229 closed by executable acceptance
- [ ] #234 canonical backflush accepted
- [ ] #230 completion contract accepted
- [ ] backflush launch mode explicitly chosen
- [ ] integrated manufacturing simulation green
- [ ] FG/WIP/costing/GL reconciliation green

### Production

- [ ] explicit owner authorization recorded
- [ ] Production apply state recorded truthfully
- [ ] post-apply readback captured if applied

Only after these are completed may Report C be labelled **Final**.

---

## 15. Recommended Genspark final headline

Until the remaining gates close, the preferred headline is:

> **Wardah ERP has strong, independently reviewed database and inventory-concurrency foundations, but complete manufacturing launch readiness remains conditional on canonical retry-safe consumption, backflush, authoritative completion, and end-to-end manufacturing/accounting simulation.**

Once every required gate is closed, this headline should be rewritten from current evidence rather than mechanically changed to a positive verdict.

---

## 16. Governing references

Repository references that must be re-read before final publication:

- `sql/migrations/191_f2_stock_write_concurrency_closure.sql`
- `docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md`
- `docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md`
- `docs/db/MATERIAL_CONSUMPTION_AUTH_190_RUNBOOK.md`
- `docs/features/manufacturing/CANONICAL_MANUFACTURING_EXECUTION_CONTRACT.md`
- `docs/ai-simulation-lab/README.md`
- `docs/ai-simulation-lab/CATALOG_RPC_SURFACE.md`
- `docs/ai-simulation-lab/CATALOG_INVARIANTS.md`
- issue `#229`
- issue `#230`
- issue `#234`
- PR `#241`
- PR `#246`

If any of these conflict with a newer merged migration, current catalog state, or current frozen SHA, update this report specification before finalizing the Genspark package.

---

## 17. Document lifecycle

This document is deliberately a **reporting contract**, not a snapshot report.

It should survive PR churn and be updated only when:

- the required final report structure changes;
- a new mandatory launch gate is approved;
- a tracked manufacturing contract changes materially;
- the evidence classification rules change.

Transient SHA/test/run values belong in the final evidence annex, not in permanent architectural conclusions.
