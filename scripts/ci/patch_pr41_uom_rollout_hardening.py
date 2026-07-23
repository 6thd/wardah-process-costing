from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


migration = Path('sql/migrations/144_products_base_uom_change_guard.sql')
replace_once(
    migration,
    "-- A product is MAPPED exactly when it owns a legal base-unit reference. Failing the\n"
    "-- preflight is safer than validating a false invariant or silently rewriting master\n"
    "-- data during rollout.\n"
    "DO $preflight$\n"
    "DECLARE\n"
    "  v_inconsistent bigint;\n"
    "BEGIN\n"
    "  SELECT count(*)\n"
    "  INTO v_inconsistent\n"
    "  FROM public.products p\n"
    "  WHERE (p.base_uom_id IS NOT NULL) IS DISTINCT FROM (p.uom_migration_status = 'MAPPED');\n\n"
    "  IF v_inconsistent > 0 THEN\n"
    "    RAISE EXCEPTION\n"
    "      'PRODUCT_UOM_INVARIANT_PREFLIGHT_FAILED: inconsistent_products=%',\n"
    "      v_inconsistent;\n"
    "  END IF;\n"
    "END\n"
    "$preflight$;\n\n",
    "-- Staged invariant: no new/updated row may claim MAPPED without a base unit.\n"
    "-- Existing historical inconsistencies remain visible for the repair screen and do\n"
    "-- not abort rollout or get rewritten automatically. A later audited migration may\n"
    "-- validate the constraint after every organization completes reconciliation.\n",
)
replace_once(
    migration,
    "      CHECK ((base_uom_id IS NOT NULL) = (uom_migration_status = 'MAPPED'))\n"
    "      NOT VALID;",
    "      CHECK (uom_migration_status <> 'MAPPED' OR base_uom_id IS NOT NULL)\n"
    "      NOT VALID;",
)
replace_once(
    migration,
    "\nALTER TABLE public.products\n  VALIDATE CONSTRAINT products_base_uom_mapping_invariant;\n",
    "\n",
)
replace_once(
    migration,
    "COMMENT ON CONSTRAINT products_base_uom_mapping_invariant ON public.products IS\n"
    "  'Fail-closed invariant: a product is MAPPED exactly when base_uom_id is present.';",
    "COMMENT ON CONSTRAINT products_base_uom_mapping_invariant ON public.products IS\n"
    "  'Staged fail-closed invariant: MAPPED requires base_uom_id. Existing historical rows remain repairable until a separately approved validation migration.';",
)

service = Path('src/services/uom-master-data-service.ts')
text = service.read_text(encoding='utf-8')
needle = "      .in('id', uomIds)"
if text.count(needle) != 2:
    raise SystemExit(f'{service}: expected two UoM id queries, found {text.count(needle)}')
text = text.replace(
    needle,
    "      .in('id', uomIds)\n      .or(`org_id.is.null,org_id.eq.${orgId}`)",
)
service.write_text(text, encoding='utf-8')

mapper = Path('src/services/uom-error-mapper.ts')
replace_once(
    mapper,
    "  { prefixes: ['PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS'], translationKey: 'baseUomLocked' },",
    "  { prefixes: ['PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS', 'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP'], translationKey: 'baseUomLocked' },",
)
replace_once(
    mapper,
    "  { prefixes: ['UOM_BACKFILL_SOURCE_NOT_RESOLVED'], translationKey: 'backfillSourceNotResolved', action: 'OPEN_BACKFILL_ISSUES' },",
    "  { prefixes: ['UOM_BACKFILL_SOURCE_NOT_RESOLVED', 'UOM_BACKFILL_RESOLUTION_UOM_MISMATCH', 'UOM_BACKFILL_SOURCE_UNSUPPORTED'], translationKey: 'backfillSourceNotResolved', action: 'OPEN_BACKFILL_ISSUES' },",
)

# This file is intentionally temporary; the guarded workflow deletes it after the
# patched source has been verified and committed.
