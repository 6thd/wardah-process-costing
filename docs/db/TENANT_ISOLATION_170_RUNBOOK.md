# Migration 170 — Tenant Isolation & Permission Hardening Runbook

**Migration:** `170_tenant_isolation_and_permission_hardening.sql`
**Scope:** Fix a real cross-tenant RLS bypass, remove a default-organization fallback reachable by `anon`, and close a cross-user permission-disclosure path.
**State:** Repository implementation, not yet applied to Production. Do not apply before the paired Fresh DB acceptance gate is green and this runbook's preflight/postflight queries have been reviewed.

## 1. Purpose

An independent security audit (2026-08-05) found and this migration closes three unrelated but co-discovered issues, none of which depend on the others:

1. All 8 CRUD RLS policies on `physical_count_items` and `physical_count_sessions` used a self-referencing correlated subquery that degenerated to always-true for any authenticated user with at least one organization membership — full cross-tenant read and write.
2. `manufacturing_stages`, `stage_wip_log` and `standard_costs` fell back to a hardcoded default-organization UUID when JWT claims carried no `org_id`/`tenant_id`, with no `TO` clause (defaulting to role `PUBLIC`) and `anon` holding `GRANT ALL` — an unauthenticated request could read/write that organization's manufacturing data.
3. `has_permission(p_user_id, p_org_id, p_permission_key)` never compared `p_user_id` to `auth.uid()`, so any authenticated user could learn whether an arbitrary *other* user is a super admin, an org admin, or holds a specific permission.

## 2. Root causes

**Issue 1** is a copy/generation defect: the subquery selected `<outer_table>.organization_id` instead of `user_organizations.org_id` (the tenant column on `user_organizations` is `org_id`, not `organization_id`). The correct pattern already existed in the same schema — `stock_transfers_org_policy` joins `user_organizations.org_id` correctly.

**Issue 2** was introduced deliberately by `sql/migrations/30_fix_rls_allow_default_org.sql` and never revisited. Migration 121 (`fail_closed_tenant_isolation`) removed an equivalent fallback from `get_current_tenant_id()`/`wardah_org_id()`, but its verification block only scans those two functions' `prosrc` text — it does not scan inline `COALESCE(...,'00000000-...')` policy predicates, so this instance survived untouched through Production cutoff 152 and Migration 169.

**Issue 3** predates any tenant-scoping work in this codebase (`sql/migrations/41_multi_tenant_rls_policies.sql`). Every confirmed caller — SQL (`149_ap_three_way_match_allocations.sql`, `150_ap_matched_invoice_idempotency_and_grn_gate.sql`, and their carried-forward baseline copies) and application code (none call it directly at all) — already passes `auth.uid()` as `p_user_id`. No legitimate caller needs to check a different user.

## 3. What the migration changes

| Change | Detail |
|---|---|
| `physical_count_items` (4 policies) | `DROP POLICY; CREATE POLICY` for `_del_m`, `_ins_m`, `_sel_m`, `_upd_m` — subquery corrected to `user_organizations.org_id`; the `sel_m` policy's redundant duplicate `(A OR A)` clause is collapsed to one. |
| `physical_count_sessions` (4 policies) | Identical treatment. |
| `manufacturing_stages`, `stage_wip_log`, `standard_costs` | `DROP POLICY; CREATE POLICY ... FOR ALL TO authenticated USING (org_id = public.wardah_org_id()) WITH CHECK (...)` — no fallback of any kind, reuses the migration-121 security root. `REVOKE ALL ON TABLE ... FROM anon` on all three. |
| `get_effective_org_id()` | `CREATE OR REPLACE`, drops the identical default-org fallback (defense-in-depth; its 4 consumers on `journal_entry_attachments` are already `TO authenticated`, so this was not `anon`-reachable before the fix). |
| `has_permission` | `CREATE OR REPLACE`, adds `IF p_user_id IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;` as the first statement. Grants unchanged (`authenticated`, `service_role` retain `EXECUTE`). |
| `scripts/ci/check_definer_guards.py` | Adds `"has_permission"` to `KNOWN_EXEMPT` — its guard is a direct `auth.uid()` identity check, not an org-membership helper, so the generic guard-pattern scan doesn't apply. |
| Preflight | Fails closed (`TENANT_170_REQUIRED_TABLE_MISSING`, `TENANT_170_WARDAH_ORG_ID_MISSING`, `TENANT_170_HAS_PERMISSION_MISSING`) if the schema has drifted from what this migration assumes, before touching anything. |
| Postflight | In-transaction `$verify$` block: none of the 8 rewritten policies still contain the literal `<table>.organization_id` self-reference; none of the 3 (or 4, including `get_effective_org_id`) rewritten predicates contain the hardcoded default UUID; `anon` holds zero grants on the 3 tables; `has_permission`'s `prosrc` contains the new guard text. Raises before `COMMIT` on any failure. |
| Locking | `LOCK TABLE` the 5 affected tables `IN SHARE ROW EXCLUSIVE MODE`; `lock_timeout = '30s'`, `statement_timeout = '5min'`. |

