# Migration 192 implementation notes (#229)

**State:** draft implementation. A successful schema migration alone does not
accept the feature; require the disposable PG17 behavioral and two-session
checks, final-head independent review, and a separate live application decision.

## Pre-application gate

Check the actual target's migration ledger read-only: M190 and M191 each applied
once, and no incompatible newer migration touching the same RPCs. Independently
verify the M191 product-lock helper and reservation-lock postflight in the
catalog. Run on a restored copy first. The migration's own preflight uses the
catalog because the fresh-DB fixture does not provide a Production-style ledger.
Do not apply #229 before M191 on Production.

## Reviewer notes carried into code

| Concern | Boundary |
| --- | --- |
| Event-lock namespace | Read the MO's own `org_id` before the lock; check it again under MO `FOR UPDATE`. The UI and JWT cannot select a different namespace. |
| Lock order | Event advisory lock, MO `FOR UPDATE`, policy `FOR SHARE`, explicit WO `FOR UPDATE`, stage WIP `FOR UPDATE`, full reservation set `FOR NO KEY UPDATE`, product prefix, then bin locks. Settings RPC uses policy `FOR UPDATE`. |
| Definer ACL | Private seed trigger and public RPCs explicitly revoke default EXECUTE from PUBLIC and anonymous callers; only the authenticated client-facing RPCs are granted. Internal product-lock helper keeps M191's client revokes. |
| Direct-write closure | Authenticated and anonymous users cannot insert a consumption row or edit the receipt/policy tables. Org Admin policy changes go through an audited RPC with a DB constraint. |
| Stock attribution | Each posted stock-ledger row stores the corresponding consumption ID in `source_line_id`. The receipt retains all generated consumption IDs. |
| Precision | The existing 4-decimal consumption columns must expand to represent M191's 6-decimal stock/WIP result. The report view is recreated inside the transaction, retaining `security_invoker` and the historical view ACL. Verify any other view dependency on the exact target before live application. |
| Legacy callers | Only `inventory-transaction-service.consumeReservedMaterials` uses the old wrapper; that method currently has no UI caller, although other methods in its service are used. `mesService.consumeMaterial` directly inserts and its hook is unmounted. Both must be migrated before any employee UI is enabled. |

## Functional limits

- Org Admin may permit `READY` and/or `IN_SETUP` work orders, but the MO must
  still be exactly `in_progress`; NULL states are rejected. Updates to settings
  affect only new events. An authorized replay retrieves the original result
  even if settings, inventory, reservation or MO lifecycle later change.
- The client must keep the UUID event ID across retries and reloads. The DB
  cannot recover an ID that a client discards before a successful response.
- Backflush and MO completion remain #234 and #230 respectively. Rejected
  eventless signatures intentionally break old direct clients instead of
  silently falling back to non-atomic writes.
- A 64-bit advisory hash can collide, which merely serializes two unrelated
  events; the full `(org_id,event_id)` UNIQUE constraint and stored canonical
  request determine identity.

## Remaining acceptance

The disposable two-session runner uses Psycopg 3 with bound parameters; the CI
workflow installs `psycopg[binary]`. Install the same package before running
`run_local.sh` in another local PostgreSQL 17 environment.

Record exact-head checkout SHA, server version, raw disposable-run output and
checksum. Confirm the unchanged C probe is RED before M192 and adapt C1/C1b/C2/C3
to the new API afterwards. The disposable suite exercises a second failing
batch line, unauthorized direct writes, replay after status/policy changes,
and two real sessions for same/different MOs and both first-transaction COMMIT
and ROLLBACK. It also tests both orders of policy update versus a READY issue.
The separate acceptance matrix asserts all 288 policy × MO × WO combinations,
including NULL statuses, and a work order owned by a different MO. The
sequential suite checks same-actor replay after revoking its grant, complete
client insert payloads, and changes to each normalized business field.
Independent final-head verification must check the raw run, NULL and malformed
policy behavior, the generated TypeScript changes, and any reviewer findings.
No Production or Staging write is implied by these tests.
