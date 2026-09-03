# Migration 186 — Canonical Inventory Routine Contracts

**Date:** 2026-09-02

**Repository migration:** `186_stock_moves_contract_repair`

**Production state:** applied 2026-09-03 as
`20260903083010 / 186_stock_moves_contract_repair`.

**Authority boundary:** this runbook does not authorize a PR merge, a
Staging/Production migration, or any data write.

## Outcome

Migration 186 does not recreate the absent `stock_moves` or `stock_quants`
relations. It removes those historical assumptions from the live routine graph
and keeps `stock_ledger_entries` plus `bins` as the inventory source of truth.
The migration is replace-only: it changes function definitions and comments,
with no table DDL, fixture, backfill, or historical-data repair.

| Routine | Decision in 186 | Preserved boundary |
|---|---|---|
| `rpc_create_mo_with_reservation` | Rewire availability to canonical bins minus bin reservations and active manufacturing reservations; resolve item→product; aggregate aliases by resolved product; lock bins before deciding | Same signature, result fields, `SECURITY DEFINER`, membership guard, and authenticated/service-role ACL |
| `wardah_apply_stock_outgoing` | Lock every bin for the product and reject any canonical outflow that would consume active MO reservations; material consumption may use only its referenced MO's reservation | Same signature, valuation/ledger behavior, internal-only ACL, and org guard |
| `consume_materials_for_mo` | Compatibility wrapper over `rpc_consume_reserved_materials`; verify MO/org consistency and propagate atomic-path errors | Same legacy signature, `SECURITY INVOKER`, and post-185 ACL; no direct stock write |
| `validate_stock_balance` | Compare every posted SLE row with bin quantity, so a cancelled original and its posted reversal net to zero as one event pair | Same signature; output aliases `item_id`/`location_id` now explicitly mean product/warehouse |
| `validate_reservations` | Replace absent `stock_quants` with product-scoped bin availability and aggregate all active MO reservations | Same signature and invoker/RLS boundary |
| `comprehensive_data_integrity_check` | Point its inventory catalog entries and indirect validators at the legal relations | Wider legacy semantics and RBAC remain separate work |
| `rpc_complete_manufacturing_order` | Remove the conditional write to an absent mirror | Existing product projection, costing, zero-cost guard, GL posting, signature, and ACL remain unchanged; no finished-goods warehouse is invented |
| `calculate_material_variances` | Explicitly retire the unsupported source with SQLSTATE `0A000` | Same signature and ACL; actual material consumption remains available, but no component standard-price snapshot is fabricated |
| `simulate_cogs` | No change | Its returned `avg_rate` is a valid RPC field and is unrelated to the absent `bins.avg_rate` column |

## Why the variance routine is retired instead of rewritten

`material_consumption` contains actual quantity and valued actual cost. The live
schema does not contain a component-level standard price snapshot tied to each
consumption. Reusing current product cost, actual valuation rate, or the
finished-product/stage `standard_costs` row would make price variance look
precise while changing its accounting meaning. Migration 186 therefore fails
explicitly instead of returning a false empty success or manufacturing a
standard. A future variance implementation requires its own reviewed snapshot
contract and application acceptance.

## Evidence shipped with the migration

| Evidence | What it proves |
|---|---|
| `acceptance_186_stock_moves_contract_red.sql` | On a database through 185, six live routine bodies retain the absent relation; reservation and balance calls fail with `42P01`; legacy consumption masks that failure; variance returns a false empty success |
| `acceptance_186_stock_moves_contract.sql` | On the green chain, no live routine body retains the old relation; cancellation pairs net correctly; item/product aliases aggregate by resolved product; a legal reservation is written with `product_id`; later canonical outflows cannot consume it; the compatibility org guard and comprehensive wrapper work |
| `acceptance_186_reservation_concurrency.sh` | Two authenticated callers requesting 6 units from 10 are forced behind the same bin lock; exactly one succeeds, one receives `INSUFFICIENT_STOCK`, and final reserved quantity/order count is `6/1` |
| `stock-moves-contract-186-acceptance.yml` | Builds separate green and pre-186 databases from the governed Baseline pair, executes both proof directions, and uploads raw outputs |

