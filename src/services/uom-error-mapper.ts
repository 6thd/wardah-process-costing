import { uomErrorTranslations, type UomErrorTranslationKey } from '@/locales/uom-errors'

export type UomErrorAction =
  | 'OPEN_PRODUCT_UOM_SETTINGS'
  | 'OPEN_BACKFILL_ISSUES'
  | 'OPEN_STAGE_WIP_LOGS'
  | 'PICK_STAGE'
  | 'PICK_WAREHOUSE'
  | 'PICK_WORK_ORDER'
  | 'OPEN_ORIGINAL_DOCUMENT'
  | 'CONTACT_SUPPORT'

export interface MappedUomError {
  code: string
  title: string
  description: string
  action?: UomErrorAction
  technicalDetails?: string
  context: Record<string, string>
}

interface UomErrorRule {
  prefixes: readonly string[]
  translationKey: UomErrorTranslationKey
  action?: UomErrorAction
}

const RULES: readonly UomErrorRule[] = [
  { prefixes: ['PRODUCT_BASE_UOM_REQUIRED'], translationKey: 'productBaseRequired', action: 'OPEN_PRODUCT_UOM_SETTINGS' },
  { prefixes: ['PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC'], translationKey: 'productBaseSpecific', action: 'OPEN_PRODUCT_UOM_SETTINGS' },
  { prefixes: ['PRODUCT_UOM_CONVERSION_MISSING'], translationKey: 'conversionMissing', action: 'OPEN_PRODUCT_UOM_SETTINGS' },
  { prefixes: ['UOM_CATEGORY_MISMATCH', 'PRODUCT_UOM_CATEGORY_MISMATCH'], translationKey: 'categoryMismatch' },
  { prefixes: ['UOM_CROSS_DIMENSION_NOT_ALLOWED', 'PRODUCT_UOM_CROSS_DIMENSION_REQUIRES_EXPLICIT_FLAG'], translationKey: 'crossDimension', action: 'OPEN_PRODUCT_UOM_SETTINGS' },
  { prefixes: ['BASE_UOM_FACTOR_MUST_EQUAL_ONE'], translationKey: 'baseFactorOne' },
  {
    prefixes: [
      'UOM_NOT_FOUND_OR_INACTIVE',
      'UOM_NOT_FOUND_IN_ORG_OR_INACTIVE',
      'PRODUCT_UOM_TARGET_INVALID',
      'PRODUCT_UOM_TARGET_INVALID_OR_WRONG_ORG',
    ],
    translationKey: 'uomUnavailable',
  },
  { prefixes: ['BOM_HAS_UNRESOLVED_UOM_LINES'], translationKey: 'bomUnresolved', action: 'OPEN_BACKFILL_ISSUES' },
  { prefixes: ['BOM_PRODUCT_OR_BASE_UOM_MISSING'], translationKey: 'bomProductMissing', action: 'OPEN_BACKFILL_ISSUES' },
  {
    prefixes: ['BOM_QUANTITY_MUST_BE_POSITIVE', 'BOM_EXPLOSION_QUANTITY_INVALID', 'BOM_CHILD_QUANTITY_INVALID'],
    translationKey: 'bomQuantityInvalid',
  },
  { prefixes: ['CONSUMPTION_EXCEEDS_RESERVATION'], translationKey: 'reservationExceeded' },
  { prefixes: ['OPEN_STAGE_WIP_LOG_NOT_FOUND'], translationKey: 'openWipMissing', action: 'OPEN_STAGE_WIP_LOGS' },
  { prefixes: ['STAGE_REQUIRED_FOR_MATERIAL_CONSUMPTION'], translationKey: 'stageRequired', action: 'PICK_STAGE' },
  {
    prefixes: ['WAREHOUSE_REQUIRED_FOR_CONSUMPTION', 'WAREHOUSE_REQUIRED_FOR_DELIVERY', 'WAREHOUSE_REQUIRED'],
    translationKey: 'warehouseRequired',
    action: 'PICK_WAREHOUSE',
  },
  { prefixes: ['WORK_ORDER_REQUIRED_FOR_CONSUMPTION'], translationKey: 'workOrderRequired', action: 'PICK_WORK_ORDER' },
  { prefixes: ['ACTIVE_RESERVATION_NOT_FOUND'], translationKey: 'reservationMissing' },
  { prefixes: ['PO_LINE_QUANTITY_MUST_BE_POSITIVE', 'SALES_LINE_QUANTITY_MUST_BE_POSITIVE'], translationKey: 'quantityPositive' },
  { prefixes: ['UOM_QUANTITY_MUST_BE_NONNEGATIVE'], translationKey: 'quantityNonnegative' },
  { prefixes: ['PO_LINE_PRICE_MUST_BE_NONNEGATIVE', 'SALES_LINE_PRICE_MUST_BE_NONNEGATIVE'], translationKey: 'priceNonnegative' },
  { prefixes: ['PRODUCT_WEIGHT_NOT_DECLARED'], translationKey: 'weightNotDeclared', action: 'OPEN_PRODUCT_UOM_SETTINGS' },
  { prefixes: ['WEIGHT_UOM_MUST_BE_ACTIVE_MASS_UNIT'], translationKey: 'weightUomMass' },
  { prefixes: ['NET_WEIGHT_MUST_BE_POSITIVE'], translationKey: 'netWeightPositive' },
  { prefixes: ['GROSS_WEIGHT_BELOW_NET_WEIGHT'], translationKey: 'grossBelowNet' },
  { prefixes: ['IDEMPOTENCY_KEY_REUSED'], translationKey: 'idempotencyReused', action: 'OPEN_ORIGINAL_DOCUMENT' },
  { prefixes: ['STOCK_OUT_NOT_APPLIED', 'STOCK_IN_NOT_APPLIED'], translationKey: 'stockMovementFailed' },
  { prefixes: ['UOM_CODE_INVALID'], translationKey: 'customCodeInvalid' },
  { prefixes: ['UOM_NAME_AND_SYMBOL_REQUIRED'], translationKey: 'customNameSymbolRequired' },
  { prefixes: ['UOM_CATEGORY_NOT_FOUND'], translationKey: 'categoryNotFound' },
  { prefixes: ['STANDARD_UOM_FACTOR_MUST_BE_POSITIVE', 'UOM_FACTOR_MUST_BE_POSITIVE'], translationKey: 'factorPositive' },
  { prefixes: ['PRODUCT_SPECIFIC_UOM_FACTOR_MUST_BE_NULL'], translationKey: 'productSpecificFactorNull' },
  { prefixes: ['UOM_DECIMAL_PLACES_INVALID'], translationKey: 'decimalPlacesInvalid' },
  { prefixes: ['SYSTEM_UOM_CODE_RESERVED'], translationKey: 'systemCodeReserved' },
  { prefixes: ['SYSTEM_UOM_ALIAS_RESERVED'], translationKey: 'systemAliasReserved' },
  { prefixes: ['UOM_INVALID_PRODUCT_CONTEXT', 'PRODUCT_AND_UOM_REQUIRED'], translationKey: 'productContextInvalid' },
  {
    prefixes: ['UOM_PRODUCT_NOT_FOUND_OR_WRONG_ORG', 'PRODUCT_NOT_FOUND_OR_WRONG_ORG', 'PRODUCT_NOT_FOUND'],
    translationKey: 'productNotFound',
  },
  {
    prefixes: ['PRODUCT_BASE_UOM_INVALID', 'PRODUCT_BASE_UOM_INVALID_OR_WRONG_ORG', 'PRODUCT_UOM_WRONG_ORG_OR_BASE_MISSING'],
    translationKey: 'productBaseInvalid',
    action: 'OPEN_PRODUCT_UOM_SETTINGS',
  },
  { prefixes: ['INVALID_UOM_CONVERSION_RESPONSE', 'UOM_CONVERSION_FAILED'], translationKey: 'conversionResponseInvalid' },
  { prefixes: ['UOM_CONVERSION_SAVE_FAILED'], translationKey: 'conversionSaveFailed' },
  { prefixes: ['PRODUCT_WEIGHT_SAVE_FAILED'], translationKey: 'weightSaveFailed' },
  { prefixes: ['PRODUCT_WEIGHT_LOOKUP_FAILED'], translationKey: 'weightLookupFailed' },
  { prefixes: ['INVALID_PRODUCT_UOM_OPTIONS_RESPONSE'], translationKey: 'productOptionsInvalid' },
  { prefixes: ['PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS'], translationKey: 'baseUomLocked' },
  { prefixes: ['PRODUCT_BASE_UOM_UNCHANGED'], translationKey: 'baseUomUnchanged' },
  { prefixes: ['PRODUCT_BASE_UOM_ASSIGN_FAILED'], translationKey: 'baseUomAssignFailed', action: 'OPEN_PRODUCT_UOM_SETTINGS' },
  {
    prefixes: ['UOM_BACKFILL_ISSUE_NOT_FOUND', 'UOM_BACKFILL_ISSUE_NOT_OPEN', 'UOM_BACKFILL_ISSUE_REQUIRED'],
    translationKey: 'backfillIssueUnavailable',
    action: 'OPEN_BACKFILL_ISSUES',
  },
  {
    prefixes: ['UOM_BACKFILL_ISSUE_RESOLVE_FAILED', 'UOM_BACKFILL_ISSUE_IGNORE_FAILED'],
    translationKey: 'backfillActionFailed',
    action: 'OPEN_BACKFILL_ISSUES',
  },
  { prefixes: ['UOM_BACKFILL_SOURCE_NOT_RESOLVED'], translationKey: 'backfillSourceNotResolved', action: 'OPEN_BACKFILL_ISSUES' },
  { prefixes: ['UOM_BACKFILL_IGNORE_NOTE_REQUIRED'], translationKey: 'ignoreNoteRequired', action: 'OPEN_BACKFILL_ISSUES' },
]

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error ?? '')
}

