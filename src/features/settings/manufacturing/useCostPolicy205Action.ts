import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { discoverCostPolicy205, type CostPolicy205State } from '@/services/mfg-cost-policy-205-service'
import { errorGroup205 } from '@/services/mfg-cost-policy-205-write-service'
import { costPolicy205ErrorMessage } from './costPolicy205Error'
import { costPolicy205QueryKey } from './queryKeys'

export interface Action205Options<V, R> {
  /** الاستدعاء نفسه، بمؤسسة اللوحة صراحة. */
  readonly run: (orgId: string, vars: V) => Promise<R>
  /** رسالة النجاح، أو `null` لنجاح بلا رسالة. */
  readonly success: (result: R | null, vars: V) => string | null
  /**
   * بعد رفض يعيد القراءة، أو رد مفقود: هل الحالة الجديدة تثبت أن ما طُلب تم؟ (التصميم §6 و§8 و§16).
   * مثلًا: المسودة صارت `approved` بالمراجعة نفسها وبيد الجلسة نفسها. لا إعادة إرسال آلية أبدًا.
   */
  readonly confirmed?: (fresh: CostPolicy205State, vars: V) => boolean
  readonly onDone?: (result: R | null, vars: V) => void
}

/**
 * كتابة واحدة في لوحة 205 لمؤسسة اللوحة (`orgId`):
 * - النجاح يعيد قراءة الحالة، ثم يعرض رسالة.
 * - رفض صلاحية أو تزامن أو إعدادات، أو رد مفقود: تُقرأ الحالة أولًا، ثم يُحكم بها (`confirmed`) أو يُعرض الرفض.
 * - خطأ عقد أو إدخال: يُعرض كما هو، والحالة لا تتغير.
 * رد يصل بعد تبديل المؤسسة أو مغادرة اللوحة يحدّث ذاكرة مؤسسته فقط، ولا يعرض شيئًا.
 */
export function useCostPolicy205Action<V, R>(orgId: string, options: Action205Options<V, R>) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const live = useRef<string | null>(orgId)
  live.current = orgId
  useEffect(() => () => { live.current = null }, [])

  const reread = (org: string) =>
    queryClient.fetchQuery({ queryKey: costPolicy205QueryKey(org), queryFn: () => discoverCostPolicy205(org), staleTime: 0 })

  return useMutation({
    mutationFn: async (vars: V) => ({ org: orgId, result: await options.run(orgId, vars) }),
    onSuccess: async ({ org, result }, vars) => {
      await queryClient.invalidateQueries({ queryKey: costPolicy205QueryKey(org) })
      if (live.current !== org) return
      const message = options.success(result, vars)
      if (message) toast.success(message)
      options.onDone?.(result, vars)
    },
    onError: async (error, vars) => {
      const org = orgId
      const group = errorGroup205(error)
      if (group === 'contract' || group === 'input') {
        if (live.current === org) toast.error(costPolicy205ErrorMessage(t, error))
        return
      }
      const fresh = await reread(org).catch(() => null)
      if (live.current !== org) return
      if (fresh?.status === 'present' && options.confirmed?.(fresh.state, vars)) {
        const message = options.success(null, vars)
        if (message) toast.success(message)
        options.onDone?.(null, vars)
        return
      }
      toast.error(costPolicy205ErrorMessage(t, error))
    },
  })
}
