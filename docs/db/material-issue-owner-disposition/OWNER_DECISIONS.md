# Pending owner decision register

**NO-GO. All 33 route records in [INVENTORY.json](INVENTORY.json) are PENDING:
owner, decision and approval evidence are null; verification evidence is empty.**
The eight operational gates below are also pending. Documentation authors and
independent reviewers are not assigned operational ownership by this register.
Source facts are in [README.md](README.md); they are not approval decisions.

## Closure rules

For each route/boundary ID, the owner must select and sign one disposition:

| Disposition | Required evidence before closure |
|---|---|
| Approved replacement | Named guarded implementation plus required business semantics, atomicity, identity/org scope, grants, replay/version behavior and target tests. Pilot operation with narrower semantics is insufficient unless the owner explicitly narrows the business requirement and approves the resulting operator workflow. |
| Intentionally unavailable | Verified disabling of every relevant entry/retry/scheduled path, approved operator alternative, pending-work recovery, user communication and monitoring. A permission error or a static no-call finding alone is insufficient. |
| Remains blocker | Named owner and blocked deployment scope, reason, dependencies and next evidence/action. Recording a blocker does not resolve it. |

For GW/DR boundaries with no affected call found, closure also requires a
deployment-specific caller/configuration/usage finding. If verified outside the
affected scope, record that finding, target revision, approver and evidence;
do not silently mark it unused or substitute a replacement. External/scheduled
coverage belongs to G01 even when a repository export has no observed caller.

No disposition here permits grant restoration, a service-role workaround,
swallowed denial, non-atomic substitution, changing canonical bytes, or removal
of the M192/NO-GO holds. Any implementation or operational action needs its own
authorized review and tests. An unavailable financial/MES route may remain a
release blocker until an owner approves a usable alternative.

## Route decisions: each row remains pending

| ID | Affected route / decision needed |
|---|---|
| RPC01 | `rpc_create_mo_with_reservation`: draft/manual creation versus existing production creation with reservations; preserve required atomicity. |
| RPC02 | `create_mo_with_reservation`: no literal call; determine external/dynamic use and required behavior. |
| RPC03 | `release_expired_reservations`: determine scheduler/expiry obligation; manual release is not automatic expiry. |
| RPC04 | `generate_work_orders_from_mo`: automatic generation/routing versus narrower manual WO creation. |
| RPC05 | `schedule_work_order`: individual scheduling requirement and operator alternative. |
| RPC06 | `auto_schedule_work_orders`: automatic scheduling requirement and operator alternative. |
| RPC07 | `assign_routing_to_mo`: routing assignment and downstream dependencies. |
| RPC08 | `release_manufacturing_order`: routing-driven release/WO creation, not just an eligible status. |
| RPC09 | `start_operation`: execution/logging/labor effects, not an eligibility setter. |
| RPC10 | `complete_operation`: production execution completion and dependent effects. |
| RPC11 | `rpc_transition_mo_status`: full state machine and legacy fallback disposition. |
| RPC12 | `rpc_complete_manufacturing_order`: finished-goods inventory and GL completion; no maintenance equivalence. |
| DW01 | Legacy create hook: verify actual consumers; replace or disable its direct insert with approved creation semantics. |
| DW02 | Optimistic update hook: verify consumers and permitted fields; distinguish cache rollback from database outcome. |
| DW03 | Cost-total writer: coherent cost/MO update and explicit error handling; recover possible partial outcomes. |
| DW04 | Creation without materials and development material fallback: include production no-material form and non-atomic reservation failure. |
| DW05 | Relationship insert retry: establish first-request outcome and safe retry/deduplication behavior. |
| DW06 | Status fallback: missing/no-success response handling, production behavior, extra fields and automatic dates. |
| DW07 | Reservation loop: batch atomicity, partial inserts, expiry and displayed parent version. |
| DW08 | Reservation release: quantity/version races and release semantics. |
| DW09 | Backflush settings: configuration ownership and behavior outside the isolated pilot. |
| DW10 | WO status/notes writer: MES semantics versus narrow eligible-state change; verify disabled UI and other consumers. |
| DW11 | Dynamic status retry: both call edges and relationship-classified errors; no retry may silently bypass the guarded path. |
| CP01 | Pause chain: logs/time effects before final status denial, compensation/reconciliation and approved operator pause. |
| CP02 | Bulk release: sequential partial outcome versus atomic batch requirement; distinguish scheduled expiry. |
| GW01 | `getTenantQuery`: deployment/configuration evidence for dynamic table use. |
| GW02 | Tenant proxy: observed SELECT consumer plus any deployed dynamic writer. |
| GW03 | JavaScript `withTenant`: deployed imports, table mappings and raw query use. |
| GW04 | Generic controllers: verify concrete bindings in the target deployment remain outside affected tables. |
| DR01 | Transaction RPC wrapper: actual names supplied by deployed/external consumers. |
| DR02 | TypeScript secure RPC wrapper: six differently named calls; verify target bodies/dependencies if used for affected workflows. |
| DR03 | Voucher reset wrapper: verify deployed two-name restriction remains outside M195 scope. |
| DR04 | JavaScript secure RPC companion: verify deployed imports and dynamic names. |

