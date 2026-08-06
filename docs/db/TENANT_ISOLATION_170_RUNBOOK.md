# Migration 170 — Tenant Isolation & Permission Hardening Runbook

**Migration:** `170_tenant_isolation_and_permission_hardening.sql`
**Scope:** Fix a real cross-tenant RLS bypass, remove a default-organization fallback reachable by `anon`, and close a cross-user permission-disclosure path.
**State:** Applied to Production (`uutfztmqvajmsxnrqeiv`) on 2026-08-06, verified via the postflight queries below run directly against the live database. Ledger row: `170_tenant_isolation_and_permission_hardening`, version `20260806043140`.

**Note on the gap between merge and apply:** this migration was merged to `main` in PR #98 well before it was actually applied to Production — the ledger had stalled at 169 with 170 sitting unapplied. Independent verification against the live database on 2026-08-06 confirmed all three original vulnerabilities were still fully live in Production for that entire window (self-referencing `physical_count_*` policies, `anon` holding SELECT+INSERT on the three manufacturing tables via the default-org fallback, `has_permission` with no caller-identity guard). A migration landing on `main` closes the gap in the repository, not in Production — the apply step is not optional follow-up, it is the fix. Do not treat a merged migration as resolved until this section (or the ledger itself) says otherwise.

## 1. Purpose

An independent security audit (2026-08-05) found and this migration closes three unrelated but co-discovered issues, none of which depend on the others:

1. All 8 CRUD RLS policies on `physical_count_items` and `physical_count_sessions` used a self-referencing correlated subquery that degenerated to always-true for any authenticated user with at least one organization membership — full cross-tenant read and write.
2. `manufacturing_stages`, `stage_wip_log` and `standard_costs` fell back to a hardcoded default-organization UUID when JWT claims carried no `org_id`/`tenant_id`, with no `TO` clause (defaulting to role `PUBLIC`) and `anon` holding `GRANT ALL` — an unauthenticated request could read/write that organization's manufacturing data.
3. `has_permission(p_user_id, p_org_id, p_permission_key)` never compared `p_user_id` to `auth.uid()`, so any authenticated user could learn whether an arbitrary *other* user is a super admin, an org admin, or holds a specific permission.

## 2. Root causes

**Issue 1** is a copy/generation defect: the subquery selected `<outer_table>.organization_id` instead of `user_organizations.org_id` (the tenant column on `user_organizations` is `org_id`, not `organization_id`). Note: `stock_transfers_org_policy`, initially cited as a correct reference for this join shape, turned out to carry a related but separate defect of its own (see Issue 1b) — it was not a clean pattern to copy verbatim.

**Issue 1b** (found in review, fixed in the same migration): none of the 8 rewritten policies checked `user_organizations.is_active`, so a user whose membership had been deactivated (row still present, `is_active=false`) kept full CRUD access. This is not a new defect introduced by the fix — it matches the original broken policies' behavior — but it went unnoticed initially because the established convention elsewhere in this schema (dozens of policies, e.g. `journal_entry_attachments`) already checks `COALESCE(user_organizations.is_active, true)` in the same subquery shape, and this migration didn't at first.

**Issue 2** was introduced deliberately by `sql/migrations/30_fix_rls_allow_default_org.sql` and never revisited. Migration 121 (`fail_closed_tenant_isolation`) removed an equivalent fallback from `get_current_tenant_id()`/`wardah_org_id()`, but its verification block only scans those two functions' `prosrc` text — it does not scan inline `COALESCE(...,'00000000-...')` policy predicates, so this instance survived untouched through Production cutoff 152 and Migration 169.

**Issue 3** predates any tenant-scoping work in this codebase (`sql/migrations/41_multi_tenant_rls_policies.sql`). Every confirmed caller — SQL (`149_ap_three_way_match_allocations.sql`, `150_ap_matched_invoice_idempotency_and_grn_gate.sql`, and their carried-forward baseline copies) and application code (none call it directly at all) — already passes `auth.uid()` as `p_user_id`. No legitimate caller needs to check a different user.

## 3. What the migration changes

