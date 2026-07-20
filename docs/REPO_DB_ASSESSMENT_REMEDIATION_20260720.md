# Remediation Plan — Repository/Database Assessment and UoM Engine

**Assessment source:** `REPO_DB_ASSESSMENT_AND_UOM_ENGINE_20260720.md`  
**Target migrations:** 128–135  
**Principle:** legal inventory quantities are stored in the product base UoM; the entered UoM and conversion factor are immutable document snapshots.

## Executive status

| Finding | Treatment | Verification |
|---|---|---|
| DB-1 weighted-average equivalent units | Migration 128 corrects completed-unit treatment, adds transferred-in EU pool and explicit beginning-WIP cost split | SQL acceptance + WIP regression |
| DB-2 `items`/`products` identity assumption | Migration 132 adds `item_product_map`, canonical `product_id`, compatibility triggers and fail-closed resolver | Missing map raises `ITEM_PRODUCT_MAP_MISSING` |
| DB-3 no UoM engine | Migrations 129–131 add catalog, aliases, product conversions, snapshots and guarded conversion RPC | UoM service tests + SQL acceptance |
| DB-4 quantity precision mismatch | Migration 130 widens legal quantity columns to `numeric(18,6)` | information-schema assertions |
| DB-5 security advisors | Migration 135 adds org-scoped `items` policies, archives snapshots and revokes unnecessary anonymous execution; infrastructure items remain operational actions | Supabase advisors after deployment |
| DB-6 performance advisors | Migration 135 caches `auth.uid()` in existing policy expressions and migration 130 adds the three live missing FK indexes | advisors + query-plan sampling |
| DB-7 public dated snapshots | Migration 135 moves empty dated tables to non-exposed `legacy_archive`; aborts if any row exists | zero public matching tables |
| DB-8 nullable org/timestamp ambiguity | Migration 130 makes stock org IDs non-null after precheck; migration 135 interprets historical naive timestamps explicitly as UTC and converts to `timestamptz` | schema assertions |
| REPO-1 sales stock race | Migration 133 replaces delivery RPC: warehouse/bin lock + `wardah_apply_stock_outgoing`; COGS comes from actual valuation | delivery contract tests |
| REPO-2 purchase valuation fallback | Migration 133 makes receipt response explicitly `inventory_atomic/uom_atomic`; strict clients must require these flags | goods receipt contract tests |
| REPO-3 client GL writes | Receipt/delivery post event journals inside the same transaction; no UoM client computes legal valuation | RPC transaction tests |
| REPO-4 parallel layers/unmanaged SQL | New work is confined to numbered migrations and a dedicated UoM service; legacy removal remains usage-proven cleanup | CI import/usage inventory |
| REPO-5 `products.stock_quantity` | Remains a compatibility aggregate maintained only by legal stock helpers; bins/SLE are authoritative | reconciliation query |

## Invariants introduced

1. A stockable product must have `base_uom_id` before any new UoM-aware legal movement.
2. Product-specific packaging such as carton/box requires an explicit positive `factor_to_base`.
3. A document stores legal base quantity plus `qty_entered`, `uom_id`, `conversion_factor_snapshot`, and entered price/cost where applicable.
4. Missing conversion, cross-category conversion and missing item-product mapping fail closed.
5. Closed WIP periods are never recalculated by migration 128.
6. Dated snapshot tables are archived only when every table is empty.

## Deployment sequence

1. Apply 128 and run WIP regression tests.
2. Apply 129–132; resolve every open UoM issue affecting an active stockable product.
3. Configure product-specific carton/box factors and test representative receipts, BOMs and deliveries.
4. Apply 133–134 in a maintenance window and deploy the strict client contract in the same release.
5. Apply 135 after a snapshot and execute `scripts/verify/warehouse_assessment_acceptance.sql`.
6. Re-run Supabase security/performance advisors and retain before/after evidence.

## Deliberately not automated

- PostgreSQL infrastructure upgrade.
- Auth leaked-password protection toggle.
- Deleting unused indexes without a 30-day usage window.
- Deleting historical snapshot tables.
- Guessing carton/box conversion factors.
- Rewriting closed accounting periods.

These actions require explicit operational approval and a rollback window.
