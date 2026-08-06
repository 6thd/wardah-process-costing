# Migration 171 — AI Usage Daily & `reports.ai_insights.use` Permission Runbook

**Migration:** `171_ai_usage_daily_and_reports_insights_permission.sql`
**Scope:** Add the quota-tracking table and race-safe accept/reject RPC that back the `reports-insights` Supabase Edge Function, plus seed the `reports.ai_insights.use` permission the Edge Function checks before calling any provider.
**State:** Repository implementation, not yet applied to Production. Do not apply before the paired Fresh DB acceptance gate is green and this runbook's preflight/postflight queries have been reviewed. The Edge Function itself is deployed independently of this migration (see `docs/db/UOM_PARTIAL_RECEIPT_148_RUNBOOK.md`-style DB-first ordering in `CLAUDE.md`) — this migration must land on Production and be verified **before** any UI that depends on `reports-insights` is merged.

## 1. Purpose

The reports-insights feature (a generic, provider-agnostic AI insights panel — no vendor name in any identifier, since the underlying model provider sits behind an internal adapter and may change) needs a per-user and per-organization daily request quota, enforced server-side and immune to two failure modes:

1. A client-supplied limit — the Edge Function must never trust a caller for how many requests it's allowed; limits are internal constants known only to trusted server code.
2. A quota race — two concurrent requests from different users in the same organization must not both read the org counter as "one below the limit" and both get accepted, which would let the organization exceed its shared daily cap.

It also must not let a rejection count against the organization's usage: a user who has already exceeded their own per-user limit and keeps retrying must not be able to consume the shared organization quota out from under other users in the same org — hence `accepted_count` and `rejected_count` are tracked as two separate columns, and only `accepted_count` is compared against the caps.

## 2. What the migration creates

| Object | Detail |
|---|---|
| `public.ai_usage_daily` | One row per `(org_id, user_id, usage_date)` (`UNIQUE` constraint `ai_usage_daily_org_user_date_key`), `accepted_count`/`rejected_count` integers (both `CHECK (... >= 0)`), `usage_date` is a UTC calendar date computed by the RPC, never client-supplied. Index `idx_ai_usage_daily_org_date (org_id, usage_date)` supports the RPC's per-org `SUM(accepted_count)` lookup. |
| RLS on `ai_usage_daily` | `ai_usage_daily_select_own`: `FOR SELECT TO authenticated USING (user_id = auth.uid())` — a caller may see only their own row (e.g. to render "N of M used today" in the UI). `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT SELECT ... TO authenticated`; `GRANT ALL ... TO service_role`. No `INSERT`/`UPDATE`/`DELETE` grant exists for `authenticated` or `anon` at all — every write goes through the RPC below. |
| `public.rpc_check_and_record_ai_usage(p_org_id, p_user_id, p_user_daily_limit, p_org_daily_limit)` | `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_temp'`. Takes `pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_today::text))` before reading or writing any counter, serializing every call for a given `(org, UTC day)` pair so a concurrent org-limit race is structurally impossible, not just unlikely. On accept, increments `accepted_count` and returns `allowed=true`; on reject (either the user's own limit or the org's shared limit is already met), increments `rejected_count` only and returns `allowed=false` — `accepted_count` is untouched by a rejection. |
| `rpc_check_and_record_ai_usage` grants | `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` — the Edge Function is the only intended caller, and only via a `service_role`-keyed admin client kept separate from the request-bound user client used for auth/org/permission checks. Neither `anon` nor `authenticated` can invoke this RPC directly with an arbitrary org/user/limit combination. |
| `reports.ai_insights.use` permission | Seeded into the existing global `permissions` catalog under the `reports` module (`ON CONFLICT (permission_key) DO NOTHING`), following the same catalog convention as every other permission — actual grants happen per-org via `role_permissions`/`user_roles`, not here. |
| Preflight | Fails closed (`AI_USAGE_171_ORGANIZATIONS_MISSING`, `AI_USAGE_171_PERMISSIONS_CATALOG_MISSING`, `AI_USAGE_171_REPORTS_MODULE_MISSING`, `AI_USAGE_171_TABLE_ALREADY_EXISTS`) if the schema this migration assumes has drifted, before touching anything. |
| Postflight | In-transaction `$verify$` block: table exists (`FAIL[171-1]`); no `INSERT`/`UPDATE`/`DELETE` grant for `anon`/`PUBLIC` on the table (`FAIL[171-1b]`); RPC is not `EXECUTE`-able by `anon`/`authenticated` (`FAIL[171-2]`) and **is** `EXECUTE`-able by `service_role` (`FAIL[171-2b]`); `reports.ai_insights.use` row exists (`FAIL[171-3]`). Raises before `COMMIT` on any deviation. |
| Locking | `lock_timeout = '30s'`, `statement_timeout = '5min'` (new table, no existing-table lock needed). |

