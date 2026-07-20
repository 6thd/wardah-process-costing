# Remediation Plan — Repository/Database Assessment and UoM Engine

**Assessment source:** `REPO_DB_ASSESSMENT_AND_UOM_ENGINE_20260720.md`  
**Target migrations:** 128–140  
**Principle:** legal inventory quantities are stored in the product base UoM; the entered UoM and conversion factor remain immutable document snapshots.

## Executive status

| Finding | Treatment | Verification |
|---|---|---|
| Weighted-average equivalent units | Migration 128 treats completed units at 100%, separates material/conversion/transferred-in pools, preserves legacy unsplit inserts and never assigns the generated `cost_total` column | WIP regression + SQL acceptance |
| `items`/`products` identity assumption | Migration 132 adds `item_product_map`, canonical `product_id`, deterministic resolution and fail-closed consumption | Missing map raises `ITEM_PRODUCT_MAP_MISSING` |
| No UoM engine | Migrations 129–131 add catalog, aliases, time-versioned product conversions, snapshots and guarded conversion RPCs | UoM service tests + Fresh DB |
| Quantity precision mismatch | Migration 130 widens legal quantity columns to `numeric(18,6)`, recreates the dependent valuation view and preserves generated expressions | Fresh DB generated-column guard |
| Generated timestamp failure | Migration 135 leaves generated `posting_datetime` intact and normalizes only mutable timestamp columns | Fresh DB + schema assertions |
| RLS initplan rewrite | Migration 135 protects already-cached expressions before replacing bare `auth.uid()` calls, preventing nested wrappers | Acceptance query |
| Product carton/weight bridge | Migration 137 adds `net_weight`, `gross_weight`, `weight_uom_id`, explicit `allow_cross_dimension`, and guarded physical-weight RPCs | C1 5.4 kg contract tests |
| BOM quantities not normalized | Migration 138 fills `quantity_base`, adds a fail-closed BOM trigger and replaces `explode_bom` with base-UoM recursive explosion | BOM acceptance |
| Partial consumption value not reaching WIP | Migration 138 records actual SLE `cogs` in `material_consumption` and adds the same value to the open stage WIP material pool atomically | `wip_cost_atomic=true` contract |
| Non-deterministic reservation selection | Migration 138 prefers `reservation_id`; fallback selection is ordered by `created_at,id` | RPC review |
| PO/SI comparison unit mismatch | Migration 139 normalizes quantity and price at line entry, so receipt/delivery limits compare base UoM to base UoM | Trigger/receipt/delivery contracts |
| Tenant cannot add custom UoMs | Migration 140 supports system units (`org_id IS NULL`) and tenant-owned units, with admin RPC and tenant-scoped RLS | RLS + RPC acceptance |
| Security/performance advisors | Migration 135 archives empty snapshots, adds live FK indexes and revokes unnecessary anonymous execution; infrastructure findings remain operational actions | Advisors after staging deployment |

## Invariants introduced

1. A stockable product must have `base_uom_id` before any new legal UoM-aware movement.
2. Generic conversions remain same-dimension; cross-dimension conversion is accepted only as an explicit product physical fact.
3. A product may declare the net/gross mass of one legal base unit. Example: C1 base unit `CARTON`, `net_weight = 5.4`, `weight_uom_id = KG`.
4. A document stores legal base quantity plus `qty_entered`, `uom_id`, `conversion_factor_snapshot`, and entered price/cost.
5. BOM component quantities are stored and exploded in the component product base UoM.
6. Material consumption, stock valuation, `material_consumption`, and stage WIP material cost are posted in one transaction.
7. Missing conversion, missing item-product mapping, ambiguous warehouse/work order/stage, or unresolved BOM quantity fails closed.
8. Closed WIP periods are never recalculated by migration 128.
9. Dated snapshot tables are archived only when every listed table is empty.
10. Tenant custom UoMs are not visible outside their organization.

## Deployment sequence

1. Take a database snapshot and run `scripts/verify/warehouse_assessment_preflight.sql`.
2. Apply 128–132 on staging and resolve every blocking UoM/item-product issue.
3. Apply 133–140 and run `scripts/verify/warehouse_assessment_acceptance.sql`.
4. Configure representative products, including C1 as one carton with 5.4 kg declared net weight.
5. Test purchase in kg/carton, BOM components in kg/g/pcs, partial material consumption, WIP cost update, and sales/delivery by carton.
6. Reconcile `bins`, SLE, `material_consumption`, stage WIP and document snapshots.
7. Re-run Supabase security/performance advisors and retain before/after evidence.
8. Deploy application and migrations in the same maintenance window; do not expose UoM-aware clients against a partially migrated schema.

## Deliberately not automated

- PostgreSQL infrastructure upgrade.
- Auth leaked-password protection toggle.
- Deleting unused indexes without a 30-day usage window.
- Deleting historical snapshot tables.
- Guessing carton/box/roll physical factors.
- Rewriting closed accounting periods.
- Catch-weight actual secondary quantities per individual stock movement.

These actions require explicit operational approval, staging evidence and a rollback window.
