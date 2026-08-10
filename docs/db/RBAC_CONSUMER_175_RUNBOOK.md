# Migration 175 — RBAC Consumer Migration RPCs

**Migration:** `175_rbac_consumer_migration_rpcs.sql`
**Part of:** Issue #93, second phase. Migration 174 gave the client an atomic,
audited RPC surface for role and assignment management, but a follow-up audit
of every production TS/TSX file writing to `roles`, `role_permissions` or
`user_roles` found the client did not fully move onto it (§1). This migration
adds the RPC surface the client needs and closes three database races discovered
during review.
**State:** Repository implementation, **not yet applied to Production**.
No privilege revocation and no table grant change. Assignment behavior is,
however, deliberately narrowed at the database boundary: INSERT requires an
active membership and every direct UPDATE is rejected in favor of
`rpc_replace_user_roles`. Apply DB-first only after the read-only data
preflight in §4 succeeds.

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
| Assignment boundary | A `BEFORE INSERT FOR EACH ROW` trigger on `user_roles` takes organization→membership locks and requires the matching active membership. A `BEFORE UPDATE FOR EACH STATEMENT` trigger rejects every UPDATE before PostgreSQL locks a child tuple, requiring `rpc_replace_user_roles`. A parent-side trigger refuses deleting, moving, or deactivating a membership while role rows remain. This prevents both orphan grants and the inverse tuple→organization lock order during the 175→176 deployment window. |
| `rpc_replace_user_roles(jsonb)` lock wrapper | The 174 body is renamed to a non-callable internal function without changing it. The public function preserves 174's pre-authorization parsing and combined org/user required-field error, takes the organization lock first, then delegates to the 174 body, which locks membership and preserves every replace/expiry/audit rule. This gives assignments and removals the same lock order without changing validation/error ordering. |
| Permission defense in depth | The explicit-role branches of both `has_permission` and `wardah_has_exact_permission` now join an active membership. Even deliberately corrupted legacy data cannot authorize a user whose membership is inactive or absent. |
| `rpc_set_org_admin(...)` | Same signature and JSON contract. It now shares an organization-row `FOR UPDATE` lock with member removal, re-authorizes the caller after the lock, and applies `LAST_ORG_ADMIN` only when the target is currently an active admin. |
| `rpc_remove_org_member(jsonb)` | **New.** Atomic, audited replacement for `removeUserFromOrg()`'s two-step client sequence. `{org_id, user_id}` payload. Guarded by `wardah_assert_org_admin`. Refuses self-removal (`RBAC_175_CANNOT_REMOVE_SELF`) and removing the last active admin (`RBAC_175_LAST_ORG_ADMIN`). It takes the shared organization lock, re-authorizes, locks the membership row, deletes `user_roles` then `user_organizations`, and writes the full pre-removal snapshot to `audit_logs`. |
| `create_role_from_template(...)` | `CREATE OR REPLACE`, identical signature and return type (`uuid`), every prior statement byte-for-byte unchanged. Adds one `audit_logs` INSERT recording the granted permission keys and flagging any sensitive ones. The consumer PR repoints `roles.tsx`'s import to the already-correct function in `rbac-service.ts`; this migration's only job is to make that function's audit trail complete once it is actually called. |
| `wardah_is_sensitive_permission(text)` | `CREATE OR REPLACE`, adds `SET search_path = ''`. The body is a pure literal comparison with no table or unqualified-name reference, so this changes nothing about its output for any input (re-asserted in postflight for all four relevant cases including `NULL`). Closes the "Function Search Path Mutable" advisory. |
| Preflight | Fails closed with `RBAC_175_INVALID_USER_ROLE_MEMBERSHIP_PREFLIGHT` if any assignment lacks a matching active membership. The two RBAC tables are locked against DML between this check and trigger installation. |
| Grants | `rpc_remove_org_member`: `REVOKE ALL FROM PUBLIC, anon, service_role`; `GRANT EXECUTE TO authenticated`. Existing `rpc_set_org_admin` grants are reasserted. No table grant changes. |

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
- **No table grant is revoked.** `authenticated` keeps the table-level
  `INSERT`/`UPDATE`/`DELETE` grants on `roles`, `role_permissions` and
  `user_roles`. At runtime, direct `user_roles` INSERT must satisfy active
  membership and all UPDATE statements are rejected before tuple locking;
  assignment changes must use `rpc_replace_user_roles`. A membership with
  assignments must clear them before deletion/deactivation.
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
scripts/ci/fresh-db/acceptance_175_rbac_concurrency.sh
.github/workflows/rbac-consumer-175-acceptance.yml
```

Markers: `RBAC_CONSUMER_175_ACCEPTANCE_PASS` and
`RBAC_CONSUMER_175_CONCURRENCY_PASS`. Coverage:

1. **Database invariant** (`175-I1…I8`) — inactive-member INSERT is rejected;
   key, non-key, and zero-row UPDATE statements all fail with the exact RPC
   redirect marker; the UPDATE trigger is proven to be `BEFORE STATEMENT`;
   parent deletion/deactivation are rejected; both permission helpers deny a
   deliberately injected inactive-member grant; the wrapped 174 replace
   contract remains live with its internal implementation inaccessible, and
   missing/invalid user plus invalid expiry inputs retain 174's validation
   order before authorization.
2. **Cross-org rejection** (`175-1`) — an org admin of one org cannot remove a
   member of another.
3. **Self-removal rejection** (`175-2`) — `RBAC_175_CANNOT_REMOVE_SELF`, own
   membership row provably untouched afterward.
4. **Last-admin guard** (`175-3a/3b/3c/3d`) — a legal removal down to exactly one
   admin succeeds; a distinct fixture (a super admin who is a *non-admin*
   member of the target org — the only way to get an admin-gated caller
   whose identity differs from the target while the guard is still
   reachable) attempting to remove the sole remaining admin is rejected with
   `RBAC_175_LAST_ORG_ADMIN`, and the membership row is proven untouched.
   A false→false request against an ordinary target proves the guard is not
   applied merely because the organization has one admin.
5. **Real removal + full audit verification** (`175-4a…4e`) — membership and
   `user_roles` rows actually gone, `audit_logs` row present with
   `old_data.role_assignments` matching the exact pre-removal snapshot,
   `new_data IS NULL`, `metadata.was_org_admin` and
   `metadata.removed_role_count` correct.
6. **`create_role_from_template` unchanged behavior + new audit row**
   (`175-5a…5e`) — permissions still granted correctly from the template,
   `audit_logs` row present with `source = 'template'` and sensitive keys
   correctly flagged.
7. **Cross-org template creation rejected** (`175-6`).
8. **Mutation proof** (`175-M1…M7`) — every 170–174 guarantee re-asserted
   plus the new grants, plus an explicit check that no table grant changed.
9. **Four real multi-session races** — direct INSERT versus removal; two admins
   removing each other; demotion versus removal; and direct UPDATE versus
   removal. The fourth queues removal first on the organization lock, then
   proves UPDATE hits the statement guard instead of taking the assignment
   tuple and recreating the inverse-lock deadlock. All use independent
   PostgreSQL connections and prove one active admin and zero orphan
   assignments at completion.
10. **Preflight red proof** — a pre-175 database is deliberately seeded with
    an inactive-member assignment; applying 175 must fail with the exact
    preflight marker and commit none of its object changes.

### 3.1 Verification required before merge

Execute on a fresh **PostgreSQL 17** cluster and retain the CI artifacts:

| Check | Result |
|---|---|
| Baseline + chain through 175 | `PASS=14 FAIL=0 NOT_RUN=0 TOTAL=14` |
| `acceptance_175` | `RBAC_CONSUMER_175_ACCEPTANCE_PASS` |
| Four multi-session races | `RBAC_CONSUMER_175_CONCURRENCY_PASS` |
| `acceptance_174` re-run on the 175 database | `SENSITIVE_PERMISSION_174_ACCEPTANCE_PASS` (no regression) |
| **Red proof** — chain built with every `175_*.sql` file excluded | `to_regprocedure('public.rpc_remove_org_member(jsonb)') IS NOT NULL` → `f` |
| **Preflight red proof** | inactive-member assignment rejects 175 with `RBAC_175_INVALID_USER_ROLE_MEMBERSHIP_PREFLIGHT` |

Every embedded shell block in `.github/workflows/rbac-consumer-175-acceptance.yml`
was checked with `bash -n`; the YAML was parsed with `yaml.safe_load`. The
same static gates already required by CI were run against the new migration
file: `check_migration_syntax.py` (pglast — 203 files, all valid),
`check_definer_guards.py` (45 migrations above the guard threshold, no
unguarded `SECURITY DEFINER`), and `validate_migration_ledger.py`
(`repo_max: 175`, numbering and naming valid).

Both red proofs are CI steps, not manual notes.

## 4. Production order

No privilege is revoked, but the assignment boundary intentionally narrows
writes and makes `rpc_replace_user_roles` the only UPDATE mechanism. Run this
read-only query against Production first:

```sql
SELECT ur.user_id, ur.org_id, ur.role_id, uo.is_active
FROM public.user_roles ur
LEFT JOIN public.user_organizations uo
  ON uo.user_id = ur.user_id
 AND uo.org_id = ur.org_id
