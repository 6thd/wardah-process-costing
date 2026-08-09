# Migration 173 — `has_permission` Active-Role Check Runbook

**Migration:** `173_has_permission_active_role_check.sql`
**Scope:** Close a second gap in `has_permission()`'s ordinary-role branch — disabling a role never revoked the access it granted.
**State:** Applied to Production (`uutfztmqvajmsxnrqeiv`) on 2026-08-09, ledger version `20260809051430`, name `173_has_permission_active_role_check`. This is the current head of the Production ledger. All nine postflight boolean columns in §5 returned `true` against the live database, and `has_function_privilege('authenticated', …)` returned `true` — full evidence in `docs/db/PERMISSION_HARDENING_170_173_CHAIN.md` §4.

## 1. Purpose

Found during the security review that approved Migration 172 (PR #109): `has_permission()`'s ordinary-role branch joins `user_roles` → `role_permissions` → `permissions` and never joins `public.roles` at all, so a role's own `is_active` flag is never checked. Disabling a role — a real, exposed administrative operation — leaves every user still assigned to it fully authorized for everything that role grants, as long as their `user_roles` row is untouched and unexpired.

This is a distinct bug from Migration 172's same-module wildcard match: 172 fixed *which* `permission_key` values a grant satisfies; this migration fixes *whether* a grant through a since-disabled role should count at all. The reviewer explicitly separated these into two independently-testable migrations rather than one combined change, to keep each change's blast radius and test surface minimal and legible.

## 2. Precedent already in this codebase

Migration 166 (`wardah_has_exact_permission`, introduced for the sensitive `accounting.vouchers.unpost` control) already joins `roles` with exactly this shape:

```sql
JOIN public.roles r
  ON r.id = ur.role_id
 AND r.org_id = p_org_id
 AND coalesce(r.is_active, true)
```

166's own comment ("`has_permission` intentionally supports module-level fallback for ordinary screens. Unposting is an exceptional control and must bypass that fallback.") shows the broad-match gap Migration 172 closed was a known, worked-around limitation *before* it was fixed at the root — but `has_permission()` itself was never updated to match `wardah_has_exact_permission`'s stricter role-activity check either. This migration brings it into line, mirroring the identical join shape and `COALESCE(..., true)` null-safety convention 166 already established — a role row with `is_active` left `NULL` (the schema default is `true`, but the column is not `NOT NULL`) must not silently lose access, matching how this codebase already treats nullable `is_active` flags elsewhere (e.g. Migration 170's `COALESCE(user_organizations.is_active, true)`).

## 3. What the migration changes

| Change | Detail |
|---|---|
| `has_permission` | `CREATE OR REPLACE`. Ordinary-role branch gains `INNER JOIN roles r ON r.id = ur.role_id AND r.org_id = p_org_id AND COALESCE(r.is_active, true)`. Every other branch/predicate — `auth.uid()` self-check (170), super-admin override, org-admin override, exact `permission_key` equality (172), `ur.org_id = p_org_id` scoping (172), and `user_roles.expires_at` role-expiry — is byte-identical. |
| Grants | Unchanged (`authenticated`, `service_role` retain `EXECUTE`) — this migration narrows the ordinary-role predicate only. |
| `scripts/ci/check_definer_guards.py` | No change needed — `has_permission` was already added to `KNOWN_EXEMPT` by Migration 170. |
| Preflight | Fails closed (`PERMISSION_173_HAS_PERMISSION_MISSING`, `PERMISSION_173_REQUIRED_TABLE_MISSING`) if the schema has drifted from what this migration assumes. |
| Postflight | In-transaction `$verify$` block: `has_permission`'s `prosrc` now joins `roles r` and contains `COALESCE(r.is_active, true)` (`FAIL[173]`), and every Migration 170/172 predicate/behavior text is still present (six separate `FAIL[173]` checks, one per predicate) — proving the fix added only the intended join, not a regression of prior behavior. |
| Locking | Function-only change — no `LOCK TABLE`, matching the convention already used for 121/172. `SET LOCAL lock_timeout = '30s'`, `statement_timeout = '5min'`. |

## 4. Acceptance gate

```text
scripts/ci/fresh-db/acceptance_173_has_permission_active_role_check.sql
```

Seeds one org, a dedicated permission (`perm173.rolecheck.use`, independent of any specific catalog key), and five fixture users:

1. **Active**: a role holding the exact permission, `roles.is_active = true` — `has_permission` returns `true`.
2. **Disabled — the bug scenario**: the *identically wired* grant (same permission, same org, no expiry) through a role with `roles.is_active = false` — `has_permission` must return `false`. A setup assertion first proves the grant is real by running the same join **minus** the `roles` gate directly (bypassing `has_permission`), confirming the fixture is correctly wired and isolating `roles.is_active` as the only variable. Before this migration, this case returned `true`; **mutation-tested** by reverting `has_permission` to the pre-173 (172-only) text on the same fixtures and confirming the assertion failed exactly as expected (`ACCEPTANCE_FAIL[173-2]: ... still authorized the caller`), then restoring the fix and re-confirming a clean pass.
3. **Expired**: an expired `user_roles` grant through an *active* role still returns `false` — Migration 170 behavior, proven unaffected by the new `roles` join.
4. **Org-admin override**: returns `true` with no role or permission grant at all — the ordinary-role branch (and its new `roles` join) is never reached.
5. **Super-admin override**: same reasoning as case 4.

Final marker: `HAS_PERMISSION_173_ACCEPTANCE_PASS`.

**Confirmed green locally on real PostgreSQL 17** (installed via the PGDG apt repository in this session's sandbox, Docker unavailable there): Fresh DB built from `000_schema_baseline_20260729_210941.sql` + `001_system_reference_data_20260729_210941.sql` through the full chain (`153` → `173`) via `run_chain.sh` — **12/12 PASS**. `acceptance_173` → `HAS_PERMISSION_173_ACCEPTANCE_PASS`; re-ran `acceptance_172`, `acceptance_170`, and `acceptance_171` on the same post-173 DB — all pass cleanly, confirming no regression across the full 170→173 permission-hardening chain.

## 5. Production apply

Target project: Supabase `uutfztmqvajmsxnrqeiv` ("Manufacturing Process") — **not** `Wardah-Prod` (`rytzljjlthouptdqeuxh`), which is `INACTIVE`.

**Preflight (read-only, before applying):**
```sql
-- Confirm the exact current (172-only) predicate text, for the record —
-- expect no join to roles and no is_active check on the role.
SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'has_permission';
```

**Postflight (read-only, after applying):**
```sql
SELECT
  prosrc ~ 'roles r' AS roles_join_present,
  prosrc ~ 'COALESCE\(r\.is_active,\s*true\)' AS role_active_guard_present,
  prosrc !~ 'LIKE' AS like_still_removed,
  prosrc ~ 'p\.permission_key\s*=\s*p_permission_key' AS exact_match_still_present,
  prosrc ~ 'ur\.org_id\s*=\s*p_org_id' AS org_scoping_still_present,
  prosrc ~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' AS identity_guard_still_present,
  prosrc ~ 'super_admins' AS super_admin_override_still_present,
  prosrc ~ 'is_org_admin' AS org_admin_override_still_present,
  prosrc ~ 'expires_at' AS role_expiry_still_present
FROM pg_proc WHERE proname = 'has_permission';
-- Expect every column true.

SELECT has_function_privilege('authenticated', 'has_permission(uuid,uuid,varchar)', 'EXECUTE');
-- Expect true (unchanged, still callable).

-- Ledger row landed exactly once.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '173_has_permission_active_role_check';
```

Expected: all nine boolean columns `true`; `has_function_privilege` `true`; exactly one ledger row for 173.

**Optional real-data sanity check** (read-only, informational — not a gate): after applying, if any organization currently has a disabled role (`roles.is_active = false`) with active `user_roles` assignments, this migration changes those users' effective permissions immediately (correctly — this is the fix). Worth a quick look before applying, purely so the change in behavior isn't a surprise to any org admin who disabled a role expecting it to already be inert:
```sql
SELECT r.org_id, r.id AS role_id, r.name, count(ur.user_id) AS affected_users
FROM public.roles r
JOIN public.user_roles ur ON ur.role_id = r.id
WHERE r.is_active = false
GROUP BY r.org_id, r.id, r.name;
```

## 6. Rollback

Additive apart from replacing `has_permission()`'s ordinary-role predicate — a single `CREATE OR REPLACE FUNCTION`. Before any Production traffic depends on the tightened contract, the reviewed recovery is to correct forward with a new numbered migration rather than hand-edit 173 in place, per the project's golden rule. Do not remove the `roles` join or the `is_active` gate under any circumstance — it is the exact vulnerability this migration closes, and a disabled role is meant to be inert everywhere, not just in the UI.

Never edit `supabase_migrations.schema_migrations` to remove this row, and never apply SQL that is not the exact file merged to `main`.

## 7. Relationship to `reports-insights`

This migration hardens `has_permission()` further but is **not** a prerequisite for the already-deployed `reports-insights` Edge Function (Migration 172 was the prerequisite for that; the function has been live on Production since immediately after 172 was applied — see PR #109's follow-up discussion). This migration is scoped purely to closing the disabled-role gap and ships as its own independent PR, per the explicit decision not to mix it with any AI-reliability follow-up work.
