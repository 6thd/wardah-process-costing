# M198 candidate: paired cutover requirements

**Planning only. NO-GO remains.** No migration number is allocated and no target
application, merge, permission change or release is authorized by this document.
Production remains hard-disabled by the existing material-issue gate. This plan
addresses a future, separately approved isolated non-PROD acceptance environment.
It does not waive the repository-first or Production deployment rules in
`CLAUDE.md`; a Production compatibility/deployment plan still needs separate review.

## Compatibility and review order

The DB candidate is reviewed in #295; the matching client is reviewed in #296.
Reviewing the DB first is **not** proof that a live DB-first deployment is
backward-compatible. The independent scoped review reproduced both mismatches:

| DB contract | Client contract for new reserve/manual WO | Result |
|---|---|---|
| M197 | #294, no parent version | Existing contract |
| M198 | #294, no parent version | `P0001 ISSUE_SETUP_VERSION_REQUIRED` |
| M197 | #296, displayed parent version | `P0001 UNSUPPORTED_ISSUE_SETUP_FIELD` |
| M198 | #296, displayed parent version | Matching contract; scoped local acceptance passed |

Both mixed pairs reject these two new operations without side effects. Neither
deployment order provides continuous availability while the isolated flag is on.
These are business rejections, not engine serialization retries. Refreshing or
retrying cannot repair a mismatched DB/client contract. Other commands are outside
this compatibility claim; saved-event replay is addressed separately below.

Record the actual DB artifact, client commit/build and catalog readback for the
chosen pair. The reviewed anchors are #295 `be8798c9ad03bc87569a2157e8dff323e11e2065`
and #296 `5ec1cd16044b542460faf2d8eae8c60e9ca6d722`. The #297 verifier cleanup
retains the same candidate SQL SHA-256:
`2cf867dfa5c9a473f0e6e05528d0603aa8885736dd31c3210b58030b616240a5`.

## Paused acceptance cutover

1. Before any target work, obtain the separately approved environment, application
   order, operator window, explicit-grant/device policy and recovery plan. Preserve
   the legal dependency order M190→191→192→193→194→195→196→197→198; candidate labels
   195–198 are not canonical allocation or permission to apply them.
2. Stop new intents and inventory pending events in every participating browser
   profile, user, org and device. Use stored record identities, report incomplete
   coverage and reconcile receipts/fences through the existing protocol. Never
   delete IndexedDB records or change event IDs/payloads to bypass recovery.
3. Enforce and verify a server-side pause for affected writers, including retries
   and in-flight requests, before changing either artifact. These PRs provide no
   pause RPC or device lease: the owner must specify and test the pause mechanism
   and record any temporary grant changes and their restoration. A new build with
   the flag off does **not** stop requests from already-open tabs or cached builds.
   If quiescence cannot be demonstrated, do not proceed.
4. Keep access held throughout installation of the approved DB artifact and the
   matching client build. DB then client may be used **inside the verified pause**;
   do not expose either mixed pair. Keep all holds in place and perform package,
   catalog/ACL/settings and #278 application/behavior readback before resumption.
5. Reload and re-authenticate all participating tabs/profiles and verify their
   client build. Refuse resumption with an old client. Already-applied pre198
   commands replay their unchanged receipts on M198. Unknown legacy commands can
   be reconciled/fenced using the existing protocol; only after verified recovery
   may a fresh intent carry the displayed version. Never add a version to a saved
   command or fetch a replacement version at submit.
6. Run authorized target identity/operator acceptance before any pilot decision:
   reserve and manual WO from the same displayed MO version, stale rejection,
   receipt replay after loss/reload, reconciliation, revoked/expired grants and
   recovery. Compare reservations, MO/WO versions, consumption, SLE, bins, WIP and
   receipts; compare financial state where relevant. Restore only approved grants
   and devices after these checks, with an explicit owner decision. This document
   neither chooses a device policy nor asserts that an optimistic version is a
   server lease or a general duplicate-human-intent guarantee.

## Failure and rollback

Keep or re-establish the verified pause when any compatibility, catalog, recovery
or identity check fails. Rolling back only the client or only the DB recreates a
mixed pair. No automatic DB downgrade is supplied or approved; an M197 DB may
reject M198 saved payloads before replay. Preserve pending records and receipts,
and require separately reviewed data/replay compatibility before any downgrade.
Fix-forward with access held is preferable to an unverified one-sided rollback.

## Evidence and remaining gates

Local/CI acceptance uses disposable PG17 and Chromium. Adapter identity is
simulated; local GoTrue/PostgREST tests use local auth-function stand-ins. Browser
profiles share an actor and execute the injected-loss steps sequentially; the
concurrent lock race is demonstrated by the database tests. These are not hosted
identity, target application, multiple physical devices or operator sign-off.

Owner grant/device decisions, canonical allocation/sign-off, target application
and #278 behavior record, real target identity/operator reconciliation, monitoring
and separate release approval remain open. The M192 hold and NO-GO decision remain.
