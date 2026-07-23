from pathlib import Path


def replace_once_or_verify(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count == 1:
        path.write_text(text.replace(old, new, 1), encoding='utf-8')
        return
    if count == 0 and new in text:
        return
    raise SystemExit(f'{path}: expected one old match or existing replacement; found {count}')


service = Path('src/services/uom-master-data-service.ts')
text = service.read_text(encoding='utf-8')
needle = "      .in('id', uomIds)"
replacement = "      .in('id', uomIds)\n      .or(`org_id.is.null,org_id.eq.${orgId}`)"
count = text.count(needle)
if count == 2:
    service.write_text(text.replace(needle, replacement), encoding='utf-8')
elif text.count(replacement) != 2:
    raise SystemExit(f'{service}: expected two unscoped or two scoped UoM queries')

mapper = Path('src/services/uom-error-mapper.ts')
replace_once_or_verify(
    mapper,
    "  { prefixes: ['PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS'], translationKey: 'baseUomLocked' },",
    "  { prefixes: ['PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS', 'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP'], translationKey: 'baseUomLocked' },",
)
replace_once_or_verify(
    mapper,
    "  { prefixes: ['UOM_BACKFILL_SOURCE_NOT_RESOLVED'], translationKey: 'backfillSourceNotResolved', action: 'OPEN_BACKFILL_ISSUES' },",
    "  { prefixes: ['UOM_BACKFILL_SOURCE_NOT_RESOLVED', 'UOM_BACKFILL_RESOLUTION_UOM_MISMATCH', 'UOM_BACKFILL_SOURCE_UNSUPPORTED'], translationKey: 'backfillSourceNotResolved', action: 'OPEN_BACKFILL_ISSUES' },",
)