| Change | Detail |
|---|---|
| `physical_count_items` (4 policies) | `DROP POLICY; CREATE POLICY` for `_del_m`, `_ins_m`, `_sel_m`, `_upd_m` — subquery corrected to `user_organizations.org_id` and `AND COALESCE(user_organizations.is_active, true)` added; the `sel_m` policy's redundant duplicate `(A OR A)` clause is collapsed to one. |
| `physical_count_sessions` (4 policies) | Identical treatment. |
| `manufacturing_stages`, `stage_wip_log`, `standard_costs` | `DROP POLICY; CREATE POLICY ... FOR ALL TO authenticated USING (org_id = public.wardah_org_id()) WITH CHECK (...)` — no fallback of any kind, reuses the migration-121 security root (which already checks active membership internally via `wardah_is_org_member`). `REVOKE ALL ON TABLE ... FROM anon` on all three. |
| `get_effective_org_id()` | `CREATE OR REPLACE`, now `RETURN public.wardah_org_id();`. The first draft only dropped the default-UUID literal but kept reading `current_setting('app.current_org_id', true)` — the exact dead session-GUC pattern `sql/migrations/118_replace_dead_org_isolation_policies.sql` already eliminated repo-wide (no Supabase client ever sets that GUC; it was the root cause of 38 tables silently returning zero rows). Delegating to `wardah_org_id()` avoids reintroducing that class of bug for `journal_entry_attachments`. |
| `has_permission` | `CREATE OR REPLACE`, adds `IF p_user_id IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;` as the first statement. Grants unchanged (`authenticated`, `service_role` retain `EXECUTE`). |
| `scripts/ci/check_definer_guards.py` | Adds `"has_permission"` to `KNOWN_EXEMPT` — its guard is a direct `auth.uid()` identity check, not an org-membership helper, so the generic guard-pattern scan doesn't apply. |
| Preflight | Fails closed (`TENANT_170_REQUIRED_TABLE_MISSING`, `TENANT_170_WARDAH_ORG_ID_MISSING`, `TENANT_170_HAS_PERMISSION_MISSING`) if the schema has drifted from what this migration assumes, before touching anything. |
| Postflight | In-transaction `$verify$` block: none of the 8 rewritten policies still contain the literal `<table>.organization_id` self-reference (`FAIL[170-1]`); all 8 still carry the active-membership guard (`FAIL[170-1b]`); none of the 3 (or 4, including `get_effective_org_id`) rewritten predicates contain the hardcoded default UUID (`FAIL[170-2]`); `get_effective_org_id` no longer reads `app.current_org_id` (`FAIL[170-2b]`); `anon` holds zero grants on the 3 tables (`FAIL[170-2]`); `has_permission`'s `prosrc` contains the new guard text (`FAIL[170-3]`). Raises before `COMMIT` on any failure. |
| Locking | `LOCK TABLE` the 5 affected tables `IN SHARE ROW EXCLUSIVE MODE`; `lock_timeout = '30s'`, `statement_timeout = '5min'`. |

`has_permission`'s return-`false`-not-raise design preserves the exact `boolean` contract for its two legitimate self-check callers (unaffected, since they always pass `auth.uid()`), and avoids a differently-shaped error message that could itself hint at the mismatch.

## 4. Acceptance gate

```text
scripts/ci/fresh-db/acceptance_170_tenant_isolation_and_permission_hardening.sql
```

Seeds two organizations, two active users (one per org) and a third user (org A, `is_active=false`), plus a product/session/item/manufacturing-stage under org A and a role/permission/user_roles grant giving org A's user one real, specific permission. Proves, in order:

1. Org B's member cannot see org A's `physical_count_sessions`/`physical_count_items` rows (SELECT filtered, not an error), and a direct `INSERT`/`UPDATE`/`DELETE` attempt against org A's row from org B's session is denied or affects zero rows on **both** tables (not just `items`); org A's row is confirmed intact afterward.
2. **Same-org happy path**: org A's own active member can still SELECT/INSERT/UPDATE/DELETE their own org's `physical_count_items` row — the fix is not an accidental deny-all — and a `WITH CHECK`-specific test proves an org-A-visible row cannot be reassigned to org B via `UPDATE ... SET organization_id = <org B>` (not just blocked from being read cross-org via `USING`).
3. The `is_active=false` fixture user, despite a JWT claiming org A (the org their now-disabled membership belongs to), cannot see org A's rows.
4. `anon` gets `permission denied` (grant-level, before any policy even evaluates) on both `SELECT` and `INSERT` against all three of `manufacturing_stages`, `stage_wip_log`, and `standard_costs`.
5. An authenticated org-B member who spoofs the JWT `org_id` claim to org A's id still cannot see org A's `manufacturing_stages` row — `wardah_org_id()`'s membership check rejects the unowned claim and falls back to the caller's own real membership, never the claimed org.
6. `has_permission` called with another user's id returns `false` regardless of that user's actual state; called with the caller's own id and a permission key they were never granted, it evaluates to `false` normally (not short-circuited to an error); called with the caller's own id and the permission key they **were** granted via the fixture role, it returns `true` — proving the function isn't simply hardcoded/short-circuited to always return `false`.

