# Migration 169 — Voucher Write Closure Runbook

**Migration:** `169_voucher_write_closure.sql`
**Scope:** Withdraw the temporary direct-write surface on voucher headers and allocation lines, and close payment-derived invoice field drift in both directions.
**State:** Applied and verified on Production (`Manufacturing Process`, `uutfztmqvajmsxnrqeiv`) on 2026-08-05, ledger version `20260805151524`. Merged to `main` via PR #96, squash commit `0bcce21a`. Production has since advanced to 173; the contract described here was re-verified live on 2026-08-09 and is unchanged (see §7).

## 1. Purpose

Migrations 163 and 167 left two temporary client capabilities open on purpose while the UI moved onto the atomic lifecycle RPCs (166–168):

- `authenticated` `INSERT` on `customer_collections` and `supplier_payments` (163);
- `authenticated` `INSERT` on `customer_collection_lines` and `supplier_payment_lines` (167).

Migration 169 withdraws both, drops the four now-obsolete insert policies, and closes a second, independently discovered gap: nothing prevented a direct `UPDATE` from silently mutating `sales_invoices.paid_amount` / `payment_status` or `supplier_invoices.paid_amount` / payment-derived `status` outside the voucher post/reset/cancel lifecycle.

## 2. Why a GUC alone is not the boundary

The pre-169 allocation-line trigger (`wardah_protect_voucher_allocation_lines`, migration 167) allowed any write once the transaction-local GUC `wardah.voucher_lines_write` read `on`, with no check on who set it. Because `service_role` can call `set_config` directly, that GUC was spoofable by any RLS-bypassing session — proven by the pre-169 Acceptance run terminating on exactly this assertion (`authenticated retains direct write on customer_collections`, the catalog-level check that runs before any GUC is even touched).

Migration 169's guard is a **dual-factor** condition, both required:

```sql
current_user = pg_get_userbyid(<owner of wardah_voucher_write_is_trusted>)
AND (
  current_setting(<capability GUC>, true) = 'on'
  OR session_user = current_user
)
```

The owner check makes a client-set GUC insufficient on its own; the GUC (or a genuine same-identity session, covering direct superuser/administrative access) makes the owner identity insufficient on its own, since other owner-defined routines exist. `wardah_voucher_write_is_trusted(text)` is `REVOKE`d from `PUBLIC`, `anon` and `authenticated`, and granted `EXECUTE` only to `service_role` — `authenticated` never reaches it, because its direct table grants are revoked first (see §3), so the trigger never fires for that role at all.

## 3. What the migration changes

