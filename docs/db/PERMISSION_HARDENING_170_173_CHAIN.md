# Migrations 170–173 — Tenant Isolation & `has_permission()` Hardening Chain

**Scope:** The four migrations that took Production from cutoff 169 to 173, and the final, verified state of the authorization surface they leave behind.
**State:** All four applied to Production (`Manufacturing Process`, `uutfztmqvajmsxnrqeiv`) and verified. 173 was the ledger head at the time of this chain's own verification (§4); Production has since advanced through Migration 174 (`20260809112236`) to Migration 175 (`20260811132302`) — see `CLAUDE.md`'s `DATABASE_STATE` block for the current head.
**Purpose of this document:** the four per-migration runbooks each describe one change in isolation. Three of them replace the *same function*, so the only way to read the current contract is to read them together. This document is that composite view, plus the live evidence that the composite actually holds.

## 1. The chain

| # | Migration | Ledger version | Applied | PR |
|---|---|---|---|---|
| 170 | `170_tenant_isolation_and_permission_hardening` | `20260806043140` | 2026-08-06 | #98 |
| 171 | `171_ai_usage_daily_and_reports_insights_permission` | `20260806061156` | 2026-08-06 | #104 |
| 172 | `172_has_permission_exact_key_match` | `20260808153737` | 2026-08-08 | #109 |
| 173 | `173_has_permission_active_role_check` | `20260809051430` | 2026-08-09 | #110 |

Per-migration detail lives in `TENANT_ISOLATION_170_RUNBOOK.md`, `AI_USAGE_DAILY_171_RUNBOOK.md`, `HAS_PERMISSION_172_RUNBOOK.md` and `HAS_PERMISSION_173_RUNBOOK.md`. Nothing here replaces those; this is the seam between them.

## 2. Three migrations, one function

170, 172 and 173 each `CREATE OR REPLACE` `public.has_permission(uuid, uuid, varchar)`. Each preserves the previous one's work rather than reverting it, so the live body is the **union** of the three:

| Layer | From | Contract |
|---|---|---|
| Caller-identity guard | 170 | `p_user_id IS DISTINCT FROM auth.uid()` → `false`. A caller can only ask about themselves; the cross-user permission-disclosure path is closed. |
| Exact permission-key match | 172 | `p.permission_key = p_permission_key`. The `LIKE`-based same-module fallback is gone — a grant on `reports.foo` no longer satisfies `reports.bar`. |
| Active-role requirement | 173 | `JOIN roles r … AND COALESCE(r.is_active, true)`. Disabling a role revokes what it granted, immediately, for everyone holding it. |
| Role expiry | pre-170 | `ur.expires_at IS NULL OR ur.expires_at > NOW()` — carried through unchanged by all three. |
| Org scoping | pre-170 | `ur.org_id = p_org_id`, and the `roles` join is org-scoped too (`r.org_id = p_org_id`). |

**The layering is why a later migration must never be read as replacing an earlier one's runbook.** 173's file contains 172's predicate; if 173 were ever reverted by hand, 172's fix would go with it. Any future change to this function must re-assert all five rows of that table, and the postflight query in §4 exists precisely to catch a replacement that silently drops one.

## 3. What 171 contributes

171 is not part of the `has_permission()` sequence — it sits in the chain by number only. It creates `public.ai_usage_daily` (per-user and per-org daily AI quota, enforced server-side by a race-safe RPC) and seeds the `reports.ai_insights.use` permission that the `reports-insights` Edge Function checks.

Its relevance to the other three is one-directional: the Edge Function's permission check *reads through* `has_permission()`, which is why the same-module wildcard 172 closed was found during 171's pre-deployment verification, and not before.

## 4. Verified live state — 2026-08-09

Read-only, run against Production after 173 landed. This is the composite postflight; it supersedes running the three per-migration postflights separately.

```sql
SELECT
  prosrc ~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' AS identity_guard,      -- 170
  prosrc !~ 'LIKE'                                    AS wildcard_removed,    -- 172
  prosrc ~ 'p\.permission_key\s*=\s*p_permission_key' AS exact_match,         -- 172
  prosrc ~ 'roles r'                                  AS roles_join,          -- 173
  prosrc ~ 'COALESCE\(r\.is_active,\s*true\)'         AS role_active_guard,   -- 173
  prosrc ~ 'ur\.org_id\s*=\s*p_org_id'                AS org_scoping,
  prosrc ~ 'expires_at'                               AS role_expiry,
  prosrc ~ 'super_admins'                             AS super_admin_override,
  prosrc ~ 'is_org_admin'                             AS org_admin_override,
  has_function_privilege('authenticated',
    'public.has_permission(uuid,uuid,varchar)', 'EXECUTE')  AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'has_permission';
```

