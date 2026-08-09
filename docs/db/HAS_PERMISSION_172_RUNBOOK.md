# Migration 172 — `has_permission` Exact Permission-Key Match Runbook

**Migration:** `172_has_permission_exact_key_match.sql`
**Scope:** Close a same-module authorization-scope bug in `has_permission()`, inherited unchanged through Migration 170, that let any granted permission in a module implicitly satisfy every other permission key in that same module.
**State:** Applied to Production (`uutfztmqvajmsxnrqeiv`) on 2026-08-08, ledger version `20260808153737`, name `172_has_permission_exact_key_match`. Postflight verified live; the exact-match predicate was re-confirmed on 2026-08-09 after 173 replaced the same function — see `docs/db/PERMISSION_HARDENING_170_173_CHAIN.md` §4. Superseded in body but **not** in effect by Migration 173, which `CREATE OR REPLACE`s the same function and preserves this migration's exact-key predicate verbatim.

## 1. Purpose

Pre-deployment verification of the (still undeployed) `reports-insights` Edge Function found that `has_permission(p_user_id, p_org_id, p_permission_key)`'s "ordinary role" branch — unchanged by Migration 170, which only added the caller-identity guard around it — matches not only an exact `permission_key`, but any `permission_key` sharing the same first dot-segment:

```sql
p.permission_key = p_permission_key
OR p.permission_key LIKE REPLACE(
     SPLIT_PART(p_permission_key, '.', 1) || '.%', '*', '%'
   )
```

For `p_permission_key = 'reports.ai_insights.use'`, `SPLIT_PART(p_permission_key, '.', 1)` is `'reports'`, so the pattern reduces to `p.permission_key LIKE 'reports.%'` — `REPLACE(...,'*','%')` is a no-op here since the pattern never contains a literal `*`. Any role holding **any** `reports.*` permission (e.g. `reports.financial.read`, `reports.exports.export`) therefore implicitly satisfied `reports.ai_insights.use`, defeating the dedicated permission Migration 171 introduced specifically to gate the `reports-insights` Edge Function's AI usage quota. This is a general same-module authorization-scope bug affecting every permission key in the catalog, not just this one.

## 2. Root cause and caller audit

The `OR LIKE` clause predates any tenant-scoping work in this codebase (`sql/migrations/41_multi_tenant_rls_policies.sql`) and survived Migration 170's `has_permission` rewrite untouched — 170 only added the `p_user_id IS DISTINCT FROM auth.uid()` self-check as the function's first statement; it did not touch the ordinary-role predicate.

**Live-data confirmation (read-only, before writing this migration):** queried Production (`uutfztmqvajmsxnrqeiv`) directly — `has_permission`'s `prosrc` matches the buggy text above verbatim, and the live `permissions` catalog holds **169 rows, 0 of which contain a literal `*`**. No `permission_key` in actual use depends on wildcard/prefix matching; the `REPLACE(...,'*','%')` call was always a no-op against real data, and the `LIKE` clause never did anything except accidentally broaden every same-module check.

**Caller audit — does any caller rely on the broad match?**

| Caller | Permission key(s) passed | Exact vs. broadened | Affected? |
|---|---|---|---|
| `149_ap_three_way_match_allocations.sql` (RPC, `rpc_post_ap_matched_invoice`-family) | `'purchasing.purchase_invoices.approve'` (literal, exact) | Exact — a literal match was always intended and always worked without the `LIKE` clause | No |
| `150_ap_matched_invoice_idempotency_and_grn_gate.sql` (same RPC family) | `'purchasing.purchase_invoices.approve'` (literal, exact) | Same as above | No |
| Baseline copies of the same two RPCs (`sql/baseline/000_schema_baseline_20260729_210941.sql`) | Same literal | Same as above | No |
| `supabase/functions/reports-insights/index.ts` (`authorize()`) | `PERMISSION_KEY = 'reports.ai_insights.use'` (exact, via `authorize()` → `userClient.rpc('has_permission', ...)`) | Exact intent — this is the caller the bug actually defeats | No (this caller needed the fix, not the broad match) |
| `src/hooks/usePermissions.ts` — exported `checkPermission(userId, orgId, moduleCode, action)` utility, constructs `p_permission_key: \`${moduleCode}.${action}\`` (a 2-segment key against a 3-segment `module.resource.action` catalog) | Rarely if ever exactly equal to a real key — this is the one place in the codebase that would actually have depended on the broad match to return `true` at all | **Zero importers anywhere in `src/`** (confirmed via `grep -rln`) — dead code, not a live dependency | No — unreachable |
| `src/hooks/usePermissions.ts` — the actual `usePermissions()` hook used by `ModuleGuard`, `ProtectedComponent`, `sidebar.tsx`, `withPermission.tsx` | N/A | Never calls the `has_permission` RPC at all — fetches permission rows directly and does its own exact `module_code`+`action` comparison client-side | No — independent code path |

