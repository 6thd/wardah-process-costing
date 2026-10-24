# #229 material-issue read and containment candidate

Draft review candidate, based on main `94400e1b78f7f5f1716568df96dba7cde2558d12`. This PR contains no UI and does not allocate or apply M195. `195_material_issue_scope_candidate.sql` remains outside `sql/migrations`; its numeric prefix is a draft filename only.

The companion isolated UI is published separately on `feat/229-material-issue-isolated-ui`, stacked on #279 head `23ba8acdc6e29219a4d7320478d35afe7d1fd5fb`. No #279 policy-setter P2 reopening is requested. The combined local source archive is `40f0dde6` on `fix/229-material-issue-release-slices`.

## Proposed behavior

- Two authenticated, read-only SECURITY DEFINER RPCs provide explicit choices for material issue. They require active membership and exact `manufacturing.material_consumption.consume`, derive the target organization from MO for context, and check scoped references in one statement snapshot.
- Orders include terminal MOs so an unresolved committed event can be replayed. New-event context requires `in_progress`; M192 remains the write-time authority for selected identities, status and policy.
- Direct INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER table and column grants are revoked on MO/WO/material reservations. Twelve documented legacy function families are quarantined, including every overload and effective EXECUTE privileges for anon/authenticated/service_role. Read privileges are retained.

**Quarantine disables creation, status transitions, WO execution/maintenance and reservation maintenance through those old paths, including Org Admin. It does not implement guarded functional replacements, close #170/#154, or establish that these twelve names exhaust every possible writer.** Fresh caller/function/trigger/RLS inventory, compatibility decisions, independent review and applicable races remain required before a rollout proposal. This is not a backward-compatible deployable migration.

M190–M194 and the M192 client contract remain unchanged. Apply only missing canonical migrations once, in order M190 → M191 → M192 → M193 → M194, after validating the target ledger and postflight. No SQL here may be applied to Production or Staging under this review.

## Acceptance evidence and limits

`run_local.sh` refuses remote host/connection configuration, creates and removes a disposable PG17 database, restores the legal cutoff-189 baseline pair, applies 190..194 once, loads populated fixtures before quarantine, applies the candidate, and runs acceptance. The fixture includes an existing foreign organization. Role expiry uses canonical `rpc_replace_user_roles`; RBAC guards are not disabled.

Local evidence: 36 valid direct-write denial probes (three users × three tables × four operations), effective table/column/function privilege checks, exact named read denials, membership/expiry/revocation, canonical M192 success, and byte-stable replay across MO/WO/reservation/consumption/WIP/bin/SLE/receipt snapshots. Posted result reconciles one SLE -10, bin quantity 990, consumption +10, reservation consumed 10, WIP material cost 100 and one receipt, with no replay effects. #278 role and eight WIP/issue/labor/close races were also re-run on the unchanged M194 chain.

Evidence logs were captured on the combined local implementation before splitting the PR. main and #279 have identical canonical SQL, baseline and DB test harness bytes used here. Commit labels in the logs identify that historical checkout, not this PR's eventual head; re-run acceptance on the frozen published head independently.

The local PostgreSQL 17.11 source archive checksum is `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979`. The constrained executor maps only UID 0 and lacks UID-changing capabilities, so **three OS startup checks** (initdb/main/pg_ctl) were conditionally changed for `WARDAH_LOCAL_UID_NAMESPACE=1`. SQL roles/RLS/execution semantics were not altered. This evidence is not a substitute for a reviewer using an unmodified PostgreSQL 17 distribution. The repository Supabase JWT shim is not real Supabase Auth/PostgREST acceptance.

Candidate SQL SHA-256: `d906c72a96468d4869d8341e1cc61c8b20383e5dd43284be0070c876c80987ca`.

- [Candidate acceptance](evidence/20261001/db-candidate.log)
- [Unchanged M194 regression](evidence/20261001/m194-regressions.log)
- [Migration chain](evidence/20261001/migration-chain.log)
- [Migration repository contract](evidence/20261001/migration-contract.log)

```bash
# PostgreSQL 17 local and disposable only; never a live connection.
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash docs/db/material-issue-229/run_local.sh
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash docs/db/stage-wip-278/run_green.sh
```

**NO-GO for new Production material-issue events.** Independent PG17 review, narrow #170/#154 boundary implementation or an explicit containment/compatibility scope, #278 application/behavior acceptance, real browser/identity acceptance with database reconciliation, owner cross-device decision, and separate release approval remain. This draft creates no live application evidence and makes no staging-trust claim.
