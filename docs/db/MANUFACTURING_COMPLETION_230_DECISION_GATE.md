# #230 — decision and implementation gate for legal manufacturing completion

**Status:** review supplement to [canonical contract §22.3–22.6](../features/manufacturing/CANONICAL_MANUFACTURING_EXECUTION_CONTRACT.md), not a new completion algorithm or accepted accounting policy. Anchor: `main@76689dc076ca50f1765603bf7fb17439e4d0af39` after M192 repository merge. Executor read-only Production ledger on 2026-09-28 shows M190 → M191 → M192 applied once each; no live completion experiment is claimed. No code or SQL changes in this PR.

## Existing numerical oracle

Keep canonical §22.5 case 1 as the provisional oracle: RM 1,000 + stage-1 labor 200 + OH 100 + stage-2 packaging 90 + labor 160 + OH 96 = **1,646 incremental input**. Abnormal loss 26, ending WIP 0, finished goods 90 units at 18 = **1,620**; `1,620 + 0 + 26 = 1,646`. The stage-1 transferred-out 1,274 flows into stage 2 **once**, rather than being added again to the sum of both stage totals. The journal is conditional on §22.5 AS-1 and the decisions below. Case 2 receives 80 units at 1,040, retains ending WIP 230, then receives 20 at 260 and only then reaches `done`. Recompute both cases if an assumption changes.

## Decisions to record before an implementation migration

| Decision | Proposed choice for review | Required acceptance consequence |
| --- | --- | --- |
| D-PERM | New explicit `manufacturing.orders.complete` permission; Org Admin retains only its existing checked bypass. No generic `orders.update` terminal write. | Unprivileged member and direct MO UPDATE cannot reach `done`; authorized event alone can. Test role revocation. |
| D-FG-WH | Persist the destination warehouse as an explicitly selected, same-org, valid warehouse on the completion event; snapshot it in the immutable event receipt. | Missing/foreign warehouse denies before mutation; replay cannot redirect receipt. |
| D-GL-POST / D-GL-TIME | Owner must choose whether terminal GL is Draft or Posted and whether material GL posts at each issue or completion. Recommend **Posted before terminal success** if the goal is a reconciled final state, but require a period-close and posting-authorization review before approving. | No `done` with missing/incorrectly staged GL. Never post duplicate issue or FG entries on retry. Draft-only success requires a clearly named provisional state rather than silently calling it accounting-final. |
| D-WIP-ACCT / D-STAGE | Choose one WIP control account with stage subledger or separate stage accounts; choose *incremental* versus *cumulative* stage-cost storage from verified database behavior. | Sum incremental inputs once; no duplicated transferred-in cost. Reconcile WIP after each partial receipt. |
| D-LAB / D-OH / D-SCRAP | Link labor, overhead and normal/abnormal scrap to reviewed, server-derived, approved sources and rate policy; identify abnormal-loss account and inspection point. | Unapproved client/PENDING costs never enter FG; abnormal loss 26 remains separate in case 1. |
| D-METHOD / D-PARTIAL | Approve WA or FIFO for each stage/MO and whether 80+20 partial FG receipts are allowed. Recommend preserving the partial-receipt case while MO remains `in_progress`; settle method before valuation SQL. | Case 2 preserves 230 WIP and permits the second 20-unit receipt; two event IDs, each replay-safe. |

The choices marked “proposed” are for independent accounting and operations review; this PR does not turn them into policy. The canonical register also has D-LIFE; M192 already fixes new consumption to `in_progress` and WO to the configured policy. Completion's own lifecycle must agree without reopening cancelled/done issues.

## Dependency and concurrency gates

1. Close the authoritative process-cost data path [#260](https://github.com/6thd/wardah-process-costing/issues/260) before computing FG from `stage_costs` or client totals. Reconcile M192 POSTED consumption to the stock-valued SLE, then to stage WIP; prohibit hand-inserted costs.
2. Make *every* path to terminal `done` use one idempotent, authorized orchestrator. Direct MO status updates, `rpc_transition_mo_status` and the WO trigger may signal readiness but cannot complete FG, GL or MO separately. Do not fix the trigger's `42702` alone.
3. **Resolve the reachable MO↔WO deadlock before enabling the trigger.** M192 issue locks MO then WO, while the current WO UPDATE trigger takes WO then MO. A disposable review reported a `40P01` deadlock after patching only the trigger ambiguity. Design one consistent lock order across WO status and material issue; prove it with two real sessions in both commit/rollback orders, including same MO, separate events, policy changes and a late issue racing completion. No raw deadlock may be accepted as business success.
4. Lock MOs, WOs, policy, WIP, reservations and products consistently with M191/M192, then commit canonical FG SLE/bin/valuation, remaining WIP, exact accepted cost, balanced GL and MO status **in one transaction**. Assert atomic failure at each stage and stable same-event replay.
5. Put implementation in additive migration(s) and client PR(s), keeping M190–M192 byte-identical. Review exact head and PG17 RED→GREEN before any separately authorized Production deployment. Staging requires a trusted rebuild and E2E before UI enablement.

**Definition of accepted completion:** with proposed policy choices approved, a completion event has one stable result; FG bin/SLE equals accepted FG quantity and value; product projection matches bins; remaining WIP and loss reconcile to incremental inputs; balanced GL has the approved state; MO terminal status is committed last within the same transaction. A failed event leaves every domain unchanged.