function normalizedLanguage(language?: string): 'ar' | 'en' {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'ar'
}

function extractCode(message: string): string {
  const trimmed = message.trim()
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? ''
  return (firstLine.split(':', 1)[0] ?? '').trim().toUpperCase()
}

function extractContext(message: string): Record<string, string> {
  const context: Record<string, string> = {}
  const detail = message.includes(':') ? message.slice(message.indexOf(':') + 1) : ''
  const pattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^,;\n]+)/g
  let match = pattern.exec(detail)
  while (match) {
    context[match[1]] = match[2].trim()
    match = pattern.exec(detail)
  }
  return context
}

function interpolate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => context[key] ?? '—')
}

export function mapUomError(error: unknown, language?: string): MappedUomError {
  const message = errorMessage(error)
  const code = extractCode(message)
  const context = extractContext(message)
  const rule = RULES.find((candidate) => candidate.prefixes.some((prefix) => code.startsWith(prefix)))
  const locale = uomErrorTranslations[normalizedLanguage(language)]
  const copy = locale[rule?.translationKey ?? 'generic']

  return {
    code: code || 'UNKNOWN_UOM_ERROR',
    title: copy.title,
    description: interpolate(copy.description, context),
    action: rule?.action ?? (rule ? undefined : 'CONTACT_SUPPORT'),
    technicalDetails: message || undefined,
    context,
  }
}

export function isUomError(error: unknown): boolean {
  const code = extractCode(errorMessage(error))
  return RULES.some((rule) => rule.prefixes.some((prefix) => code.startsWith(prefix)))
}

export const UOM_ERROR_PREFIXES = RULES.flatMap((rule) => [...rule.prefixes])