`has_permission`'s return-`false`-not-raise design preserves the exact `boolean` contract for its two legitimate self-check callers (unaffected, since they always pass `auth.uid()`), and avoids a differently-shaped error message that could itself hint at the mismatch.

## 4. Acceptance gate

```text
scripts/ci/fresh-db/acceptance_170_tenant_isolation_and_permission_hardening.sql
```

Seeds two organizations and two users, each a member of exactly one, plus a product/session/item/manufacturing-stage under org A. Proves, in order:

1. Org B's member cannot see org A's `physical_count_sessions`/`physical_count_items` rows (SELECT filtered, not an error), and a direct `INSERT`/`UPDATE`/`DELETE` attempt against org A's row from org B's session is denied or affects zero rows; org A's row is confirmed intact afterward.
2. `anon` gets `permission denied` (grant-level, before any policy even evaluates) on both `SELECT` and `INSERT` against `manufacturing_stages`.
3. An authenticated org-B member who spoofs the JWT `org_id` claim to org A's id still cannot see org A's row — `wardah_org_id()`'s membership check rejects the unowned claim and falls back to the caller's own real membership, never the claimed org.
4. `has_permission` called with another user's id returns `false` regardless of that user's actual state; called with the caller's own id, it still evaluates normally (not short-circuited to an error or an incorrect `true`).

Final marker: `TENANT_ISOLATION_170_ACCEPTANCE_PASS`.

**This suite has been syntax-validated with the project's `pglast`-based checker and reviewed line-by-line against the exact pre-migration policy/function text, but has not yet been executed against a live PostgreSQL 17 instance in this environment** — this sandbox has no PostgreSQL 17 available locally (PG16 only; the paired schema baseline uses PG17-only syntax that PG16 cannot parse) and no working Docker daemon to run one. **Running this suite to green on Fresh PostgreSQL 17 in CI is a mandatory gate before this migration may be applied to Production** — do not treat local syntax validation as equivalent to a passing behavioral run.

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
-- All 8 physical_count_* policies must reference user_organizations.org_id,
-- never <table>.organization_id.
SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy
WHERE polrelid IN ('public.physical_count_items'::regclass,
                    'public.physical_count_sessions'::regclass);

-- anon must hold zero privileges on the 3 tables.
SELECT has_table_privilege('anon', t, 'SELECT') AS sel,
       has_table_privilege('anon', t, 'INSERT') AS ins
FROM unnest(ARRAY['public.manufacturing_stages','public.stage_wip_log','public.standard_costs']) t;

-- has_permission carries the new guard and grants are unchanged.
SELECT prosrc ~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' AS has_guard
FROM pg_proc WHERE proname = 'has_permission';
SELECT has_function_privilege('authenticated', 'has_permission(uuid,uuid,varchar)', 'EXECUTE');

-- Ledger row landed exactly once.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '170_tenant_isolation_and_permission_hardening';
```

Expected: all 8 policy texts reference `user_organizations.org_id`; both `anon` grant checks `false` for all three tables; `has_guard` true; `has_function_privilege` true (unchanged, still callable — just self-scoped now); exactly one ledger row for 170.

## 6. Rollback

Additive apart from replacing 8 RLS policy predicates, 3 tenant-isolation policy predicates + their `anon` grants, `get_effective_org_id()`, and `has_permission()`. Before any Production traffic depends on the tightened contract, the reviewed recovery is to correct forward with a new numbered migration rather than hand-edit 170 in place, per the project's golden rule. Do not restore the previous self-referencing subquery or the default-org fallback under any circumstance — both are the exact vulnerabilities this migration closes. If a legitimate workflow is found broken by the tightened `has_permission` guard or the `authenticated`-only scoping on the 3 manufacturing tables, the correct response is a forward-fix migration that adds an explicit, narrow exception (e.g. a specific service-role bypass proven necessary), not reverting the guard.

Never edit `supabase_migrations.schema_migrations` to remove this row, and never apply SQL that is not the exact file merged to `main`.