Final marker: `TENANT_ISOLATION_170_ACCEPTANCE_PASS`.

**Confirmed green in CI on real PostgreSQL 17** via the dedicated `tenant-isolation-170-acceptance.yml` workflow — the "Confirm Migration 170 satisfies the tenant-isolation contract" check has passed on the current head commit. (This sandbox still has no PostgreSQL 17/Docker available locally for a from-scratch local run; CI remains the behavioral proof, but unlike the first draft of this runbook, that proof now exists and is green, not merely pending.)

**Known remaining gap, not covered by this acceptance suite:** no catalog-level scan proves that no `SECURITY DEFINER` RPC writes to these five tables while bypassing RLS. A repository search found no such RPC in current use (writes to these tables appear to be direct DML, not RPC-mediated), so this is not treated as a merge blocker, but it is not the same as a proof — flagged here as a defensive follow-up, not silently assumed covered.

## 5. Production apply

Target project: Supabase `uutfztmqvajmsxnrqeiv` ("Manufacturing Process") — **not** `Wardah-Prod` (`rytzljjlthouptdqeuxh`), which is `INACTIVE`.

**Preflight (read-only, before applying):**
```sql
-- Confirm the exact current (broken) policy text on the 8 physical_count_*
-- policies and the 3 default-org policies, for the record.
SELECT polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
FROM pg_policy
WHERE polrelid IN ('public.physical_count_items'::regclass,
                    'public.physical_count_sessions'::regclass,
                    'public.manufacturing_stages'::regclass,
                    'public.stage_wip_log'::regclass,
                    'public.standard_costs'::regclass);

-- Confirm anon currently holds grants on the 3 tables (expected true pre-apply).
SELECT has_table_privilege('anon', t, 'SELECT')
FROM unnest(ARRAY['public.manufacturing_stages','public.stage_wip_log','public.standard_costs']) t;

-- Confirm no active voucher/physical-count session is mid-transaction during
-- the apply window (best-effort operational check, not a hard gate).
```

**Postflight (read-only, after applying):**
```sql
-- All 8 physical_count_* policies must reference user_organizations.org_id
-- (never <table>.organization_id) AND carry the active-membership guard.
SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy
WHERE polrelid IN ('public.physical_count_items'::regclass,
                    'public.physical_count_sessions'::regclass);
-- Expect every row's text to contain 'is_active'.

-- anon must hold zero privileges on all 3 tables.
SELECT has_table_privilege('anon', t, 'SELECT') AS sel,
       has_table_privilege('anon', t, 'INSERT') AS ins
FROM unnest(ARRAY['public.manufacturing_stages','public.stage_wip_log','public.standard_costs']) t;

-- get_effective_org_id must delegate to wardah_org_id(), never read the dead
-- app.current_org_id GUC again.
SELECT prosrc ~ 'wardah_org_id' AS delegates_correctly,
       prosrc !~ 'app\.current_org_id' AS no_dead_guc
FROM pg_proc WHERE proname = 'get_effective_org_id';

-- has_permission carries the new guard and grants are unchanged.
SELECT prosrc ~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' AS has_guard
FROM pg_proc WHERE proname = 'has_permission';
SELECT has_function_privilege('authenticated', 'has_permission(uuid,uuid,varchar)', 'EXECUTE');

-- Ledger row landed exactly once.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '170_tenant_isolation_and_permission_hardening';
```

Expected: all 8 policy texts reference `user_organizations.org_id` and `is_active`; both `anon` grant checks `false` for all three tables; `delegates_correctly` and `no_dead_guc` both true; `has_guard` true; `has_function_privilege` true (unchanged, still callable — just self-scoped now); exactly one ledger row for 170.

## 6. Rollback

Additive apart from replacing 8 RLS policy predicates, 3 tenant-isolation policy predicates + their `anon` grants, `get_effective_org_id()`, and `has_permission()`. Before any Production traffic depends on the tightened contract, the reviewed recovery is to correct forward with a new numbered migration rather than hand-edit 170 in place, per the project's golden rule. Do not restore the previous self-referencing subquery or the default-org fallback under any circumstance — both are the exact vulnerabilities this migration closes. If a legitimate workflow is found broken by the tightened `has_permission` guard or the `authenticated`-only scoping on the 3 manufacturing tables, the correct response is a forward-fix migration that adds an explicit, narrow exception (e.g. a specific service-role bypass proven necessary), not reverting the guard.

Never edit `supabase_migrations.schema_migrations` to remove this row, and never apply SQL that is not the exact file merged to `main`.
