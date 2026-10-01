# Material issue: operator, decision and migration review package

**NO-GO for rollout.** This package completes mounted isolated preparation controls and adds candidate CI acceptance. It does not grant roles, allocate canonical migrations, approve a device policy, apply a live migration, close #278/#170/#154, or remove the Production/M192 hold.

## Mounted operator scope

The material-issue page has a lazy “Prepare material issue” panel. A scoped link from the manufacturing order screen is visible only with the isolated flag and one of consume/prepare/reserve/release. The catalog entries remain hidden with #229. Production is held independently of the flag.

| Control | Server operation | Required exact keys |
|---|---|---|
| Product-only draft MO | `create_order` | prepare + orders.create |
| MO eligibility | `set_order_status` | prepare + orders.update |
| Manual WO | `create_work_order` | prepare |
| WO material eligibility | `set_work_order_status` | prepare |
| Base-unit reservation | `reserve` | reserve |
| Resize pristine base-unit total | `resize_reservation` | reserve |
| Release unconsumed quantity | `release_reservation` | release |
| Pristine stage WIP dialog | `open_stage_wip` | prepare + stage_costs.create |

All short names are `manufacturing.*` keys: prepare=`material_issue_setup.prepare`, reserve=`material_reservation.reserve`, release=`material_reservation.release`. Writes use the existing immutable maintenance gateway and frozen SQL; there is no direct-write fallback. Reserve resolves its base UOM through the existing scoped read RPC before persistence. The displayed MO/WO/reservation version is submitted; the UI does not silently fetch a newer version to overwrite someone else's change. Decimal input explains invalid digits/precision instead of silently rounding. Historical or non-base reservations may be released but cannot be resized.

Read catalog pages are org-scoped, ordered by UUID and paginated through all rows, including terminal MOs needed for release. Every row and the current user/org are verified. A failed read or storage operation blocks new sending; saved-event recovery remains separate. Identity changes remount the form. Permission state is rechecked after the Auth await, and the frozen gateway/server remain authoritative.

## Permission and device choices

Org Admin's isolated policy page can export a **draft** decision; nothing is preselected. Choose combined operator, separated preparer/keeper/issuer, or supervised preparer/issuer/releaser. Exported profiles contain exact keys, no wildcards, no Admin shortcut and no template expansion. Use the existing owner-controlled role process to implement approved grants after the permission catalog is installed. Name the people, org, role IDs and expiries in the sign-off; verify each positive and negative action with that user's actual role assignment. The export is a proposal, not an audit record of grants.

Device choices are operational:

- **Designated workstation:** assign one station for each MO/shift. Reconcile outstanding events and record the handover before moving stations. The server does not enforce this designation.
- **Coordinated devices:** allow multiple stations only after the owner accepts that different event UUIDs can represent duplicate human intent. Require coordination and post-operation reconciliation. Same-event replay remains idempotent; different events are separate requests.
- **Server lease required:** keep rollout held until an enforceable device lease/durable intent mechanism is implemented and independently accepted. It is explicitly unavailable in this package.

Changing either choice resets acknowledgement. Every export has `state=draft`, `release_ready=false`, `server_lease_available=false` and `distinct_event_duplicate_intent_prevented=false`. A checkbox neither approves rollout nor changes server permissions. These options do not hide unresolved events or permit a device switch to erase them.

## Proposed migrations and ordering

Main was checked at `94400e1b78f7f5f1716568df96dba7cde2558d12`; its canonical maximum is 194. Proposed destinations are **195 scope containment → 196 maintenance/reconciliation**. They are review artifacts under this directory, not entries in canonical `sql/migrations` or MANIFEST. Their SQL bytes are identical to frozen #291 `75b4be4d…` and #293 `b95384a9…`; `MIGRATION_PACKAGE.json` gives full revisions and SHA-256 hashes. Neither frozen candidate changes.

Legal fresh order is the matching cutoff-189 baseline/reference pair, then **190 → 191 → 192 → 193 → 194 → proposed 195 → proposed 196**, each once. M190 must precede M191. On an existing database, inspect its migration/application record and definitions; apply only verified missing migrations after separate approval. Never replay 190–194 merely because this package lists them. No migration application is authorized by this runbook.

