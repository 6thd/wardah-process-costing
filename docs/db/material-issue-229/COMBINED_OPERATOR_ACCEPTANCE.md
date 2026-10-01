# Combined technical acceptance and operator compatibility

This is a review candidate, not release approval. Both PRs remain Draft, the M192
hold remains, and no live migration, Production or Staging access is authorized.

## Frozen inputs and assembly

- DB #293: `b95384a917d5a0879350f4598e79a43a4c21e4f1`, tree
  `65777022d83e808402913f9465103742614780d2` (unchanged).
- Client correction parent #294: `321d7c33f7026248ce8832324f5246d9327a3f88`.
- The additional `Material issue combined candidate` workflow checks out the
  exact PR head and combines it with the frozen DB tree in its disposable working
  directory using `git merge-tree` and `git read-tree`. It creates no merge commit
  or remote ref. The log prints both heads and the resulting tree.
- Canonical `sql/` and `scripts/ci/fresh-db/` must remain byte-identical to the
  client head. The database loads the cutoff-189 baseline pair, then M190, M191,
  M192, M193, M194 exactly once, then #291 containment and #293 candidate SQL.

## Two operator compatibility corrections

1. The manufacturing-order form adapter previously copied `products.id` into
   `item_id`. In the isolated branch it now sends product identity without
   inventing an item mapping. The ordinary branch retains its existing payload.
2. The mounted WIP form previously sent quantity, percentage, cost and notes
   fields that the pristine-opening service rejects. The isolated form now sends
   only MO, stage and period fields, hides unsupported inputs, and visibly holds
   editing existing WIP records. The ordinary form retains its existing behavior.

The three new regression tests fail before these corrections and pass after
them. They call the actual form adapter/service and mounted WIP dialog/service;
only the maintenance transport, identity and select widgets are substituted.
The previous WIP row/list permission tests and order-service tests also pass
(40 tests together). Type-check and the reviewed mutation baseline remain gates.

## What the additional browser/PG17 job proves

`tests/fixtures/material-issue-combined/run_local.sh` refuses remote connection
configuration, requires loopback PG17 on a high local port, creates a disposable
database, and drops it on exit. The CI service is unmodified `postgres:17`.

The browser uses actual client services, the mounted WIP dialog and the employee
issue page. A loopback-only test adapter replaces Supabase transport and Auth:
it executes a fixed allowlist of real PostgreSQL RPCs as `authenticated`, using
the fixed consumer's simulated JWT identity. Observer snapshots use the local
database owner solely to inspect effects. All non-loopback browser requests are
blocked. Explicit test grants are seeded; this does not decide operator grants.

The additional job first runs the existing combined SQL acceptance and nine
blocker-based races, then runs Chromium through:

- product-form adapter creation; order status changes; manual WO creation and
  eligibility status; base-unit reservation; pristine WIP opening;
- employee issue of 10 base units, committed server-side with its response lost;
- reload and retry of the identical saved event, matching the receipt and the
  full MO/WO/reservation/WIP/consumption/bin/SLE/product/event/GL snapshot;
- release of the remaining 15 units, preserving consumed history, stock effects,
  WIP cost and GL/journal rows.

Expected markers are `COMBINED_PRODUCT_FORM_PRISTINE_WIP_REAL_PG_PASS`,
`COMBINED_BROWSER_M192_LOST_RESPONSE_RELOAD_REPLAY_STATE_EQUAL_PASS`,
`COMBINED_RELEASE_PRESERVES_HISTORY_STOCK_WIP_GL_PASS`, and
`COMBINED_TECHNICAL_ACCEPTANCE_PASS`. Presence of this harness alone is not a pass;
consult the exact-head job logs and PR evidence record for execution results.
Green unit/build/Sonar checks alone do not prove this browser/PG flow.

Local execution here cannot supply unmodified PG17 under the available UID
namespace. No PostgreSQL source patch is used as evidence for this gate. The
additional standard-PG17 CI job supplies executable evidence, subject to review.

## Operator coverage and remaining prerequisites

| Operator step | Current coverage | Acceptance limit |
| --- | --- | --- |
| Create MO from selected product | Actual form adapter to actual service; new regression and PG flow | Browser harness invokes adapter; not the complete mounted MO form/navigation |
| MO / WO eligibility status | Actual routed service to real RPC | Complete operator navigation and grant UX still need acceptance |
| Manual WO creation | Reviewed client API to real RPC | No mounted operator control calls this API |
| Create / release reservation | Actual service to real RPC | Isolated operator controls are not mounted; legacy auto-reserve is bypassed |
| Resize reservation | Existing candidate SQL acceptance | No mounted isolated resize control; not exercised in the new browser flow |
| Open stage WIP | Actual mounted form to actual service / RPC | Fixed identity and explicit seeded grants |
| Issue / reload / retry | Actual employee UI and IndexedDB to real PG RPC | Fixed identity and local adapter, not Supabase Auth/PostgREST |

**Technical combined acceptance does not close operator acceptance.** Before a
general manual pilot, provide and accept mounted controls for manual WO creation
and eligibility plus reservation create/resize/release, with the exact explicit
grants and pending-event recovery. Alternatively the owner must explicitly choose
and document a narrower pilot with pre-prepared orders/reservations; that choice
has not been assumed. Quarantined generate-work-orders and general MES writers
must not be used as a fallback. Physical counts and the rest of MES remain in
their separate tracks.

Still required: complete combined/operator compatibility acceptance, #278's
application and behavior record, final canonical migration allocation/sign-off,
real-identity browser acceptance with database reconciliation, owner decisions
on explicit grants and cross-device risk, and separate release approval.
Prior accepted policy-setter/sidebar P2s and the accepted five corrections are
not reopened by this delta. Overall rollout remains **NO-GO**.
