# Migration 174 — Sensitive Permission Class & Atomic RBAC Control Plane

**Migration:** `174_sensitive_permission_class_and_rbac_rpcs.sql`
**Closes:** Issue #93 — the org-admin override branch never read `p_permission_key`, so every active org admin passed every key.
**State:** Repository implementation, **not yet applied to Production**. The operational transaction in §6 must run and be verified *before* this migration is applied, or the organization is locked out of unpost/cancel entirely. Do not apply out of order.

## 1. The verified problem

Read-only inventory of the live database on 2026-08-09, before any code was written:

| Fact | Value |
|---|---|
| Active super admins | **0** (table empty) |
| Active org admins | **1** (`d572eb14…`, org `00000000-…-0001`) |
| `user_roles` assignments | **0** |
| Roles | `Accountant` (0 permissions), `Full Access` (166) — both active, both with 0 users |
| Permission keys total | 169 |
| Keys granted to no role | exactly 3: `accounting.vouchers.unpost`, `accounting.vouchers.cancel`, `reports.ai_insights.use` |

Effective access of that single org admin, computed per branch:

| Key | via super admin | via org-admin override | via explicit grant |
|---|---|---|---|
| `accounting.vouchers.unpost` | ❌ | ✅ | ❌ |
| `accounting.vouchers.cancel` | ❌ | ✅ | ❌ |

The authority existed **solely** through the override. `accounting.vouchers.reverse` does not exist — not in the live catalog, not anywhere in the repository — and was deliberately not invented.

## 2. The approved contract

| Principal | Ordinary keys | Sensitive keys |
|---|---|---|
| Platform super admin | ✅ override | ✅ override (emergency access) |
| Org admin | ✅ override, including user and role administration | ❌ **requires an explicit grant** |
| Any user | via active, unexpired, org-scoped role | via active, unexpired, org-scoped role |

An org admin may create a sensitive role and assign it — including to themselves. Authority is not removed; it is converted from a silent override into an explicit, audited decision.

## 3. The central classifier

```sql
public.wardah_is_sensitive_permission(text) RETURNS boolean  -- IMMUTABLE, STRICT
```

Exactly two keys: `accounting.vouchers.unpost`, `accounting.vouchers.cancel`.

**A function, not a table, on purpose.** Widening the sensitive set must pass through a migration, code review and acceptance tests — never a silent data edit. `reports.ai_insights.use` is deliberately ordinary.

It is `STRICT`, so `NULL` in yields `NULL` out. Every call site wraps it in `COALESCE(…, false)`; a null key must not be treated as sensitive. The acceptance suite asserts the STRICT behaviour directly (`174-0c`), because a future rewrite that drops `STRICT` would silently change how null keys are classified.

Both permission functions call this one classifier, so the two cannot drift — which was the explicit requirement (no duplicated lists).

## 4. What the migration changes

| Change | Detail |
|---|---|
| `wardah_is_sensitive_permission(text)` | New. `IMMUTABLE STRICT`, no table access, not `SECURITY DEFINER`. `REVOKE` from `PUBLIC`/`anon`; `EXECUTE` to `authenticated` (the UI badges sensitive keys from it via the snapshot). |
| `has_permission(uuid,uuid,varchar)` | Org-admin branch gains `NOT v_sensitive`. All five layers of the 170–173 chain reproduced verbatim. |
| `wardah_has_exact_permission(uuid,uuid,text)` | Same narrowing, same classifier. Execute boundary re-asserted: `postgres` only. |
| `rpc_upsert_org_role(jsonb)` | Creates or updates a role **and its complete permission set** in one transaction. Rejects unknown keys (`RBAC_174_UNKNOWN_PERMISSION_KEY`), duplicate names, system roles. `FOR UPDATE` on the role row. |
| `rpc_replace_user_roles(jsonb)` | Atomic replace of a user's roles for one org. Rejects non-members (`RBAC_174_TARGET_NOT_ACTIVE_ORG_MEMBER`) and foreign roles (`RBAC_174_ROLE_NOT_IN_ORG`). |
| `rpc_delete_org_role(jsonb)` | Refuses while users still hold the role (`RBAC_174_ROLE_STILL_ASSIGNED`) and refuses system roles. |
| `rpc_permission_snapshot(uuid)` | Returns the caller's effective keys, `is_org_admin`, `is_super_admin`, and the sensitive-key set for badging. **The single source of truth for UI decisions.** |
| Audit | Every mutation writes `audit_logs` with `sensitive_keys` / `sensitive_keys_granted` and a `self_assignment` flag. |
| Grants | Four RPCs: `REVOKE ALL FROM PUBLIC, anon, service_role`; `GRANT EXECUTE TO authenticated`. |