**Conclusion: no live caller anywhere in this codebase (SQL or application) relies on the broad same-module match.** The only caller that structurally could have depended on it is dead code with zero importers.

## 3. What the migration changes

| Change | Detail |
|---|---|
| `has_permission` | `CREATE OR REPLACE`. Ordinary-role predicate: `p.permission_key = p_permission_key` only — the `OR p.permission_key LIKE ...` clause is removed entirely. `auth.uid()` self-check (170), super-admin override, org-admin override, `ur.org_id = p_org_id` scoping, and `(ur.expires_at IS NULL OR ur.expires_at > NOW())` role-expiry behavior are byte-identical to Migration 170 — untouched. |
| Grants | Unchanged (`authenticated`, `service_role` retain `EXECUTE`) — this migration narrows the predicate only, not the execution boundary. |
| `scripts/ci/check_definer_guards.py` | No change needed — `has_permission` was already added to `KNOWN_EXEMPT` by Migration 170 (guarded by a direct `auth.uid()` comparison, not an org-membership helper). |
| Preflight | Fails closed (`PERMISSION_172_HAS_PERMISSION_MISSING`, `PERMISSION_172_REQUIRED_TABLE_MISSING`) if the schema has drifted from what this migration assumes, before touching anything. |
| Postflight | In-transaction `$verify$` block: `has_permission`'s `prosrc` no longer contains `LIKE` (`FAIL[172]`); still contains the exact-equality predicate (`FAIL[172]`); and still contains the `auth.uid()` self-check, `super_admins` override, `is_org_admin` override, and `expires_at` role-expiry text from Migration 170 (each a distinct `FAIL[172]` check) — proving the fix narrowed only the intended predicate, not the surrounding contract. Raises before `COMMIT` on any failure. |
| Locking | Function-only change — no `LOCK TABLE` (matches the convention already used for function-only migrations such as 121); `SET LOCAL lock_timeout = '30s'`, `statement_timeout = '5min'`. |

## 4. Acceptance gate

```text
scripts/ci/fresh-db/acceptance_172_has_permission_exact_key_match.sql
```

