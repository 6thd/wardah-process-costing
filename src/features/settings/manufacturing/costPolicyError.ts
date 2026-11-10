import type { TFunction } from 'i18next'
import { costPolicyErrorDetail, costPolicyErrorKey } from '@/services/mfg-cost-policy-service'

/** رسالة مترجمة لرموز 204، مع التفصيل (المسار أو الحد) إن وُجد؛ وإلا الرسالة كما هي. */
export function costPolicyErrorMessage(t: TFunction, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const key = costPolicyErrorKey(message)
  if (!key) return message
  const detail = costPolicyErrorDetail(message)
  return detail ? `${t(key)} (${detail})` : t(key)
}
