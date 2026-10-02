# M198 parent-version review candidate

Draft, not allocated/applied, release_ready=false. Stacked on accepted #294
`c6255e03536d2dff1ffa0a9130cdab6778fa5637`; frozen DB dependency #293
`b95384a917d5a0879350f4598e79a43a4c21e4f1`. The existing M190–197 files,
manifest, client contracts and holds are unchanged.

The candidate is the exact M197 setup function plus two allowlist additions,
positive integer expected_version validation for new reserve/manual-WO intent,
a comparison under the existing MO row lock, and one transactional parent touch
using the frozen enabled version trigger. Metadata/OID and before/after body
fingerprint guards are retained. The trigger's body and attachment are checked.
Failure to increment exactly once rolls back every effect. SQLSTATE P0001 is a
business rejection; engine serialization errors are not caught or rewritten.

Saved-event lookup remains before version validation. Already-applied pre198
commands without a version replay their original receipt. Unknown legacy commands
can still be reconciled/fenced with the unchanged protocol. New unversioned child
commands are refused. A client replacement must send the displayed version;
fetching a new version at submit would erase the stale-draft guarantee.

New reserve/manual-WO commands are incompatible in both mixed DB/client pairs:
#294 against M198 rejects a missing version, and #296 against M197 rejects the
new field. DB-first review is not a live availability guarantee. Follow the
[paired cutover requirements](CUTOVER.md): separately approved non-PROD work must
hold access, verify a server-side pause and switch the matching pair before
resumption. No target application or Production exception is authorized here.

`CANDIDATE.json` pins this supplemental artifact and the frozen release manifest.
It does not allocate a canonical number or modify the accepted195–197 package.
Local source-body comparisons use SHA-256 (before_prosrc_sha256 and
after_prosrc_sha256). Existing prosrc_md5 fields are retained only for the frozen
PostgreSQL catalog/SQL guard contract; their values and candidate SQL bytes do not
change. The installed catalog remains independently checked by PG17. No analyzer
suppressions or migration changes are introduced by this cleanup.
The independent runner installs cutoff189 then190→…→198 before fixtures in a new
loopback disposable PG17 database. The overlay verifies the reviewed198 body
first, then reuses the frozen22-function profile for all other body and
owner/ACL/settings/signature checks. It never learns fingerprints from a target.

Acceptance checks: two actors with distinct event UUIDs waiting on the same MO
(one child/one P0001 rejection), saved-event replay/no effects, bad/missing versions,
permission denial/revocation during the lock wait, all four eligible statuses,
unchanged stock/financial effects, genuine REPEATABLE READ40001, actual legacy197
receipt replay/fence, and install-guard mutations. The legacy probe temporarily
installs197 in the disposable fixture transaction, records a real receipt and
restores198 before commit; final catalog readback verifies restoration.

The DB PR runs the existing198-free native fixture as an unchanged compatibility
baseline. It does not prove a198 client. A separate dependent client PR will
install198 for both native/real-Auth browser modes and add the new child race.
No hosted Auth, target environment, Production/Staging or rollout approval.

```bash
python3 docs/db/material-issue-parent-version-198/verify_candidate.py
python3 docs/db/material-issue-parent-version-198/test_candidate.py
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=postgres bash docs/db/material-issue-parent-version-198/run_local.sh
```

This optimistic version check prevents two successful child creations against the
same displayed MO version. It is not a lease or a general duplicate-human-intent
guarantee. Refreshed distinct intents, create_order with different numbers,
other MOs and M192 consumption are outside this protection. Device/grant policy,
canonical allocation/sign-off, target application/behavior/operator acceptance,
monitoring and separate release approval remain open.