| Change | Detail |
|---|---|
| Function rename | The ten original `rpc_*` implementations are renamed to `wardah_169_internal_*` and `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` — nobody may call them by name directly. |
| New public wrappers | `CREATE OR REPLACE FUNCTION public.rpc_*` (same ten signatures, `SECURITY DEFINER`) re-checks `auth.uid()` and tenant membership, brackets the internal call with `wardah_169_enter_write_context()` / `wardah_169_leave_write_context()`, and restores the write context explicitly in an `EXCEPTION WHEN OTHERS` handler before re-raising — not only via transaction rollback. |
| Header guard | New `BEFORE INSERT OR UPDATE OR DELETE` trigger `wardah_protect_voucher_headers()` on `customer_collections` and `supplier_payments`. Stable rejection: `VOUCHER_HEADER_WRITE_FORBIDDEN`. |
| Allocation guard | `wardah_protect_voucher_allocation_lines()` (migration 167's function, `CREATE OR REPLACE`d in place — the existing triggers on `customer_collection_lines` / `supplier_payment_lines` keep their bindings) now requires the dual-factor check instead of the GUC alone. Stable rejection: `VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN`. |
| Invoice payment-field guard | New `BEFORE UPDATE` trigger `wardah_protect_invoice_payment_fields()` on `sales_invoices` and `supplier_invoices`. Stable rejection: `VOUCHER_DERIVED_PAYMENT_FIELDS_WRITE_FORBIDDEN`. |
| Table grants | `REVOKE INSERT, UPDATE, DELETE ON TABLE customer_collections, customer_collection_lines, supplier_payments, supplier_payment_lines FROM authenticated`; `SELECT` is preserved. |
| Policies | The four temporary insert policies from 163/167 (`*_org_insert_draft`, `*_org_insert_new_draft`) are dropped. |
| RPC grants | Ten `rpc_*` wrappers: `REVOKE ALL ... FROM PUBLIC, anon, service_role`, `GRANT EXECUTE ... TO authenticated`. |
| Preflight | Fails closed (`VOUCHER_169_REQUIRED_RPC_MISSING`, `VOUCHER_169_ALLOCATION_GUARD_MISSING`) if any of the ten RPCs or the allocation guard function is absent before the migration touches anything. |
| Postflight | An in-transaction `$verify$` block re-checks table grants, RPC grants and the presence of exactly six protection triggers, and raises before `COMMIT` if any check fails. |
| Locking | `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` on all six affected tables for the duration of the transaction; `lock_timeout = '30s'`, `statement_timeout = '5min'`. |

## 4. Invoice payment-field boundary — both directions

The trigger distinguishes a payment-derived change from an ordinary business update:

- **Customer invoices (`sales_invoices`):** any change to `paid_amount` or `payment_status` requires the trusted capability. This is symmetric by construction — every `payment_status` change is covered, not only specific target values.
- **Supplier invoices (`supplier_invoices`):** any change to `paid_amount` requires the trusted capability. A `status` change requires it only when the transition is **into or out of** `partially_paid` / `paid`:

  ```sql
  NEW.status IS DISTINCT FROM OLD.status
  AND (OLD.status IN ('partially_paid','paid') OR NEW.status IN ('partially_paid','paid'))
  ```

  The first implementation reviewed for this migration guarded only the transition *into* those two statuses. That left a live gap: an ordinary `UPDATE` (no voucher, no capability) could move an invoice **out of** `paid` or `partially_paid` — e.g. back to `approved` — without touching `paid_amount`, silently erasing the record that a payment had been posted, outside the legal reset/cancel path. The gap was found and closed before merge; the "both directions" condition above is what actually shipped.
- **`draft → submitted → approved`, and the independent `match_status → 'matched'` transition, remain legal without any capability.** The guard does not touch `supplier_invoices.status` wholesale — only the two specific values that represent settlement.

## 5. Acceptance gate

```text
scripts/ci/fresh-db/acceptance_169_voucher_write_closure.sql   (revision 1.4)
.github/workflows/voucher-write-closure-169-red-proof.yml
```

Run on a Fresh PostgreSQL 17 database built through the paired baseline and every migration up to and including 169, seeded with the committed fixtures from `acceptance_168_voucher_atomic_lifecycle.sql`. Required markers, both must appear:

```text
VOUCHER_ATOMIC_168_ACCEPTANCE_PASS
VOUCHER_WRITE_CLOSURE_169_ACCEPTANCE_PASS
```

What the suite proves, in order:

1. `authenticated` has lost `INSERT`/`UPDATE`/`DELETE` on all four voucher tables and kept `SELECT`; the four temporary policies are gone.
2. A direct `authenticated` header `INSERT` fails with `permission denied` (grant-level, before any trigger runs).
3. `service_role`, having set all three capability GUCs to `'on'` itself, still cannot: create a voucher header (`VOUCHER_HEADER_WRITE_FORBIDDEN`); insert an allocation line against a real committed 168 invoice (`VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN`); or mutate `paid_amount`/payment-derived status on either invoice type (`VOUCHER_DERIVED_PAYMENT_FIELDS_WRITE_FORBIDDEN`).
4. The `paid → approved` and `partially_paid → approved` reverse transitions are rejected the same way, and the invoice's `status` is proven unchanged afterward — not merely that the statement errored.
5. The real forward workflow `draft → submitted → approved + matched` remains legal and untouched by the guard.
6. A failing internal RPC call (`rpc_update_customer_receipt_draft` against a non-existent id) leaves all three capability GUCs reading `off` for the rest of the transaction — proving the explicit `EXCEPTION` handler, not only rollback, does the restoration.
7. All ten `rpc_*` wrappers remain executable by `authenticated` and denied to `anon` and `service_role`.

A fixture-existence guard (`ACCEPTANCE_FIXTURE_MISSING`) runs before the allocation-line assertions so a missing 168 fixture fails loudly as a setup error, never silently as a false "red" or false "green" on the guard itself.

**This suite has run to green on Fresh PostgreSQL 17 in CI, on the exact commit merged as `0bcce21a` (PR #96). It has not been run against Production.** Production verification is catalog-level only — see §7. Do not treat a green Production catalog check as equivalent to a green Acceptance run; they check different things and both matter.

## 6. Deployment record

| Item | Value |
|---|---|
| Repository PR | #96, `fix(vouchers): close direct writes and payment-state drift` |
| Merge | Squash, `0bcce21a`, into `main`, at the reviewed head `dccd8739` |
| Production project | `Manufacturing Process` (`uutfztmqvajmsxnrqeiv`) — **not** `Wardah-Prod` (`rytzljjlthouptdqeuxh`), which is `INACTIVE` |
| Applied | 2026-08-05, single transaction, no partial apply |
| Ledger row | `supabase_migrations.schema_migrations`: version `20260805151524`, name `169_voucher_write_closure` |
| Pre-apply state | Production ledger cutoff was 168; a verified backup was taken and confirmed logically sound before this migration was applied (free-tier project, no platform PITR/snapshot available) |

The production sequence between 152 and 169 also carries a documented naming exception: the row for migration 163 is recorded as `payment_voucher_guarded_draft_inserts` rather than `163_payment_voucher_atomic_draft_creation`. This is now declared in `sql/migrations/migration_ledger_exceptions.json` (`version_name_aliases["20260731102524"]`) and confirmed against the live ledger with `scripts/ci/validate_migration_ledger.py` — same pattern as the existing 121 alias.

## 7. Production verification actually performed

Post-apply verification was catalog-level, run read-only against the live database (not the synthetic-fixture Acceptance script in §5):

```sql
-- Table grants: authenticated keeps SELECT only.
SELECT has_table_privilege('authenticated','public.'||t,'INSERT') AS ins,
       has_table_privilege('authenticated','public.'||t,'UPDATE') AS upd,
       has_table_privilege('authenticated','public.'||t,'DELETE') AS del,
       has_table_privilege('authenticated','public.'||t,'SELECT') AS sel
FROM unnest(ARRAY['customer_collections','customer_collection_lines',
                   'supplier_payments','supplier_payment_lines']) t;

-- The four temporary policies are gone.
SELECT policyname FROM pg_policies WHERE schemaname='public'
  AND policyname IN ('customer_collections_org_insert_draft',
                      'supplier_payments_org_insert_draft',
                      'customer_collection_lines_org_insert_new_draft',
                      'supplier_payment_lines_org_insert_new_draft');

-- All six protection triggers exist.
SELECT tgname FROM pg_trigger
WHERE tgname IN ('trg_protect_customer_collections','trg_protect_supplier_payments',
                  'trg_protect_customer_collection_lines','trg_protect_supplier_payment_lines',
                  'trg_protect_sales_invoice_payment_fields','trg_protect_supplier_invoice_payment_fields')
  AND NOT tgisinternal;

-- RPC and internal-function grants.
SELECT has_function_privilege('authenticated', sig, 'EXECUTE') AS auth_exec,
       has_function_privilege('anon', sig, 'EXECUTE') AS anon_exec,
       has_function_privilege('service_role', sig, 'EXECUTE') AS svc_exec
FROM unnest(ARRAY['public.rpc_create_customer_receipt(jsonb)', /* … all ten … */]) sig;
```

Confirmed results: `authenticated` shows `ins=upd=del=false, sel=true` on all four tables; zero rows returned for the obsolete-policy query; all six triggers present; all ten RPCs `auth_exec=true, anon_exec=false, svc_exec=false`; the internal `wardah_169_internal_*` functions and `wardah_voucher_write_is_trusted` are unreachable by `anon`/`authenticated`, and `wardah_voucher_write_is_trusted` is reachable only by `service_role` as designed.

**Re-verified on 2026-08-09**, after Production had advanced to 173, that the table-grant half of this contract still holds unchanged: `authenticated` has `ins=upd=del=false, sel=true` on all four voucher tables. Migrations 170–173 do not touch the voucher write surface, and the live catalog confirms they did not disturb it.

Security/performance advisors were reviewed after the apply. The 80 `authenticated_security_definer_function_executable` warnings include the ten new `rpc_*` wrappers by design (they must be `SECURITY DEFINER` and callable by signed-in users; identity and membership are re-checked inside each wrapper) and are otherwise pre-existing, unrelated debt. Leaked-password-protection, the PostgreSQL version advisory, and the `rls_enabled_no_policy` findings on `journal_entries`/`journal_lines` all predate this migration and are independent of it.

No smoke transaction was executed against Production data; the smoke path is covered by the Fresh DB Acceptance run in §5.

## 8. Rollback

Additive apart from replacing `wardah_protect_voucher_allocation_lines` (which only narrows an existing bypass) and renaming the ten original RPC bodies. Before any production traffic has used the new contract, the reviewed recovery is to correct forward with a new numbered migration rather than hand-edit 169 in place, per the project's golden rule. A rollback script, if ever required, must restore the exact pre-169 grants, policies, and trigger/function bodies without deleting voucher or ledger history, and is only appropriate if postflight failed before business traffic resumed on the new contract — once vouchers have been created, posted, reset or cancelled under 169, prefer a forward-fix migration instead.

Never edit `supabase_migrations.schema_migrations` to remove this row, and never re-apply SQL that is not the exact file merged to `main`.
