# M195 legacy RPC caller inventory

**Static repository evidence; all live application/release holds remain.**
Anchors and literal call locations are in
[LEGACY_RPC_INVENTORY.json](LEGACY_RPC_INVENTORY.json). The corpus is runtime
`src/**/*.ts(x)` excluding tests and generated types. No external scheduler,
dynamic RPC name, hosted identity or live usage was inspected. Absence below
means no literal source call found, not proof that the function is unused.

| M195-quarantined name | Retained client entry point | Required compatibility disposition |
|---|---|---|
| `rpc_create_mo_with_reservation` | `createOrder.ts`, `createManufacturingOrder` | Isolated `create_order` covers draft/manual preparation only; legacy/production branch still calls this RPC. Owner must replace or retire it before M195. |
| `create_mo_with_reservation` | No literal runtime call found | Check external/dynamic clients; remain quarantined. |
| `release_expired_reservations` | No literal runtime call found | Check scheduled/external callers; manual `release_reservation` is not automatic expiry. |
| `generate_work_orders_from_mo` | `mesService.ts`, `generateWorkOrdersFromMO` | Automatic WO generation has no approved equivalent; manual `create_work_order` has narrower scope. |
| `schedule_work_order` | `capacityService.ts`, `scheduleWorkOrder` | Scheduling remains outside the manual-issue pilot; replace or retire. |
| `auto_schedule_work_orders` | `capacityService.ts`, `autoScheduleWorkOrders` | Automatic scheduling remains outside the pilot; replace or retire. |
| `assign_routing_to_mo` | `efficiencyService.ts`, `assignRoutingToMO` | Routing assignment remains outside the pilot; replace or retire. |
| `release_manufacturing_order` | `efficiencyService.ts`, `releaseManufacturingOrder` | Routing-driven release/WO creation is not the eligible-status setter; replace or retire. |
| `start_operation` | `mesService.ts`, `startOperation` | Execution/logging semantics are not replaced by the eligibility setter; replace or retire. |
| `complete_operation` | `mesService.ts`, `completeOperation` | Production execution completion remains outside the pilot; replace or retire. |
| `rpc_transition_mo_status` | `updateStatus.ts`, `updateManufacturingOrderStatus` | Isolated branch uses eligible-status maintenance; legacy branch still calls this RPC. No full state-machine equivalence is claimed. |
| `rpc_complete_manufacturing_order` | `updateStatus.ts`, atomic completion helper | Finished-goods/GL completion is not replaced by maintenance status changes; replace or retire. |

M195 also closes client INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges
on `manufacturing_orders`, `work_orders` and `material_reservations`, including
column writes. The accepted client redirects selected isolated preparation paths
through the guarded maintenance RPC. Legacy direct writes outside that path are
not made compatible merely by deleting literal RPC calls. Caller disposition
must cover both RPCs and those direct writers, including fallback paths.

Ordinary production builds cannot enable the isolated gate. Consequently all
ten retained literal calls must be treated as open compatibility items for live
M195, even where a narrow isolated replacement exists. Permission-denied
responses from the quarantined functions do not justify restoring grants,
swallowing errors, or enabling a non-atomic fallback. This PR does none of those.

The owner's deployment record must classify each affected route as: approved
replacement with equivalent required semantics, intentionally unavailable with
an approved operator workflow, or release blocker. This inventory requests those
decisions; it does not choose them or claim they are complete. Catalog/ACL and
real target behavior readback must then verify the chosen dispositions.