The existing Migration 185 gate is expected to rerun because the migration path
changed. Migration 186 deliberately preserves its ACL assertions for
`consume_materials_for_mo` while changing that routine from a broken writer to a
canonical wrapper.

## Review checklist before any deployment decision

1. Confirm the PR head and base are unchanged and all required checks finished.
2. Read the raw Red, Green, and concurrency artifacts; do not infer success from
   the workflow badge alone.
3. Confirm `pg_proc.prosrc` contains zero live references to the retired
   relation after applying 186 to the fresh database.
4. Confirm Migration 185 acceptance still passes on the same head.
5. Confirm no migration or fixture was applied to Production as part of PR
   review.

## Production deployment checklist — completed 2026-09-03

The following checklist was executed only after separate Production authorization:

1. Recheck the migration ledger still ends at 185 and the legacy relations are
   still absent.
2. Recheck the eight target signatures, `prosecdef` values, owners, search paths,
   and ACLs; stop on drift.
3. Apply `186_stock_moves_contract_repair` once through the governed Supabase
   migration path.
4. Read back the ledger row and run the migration postflight/catalog queries.
5. Do not create a manufacturing order, reservation, consumption, or historical
   repair on Production for smoke testing. Behavioral smoke belongs to an
   isolated environment.

## Production application evidence — 2026-09-03

- Project: `uutfztmqvajmsxnrqeiv` (`Manufacturing Process`), PostgreSQL 17.6;
  Staging project `bhomjavdkzcvjyymzyla` was not targeted.
- Preflight ledger ended at
  `20260830081533 / 185_stock_write_surface_closure`; `stock_moves` and
  `stock_quants` relations were absent, the canonical relations/helpers were
  present, and all eight target routine signatures, owners, security modes,
  search paths, and ACLs matched the reviewed contract.
- Applied the exact file merged by PR #213 from `main@956011a` (source head
  `4358c11`; SHA-256
  `d96ec20356852f26f9a423bc35b4d26c6249b82fe738f525795239f3edc9ffb9`).
- Ledger readback ends at
  `20260903083010 / 186_stock_moves_contract_repair`.
- Catalog readback found all eight replacement bodies, zero public function
  bodies referencing `stock_moves`, canonical product resolution and atomic
  consumption markers, the reservation floor, and the expected ACLs. The two
  dormant historical routines that still reference absent `stock_quants` are
  tracked separately; neither is part of the repaired legal path.
- Direct read-only invocation of `calculate_material_variances(NULL,NULL,NULL)`
  raised SQLSTATE `0A000` with `MATERIAL_VARIANCE_SOURCE_RETIRED`, as designed.
- Data invariance before/after: SLE `5` rows / quantity `1400` / value delta
  `14250`; bins `2` rows / quantity `1000` / value `4250`; reservations `0`;
  manufacturing orders `3`. No count or aggregate changed.
- Supabase advisors were unchanged: security `94`, performance `549`, with zero
  newly introduced finding in either set.
- Generate Schema Baseline run `33734325356` passed every step and produced
  cutoff-186 pair `000_schema_baseline_20260903_083805.sql` +
  `001_system_reference_data_20260903_083805.sql`; clean rebuild measured 133
  tables, 259 functions, and 318 policies, and matched all 263 reference rows.
  Publication remains a separate review decision in Draft PR #214.

## Recovery

Do not drop functions or edit Migration 186 after application. If review finds a
defect, restore the required prior or corrected definitions through a new,
incremental migration. Historical inventory repair remains outside this scope.

## Still open after 186

- `INV-01`/`INV-03`: missing bin and ledger continuity/data remediation.
- `INV-02`: legal voucher idempotency and its own deterministic race proof.
- `INV-04`/`INV-06`: product projection and analyzer organization identity.
- `INV-07`/`INV-08`/`INV-10`: UoM completeness, bin uniqueness, and provenance.
- Issue #173/#174: exact read-permission enforcement for inventory/manufacturing reports.
- Dormant client adapters and raw SQL files: application/tooling retirement or a
  complete legal rewrite in a separate PR.
