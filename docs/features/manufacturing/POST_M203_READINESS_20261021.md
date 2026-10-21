# Manufacturing readiness after M195–M203 — inventory, dependencies and decision register (2026-10-21)

**Type:** review document. It changes no code, migration, grant or data, and it does not decide any accounting or operational policy.
**Anchors:** `main@034aad391f1009e514aa26b1f0b0069391fc3740`; GitHub issues and PRs read 2026-10-21T12:33Z (public API, read only);
schema facts from the Production catalog observed after M203 in the 2026-10-21 window (catalog signature equal to the pre-built
expected state E_10). See [M195–M203 Production application](../../db/M195_M203_PRODUCTION_APPLICATION_20261021.md).

The weekly report for 12–19 October is a historical source: it predates the 2026-10-21 application and is not a description of
the current state.

## 1. Baseline facts that this inventory relies on

| Fact | Evidence | What it does not mean |
|---|---|---|
| M195–M203 and the CRLF script are applied to Production, once each, with every pre-registered check passing | Application record above | Not atomicity under every failure (N23 proved specific B2 cases on a throwaway project); not a restore of the hosted project |
| The G9 containment of 195 is in force | 195 revokes INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on `manufacturing_orders`, `work_orders`, `material_reservations` and EXECUTE on 12 legacy functions from `PUBLIC`/`anon`/`authenticated`/`service_role` | MO/WO/reservation maintenance through those paths is unavailable until a compatible client is accepted and a resume decision is taken |
| `labor_time_logs` and `moh_applied` do not exist (`labor_time_tracking` does); `stage_costs` columns include `good_qty`, `scrap_qty`, `dm_cost`, `dl_cost`, `moh_cost`, `transferred_in`, `mode` | Observed catalog after M203 | The #260 RED of 2026-09-25 (cutoff-189) still describes the client and engine inputs |
| `complete_manufacturing_order`, `apply_labor_time`, `apply_overhead`, `create_manufacturing_order` do not exist; `upsert_stage_cost` exists only as `(p_tenant, p_mo, p_stage, p_wc, p_good_qty, p_dm, p_mode, …)`; `rpc_complete_manufacturing_order(jsonb)` exists with EXECUTE held by `postgres` only | Observed catalog after M203 | `rpc_complete_manufacturing_order` is not an accepted completion path (#230); it is unreachable for client roles |
| `rpc_consume_material_event` (M192) was not modified by 195–203 | TP-9 per-step difference tables (no entry for it in steps 195–203) | Its behaviour under the post-195 environment was not re-run here |
| No backflush trigger is attached to `manufacturing_orders`, `work_orders`, `material_consumption` or `material_reservations` | Observed catalog after M203 (trigger list of those tables) | `backflush_materials(uuid, numeric)` still exists with EXECUTE for `authenticated`; its catalog comment describes it as a permission-gated retired entry point (#234). Its body was not re-run here |
| Database deployment and the Vercel client deployment are independent | Repository workflow (CLAUDE.md, "repository-first / DB-first") | Applying 195–203 deployed no client |

## 2. Status, dependencies and required work

| Issue | Current behaviour | Evidence | Dependency | Absorbed in `main` | Required fix | Acceptance criterion |
|---|---|---|---|---|---|---|
| **#260** stage costing | Client stage-costing writes target absent tables/columns; unit cost computed client-side; Equivalent Units page showed static figures and stub actions | Issue RED (2026-09-25) + observed catalog after M203 | Owner decisions **D-LAB/D-OH** (labor and overhead sources and rates) and **D-STAGE** (incremental vs cumulative rows), jointly with #230 | Nothing of the engine repair | Interim (branch `fix/260-stage-costing-fail-closed`): writes refuse before any request; honest Equivalent Units page. Then DB-first repair of `upsert_stage_cost_core` / `rpc_cost_of_production_report` after the decisions | Issue §"Required before implementation" 1–5, including the 900-EUP weighted-average case, FIFO and scrap on disposable PG17, then mounted-UI readback |
| **#230** completion | No supported completion path: legacy completion/transition RPCs (including `rpc_complete_manufacturing_order`) and direct MO writes are revoked from client roles by 195; `complete_manufacturing_order` does not exist | Observed catalog; contract §22 and [decision gate](../../db/MANUFACTURING_COMPLETION_230_DECISION_GATE.md) | Decisions D-PERM, D-FG-WH, D-GL-POST/D-GL-TIME, D-WIP-ACCT/D-STAGE, D-LAB/D-OH/D-SCRAP, D-METHOD/D-PARTIAL; #260 closed first; MO↔WO lock-order gate; #195 (data) for GL acceptance | Contract, worked cases and gate document only | One authorized idempotent orchestrator committing FG SLE/bin, valuation, remaining WIP, accepted cost, balanced GL and MO status in one transaction (new additive migration ≥ 204) | Gate document "definition of accepted completion" and §22.5 cases 1 and 2 |
| **#229** consumption retry | DB core is M192: stable event identity, replay returns the stored receipt, changed payload → `MATERIAL_ISSUE_EVENT_CONFLICT`, lifecycle and WO policy checks; two-session races in `docs/db/material-consumption-192/concurrency.py` | M192 application record; acceptance in `main` | Consumer UI (#301), narrow #170/#154 slices, real-browser acceptance, cross-device decision, pilot decision; M192 event hold | DB core (M192) and the read/maintenance RPCs of 195–198 | Accept the consumer (#301 candidate) on an isolated environment; no DB change identified | Issue #229 comment 2026-09-30 checklist |
| **#234** backflush | Retired: no backflush trigger attached; the manual entry point is described as permission-gated and retired | Observed catalog; issue comment 2026-09-25 | Decisions on BOM selection (approval, version, effective dates, alternatives) and whether automatic backflush is allowed under which actor; sequenced after #229 consumer and before #230 | Quarantine only | Backflush as an input mode into the #229 core (same event identity, BOM snapshot, canonical consumption) — not a second engine | Issue acceptance list (no/one/ambiguous BOM, cross-org, permission, no direct `material_consumption` insert, reconciliation, rollback, retry via the #229 identity) |
| **#171** audit forgery | `audit_logs` INSERT open to authenticated callers for own user/org | Issue (2026-08-23) | Separate security design | — | Not in this round. The stage-costing actions use a local audit stub and send no client audit row | Issue §"Required design" |
| **#195** (issue, not migration 195) | 16 posted GL lines with unmapped four-digit codes | Issue (2026-08-28) | Owner/accountant mapping decision | — | Not in this round; limits the acceptance of any completion GL effect (A4 below) | Issue |

## 3. Decision register (open; not decided here)

| Decision | Question | Options and their effect |
|---|---|---|
| D-LAB / D-OH (#260, #230) | Which server-side sources carry labor and overhead into stage cost? | (a) existing `labor_time_tracking` plus an approved overhead-rate source; (b) new reviewed tables; (c) defer labor/OH and cost materials only. (a) needs a mapping from tracking rows to stages and an approval state; (b) adds schema and acceptance; (c) under-states FG cost until resolved and must be labelled provisional |
| D-STAGE (#260, #230) | Are `stage_costs` rows incremental per stage or cumulative including transferred-in? | Incremental: FG = Σ inputs once; cumulative: transferred-in must be excluded when summing. Either works only if enforced in one place; mixing double-counts (the §22 invariant) |
| D-PERM (#230) | Who may complete an MO? | A new explicit `manufacturing.orders.complete` key (proposed in the gate) vs reusing an existing key; affects role templates and acceptance |
| D-FG-WH (#230) | Where does FG go? | Destination warehouse on the completion event (proposed) vs a per-product default; affects replay safety and multi-warehouse orgs |
| D-GL-POST / D-GL-TIME (#230) | Draft or Posted at completion; material GL at issue or at completion? | Posted-before-success gives a reconciled final state but needs period-close and posting authority review; Draft needs a clearly provisional state |
| D-WIP-ACCT (#230) | One WIP control account with a stage subledger, or one account per stage? | Affects mappings, reports and #195-style account hygiene |
| D-SCRAP (#230) | Normal vs abnormal scrap, inspection point, abnormal-loss account | Abnormal loss must stay outside FG (case 1: 26) |
| D-METHOD / D-PARTIAL (#230) | Weighted average or FIFO per stage/MO; partial FG receipts allowed? | Method changes valuation SQL; partial receipts keep ending WIP valued (case 2) |
| D-BOM / D-AUTO (#234) | BOM selection rule; automatic backflush allowed and under which actor? | Contract default is disabled; enabling requires an explicit system-actor and the #229 identity |

## 4. Acceptance matrix

| Criterion | Evidence now | Remaining |
|---|---|---|
| #260: client writes to absent objects stop | Branch `fix/260-stage-costing-fail-closed`: refusal before any request, unit tests, full suite | Review and merge decision |
| #260: Equivalent Units shows no fake figure or action | Same branch: page states unavailable; test with a negative control against the old component | Real data after the engine repair |
| #260: engine runs on the real schema; 900-EUP, FIFO, scrap cases | — | Needs D-LAB/D-OH and D-STAGE, then DB-first repair on disposable PG17 |
| #230: one atomic completion; failure leaves every domain unchanged | — | Needs the decisions in §3 and #260 |
| #230: unprivileged or direct-table completion impossible | Containment of 195 revokes the legacy paths (observed catalog) | Positive authorized path does not exist yet |
| #229: replay does not duplicate; changed payload rejected; concurrent same event | M192 acceptance and two-session test in `main` | Re-run in the post-195 environment with the consumer; browser/identity acceptance |
| #229: cross-org / unauthorized rejected | M192 acceptance | Same as above |
| #234: no second consumption engine; manual + backflush cannot double-consume | Backflush retired (no backflush trigger; entry point described as permission-gated retired) | Contract decisions, then implementation as an input mode of #229 |

## 5. Related pull requests (state as read 2026-10-21T12:33Z; not changed by this document)

| PR | State | Finding |
|---|---|---|
| #301 material-issue client | Open, Draft, head `0e462611`, base `main@3acea30d` (92 commits behind) | Merges onto `main@034aad39` with no conflict. The eight material-issue RPCs it calls (`rpc_consume_material_event`, `rpc_get_material_issue_context`, `rpc_get_material_issue_wo_statuses`, `rpc_get_material_reservation_setup`, `rpc_list_material_issue_orders`, `rpc_manage_material_issue_setup`, `rpc_reconcile_material_issue_setup`, `rpc_set_material_issue_wo_statuses`) exist in the observed post-M203 catalog with the argument names it passes. Calls already present in files it touches (`start_operation`, `complete_operation`, `rpc_complete_manufacturing_order`, `generate_work_orders_from_mo`) are revoked by 195 and stay unavailable. A candidate branch on current `main` is prepared separately for review |
| #304 QC UI | Open, Draft, head `1781c981`, stacked on a non-main base | Carries its own copy of `199_manufacturing_quality_control.sql`; conflicts with the canonical 199 in `main` (5 files). Needs rework onto the applied 199/202 before review; not a dependency of #260/#230 |
| #308 integration of frozen candidates | Open, Draft, head `2ea72541` | Historical frozen reference; conflicts on the same 199 files. Not to be merged as is; nothing identified as both required and not yet absorbed |
| #319 Sonar auth diagnostics | Open, Draft, head `0e1242bf` | Its purpose (diagnose the Sonar token failure) was met: Sonar passed on #318 after the token update and on the merge commit. Recommendation: close as superseded (owner decision) |

## 6. Out of scope here

Prometheus/PromQL monitoring (later, separate phase); hosted Staging/E2E writes; any Production migration; any resume of writers or users.
