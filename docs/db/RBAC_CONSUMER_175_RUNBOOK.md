# Migration 175 — RBAC Consumer Migration RPCs

**Migration:** `175_rbac_consumer_migration_rpcs.sql`
**Part of:** Issue #93, second phase. Migration 174 gave the client an atomic,
audited RPC surface for role and assignment management, but a follow-up audit
of every production TS/TSX file writing to `roles`, `role_permissions` or
`user_roles` found the client did not fully move onto it (§1). This migration
adds exactly the RPC surface the client needs to close every remaining gap.
**State:** Repository implementation, **not yet applied to Production**.
Additive only — no privilege revocation, no table grant touched. Safe to
apply DB-first, ahead of any dependent UI change, per the standard sequencing
in `CLAUDE.md`.

## 1. The verified gap

Read of every production TS/TSX file that mutates `roles`, `role_permissions`
or `user_roles`, done after 174 shipped:

| File | Function | Covered by 174? |
|---|---|---|
| `src/pages/org-admin/roles.tsx` | permission editing | ✅ via `rbac-service.ts` RPCs |
| `src/services/rbac-service.ts` | `upsertRole` / `replaceUserRoles` / `deleteRole` | ✅ RPC-based since 174 |
| `src/services/org-admin-service.ts` | `updateUserRoles()` | ❌ direct `DELETE`+`INSERT` on `user_roles`, no audit row, no atomicity |
| `src/services/org-admin-service.ts` | `removeUserFromOrg()` | ❌ direct `DELETE` on `user_roles` then `user_organizations`, first error unchecked, no last-admin/self-removal guard |
| `src/services/org-admin-service.ts` | `createRoleFromTemplate()` | ❌ separate, unrelated same-named function: direct `INSERT roles` + loop of `INSERT role_permissions`, no audit |
| `src/services/super-admin-service.ts` | `createOrgWithUser()` | direct `INSERT user_roles` — **dead code**, see §3 |

`src/pages/org-admin/roles.tsx` imports `createRoleFromTemplate` from
`org-admin-service.ts` — the direct-write version — not the already-correct,
already-guarded RPC-based function of the same name in `rbac-service.ts`
(added around migration 120). The real defect was the import, not a missing
RPC; this migration only adds the audit row that RPC was missing.

`updateUserRoles()` and `removeUserFromOrg()` have no RPC-based equivalent at
all before this migration.

## 2. What this migration adds

| Change | Detail |
|---|---|
| `rpc_remove_org_member(jsonb)` | **New.** Atomic, audited replacement for `removeUserFromOrg()`'s two-step client sequence. `{org_id, user_id}` payload. Guarded by `wardah_assert_org_admin`. Refuses self-removal (`RBAC_175_CANNOT_REMOVE_SELF`) and removing the last active admin (`RBAC_175_LAST_ORG_ADMIN`) — mirroring the guards `rpc_set_org_admin` (migration 103) already applies to demotion; removal is more drastic and had no server-side guard at all before this. Locks the membership row `FOR UPDATE`, deletes `user_roles` then `user_organizations` inside the same transaction, and writes one `audit_logs` row with the full pre-removal membership and role-assignment snapshot in `old_data`. |
| `create_role_from_template(...)` | `CREATE OR REPLACE`, identical signature and return type (`uuid`), every prior statement byte-for-byte unchanged. Adds one `audit_logs` INSERT recording the granted permission keys and flagging any sensitive ones. The consumer PR repoints `roles.tsx`'s import to the already-correct function in `rbac-service.ts`; this migration's only job is to make that function's audit trail complete once it is actually called. |
| `wardah_is_sensitive_permission(text)` | `CREATE OR REPLACE`, adds `SET search_path = ''`. The body is a pure literal comparison with no table or unqualified-name reference, so this changes nothing about its output for any input (re-asserted in postflight for all four relevant cases including `NULL`). Closes the "Function Search Path Mutable" advisory. |
| Grants | `rpc_remove_org_member`: `REVOKE ALL FROM PUBLIC, anon, service_role`; `GRANT EXECUTE TO authenticated`. No other grant is touched anywhere in this migration. |

### 2.1 What this migration deliberately does not do

- **No RPC for `super-admin-service.ts`'s `user_roles` insert.** That code
  looks up `roles.name = 'org_admin'` and only inserts if found. A
  repository-wide search confirms no migration or seed has ever created a
  role literally named `org_admin` for any organization — the only
  `'org_admin'` string in `sql/` is a **module label** from migration 53, not
  a role name. The lookup's `.single()` never resolves and the guarded
  insert never executes. Building an RPC for a path that has never run would
  add a new sanctioned write surface for nothing; the consumer PR deletes
  the dead block instead. Real admin authority for a newly bootstrapped
  organization is `user_organizations.is_org_admin = true`, set two
  statements earlier in the same function — untouched, unaffected, and
  already outside RBAC-table scope.
- **`wardah_assert_org_admin` / `wardah_assert_org_member` are not touched.**
  Dozens of functions across the schema depend on their current behavior,
  including the caller-must-be-a-member-first ordering. Widening either is a
  cross-cutting change that deserves its own migration and review, not a
  rider on this one.
- **No table grant is revoked.** `authenticated` keeps direct
  `INSERT`/`UPDATE`/`DELETE` on `roles`, `role_permissions` and `user_roles`.
  That closure is **Migration 176**, applied only after the consumer PR has
  moved every real caller onto the RPC surface this migration and 174
  together provide, and the real browser smoke on the deployed UI has proven
  it end to end. Revoking here, before the consumer PR ships, would break
  the still-live direct-write paths in the window between this migration and
  its dependent UI deploying — the same `repository-first` / `DB-first`
  sequencing violation `CLAUDE.md` already documents for Migration 148 and
  (inverted) for Migration 170.

