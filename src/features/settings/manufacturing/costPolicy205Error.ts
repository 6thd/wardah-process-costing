import type { TFunction } from 'i18next'
import { errorDetail205, errorKey205 } from '@/services/mfg-cost-policy-205-write-service'

/**
 * رسالة مترجمة لرفض من 205 مع التفصيل بعد «:» (التصميم §14). رسالة ليست من الخادم (انقطاع) تُعرض
 * بنص يقول إن النتيجة غير معروفة وإن الحالة أعيدت قراءتها، ثم الرسالة الأصلية.
 */
export function costPolicy205ErrorMessage(t: TFunction, error: unknown): string {
  const key = errorKey205(error)
  const message = error instanceof Error ? error.message : String(error)
  if (!key) return `${t('manufacturingSettings.costPolicy205.errors.unknownOutcome')} (${message})`
  const translated = t(key, { defaultValue: '' })
  const base = translated || `${t('manufacturingSettings.costPolicy205.errors.untranslated')} ${message}`
  const detail = errorDetail205(error)
  return detail && translated ? `${base} (${detail})` : base
}
