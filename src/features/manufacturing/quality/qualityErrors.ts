import type { TFunction } from 'i18next'
import { QualityRpcError } from '@/services/manufacturing/qualityService'

/** Localized message for a quality RPC failure; unknown errors stay generic. */
export function qualityErrorMessage(t: TFunction, error: unknown): string {
  if (error instanceof QualityRpcError && error.code) {
    return t(`quality.errors.${error.code}`)
  }
  return t('quality.errors.generic')
}
