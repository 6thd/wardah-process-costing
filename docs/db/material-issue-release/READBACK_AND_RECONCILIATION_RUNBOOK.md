# Read-only application evidence and reconciliation triage

**NO-GO remains.** These tools neither apply a migration nor grant, revoke, send,
replay, fence or acknowledge an event. They do not connect to a target database:
an operator must export data from an independently authorized connection.
No Production/Staging export has been performed for this change.

## Catalog evidence

MIGRATION_PACKAGE.json pins 22 effective M192–M197 functions to their last
reviewed definition, including the posted-history/WIP guards, policy RPCs,
containment reads and maintenance/reconciliation RPCs. Source fingerprints are
recomputed without a database. Expectations are not learned from a target dump.
195/196/197 bytes and hashes are unchanged by this work.

The profile compares exact signature coverage (missing or extra overload fails),
body MD5, owner, language, kind, SECURITY DEFINER, function settings, normalized
ACL (including grantor/grant option) and effective EXECUTE for anon,
authenticated and service_role. Effective privileges catch inherited execution
even if the direct ACL appears correct. The owner must be supplied explicitly
from the approved application plan, never copied automatically from the dump.
The profile reflects the reviewed baseline's grants; it does not revoke existing
service-role grants on M192 or change the eventless wrappers' failing behavior.

An approved operator can export with their explicit connection options and
credentials supplied through their existing secure mechanism:

```sh
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/catalog_readback.sql > /tmp/wardah-catalog-readback.json
python3 docs/db/material-issue-release/verify_catalog_readback.py --expected-owner postgres < /tmp/wardah-catalog-readback.json
```

`postgres` is the disposable CI owner, not an assumption about a future target.
The SQL enforces a read-only repeatable-read transaction, uses only catalog
queries, exports one JSON document and rolls back. The offline comparator exits
0 on profile equality, 1 on drift and 2 on invalid evidence. It does not prove
authenticity of a file supplied by an operator. Store the capture timestamp,
database identity, source revision and verifier result with the application
record; independently confirm that the connection is the authorized target.

**Scope limit:** this is a PG17 profile for these 22 functions. It does not prove
migration history/order/exactly-once application, all M190/M191 functions, trigger
attachment/enabled state, table/column containment, M195's quarantined legacy-RPC
EXECUTE containment, unrelated writers or the
complete #278 behavior record. Those remain separate release prerequisites.
An environment-specific owner/ACL difference fails for review; do not regenerate
expectations from that environment merely to make it pass.

## Reconciliation evidence

The maintenance events table holds only `applied` receipts and `closed` fences.
It has no server-side unresolved state. A command still in IndexedDB may be
unknown before reaching the server, already applied, or fenced but not yet
acknowledged. Zero server rows cannot establish zero unresolved browser intents.

The owner-only read-only export contains event/org/actor/operation/state and
resolution time, without command payloads, receipt bodies or credentials:

```sh
psql -X -qAt -v ON_ERROR_STOP=1 -f docs/db/material-issue-release/reconciliation_readback.sql > /tmp/wardah-reconciliation-server.json
```

Pass one JSON document on stdin to monitor_reconciliation.py with two keys:
`server` (the exact export) and `inventory` (the operator's declared roster and
observations). This change supplies no product-side export or automatic collector.
Each source is a **station/browser-profile/org/user** scope. Include every scope
from the owner's device plan; multiple users/profiles on a station are separate
sources. An inaccessible profile or failed storage read must be recorded as
`read_succeeded:false`, never as a verified empty list.

Inventory shape (timestamps must include timezone):