WHERE uo.user_id IS NULL OR uo.is_active IS NOT TRUE;
-- Expect zero rows. Stop and remediate explicitly if any row is returned.
```

The migration repeats this check under table locks, so a write cannot slip
between operator preflight and trigger installation.

### Step 1 — apply 175

Apply the exact file merged to `main`. Its own `$verify$` block runs before
`COMMIT` and fails the transaction on any drift.

### Step 2 — read-only postflight

```sql
SELECT
  prosrc ~ 'wardah_assert_org_admin'              AS org_admin_guarded,
  prosrc ~ 'RBAC_175_CANNOT_REMOVE_SELF'          AS self_removal_guard,
  prosrc ~ 'RBAC_175_LAST_ORG_ADMIN'              AS last_admin_guard,
  prosrc ~ 'organizations o'                       AS locks_organization_row,
  prosrc ~ 'FOR UPDATE'                            AS locks_rows,
  prosrc ~ 'audit_logs'                            AS writes_audit
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'rpc_remove_org_member';
-- Expect every column true.

SELECT has_function_privilege('anon', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE') AS anon_can_call,
       has_function_privilege('authenticated', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE') AS authenticated_can_call;
-- Expect anon_can_call = false, authenticated_can_call = true.

SELECT c.relname, t.tgname, t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND t.tgname IN (
    'trg_wardah_175_require_active_role_membership',
    'trg_wardah_175_reject_direct_role_update',
    'trg_wardah_175_protect_role_membership_parent');
-- Expect three enabled rows.

SELECT pg_get_triggerdef(t.oid) AS update_guard
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'user_roles'
  AND t.tgname = 'trg_wardah_175_reject_direct_role_update';
-- Expect BEFORE UPDATE ... FOR EACH STATEMENT.

SELECT proname,
       prosrc ~ 'user_organizations uo' AS joins_membership,
       prosrc ~ 'uo\.is_active IS TRUE' AS requires_active
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('has_permission', 'wardah_has_exact_permission');
-- Expect both booleans true for both rows.

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
smoke against the deployed UI has passed. Until then the table grants remain,
but assignment UPDATE is already RPC-exclusive at the behavioral boundary;
176 closes the remaining direct-write privilege surface.

## 5. Rollback

No table grant changed and all public RPC signatures remain stable, but 175
adds three invariant/write triggers and replaces authorization/admin function
bodies.
Per the golden rule, use a new numbered forward-fix migration if rollback is
required; never edit an applied 175 or remove its ledger row.

Never edit `supabase_migrations.schema_migrations`, and never apply SQL that
is not the exact file merged to `main`.
