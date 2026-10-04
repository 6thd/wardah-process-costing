# M195 caller and direct-write disposition inventory

**Documentation only. Live application and client release remain NO-GO.**
This records source evidence and requests owner decisions. Every decision is
pending; no unavailable route, replacement, privilege change or cutover is approved.
The repository-integration PASS for #301 does not satisfy its deployment gates.

## Frozen scope

| Input | Commit | Tree |
|---|---|---|
| Documentation PR base, main after #299 | `3acea30d83e182a2651b60b8696a658137bc0c92` | `60f5aecb7275660ef8741c3fa18d9f2be48b6b1d` |
| Audited #301 client | `0e462611e49f50d30f888323837d351b03f3acab` | `d73fc628ce9ac1addd3cb844bac51c4f4dd747c2` |

This PR starts from main, adds only this directory, and does not incorporate or
move #301. Source links deliberately use the frozen #301 commit: its client is
not yet on main. [INVENTORY.json](INVENTORY.json) records file SHA-256 values,
exact source anchors, branch conditions, counts and 33 pending route decisions.
[OWNER_DECISIONS.md](OWNER_DECISIONS.md) specifies the missing decisions/evidence;
[REVIEW_PROMPT.md](REVIEW_PROMPT.md) defines independent documentation acceptance.