```json
{
  "expected_sources": ["station-A/profile-1/org-A/user-A"],
  "sources": [{
    "source_id": "station-A/profile-1/org-A/user-A",
    "org_id": "00000000-0000-4000-8000-000000000001",
    "actor_id": "00000000-0000-4000-8000-000000000002",
    "observed_at": "2026-10-01T19:30:00Z",
    "read_succeeded": true,
    "pending": [{
      "event_id": "00000000-0000-4000-8000-000000000003",
      "org_id": "00000000-0000-4000-8000-000000000001",
      "actor_id": "00000000-0000-4000-8000-000000000002",
      "operation": "reserve",
      "first_observed_at": null
    }]
  }]
}
```

Use each record's saved event ID, orgId, actorId and operation from the pending
store; translate the stored orgId/actorId field names to org_id/actor_id. Never
copy the source's org/user onto a record or infer a new intent. One browser
profile may contain several orgs/users: partition records into their actual
scopes, or report the mismatch as incomplete coverage. Missing record identities
are invalid evidence (exit 2). A source/record mismatch is reported as
inventory_scope_mismatch, attributed to the stored org/user, and gives exit 2.

The same (stored org_id, event_id) in multiple sources is also a coverage problem
(exit 2), including actor disagreements. All observations remain visible in
pending; pending_observation_count counts them. pending_count and per-org
pending_browser_records count each scoped event once. Age alerts are counted
once per event; the largest known observation-age lower bound is retained.
The same event UUID in different orgs is a different scoped event.

This is maintenance setup only; the separate M192
consumption pending store is outside this report. It is not a fleet discovery
tool, a receipt verifier or a cross-device deduplicator. A declared complete
roster is an operator assertion; the tool cannot discover omitted workstations.

The current frozen browser records have **no creation timestamp**. Do not invent
one from the server's created_at (that is resolution time). `first_observed_at`
is the first recorded operator observation, a lower bound on intent age; if
unknown, pass null and escalate the unknown age. Do not change the saved record.

| Observation | Action |
|---|---|
| server_unobserved | Outcome remains unknown; use the existing actor's authorized recovery/reconciliation path |
| applied_acknowledgement_needed | Existing recovery must verify the full receipt and identity before acknowledgement |
| closed_acknowledgement_needed | Existing reconciliation must verify the fence and identity before acknowledgement |
| identity_or_operation_mismatch | Stop recovery and investigate the scope; never clear the local record |
| inventory_scope_mismatch or event in multiple sources | Repair the inventory partition/duplicate evidence; do not treat counts as complete |
| Missing/stale/failed source | Coverage incomplete; do not report a clear station |

The report never deletes a pending record or calls an RPC. A missing server row
is not proof of rejection and is never permission to create a new event.

```sh
python3 docs/db/material-issue-release/monitor_reconciliation.py --shift-hours 8 --freshness-minutes 15 < /tmp/wardah-reconciliation-input.json
```

**Proposed operating thresholds for owner approval:** capture all declared
profiles at shift start/end and after any unknown outcome; observations and
server export no older than 15 minutes; alert any pending record immediately,
escalate unknown age or an observed age of at least 8 hours. Match `shift-hours`
to the owner's approved shift length. Exit 0 means no pending records in the
fresh declared roster, 1 means pending work, 2 means incomplete/invalid coverage.
Every report keeps release_ready=false. Archive only access-controlled evidence;
these IDs and counts are operational data. Retention and an automatic collector
remain owner/implementation decisions.

## Verification boundaries and next order

The candidate runner compares a real PG17 catalog before fixtures and runs field,
missing-function, overload, ACL and inherited-execution snapshot failure controls.
It also exports real server metadata after acceptance/races and tests triage with
a simulated roster. Snapshot mutations are not live permission/DDL experiments;
simulated inventories are not actual workstation collection.

Next: independent scoped acceptance of this tooling; approve collection/alert
ownership and the exact grant/device plan; decide whether the separate proposed
198 mitigation is required; then prepare canonical numbering/MANIFEST and
application/sign-off artifacts. #278 application/behavior evidence, remaining
quarantined caller compatibility, target real-identity operator reconciliation
and separate release approval remain open. No accepted P2 or frozen DB review
needs to be reopened.