Why `SECURITY DEFINER` + `REVOKE`/`GRANT service_role` instead of this repo's more common `wardah_assert_org_member`/`wardah_is_org_member` guard-call pattern: the RPC is never meant to be reachable by an end-user session at all — the Edge Function resolves and verifies the caller's identity, organization membership, and permission itself using a request-bound client keyed to the user's own JWT, and only then calls this RPC through a completely separate `service_role` admin client purely to record/check the quota. Re-deriving `auth.uid()` inside the RPC would just compare against `NULL` (a `service_role` call carries no end-user JWT) and add nothing; the real guard is the grant itself. `scripts/ci/check_definer_guards.py` recognizes this `REVOKE ... FROM PUBLIC, anon, authenticated` pattern directly — no `KNOWN_EXEMPT` entry was needed.

## 3. Acceptance gate

```text
scripts/ci/fresh-db/acceptance_171_ai_usage_daily.sql
```

Seeds one organization with two active users. Proves, in order:

1. Direct `EXECUTE` of `rpc_check_and_record_ai_usage` is denied for both the `authenticated` and `anon` roles, regardless of arguments — the RPC is reachable only as `service_role`.
2. With a per-user limit of 3, user A's first 3 calls are all accepted with `user_accepted_count` incrementing 1→2→3; the 4th call is rejected, `accepted_count` is unchanged from before that call, and `rejected_count` becomes 1 — a rejection never inflates accepted usage.
3. With an org-wide limit of 4 and user A already holding 3 accepted requests, user B's first call brings the org total to 4 and is accepted; user B's second call is rejected purely on the org-wide cap, even though user B's own per-user count (1) is nowhere near a generous per-user limit — proving the org cap is enforced independently of, and can bind tighter than, any individual user's own limit.
4. A row dated "yesterday" (UTC) with `accepted_count = 999` does not affect a fresh organization/user's counters for today — the first call today is accepted with `user_accepted_count = 1`, confirming the UTC-day boundary is respected rather than accumulating across days.
5. RLS: user A can `SELECT` their own row, cannot `SELECT` user B's row, and a direct `INSERT` attempt (bypassing the RPC) is denied at the grant level.

Final marker: `AI_USAGE_DAILY_171_ACCEPTANCE_PASS`.

**Not covered by this acceptance suite, stated explicitly rather than assumed:** true concurrent-connection racing. Like every other acceptance file in this repo, this script is a single sequential `psql` session — it cannot exercise two simultaneous connections racing the same advisory lock. The lock design (`pg_advisory_xact_lock` scoped to `(org_id, UTC date)`, held for the RPC's whole transaction) is reviewed for correctness under concurrency, but only sequential-call correctness is actually exercised here.

## 4. Production apply

Target project: Supabase `uutfztmqvajmsxnrqeiv` ("Manufacturing Process") — **not** `Wardah-Prod` (`rytzljjlthouptdqeuxh`), which is `INACTIVE`.

**Preflight (read-only, before applying):**
```sql
-- Confirm the table does not already exist.
SELECT to_regclass('public.ai_usage_daily');

-- Confirm the reports module row exists (permission seed depends on it).
SELECT id FROM public.modules WHERE name = 'reports';
```

**Postflight (read-only, after applying):**
```sql
-- Table exists, RLS enabled, no write grant for anon/PUBLIC.
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_usage_daily'::regclass;
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'ai_usage_daily'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC', 'service_role');
-- Expect: authenticated has SELECT only; anon/PUBLIC have nothing; service_role has everything.

-- RPC is EXECUTE-able only by service_role.
SELECT has_function_privilege('anon', 'rpc_check_and_record_ai_usage(uuid,uuid,integer,integer)', 'EXECUTE') AS anon_can,
       has_function_privilege('authenticated', 'rpc_check_and_record_ai_usage(uuid,uuid,integer,integer)', 'EXECUTE') AS authenticated_can,
       has_function_privilege('service_role', 'rpc_check_and_record_ai_usage(uuid,uuid,integer,integer)', 'EXECUTE') AS service_role_can;
-- Expect: anon_can=false, authenticated_can=false, service_role_can=true.

-- Permission seeded exactly once.
SELECT permission_key, module_id FROM public.permissions WHERE permission_key = 'reports.ai_insights.use';

-- Ledger row landed exactly once.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '171_ai_usage_daily_and_reports_insights_permission';
```

Expected: `anon_can=false`, `authenticated_can=false`, `service_role_can=true`; exactly one `reports.ai_insights.use` permission row; exactly one ledger row for 171.

**Do not deploy or enable the `reports-insights` Edge Function, and do not merge/enable any UI that calls it, until this migration is applied and verified here** — per `CLAUDE.md`'s DB-first-for-dependent-UI rule, the RPC and permission row must exist before any code path can call `supabase.functions.invoke('reports-insights', ...)` successfully.

## 5. Rollback

Purely additive: one new table, one new RLS policy, one new `SECURITY DEFINER` function, one new permission catalog row. Nothing existing is modified. If a defect is found after apply, correct forward with a new numbered migration per the project's golden rule — do not hand-edit 171 in place, and do not drop `ai_usage_daily` (it is quota-accounting history, not disposable state) to fix a bug found later.

Never edit `supabase_migrations.schema_migrations` to remove this row, and never apply SQL that is not the exact file merged to `main`.
