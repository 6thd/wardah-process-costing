# Wardah Process Costing — Project Manifest

**آخر تحديث:** 2026-07-18  
**أحدث commit على main:** `ab21f8d` (PR #30 — squash-merged)  
**Supabase Project:** `uutfztmqvajmsxnrqeiv`  
**Branch for new work:** أنشئ من `main` باسم `claude/<task>-<slug>`

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS (RTL/Arabic) |
| Backend/DB | Supabase (PostgreSQL 17, PostgREST, Auth, Storage) |
| State | Zustand + TanStack Query |
| i18n | react-i18next — **zero hardcoded strings enforced by CI gate** |
| Tests | Vitest (3601 tests, 169 files) |
| E2E | Playwright (nightly on staging) |
| CI/CD | GitHub Actions → Vercel (preview + prod) + Netlify |
| Quality | SonarCloud · Codacy · CodeFactor |

---

## Repository Layout (key paths)

```
sql/
  migrations/          # 122 numbered migrations (1–122)
  baseline/            # 000_schema_baseline_20260717.sql  (cutoff=121)
scripts/
  ci/
    check_definer_guards.py      # T1: SECURITY DEFINER guard
    check_migration_syntax.py    # pglast SQL syntax check
    fresh-db/                    # T3: supabase_shim.sql, run_chain.sh, build_apply_order.py
  i18n/
    count-hardcoded.mjs          # i18n gate (--ci flag blocks on any hardcoded text)
.github/workflows/
  ci-cd.yml                      # main CI: lint → test → type-check → fresh-db → build
  sonarqube.yml                  # SonarCloud scan
  generate-baseline.yml          # manual: dump production schema → commit baseline
  e2e-nightly.yml                # Playwright nightly on staging
src/
  features/manufacturing/
    components/WipLogFormDialog.tsx   # WIP log form (cost_total stripped from payload)
  services/                      # domain services
  types/database.generated.ts   # Supabase generated types (committed)
e2e/
  routes-smoke.spec.ts           # T4: all sidebar routes smoke test
  auth-roles.spec.ts             # T4: role-based access
  fixtures/
    auth.ts
    sidebar-routes.ts
```

---

## Database State

- **Migrations:** 1–122 (122 = `fix_check_entry_approval_dead_code.sql`)
- **Baseline:** `sql/baseline/000_schema_baseline_20260717.sql` — cutoff 121
  - Covers migrations 1–121; migration 122 applied on top in Fresh DB test
  - Contains 22 `GENERATED ALWAYS AS STORED` columns (restored in PR #30)
- **Tables:** ≥120 · **Functions:** ≥150 · **Policies:** ≥300 · **Generated cols:** ≥22

### Known GENERATED columns (do NOT write explicitly in INSERT/UPDATE)

| Table | Column | Expression |
|---|---|---|
| `bins` | `projected_qty` | `actual_qty - reserved_qty + ordered_qty + planned_qty` |
| `bom_cost_analysis` | `material_variance` | `actual_material_cost - standard_material_cost` |
| `bom_cost_analysis` | `labor_variance_pct` | `(actual-standard)/standard * 100` |
| `bom_cost_details` | `variance` | `actual_total_cost - standard_total_cost` |
| `bom_operations` | `setup_cost` | `(setup_time_minutes/60.0) * COALESCE(labor_rate,0)` |
| `employees` | `full_name` | `first_name \|\| ' ' \|\| last_name` |
| `purchase_order_lines` | `line_total` | `quantity * unit_price * (1-disc%) * (1+tax%)` |
| `sales_invoice_lines` | `line_total` | same formula |
| `sales_invoice_lines` | `cogs` | `quantity * COALESCE(unit_cost_at_sale,0)` |
| `sales_invoices` | `balance` | `total_amount - paid_amount` |
| `stage_wip_log` | `cost_total` | `cost_beginning_wip + cost_material + cost_labor + cost_overhead + cost_transferred_in` |
| `standard_costs` | `total_cost_per_unit` | `material + labor + overhead` |
| `stock_ledger_entries` | `posting_datetime` | `posting_date + posting_time` |
| `supplier_invoice_lines` | `line_total` | same formula |
| `supplier_invoices` | `balance` | `total_amount - paid_amount` |
| *(+ 7 more)* | | |

> PostgREST silently strips GENERATED columns from payloads, but the code should never include them. `WipLogFormDialog.tsx` was fixed in PR #30 — `cost_total` is now excluded from `stageWipLogService.create/update` calls.

---

## CI Pipeline (ci-cd.yml) — all gates are hard failures

1. **i18n gate** — `node scripts/i18n/count-hardcoded.mjs --ci` (zero hardcoded strings)
2. **Generated types check** — `src/types/database.generated.ts` must exist and be ≥100 lines
3. **TypeScript** — `npm run type-check`
4. **ESLint** — `npm run lint`
5. **Unit & integration tests** — `npm run test -- --run` (3601 tests)
6. **Migration SQL syntax** — pglast (libpg_query)
7. **Migration numbering** — no gaps unless documented in `skipped_migration_numbers.yml`
8. **DEFINER guard** — `scripts/ci/check_definer_guards.py` (no unguarded SECURITY DEFINER)
9. **Fresh DB chain test** — applies baseline + migrations 122+ to fresh PG16 container; checks tables≥120, funcs≥150, policies≥300, generated_cols≥22
10. **Build** — `npm run build`

---

## Security Architecture (T1)

Every `SECURITY DEFINER` function must have an org-member guard as the **first** statement in its body:

```sql
-- Required pattern (first line of function body):
IF NOT EXISTS (
  SELECT 1 FROM user_organizations
  WHERE user_id = auth.uid() AND org_id = p_org_id
) THEN RAISE EXCEPTION 'Not a member'; END IF;
```

`check_definer_guards.py` enforces this in CI:
- Detects `REVOKE ... FROM PUBLIC` as the presence of an explicit revoke
- Dynamically detects dollar-quote delimiter (`$function$`, `$$`, etc.) to avoid body bleed
- Scans all files in `sql/migrations/`

---

## Completed Work (PRs merged to main)

| PR | Description |
|---|---|
| #23 | T6-م3: i18n migration — 373 hardcoded strings → t(), CI gate at 0 |
| #25 | T4: Playwright E2E suite — roles + org isolation + nightly CI |
| #27–#28 | T2: generate-baseline workflow + stock movements fix |
| #29 | T1: SECURITY DEFINER guard + CI script (check_definer_guards.py) |
| #30 | Restore 22 GENERATED columns in baseline; CI guard (≥22 check); E2E preflight fix; strip `cost_total` from WIP payload |

---

## Pending Tasks (priority order)

### P1 — Production correctness

**`handle_new_user()` trigger mismatch**
- Baseline now has `user_profiles` table but production trigger still references `users_profiles_20250905_1900`
- Fix: write migration 123 to `DROP TRIGGER` + `CREATE TRIGGER` pointing to correct table name
- Verify by checking `pg_trigger` on production after applying

**`updateStock()` + `consumeReservedMaterials()` missing ledger writes**
- Both functions modify `bins` quantities but do NOT write to `stock_ledger_entries`
- Every stock movement must have a ledger entry for audit/valuation
- Fix: create atomic RPC `rpc_stock_movement(...)` that writes bins + ledger in one transaction
- Files: `src/services/warehouse-service.ts`, `src/services/purchasing-service.ts`

### P2 — Quality

**SonarCloud coverage: 30.4% (target 80%)**
- Most untested surface: `src/services/` (purchasing, sales, HR, manufacturing)
- Approach: add Vitest unit tests with Supabase client mocked via `vi.mock`
- Reference pattern: `src/services/manufacturing/__tests__/bomCostingService.test.ts`

### P3 — Infrastructure

**E2E secrets not yet added to GitHub**
- 9 secrets needed in Settings → Secrets → Actions:
  `STAGING_URL`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_ORG_ADMIN_EMAIL`, `E2E_ORG_ADMIN_PASSWORD`, `E2E_SUPER_ADMIN_EMAIL`, `E2E_SUPER_ADMIN_PASSWORD`, `E2E_ORG_B_USER_EMAIL`, `E2E_ORG_B_USER_PASSWORD`
- E2E nightly workflow is wired; will run once secrets are set

**Baseline regeneration (when needed)**
- Run `.github/workflows/generate-baseline.yml` manually after adding migrations that change schema significantly
- Requires `SUPABASE_DB_URL` secret in GitHub Actions

---

## How to add a migration

1. Pick next number (currently 122 is latest; next = 123)
2. Create `sql/migrations/123_<description>.sql`
3. If you skip a number, add it to `sql/migrations/skipped_migration_numbers.yml`
4. SQL must pass pglast syntax check (no bare `RAISE`, no T-SQL syntax)
5. If adding a SECURITY DEFINER function: include org-member guard as first body statement + `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC`

---

## Running locally

```bash
npm ci
npm run type-check
npm run lint
npm run test -- --run
npm run build
```

For migration syntax check:
```bash
pip install pglast
python3 scripts/ci/check_migration_syntax.py
```

For DEFINER guard check:
```bash
python3 scripts/ci/check_definer_guards.py
```

---

## Secrets required

| Secret | Used by |
|---|---|
| `SUPABASE_DB_URL` | generate-baseline.yml (pg_dump from production) |
| `SUPABASE_ACCESS_TOKEN` | sonarqube.yml |
| `SONAR_TOKEN` | sonarqube.yml |
| `STAGING_URL` + 8 E2E secrets | e2e-nightly.yml |

---

## Branch convention

```
claude/<task-tag>-<short-slug>
```
Examples: `claude/p1-handle-new-user-trigger`, `claude/p1-stock-ledger-rpc`

Always develop on the feature branch, then open a PR → squash-merge to `main`.