These IDs match JSON exactly. CP01/CP02 share DW10/DW08 implementations but
require separate workflow decisions because preceding/looped effects differ.

## Operational gates: also pending

| ID | Required owner decision and evidence |
|---|---|
| G01 | Complete deployed/external/dynamic/scheduled/configuration caller inventory, including different-name RPC dependencies and deprecated tools' verified exclusion. Record target revision and usage window. Do not infer non-use from source absence. |
| G02 | Explicit grants, role owners, expiry/renewal/revocation and monitoring responsibilities; privilege/denial readback with real identities. No automatic admin bypass or service-role workaround. |
| G03 | Device policy, operator responsibility and durable event recovery across devices. Event replay/version fencing is not a device lease or proof of human-intent deduplication. |
| G04 | Current #278 target application/behavior record, exact frontend/database identities and hosted browser/operator reconciliation. Local JWT/REST and mocks are not hosted evidence. |
| G05 | Verified server-side pause covering retries and in-flight requests; pending event inventory/recovery; paired client/database cutover and rollback/forward-recovery plan with named owners. Production/Staging require separate authorization. |
| G06 | Target migration application plan/sign-off and permission to apply exact main SQL; readback, negative controls, before/after state and independent acceptance. Repository CI does not prove live application. |
| G07 | Client merge/deployment and release decisions after DB-first verification and compatibility closure. Preserve production hard-disable and all M192/NO-GO holds until separately authorized change. |
| G08 | Baseline regeneration only after canonical migrations appear in the verified Production ledger; independent workflow/PR and clean reconstruction evidence. |

## Record to complete for each ID

The owner adds the following in a reviewed follow-up, with matching JSON route
fields where applicable. An author filling a record without linked approval
does not make the decision approved.

| Field | Current value / required content |
|---|---|
| ID and affected deployment | ID above; exact target revision/environment and business route; pending |
| Accountable owner / approver | Unassigned / no approval |
| Required semantics | Fields/effects, atomicity, financial/MES consequences, expiry and operator expectations; to be agreed |
| Decision | Pending; named replacement, approved unavailability, verified boundary exclusion, or remains blocker |
| Implementation/operator alternative | Pending; source/schema anchors and operator instructions |
| Verification | Empty; exact target identities, real role/denial tests, concurrent/replay/failure cases, recovery and monitoring evidence |
| Approval evidence / date | None; link to explicit owner approval and independent acceptance |
| Outstanding dependencies / holds | All inherited holds remain; no implied closure |

No route record is closed and no operational gate is satisfied by this PR.