### 4.1 What this migration deliberately does **not** do

- **No `auth.uid()` guard added to `wardah_has_exact_permission`.** It is internal (`EXECUTE` is `postgres` only), its four callers pass an actor resolved inside the RPC, and adding the guard risks breaking them for no reachable gain. The postflight re-asserts the execute boundary instead.
- **Direct `INSERT`/`UPDATE`/`DELETE` on `roles`, `role_permissions`, `user_roles` is not revoked from `authenticated`.** The live role-management UI still writes those tables directly; revoking here would break it in the window between applying 174 and deploying the dependent UI.

  This mirrors the sequence this repository already established with 163/167 → 169: ship the atomic RPCs, move the UI onto them, then close the direct-write surface in its own migration. **That closure is Migration 175 and is required to finish Issue #93** — until it lands, the RPCs are the sanctioned path but not yet the only one.

## 5. Acceptance gate

```text
scripts/ci/fresh-db/acceptance_174_sensitive_permission_class.sql
.github/workflows/sensitive-permission-174-acceptance.yml
```

Marker: `SENSITIVE_PERMISSION_174_ACCEPTANCE_PASS`. Coverage, all eight scenarios plus mutation proof:

1. Org admin **without** a grant — sensitive denied, ordinary still allowed (`174-1a/1b/1c`).
2. Org admin **with** a grant — allowed (`174-2`).
3. Super admin — allowed with no role at all (`174-3`).
4. Disabled role — denied, 173 preserved (`174-4`).
5. Expired assignment — denied (`174-5`).
6. Cross-org — denied for both key classes (`174-9a/9b`).
7. Caller-identity guard — denied when asking about another user, 170 preserved (`174-7`).
8. Ordinary keys — override intact (`174-1c`, `174-15`).
9. **Mutation proof** (`174-M1…M9`) — each 166–173 guarantee re-asserted as its own named assertion, so a regression in any single layer fails identifiably rather than being masked by a neighbouring check.

The whole matrix runs against **both** functions (§3 and §4 of the script), plus the RBAC control plane: atomicity of a rejected update, self-assignment, audit rows, delete refusal, cross-org write refusal, and snapshot correctness for granted and ungranted admins.

### 5.1 Verification actually performed

Executed locally on a real **PostgreSQL 17.10** cluster, building the baseline pair plus the full chain:

| Check | Result |
|---|---|
| Baseline + chain through 174 | `PASS=13 FAIL=0 NOT_RUN=0 TOTAL=13` (174's own postflight ran inside it) |
| `acceptance_174` | `SENSITIVE_PERMISSION_174_ACCEPTANCE_PASS` |
| `acceptance_172` re-run on the 174 database | `HAS_PERMISSION_172_ACCEPTANCE_PASS` |
| `acceptance_173` re-run on the 174 database | `HAS_PERMISSION_173_ACCEPTANCE_PASS` |
| **Red proof** — same fixture on a database built only through 173 | ungranted org admin → `accounting.vouchers.unpost` returned **`t`** |

The red proof is wired into the workflow as its own failing step, not left as a manual note: if a pre-174 database ever stops reproducing the bypass, the job fails rather than quietly reporting a green suite that proves nothing.

The same gate then ran in CI on `postgres:17` and passed end to end — `Sensitive Permission 174 Acceptance`, including the red-proof step, on PR #112. Local and CI agree; neither is treated as sufficient alone.

**Generated types.** `Regenerate UoM Database Types` rebuilds a Fresh DB from the repository migrations and runs `supabase gen types` against **that** database (`localhost/wardah_fresh`), never against Production. It therefore commits the four new RPCs and the classifier into `src/types/database.generated.ts` as soon as 174 is in the repository — which is expected and is **not** evidence that 174 has been applied to Production. The ledger remains the only authority for that.

## 6. Mandatory Production order

**Steps 1–4 are not preparation for the fix; they are part of it.** With zero super admins, zero role assignments, and both sensitive keys granted to zero roles, applying 174 first would leave **nobody** able to unpost or cancel. Note that assigning the existing `Full Access` role does **not** help — it holds 166 of 169 keys and these two are among the three it lacks.

### Step 1–3 — operational transaction (before the migration)

Org-scoped data, so it is **not** part of any migration and not part of the Baseline (`roles`/`user_roles` are excluded from the system reference snapshot by design). Run once, as a single transaction, against Production:

```sql
BEGIN;

-- 1. The role.
INSERT INTO public.roles (org_id, name, name_ar, description, is_active, is_system_role)
VALUES ('00000000-0000-0000-0000-000000000001',
        'Financial Controller', 'المراقب المالي',
        'Explicit authority for sensitive accounting controls (Issue #93 / Migration 174)',
        true, false)
RETURNING id;   -- keep this id for step 3

-- 2. Exactly the two sensitive keys, nothing else.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.org_id = '00000000-0000-0000-0000-000000000001'
  AND r.name = 'Financial Controller'
  AND p.permission_key IN ('accounting.vouchers.unpost','accounting.vouchers.cancel');

-- 3. Assign it to the current org admin.
INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at)
SELECT 'd572eb14-5a8a-4ec9-ad3b-6945fcc8be0e', r.id,
       '00000000-0000-0000-0000-000000000001', NULL
FROM public.roles r
WHERE r.org_id = '00000000-0000-0000-0000-000000000001'
  AND r.name = 'Financial Controller';

COMMIT;
```

### Step 4 — prove the grant before applying anything

```sql
SELECT p.permission_key,
       EXISTS (
         SELECT 1 FROM public.user_roles ur
         JOIN public.roles r ON r.id = ur.role_id
           AND r.org_id = ur.org_id AND COALESCE(r.is_active, true)
         JOIN public.role_permissions rp ON rp.role_id = ur.role_id
         JOIN public.permissions pp ON pp.id = rp.permission_id
         WHERE ur.user_id = 'd572eb14-5a8a-4ec9-ad3b-6945fcc8be0e'
           AND ur.org_id = '00000000-0000-0000-0000-000000000001'
           AND pp.permission_key = p.permission_key
           AND (ur.expires_at IS NULL OR ur.expires_at > now())
       ) AS via_explicit_grant
FROM public.permissions p
WHERE p.permission_key IN ('accounting.vouchers.unpost','accounting.vouchers.cancel');
```

**Both rows must read `via_explicit_grant = true`. If either is false, stop — do not apply the migration.**

### Step 5 — apply 174 and run postflight

Apply the exact file merged to `main`. The migration's own `$verify$` block runs before `COMMIT` and fails the transaction on any drift. Then, read-only:

```sql
SELECT
  prosrc ~ 'wardah_is_sensitive_permission'          AS consults_classifier,
  prosrc ~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' AS identity_guard_170,
  prosrc !~ 'LIKE'                                    AS no_wildcard_172,
  prosrc ~ 'p\.permission_key\s*=\s*p_permission_key' AS exact_key_172,
  prosrc ~ 'COALESCE\(r\.is_active, true\)'           AS active_role_173,
  prosrc ~ 'expires_at'                               AS role_expiry,
  prosrc ~ 'super_admins'                             AS super_admin_override,
  prosrc ~ 'is_org_admin'                             AS org_admin_override_present
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'has_permission';
-- Expect every column true. `org_admin_override_present` must stay TRUE:
-- the override is narrowed, not removed — ordinary keys still ride it.

SELECT (SELECT count(*) FROM public.permissions
         WHERE public.wardah_is_sensitive_permission(permission_key)) AS sensitive_rows;
-- Expect exactly 2.

SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '174_sensitive_permission_class_and_rbac_rpcs';
-- Expect exactly one row.
```

### Step 6 — deploy the dependent UI

Only after step 5 is verified. The UI PR removes the client-side override and moves role/user administration onto the RPCs. Merging it earlier would ship a client calling RPCs that do not exist; applying 174 without it leaves the UI showing unpost/cancel buttons that the backend now refuses — the divergence described in §7.

### Step 7 — browser smoke on the deployed UI

Create a role · edit its permissions · assign it · revoke it · confirm the `cancel`/`unpost` controls disappear for an ungranted admin and reappear once the sensitive role is assigned.

## 7. Why the UI is part of the closure, not a follow-up

`src/hooks/usePermissions.ts` re-implements the override client-side:

```ts
if (isSuperAdmin) return true;
if (isOrgAdmin) return true;   // never consults the backend
```

and the loader short-circuits with `setPermissions([])` for admins. After 174, the client would still believe an ungranted org admin may unpost, while the RPC refuses — a button that fails on click. `rpc_permission_snapshot` exists precisely so the client stops deciding and starts asking.

The same PR replaces the non-atomic delete-then-insert pairs in `src/services/rbac-service.ts` with `rpc_upsert_org_role` / `rpc_replace_user_roles` / `rpc_delete_org_role`, so a failed second call can no longer leave a role with no permissions or a user with no roles.

## 8. Rollback

Additive apart from replacing two function bodies. Both replacements only ever *narrow* authority for two keys, so a forward fix is preferred to any revert, per the golden rule. If the sensitive class must be lifted in an emergency, the reviewed path is a new numbered migration that changes the classifier — **not** a hand-edit of 174, and **not** re-widening the override, since a super admin already provides the emergency route by design.

Never edit `supabase_migrations.schema_migrations`, and never apply SQL that is not the exact file merged to `main`.