All ten columns returned `true`.

Tenant-isolation closures from 170, re-checked in the same pass:

```sql
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename IN ('physical_count_items','physical_count_sessions')) AS physical_count_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename IN ('physical_count_items','physical_count_sessions')
     AND (qual LIKE '%physical_count_items%' OR qual LIKE '%physical_count_sessions%')) AS self_referencing_policies,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE grantee='anon' AND table_schema='public'
       AND table_name IN ('manufacturing_stages','stage_wip_log','standard_costs')) AS anon_grants_on_mfg,
  (SELECT to_regclass('public.ai_usage_daily') IS NOT NULL) AS ai_usage_daily_exists,
  (SELECT count(*) FROM public.permissions
     WHERE permission_key='reports.ai_insights.use')        AS ai_insights_permission_rows;
```

Result: `physical_count_policies = 8`, `self_referencing_policies = 0`, `anon_grants_on_mfg = 0`, `ai_usage_daily_exists = true`, `ai_insights_permission_rows = 1`.

Ledger head confirmed as `20260809051430 / 173_has_permission_active_role_check`, with `scripts/ci/validate_migration_ledger.py` reporting `live_cutoff: 173`, `repo_max: 173`, `repository_ahead_by: 0`, `pending_repository_files: []`.

**What this evidence is and is not.** These are catalog-level assertions about the deployed contract. The behavioural proofs — that a disabled role actually stops authorizing, that a same-module key actually stops matching — come from the paired Fresh PostgreSQL 17 acceptance workflows (`tenant-isolation-170-acceptance.yml`, `ai-usage-daily-171-acceptance.yml`, `has-permission-172-acceptance.yml`, `has-permission-173-acceptance.yml`), which run against synthetic fixtures, never Production data. Both matter; neither substitutes for the other.

## 5. What this chain deliberately did **not** change

Both override branches survive all four migrations, untouched and by design:

```sql
EXISTS (super_admins WHERE user_id = p_user_id AND is_active)        -- branch 1
OR EXISTS (user_organizations WHERE user_id = p_user_id
             AND org_id = p_org_id AND is_active AND is_org_admin)   -- branch 2
```

**Branch 2 never reads `p_permission_key`.** Any active org admin passes every key, including the sensitive accounting controls (`unpost`, `cancel`, `reverse`). Verified live on 2026-08-09: the override is present in **both** `has_permission(uuid,uuid,varchar)` and `wardah_has_exact_permission(uuid,uuid,text)`.

This is open architectural question **Issue #93**, not an oversight of this chain. Two consequences follow directly, and both are live today:

1. **A contract check that counts `role_permissions` rows does not measure effective authorization.** `granted_roles = 0` for a sensitive key is compatible with every org admin holding it. Checks that intend to measure real access must call the permission function per active user, not count grants.
2. **`wardah_has_exact_permission` is "exact" only about the *key*, not about the *override*.** Migration 166 introduced it to bypass the module-level fallback for `accounting.vouchers.unpost`; it joins `roles` and checks `is_active` (173 later brought `has_permission` into line with it), but it carries the same org-admin branch. The name promises more isolation than the implementation delivers.

Deciding Issue #93 — keep the override and document it, or carve out a sensitive-permission class that requires an explicit grant — is the next authorization change, and it is out of scope for 170–173. If the sensitive-class option is chosen, note the lockout risk recorded in the issue: the single active org admin must be granted the new role **before** the override is narrowed, or nobody can perform those operations afterwards.

## 6. Governance record

Two process facts from this window are worth keeping, because both are precedents:

- **170 sat merged-but-unapplied.** It reached `main` in PR #98 while the Production ledger was still at 169, and all three vulnerabilities stayed fully live for that entire window. Merging a migration closes the gap in the repository, not in Production. See `TENANT_ISOLATION_170_RUNBOOK.md`, header note.
- **171 honoured DB-first ordering.** The migration was applied and verified on 2026-08-06; the UI depending on `reports-insights` merged on 2026-08-08 (#106) and after (#107, #108). This is the ordering `CLAUDE.md` §"ترتيب النشر" requires, and the counter-example to Migration 148's violation.

A third fact belongs to the ledger itself: the Production row for migration 163 is named `payment_voucher_guarded_draft_inserts`, not `163_payment_voucher_atomic_draft_creation`. Until that alias was declared in `sql/migrations/migration_ledger_exceptions.json`, `Audit Production Migration Ledger` failed closed on every run with:

```text
ERROR: Live migration 20260731102524/payment_voucher_guarded_draft_inserts has no
exact repository file payment_voucher_guarded_draft_inserts.sql and no documented alias
```

The alias is now declared and the audit passes. The row itself was never touched — the historical name is preserved exactly as applied, per the golden rule.
