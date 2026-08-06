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
| RLS on `ai_usage_daily` | `ai_usage_daily_select_own_active_org`: a caller may see only their own row while an `is_active IS TRUE` row still links that user to the row's organization. Disabling membership removes visibility immediately. `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `GRANT SELECT ... TO authenticated`; `GRANT ALL ... TO service_role`. The explicit revoke from `authenticated` matters: the baseline's `ALTER DEFAULT PRIVILEGES` grants `ALL` on every new public table to `anon`/`authenticated`/`service_role` at `CREATE TABLE` time, so a table that only revokes from `anon`/`PUBLIC` would silently leave `authenticated` with its default `INSERT`/`UPDATE`/`DELETE` grant, relying on RLS alone as the write guard instead of the grant model. No `INSERT`/`UPDATE`/`DELETE` grant exists for `authenticated` or `anon` at all — every write goes through the RPC below. |
| `public.rpc_check_and_record_ai_usage(p_org_id, p_user_id)` | `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_temp'`. The limits are immutable function constants: 20 accepted requests per user per UTC day and 100 per organization per UTC day. The RPC independently requires and `FOR SHARE`-locks an active `user_organizations` row before the quota lock or any write, so membership cannot be disabled midway through an accepted decision. Takes `pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_today::text))` before reading or writing any counter, serializing every call for a given `(org, UTC day)` pair so a concurrent org-limit race is structurally impossible, not just unlikely. On accept, increments `accepted_count` and returns `allowed=true`; on reject (either the user's own limit or the org's shared limit is already met), increments `rejected_count` only and returns `allowed=false` — `accepted_count` is untouched by a rejection. |
| `rpc_check_and_record_ai_usage` grants | `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` — the Edge Function is the only intended caller, and only via a `service_role`-keyed admin client kept separate from the request-bound user client used for auth/org/permission checks. Neither `anon` nor `authenticated` can invoke this RPC directly, and no caller can supply or raise a quota limit. |
| `reports.ai_insights.use` permission | Seeded into the existing global `permissions` catalog under the `reports` module (`ON CONFLICT (permission_key) DO NOTHING`), following the same catalog convention as every other permission — actual grants happen per-org via `role_permissions`/`user_roles`, not here. |
| Preflight | Fails closed (`AI_USAGE_171_ORGANIZATIONS_MISSING`, `AI_USAGE_171_PERMISSIONS_CATALOG_MISSING`, `AI_USAGE_171_REPORTS_MODULE_MISSING`, `AI_USAGE_171_TABLE_ALREADY_EXISTS`) if the schema this migration assumes has drifted, before touching anything. |
| Postflight | In-transaction `$verify$` block: table exists (`FAIL[171-1]`); no `INSERT`/`UPDATE`/`DELETE` grant for `anon`/`PUBLIC`/`authenticated` on the table (`FAIL[171-1b]`); RPC is not `EXECUTE`-able by `anon`/`authenticated` (`FAIL[171-2]`) and **is** `EXECUTE`-able by `service_role` (`FAIL[171-2b]`); `reports.ai_insights.use` row exists (`FAIL[171-3]`). Raises before `COMMIT` on any deviation. |
| Locking | `lock_timeout = '30s'`, `statement_timeout = '5min'` (new table, no existing-table lock needed). |

Why `SECURITY DEFINER` + `REVOKE`/`GRANT service_role`: the Edge Function resolves the caller with a request-bound client, then a separate service-role client records quota. Because `auth.uid()` is null on that privileged call, the RPC cannot re-derive the actor; instead it revalidates the supplied `(org_id, user_id)` against an active `user_organizations` row. The grant boundary and membership check are both required. `scripts/ci/check_definer_guards.py` recognizes this `REVOKE ... FROM PUBLIC, anon, authenticated` pattern directly — no `KNOWN_EXEMPT` entry was needed.

## 3. Acceptance gates

The workflow builds a Fresh DB on PostgreSQL 17 and runs both:

- `scripts/ci/fresh-db/acceptance_171_ai_usage_daily.sql`: proves direct denial for `anon`/`authenticated`, the positive path under `SET ROLE service_role`, active-membership rejection, fixed 20/100 limits, rejected-vs-accepted accounting, UTC-day separation, own-row RLS, and visibility removal after membership deactivation.
- `scripts/ci/fresh-db/acceptance_171_ai_usage_concurrency.sh`: creates three active users in one organization, seeds 99 accepted requests, holds the exact advisory-lock key, then queues two independent `psql` callers under `service_role`. Exactly one returns `allowed=true`, one returns `allowed=false`, and the final aggregate must be exactly `accepted_count=100` and `rejected_count=1`.

Final markers:

```text
AI_USAGE_DAILY_171_ACCEPTANCE_PASS
AI_USAGE_DAILY_171_CONCURRENCY_PASS accepted|rejected=100|1 results=f,t
```

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
-- Expect: authenticated has SELECT only and RLS additionally requires an active membership; anon/PUBLIC have nothing; service_role has everything.

-- RPC is EXECUTE-able only by service_role.
SELECT has_function_privilege('anon', 'rpc_check_and_record_ai_usage(uuid,uuid)', 'EXECUTE') AS anon_can,
       has_function_privilege('authenticated', 'rpc_check_and_record_ai_usage(uuid,uuid)', 'EXECUTE') AS authenticated_can,
       has_function_privilege('service_role', 'rpc_check_and_record_ai_usage(uuid,uuid)', 'EXECUTE') AS service_role_can;
-- Expect: anon_can=false, authenticated_can=false, service_role_can=true.

-- Permission seeded exactly once.
SELECT permission_key, module_id FROM public.permissions WHERE permission_key = 'reports.ai_insights.use';

-- Ledger row landed exactly once.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '171_ai_usage_daily_and_reports_insights_permission';
```

Expected: `anon_can=false`, `authenticated_can=false`, `service_role_can=true`; the RPC signature has exactly two UUID arguments; exactly one `reports.ai_insights.use` permission row; exactly one ledger row for 171.

**Do not deploy or enable the `reports-insights` Edge Function, and do not merge/enable any UI that calls it, until this migration is applied and verified here** — per `CLAUDE.md`'s DB-first-for-dependent-UI rule, the RPC and permission row must exist before any code path can call `supabase.functions.invoke('reports-insights', ...)` successfully.

## 5. Rollback

Purely additive: one new table, one new RLS policy, one new `SECURITY DEFINER` function, one new permission catalog row. Nothing existing is modified. If a defect is found after apply, correct forward with a new numbered migration per the project's golden rule — do not hand-edit 171 in place, and do not drop `ai_usage_daily` (it is quota-accounting history, not disposable state) to fix a bug found later.

Never edit `supabase_migrations.schema_migrations` to remove this row, and never apply SQL that is not the exact file merged to `main`.