Seeds two organizations and **seven** fixture users covering every case in scope, then calls `has_permission()` as each (via `request.jwt.claim.sub`, matching the function's own `auth.uid()` self-check):

1. **The bug scenario itself**: a user whose only role grants `reports.financial.read` (same module, different permission) — `has_permission(..., 'reports.ai_insights.use')` must return `false`. Before the fix, this returned `true`; confirmed empirically by reverting the function to the pre-172 text on the same fixtures and observing this exact assertion fail (`ACCEPTANCE_FAIL[172-1]`) before restoring the fix and re-confirming a clean pass.
2. An explicit, exact grant of `reports.ai_insights.use` itself still returns `true`.
3. Org-admin override (`is_org_admin = true`, no explicit grant) still returns `true`.
4. Super-admin override (`super_admins` row, no explicit grant, not an org admin) still returns `true`.
5. Cross-user: a caller cannot query a different user's permission state (Migration 170 behavior, unchanged).
6. **Cross-org**: the `CrossOrg` user holds the *exact* `reports.ai_insights.use` key via a real `user_roles` row scoped to org B — first checked against org B itself (must return `true`, proving the grant is real, not a broken fixture), then checked against org A (must return `false`). This fixture shape is deliberate: an earlier draft used a `CrossOrg` user with *no* grant anywhere, which made the org-A assertion pass regardless of whether `ur.org_id = p_org_id` was even present in the function — indistinguishable from case 8 (ungranted) and not a real proof of org scoping. Granting the exact key in the *wrong* org is the only shape that isolates the org predicate specifically. **Mutation-tested**: temporarily removed `AND ur.org_id = p_org_id` from `has_permission` on the same fixtures and confirmed the org-A assertion failed exactly as expected (`ACCEPTANCE_FAIL[172-6]: ... evaluated true against org A`), then restored the predicate and re-confirmed a clean pass.
7. Expired role: an exact-key grant via a `user_roles` row whose `expires_at` is in the past returns `false`.
8. Ungranted: a **separate, distinct** user (`Ungranted`, not `CrossOrg` — which now genuinely holds a grant) with zero role/permission rows anywhere returns `false`, not an error.

Final marker: `HAS_PERMISSION_172_ACCEPTANCE_PASS`.

Migration 172's own postflight `$verify$` block also asserts `has_permission`'s `prosrc` still contains the `ur\.org_id\s*=\s*p_org_id` predicate text, independent of the acceptance suite's behavioral proof — a static, in-migration check that the org-scoping join condition specifically was not dropped.

**Confirmed green locally on real PostgreSQL 17** (installed from the PGDG apt repository in this session's sandbox, since Docker was unavailable here): Fresh DB built from `000_schema_baseline_20260729_210941.sql` + `001_system_reference_data_20260729_210941.sql` through the full chain (`153` → `172`) via `run_chain.sh`, `11/11 PASS`; `acceptance_172_has_permission_exact_key_match.sql` → `HAS_PERMISSION_172_ACCEPTANCE_PASS` (9 assertions, including the cross-org setup check); `acceptance_170_tenant_isolation_and_permission_hardening.sql` → `TENANT_ISOLATION_170_ACCEPTANCE_PASS` (re-run after 172, confirming no regression); `acceptance_171_ai_usage_daily.sql` → `AI_USAGE_DAILY_171_ACCEPTANCE_PASS` (same). Both the same-module mutation (case 1) and the org-scoping mutation (case 6) were independently confirmed to fail acceptance when reverted, then pass cleanly when restored. The dedicated `has-permission-172-acceptance.yml` workflow mirrors this exactly for CI.

## 5. Production apply

Target project: Supabase `uutfztmqvajmsxnrqeiv` ("Manufacturing Process") — **not** `Wardah-Prod` (`rytzljjlthouptdqeuxh`), which is `INACTIVE`.

**Preflight (read-only, before applying):**
```sql
-- Confirm the exact current (broken) predicate text, for the record.
SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'has_permission';
-- Expect the OR-LIKE clause to still be present.

-- Confirm the live permission catalog has no wildcard keys (sanity check
-- this migration's premise still holds at apply time).
SELECT count(*) AS total, count(*) FILTER (WHERE permission_key LIKE '%*%') AS wildcard_count
FROM public.permissions;
-- Expect wildcard_count = 0.
```

**Postflight (read-only, after applying):**
```sql
-- has_permission must no longer contain LIKE, must contain the exact
-- equality predicate, and must retain every Migration 170 behavior.
SELECT
  prosrc !~ 'LIKE' AS like_removed,
  prosrc ~ 'p\.permission_key\s*=\s*p_permission_key' AS exact_match_present,
  prosrc ~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' AS identity_guard_present,
  prosrc ~ 'super_admins' AS super_admin_override_present,
  prosrc ~ 'is_org_admin' AS org_admin_override_present,
  prosrc ~ 'expires_at' AS role_expiry_present,
  prosrc ~ 'ur\.org_id\s*=\s*p_org_id' AS org_scoping_present
FROM pg_proc WHERE proname = 'has_permission';
-- Expect every column true.

SELECT has_function_privilege('authenticated', 'has_permission(uuid,uuid,varchar)', 'EXECUTE');
-- Expect true (unchanged, still callable).

-- Ledger row landed exactly once.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '172_has_permission_exact_key_match';
```

Expected: `like_removed`, `exact_match_present`, `identity_guard_present`, `super_admin_override_present`, `org_admin_override_present`, `role_expiry_present`, and `org_scoping_present` all `true`; `has_function_privilege` `true`; exactly one ledger row for 172.

## 6. Rollback

Additive apart from replacing `has_permission()`'s ordinary-role predicate — a single `CREATE OR REPLACE FUNCTION`. Before any Production traffic depends on the tightened contract, the reviewed recovery is to correct forward with a new numbered migration rather than hand-edit 172 in place, per the project's golden rule. Do not restore the `OR LIKE` same-module match under any circumstance — it is the exact vulnerability this migration closes, and the caller audit in §2 confirms no legitimate caller needs it. If a legitimate workflow is found broken by the tightened match (a caller genuinely needs a same-module or hierarchical permission check), the correct response is a forward-fix migration that adds an explicit, narrow mechanism for that (e.g. a dedicated parent-permission table, not a `LIKE` pattern reconstructed from string-splitting the key), not reverting to the broad match.

Never edit `supabase_migrations.schema_migrations` to remove this row, and never apply SQL that is not the exact file merged to `main`.

## 7. Relationship to `reports-insights` deployment

This migration is a **prerequisite** for deploying the `reports-insights` Edge Function (`verify_jwt=true`), per the repository's `repository-first` migration / `DB-first` interface ordering rule (`CLAUDE.md`). The Edge Function calls `has_permission(auth.uid(), org_id, 'reports.ai_insights.use')` to gate access before ever reaching the AI provider or the daily-quota RPC; without this fix, any role holding an unrelated `reports.*` permission would bypass that gate entirely. The function remains undeployed until: this migration is merged to `main`, applied to Production, and verified via the postflight queries in §5 above — after which the Edge Function deployment and its own agreed Production checks (401 without JWT, 403 without permission, 200 for an authorized user, immediate fallback on provider failure, 429 on quota) proceed as a separate, later step.
