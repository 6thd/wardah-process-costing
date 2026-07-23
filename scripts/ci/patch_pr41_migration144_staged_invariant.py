from pathlib import Path

path = Path('sql/migrations/144_products_base_uom_change_guard.sql')
text = path.read_text(encoding='utf-8')

old_preflight = """-- A product is MAPPED exactly when it owns a legal base-unit reference. Failing the
-- preflight is safer than validating a false invariant or silently rewriting master
-- data during rollout.
DO $preflight$
DECLARE
  v_inconsistent bigint;
BEGIN
  SELECT count(*)
  INTO v_inconsistent
  FROM public.products p
  WHERE (p.base_uom_id IS NOT NULL) IS DISTINCT FROM (p.uom_migration_status = 'MAPPED');

  IF v_inconsistent > 0 THEN
    RAISE EXCEPTION
      'PRODUCT_UOM_INVARIANT_PREFLIGHT_FAILED: inconsistent_products=%',
      v_inconsistent;
  END IF;
END
$preflight$;

"""
new_preflight = """-- Staged invariant: new or updated rows may not claim MAPPED without a base
-- unit. Existing historical inconsistencies remain visible to the repair workflow;
-- rollout never rewrites them or aborts before each organization can reconcile them.
"""

if old_preflight in text:
    text = text.replace(old_preflight, new_preflight, 1)
elif new_preflight not in text:
    raise SystemExit('migration 144 preflight block is neither original nor patched')

old_constraint = "CHECK ((base_uom_id IS NOT NULL) = (uom_migration_status = 'MAPPED'))"
new_constraint = "CHECK (uom_migration_status <> 'MAPPED' OR base_uom_id IS NOT NULL)"
if old_constraint in text:
    text = text.replace(old_constraint, new_constraint, 1)
elif new_constraint not in text:
    raise SystemExit('migration 144 invariant expression is neither original nor patched')

old_validate = "\nALTER TABLE public.products\n  VALIDATE CONSTRAINT products_base_uom_mapping_invariant;\n"
new_validate = "\n-- Historical validation is intentionally deferred until every organization has\n-- completed an audited reconciliation through the repair workflow.\n"
if old_validate in text:
    text = text.replace(old_validate, new_validate, 1)
elif new_validate not in text:
    raise SystemExit('migration 144 validation statement is neither original nor patched')

text = text.replace(
    '-- safety: additive/replace-only. No operational row is deleted. The migration aborts\n--         if pre-existing products violate the MAPPED <=> base_uom_id invariant.',
    '-- safety: additive/replace-only. No operational row is deleted or rewritten. The\n--         staged NOT VALID constraint protects new writes without blocking legacy repair.',
    1,
)
text = text.replace(
    "  'Fail-closed invariant: a product is MAPPED exactly when base_uom_id is present.';",
    "  'Staged fail-closed invariant: MAPPED requires base_uom_id. Historical validation is deferred until audited reconciliation is complete.';",
    1,
)

path.write_text(text, encoding='utf-8')