M195 [revokes writes and legacy EXECUTE](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/sql/migrations/195_material_issue_scope.sql#L87-L110)
from PUBLIC, anon, authenticated and service_role, including column grants on
`manufacturing_orders`, `work_orders` and `material_reservations`. Repository
allocation is known; the current live ledger, identities and usage were not inspected.

The [isolated gate](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/features/manufacturing/material-issue/gate.ts#L2-L4)
is false in production builds. Isolated redirection below therefore supplies
narrow development-only behavior, not production compatibility. Preview builds
in production mode have the same restriction. Denial is containment evidence,
not approval to restore privileges or to leave an operator without a workflow.

## Counted direct writes

There are **10 literal table-write chains in eight files**, plus **one dynamic
UPDATE implementation** resolved through two known call edges. The eleven rows
below count implementations, not users, deployed routes or invocations. CP01/CP02
delegate to these implementations and are not counted again. JSON anchors point
to `.from`; fluent `.insert`/`.update` calls follow on the next line.

| ID / frozen source | Entry point and condition | Required semantics / unresolved compatibility |
|---|---|---|
| DW01 [useManufacturingOrders.ts:33](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/hooks/useManufacturingOrders.ts#L24-L41) | `useCreateManufacturingOrder`: direct MO INSERT when gate false; gate true delegates to `manufacturingService.create`. | Caller-supplied order fields. No runtime consumer of this particular create export found; the same-named hook in `use-manufacturing.ts` is different. Retained code still requires usage/disposition evidence. |
| DW02 [useOptimisticUpdates.ts:13](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/hooks/useOptimisticUpdates.ts#L5-L53) | `useOptimisticManufacturingOrderUpdate`: arbitrary MO UPDATE, no gate. | This is a DB mutation, separate from optimistic cache edits. Cache rollback/refetch is not database rollback. No runtime consumer of this export found. |
| DW03 [supabase-service.ts:397](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/supabase-service.ts#L368-L403) | `processCostService.updateOrderTotalCost`: sums `process_costs`, then updates MO `total_cost`/`updated_at`; no gate. | `processCostService.create` inserts a cost before calling this helper. MO UPDATE response error is ignored. Required cost consistency and failure reporting need explicit disposition; pilot status changes do not replace cost aggregation. |
| DW04 [createOrder.ts:128](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/createOrder.ts#L123-L148) | `insertOrder`: gate false and **no materials, including production**, or missing atomic-create RPC with materials outside production. | Gate true returns guarded `create_order` first. With materials, real RPC errors (including quarantine denial) stop; missing-function fallback is refused in production. The no-material path has no production restriction. |
| DW05 [createOrder.ts:136](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/createOrder.ts#L115-L148) | `insertOrder` repeats INSERT after PGRST200 or a relationship-error message. | Same payload, second HTTP request. No source-only claim that the first attempt persisted, or that repeating it is safely deduplicated. Treat retry semantics separately from DW04. |
| DW06 [updateStatus.ts:251](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/updateStatus.ts#L199-L269) | `updateManufacturingOrderStatus`: direct MO UPDATE after transition RPC is missing, or returns neither error nor success. | Transition fallback has **no production guard**. Completion has its own production fail-closed guard. Genuine non-missing RPC errors throw; relationship-classified errors can reach DW11 through the catch. Data includes status, supplied extra fields and automatic dates. |
| DW07 [inventory-transaction-service.ts:174](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/inventory-transaction-service.ts#L135-L198) | `reserveMaterials`: gate false does availability read then one reservation INSERT per material. | Multi-line loop is separate requests; earlier inserts can survive a later failure. Gate true permits only one material, no expiry and a displayed parent version for `reserve`. Initial multi-line `create_order` is a different atomic operation. |
| DW08 [inventory-transaction-service.ts:251](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/inventory-transaction-service.ts#L207-L269) | `releaseReservation`: gate false reads then updates status, released quantity/time. | Legacy read/compute/write lacks a displayed-version fence. Gate true uses reservation-versioned `release_reservation`. Manual release does not implement automatic expiry. |
| DW09 [efficiencyService.ts:587](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/efficiencyService.ts#L579-L598) | `updateBackflushSettings`: MO UPDATE of `auto_backflush`, `backflush_timing`, `updated_at`; no gate. | Hook `useUpdateBackflushSettings` delegates here. These settings have no isolated maintenance replacement. Retired consumption helpers do not make this configuration writer compatible. |
| DW10 [mesService.ts:340](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/mesService.ts#L328-L353) | `updateWorkOrderStatus`: legacy WO UPDATE of status/notes/time; gate true uses eligibility-only setter and rejects truthy notes. | [M198](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/sql/migrations/198_material_issue_parent_version.sql#L153-L187) limits MO targets to confirmed/in_progress/on_hold; WO source/target to READY/IN_SETUP/IN_PROGRESS/ON_HOLD with in-progress parent. It does not implement start/pause/labor/completion semantics. |
| DW11 [helpers.ts:121](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/helpers.ts#L114-L136) | `performSimpleUpdate(tableName,...)`: two [calls](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/updateStatus.ts#L137-L173) pass `manufacturing_orders`. | One dynamic implementation, not two extra literal chains. First retry uses full `updateData`; error-handler retry constructs status/time and completion end_date. Relationship classification is code/message-based. Isolated status request is outside legacy catch/fallback. |

Creation with material fallback also calls the [reservation helper](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/createOrder.ts#L65-L86),
which logs reservation failure and still returns the created order. This is a
separate-request partial-outcome risk, not the atomic RPC's behavior. The retained
[order form](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/features/manufacturing/services/manufacturingOrderService.ts#L18-L52)
calls `manufacturingService.create` without materials: it reaches DW04 outside
the isolated gate. Service delegation is not a new insert implementation.

## Compound paths and dynamic boundaries

| ID | Source / result of static trace |
|---|---|
| CP01 | [pauseWorkOrder](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/manufacturing/mesService.ts#L357-L384) inserts `operation_execution_logs`, updates `labor_time_tracking`, then calls DW10. Separate requests can leave earlier effects when final update is denied; first two returned errors are not checked. Gate true refuses before any write. [Dashboard action/read constants](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/features/manufacturing/mes/WorkCenterDashboard.tsx#L45-L56) are false: retained service is not proof of an enabled UI route. |
| CP02 | [releaseAllReservations](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/inventory-transaction-service.ts#L271-L289) loops over DW08. Gate true refuses; legacy loop is not atomic and not automatic expiry. No runtime caller found. |
| GW01 | [getTenantQuery](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/core/security.ts#L193-L210) supports dynamic-table writes; no runtime caller found. |
| GW02 | [tenant-client proxy](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/lib/tenant-client.ts#L124-L204) supports dynamic-table writes. Observed tenant-validator consumer is SELECT; no runtime caller of `fromTenant` found. |
| GW03 | JavaScript [withTenant](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/core/supabaseClient.js#L124-L160) maps or accepts a table name and exposes writes/raw `.from`; no runtime caller found. |
| GW04 | [BaseController](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/modules/core/BaseController.ts#L113-L253) implements generic saves/updates/deletes. Observed concrete subclasses bind purchase_orders/goods_receipts, not the three affected tables. Not counted as an affected writer. |
| DR01 | [executeRPC](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/lib/db-transaction.ts#L108-L137) accepts a string. No runtime call of its exported transaction wrapper or manager method found. |
| DR02 | TypeScript [createSecureRPC](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/core/security.ts#L167-L189) has six literal callers in `ui/events.ts`: create_manufacturing_order, apply_labor_time, apply_overhead, upsert_stage_cost, complete_manufacturing_order, update_item_avco. None is an M195 name. Their database bodies/dependencies are outside this audit. |
| DR03 | [resetVoucherToDraft](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/services/payment-vouchers-service.ts#L389-L407) has a two-name type union; both callers use customer-receipt/supplier-payment resets, neither in M195. |
| DR04 | JavaScript [createSecureRPC companion](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/core/security.js#L180-L205) accepts a string; no direct runtime import of this `.js` companion found. |

These eight generic/dynamic boundaries are **not eight confirmed affected
writers**. No-call findings describe this source search only, not hosted usage,
external clients, future calls, dynamic loading or safe retirement.

## Method, exclusions and evidence limits

The corpus is tracked `src/**/*.{ts,tsx,js,jsx}` at the frozen client, excluding
`.test.`/`.spec.`, `__tests__`, `__mocks__` and `database.generated.ts`. TypeScript
AST traversal finds `.from('affected_table')` with insert/update/upsert/delete
in the same fluent chain, and `.rpc('M195_name')` literals. It reports 10 write
chains and 10 RPC calls. Table/RPC identifier searches, dynamic `.from`/`.rpc`
inspection and named callers then resolve DW11, delegates and wrappers. There
are no literal upsert/delete chains targeting these three tables in this corpus.
This is not whole-program data-flow analysis or an audit of every differently
named RPC, trigger, configuration mapping or database writer.

Read-only queries, cache-only changes and type declarations are excluded from
write counts. `SupabaseInventoryRepository` reservations target
`stock_reservations`, not `material_reservations`; configurable valuation writes
use inventory-ledger/items keys and are not confirmed affected-table writes.
Legacy `consumeReservedMaterials`, `backflushMaterials` and `consumeMaterial`
throw before database writes. No new retirement is performed here.
The [deprecated database tools](https://github.com/6thd/wardah-process-costing/blob/0e462611e49f50d30f888323837d351b03f3acab/src/database/README.md)
are outside application-route counts; `run-migrations.js` calls `execute_sql`
with SQL text. They were inspected as source only, never executed, and do not
provide an approved application route or evidence of hosted use/non-use.

The twelve-name RPC inventory is re-anchored to #301 in JSON. It has ten literal
calls and two names with none (`create_mo_with_reservation`,
`release_expired_reservations`). External/scheduled use still needs evidence.
No Production/Staging query, target identity, operator approval, live pause,
pending-event recovery or current #278 application record was collected.
These omissions remain explicit decision gates; this documentation closes only
the missing **source inventory**, not the live compatibility gate.

## Documentation validation

At the frozen source, an independent enumeration pass over 516 tracked corpus
files matched the JSON's ten literal writes and ten M195 RPC calls exactly
(path, line, table/name and operation). Both DW11 call edges matched. All 31
file SHA-256 values matched git blobs; all 64 JSON anchors and 34 Markdown links
were checked. The 33 unique route IDs match the register, and every route
remains PENDING with null approval fields and no verification evidence. All
eight operational gates are present. `git diff --check` passes. No SQL/browser
or application test was rerun for this documentation-only delta; prior #301
runtime evidence is not represented as a fresh test of this PR.
