import type { TFunction } from 'i18next'
import { manufacturingSettingsErrorKey } from '@/services/manufacturing-settings-service'

/** نص الخطأ للمستخدم: رسالة مترجمة لرموز قاعدة البيانات المعروفة، وإلا الرسالة الأصلية. */
export function settingsErrorMessage(t: TFunction, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const key = manufacturingSettingsErrorKey(message)
  return key ? t(key) : message
}