## 3. Acceptance gate

```text
scripts/ci/fresh-db/acceptance_175_rbac_consumer_migration_rpcs.sql
.github/workflows/rbac-consumer-175-acceptance.yml
```

Marker: `RBAC_CONSUMER_175_ACCEPTANCE_PASS`. Coverage:

1. **Cross-org rejection** (`175-1`) — an org admin of one org cannot remove a
   member of another.
2. **Self-removal rejection** (`175-2`) — `RBAC_175_CANNOT_REMOVE_SELF`, own
   membership row provably untouched afterward.
3. **Last-admin guard** (`175-3a/3c/3d`) — a legal removal down to exactly one
   admin succeeds; a distinct fixture (a super admin who is a *non-admin*
   member of the target org — the only way to get an admin-gated caller
   whose identity differs from the target while the guard is still
   reachable) attempting to remove the sole remaining admin is rejected with
   `RBAC_175_LAST_ORG_ADMIN`, and the membership row is proven untouched.
4. **Real removal + full audit verification** (`175-4a…4e`) — membership and
   `user_roles` rows actually gone, `audit_logs` row present with
   `old_data.role_assignments` matching the exact pre-removal snapshot,
   `new_data IS NULL`, `metadata.was_org_admin` and
   `metadata.removed_role_count` correct.
5. **`create_role_from_template` unchanged behavior + new audit row**
   (`175-5a…5e`) — permissions still granted correctly from the template,
   `audit_logs` row present with `source = 'template'` and sensitive keys
   correctly flagged.
6. **Cross-org template creation rejected** (`175-6`).
7. **Mutation proof** (`175-M1…M7`) — every 170–174 guarantee re-asserted
   plus the new grants, plus an explicit check that no table grant changed.

### 3.1 Verification actually performed

Executed locally on a real **PostgreSQL 17.10** cluster, rebuilt from
scratch immediately before commit:

| Check | Result |
|---|---|
| Baseline + chain through 175 | `PASS=14 FAIL=0 NOT_RUN=0 TOTAL=14` |
| `acceptance_175` | `RBAC_CONSUMER_175_ACCEPTANCE_PASS` |
| `acceptance_174` re-run on the 175 database | `SENSITIVE_PERMISSION_174_ACCEPTANCE_PASS` (no regression) |
| **Red proof** — chain built with every `175_*.sql` file excluded | `to_regprocedure('public.rpc_remove_org_member(jsonb)') IS NOT NULL` → `f` |

Every embedded shell block in `.github/workflows/rbac-consumer-175-acceptance.yml`
was checked with `bash -n`; the YAML was parsed with `yaml.safe_load`. The
same static gates already required by CI were run against the new migration
file: `check_migration_syntax.py` (pglast — 203 files, all valid),
`check_definer_guards.py` (45 migrations above the guard threshold, no
unguarded `SECURITY DEFINER`), and `validate_migration_ledger.py`
(`repo_max: 175`, numbering and naming valid).

The red proof is a real CI step, not a manual note: if a pre-175 database
ever produces `rpc_remove_org_member`, the job fails.

## 4. Production order

Purely additive — no operational transaction is required before applying
this migration, unlike 174. There is no lockout risk: nothing existing is
narrowed or revoked.

### Step 1 — apply 175

Apply the exact file merged to `main`. Its own `$verify$` block runs before
`COMMIT` and fails the transaction on any drift.

### Step 2 — read-only postflight

```sql
SELECT
  prosrc ~ 'wardah_assert_org_admin'              AS org_admin_guarded,
  prosrc ~ 'RBAC_175_CANNOT_REMOVE_SELF'          AS self_removal_guard,
  prosrc ~ 'RBAC_175_LAST_ORG_ADMIN'              AS last_admin_guard,
  prosrc ~ 'FOR UPDATE'                            AS locks_membership_row,
  prosrc ~ 'audit_logs'                            AS writes_audit
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'rpc_remove_org_member';
-- Expect every column true.

SELECT has_function_privilege('anon', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE') AS anon_can_call,
       has_function_privilege('authenticated', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE') AS authenticated_can_call;
-- Expect anon_can_call = false, authenticated_can_call = true.

SELECT prosrc ~ 'audit_logs' AS template_now_audited
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'create_role_from_template';
-- Expect true.

SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '175_rbac_consumer_migration_rpcs';
-- Expect exactly one row.
```

### Step 3 — merge and deploy the separate consumer PR

Only after step 2 is verified. That PR (not this migration) rewires
`users.tsx` onto `rpc_replace_user_roles` and the new `removeOrgMember()`
wrapper, repoints `roles.tsx`'s template-creation import to `rbac-service.ts`,
deletes the three dead/dangerous direct-write functions from
`org-admin-service.ts`, deletes the dead role-lookup block from
`super-admin-service.ts`, and adds the CI gate forbidding any remaining
direct RBAC-table mutation in `src/`.

### Step 4 — real browser smoke, then Migration 176

Migration 176 — the direct-write revocation on `roles`, `role_permissions`,
`user_roles` — is applied only after the consumer PR is live and the browser
smoke against the deployed UI has passed. Until then `authenticated` keeps
both paths: the RPCs are sanctioned, not yet exclusive.

## 5. Rollback

Additive apart from two `CREATE OR REPLACE` bodies, both no-ops for existing
behavior except the added audit write. Per the golden rule, a forward fix
(a new numbered migration) is preferred over any revert. There is nothing to
revert defensively: no grant was narrowed, no existing caller's contract
changed, and the new RPC's execute boundary is `authenticated` only, matching
every other RBAC RPC in this repository.

Never edit `supabase_migrations.schema_migrations`, and never apply SQL that
is not the exact file merged to `main`.