`run_migration_package.sh` creates a disposable loopback PG17 database, copies canonical files and the proposals into a temporary apply directory, asserts the exact seven-file order, installs before any test fixtures, then runs containment, maintenance, reconciliation and blocker-based races. This catches dependencies hidden by pre-seeding. It never changes canonical files.

Before promotion: recheck the current canonical maximum, allocate the numbers in a separate reviewable canonical PR, add MANIFEST rows accurately marked review/application-pending, retain SQL semantics/hashes, obtain independent sign-off on that final tree and its standard-PG17 chain. Allocation collisions require renumbering and rerunning the package. Prepare a read-only privilege/function/caller inventory and application evidence for #278; a previous staging observation is not a current application record. The old direct MO/WO/reservation writers remain quarantined; broader MES/capacity/efficiency flows are still outside this manual-issue pilot.

A failed installation keeps the UI held. Do not “rollback” by restoring quarantined legacy privileges or deleting committed stock/cost/events. Review the actual transaction/application state and choose an approved roll-forward or restore procedure with a verified backup. Application record should include environment identifier, actor, UTC time, pre/post migration ledger, exact hashes, privileges, #278 behavior markers, grant dispositions and reconciliation evidence; no passwords/tokens.

## Acceptance and evidence boundaries

| Evidence | What it proves | What it does not prove |
|---|---|---|
| Vitest/type-check/build | Input/version/permission gates, draft export, simulated recovery, ordinary-path regressions | Native IndexedDB, JWT/REST authorization or live database |
| Combined native Chromium → standard PG17 | Clicked MO/WO/status/reserve/resize/release/WIP controls, real candidate RPC effects, lost-response replay, two-profile stale intent and durable reconciliation fence | Auth is fixed/simulated; network failure is injected; owner UX sign-off |
| Local vendor Supabase Auth + PostgREST + native Chromium + PG17 | Password sign-in, real signed JWT and REST role/claims, same mounted flow/reconciliation, old-JWT permission revocation with no effects, sign-out | Hosted Supabase configuration, live membership/identity, Staging/Production or owner approval |
| Proposed seven-file migration chain | Frozen SQL installs before fixtures in legal order on an unmodified server | Canonical allocation, live application or final sign-off |

The native trace compares the actual event UUID shown in the receipt. Replay compares the full captured state. Release compares consumption, SLE, bins, WIP, products, issue events, GL entries/lines and journal entries/lines against the posted state. GL remains empty in this manual issue fixture: this is an absence-of-effects assertion, not a demonstration of GL posting. The local owner observation connection is separate from authenticated RPC execution. CI is a stacked candidate gate, not a durable release/deployment gate.

The real-Auth runner uses upstream `supabase/gotrue:v2.196.0` and `postgrest/postgrest:v14.17`, local test credentials, vendor Auth tables, and a local `auth.uid()`/`auth.role()` compatibility adapter for PostgREST JWT-claims JSON. It does not modify PostgreSQL or business/canonical SQL. No service JWT reaches the browser. Local fixture grant controls affect only the named disposable org/role and use literal parameterized SQL. They are not product routes.

Run from the combined #294/#293 tree with standard PostgreSQL 17 on 127.0.0.1:55432, `PGUSER=postgres PGPASSWORD=postgres`; the runners reject connection URL/service/PGHOSTADDR overrides. `bash tests/fixtures/material-issue-combined/run_local.sh` needs Chromium. `bash tests/fixtures/material-issue-real-auth/run_local.sh` additionally needs Docker and starts vendor services bound to loopback, cleaning them up on exit. The shared candidate workflow runs these and the seven-file package. Their results must be read on the exact final SHA before treating any new gate as passed.

## Remaining release prerequisites

1. Independent acceptance of the final mounted operator UI and reconciliation delta; no repeat review of accepted policy-setter/sidebar P2s or frozen DB logic.
2. Owner decisions on exact grants/expiry and device arrangement, with written risk disposition; a lease-required choice remains blocked.
3. Final canonical migration allocation/MANIFEST/sign-off and an approved application plan; the proposals are not allocated or live.
4. Current #278 application/behavior record and compatibility disposition for remaining quarantined callers, limited #170/#154 manual-issue scope.
5. Deployment-specific real identities, browser/network/storage/permission/tenant/policy changes, with database reconciliation and operator acceptance. Local vendor Auth evidence reduces uncertainty but cannot certify a hosted environment we did not access.
6. Separate release approval. M192 and Production hold remain in place until that decision.
