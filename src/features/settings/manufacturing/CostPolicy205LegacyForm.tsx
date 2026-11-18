import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CostPolicy205State, CostPolicyVersion205 } from '@/services/mfg-cost-policy-205-service'
import type { GlAccountOption205, LegacyResolutionPayload205 } from '@/services/mfg-cost-policy-205-write-service'
import { CostPolicy205Allocation } from './CostPolicy205Allocation'
import { buildResolutionPayload, hasInvalidNumber, legacyFormFor, remapPools, type AllocationPool, type LegacyResolutionForm } from './costPolicy205Draft'

const P = 'manufacturingSettings.costPolicy205'

/**
 * معالجة إصدار قديم (التصميم §9): خارج الإصدار نفسه، تغطي مجمعاته بالضبط، وسببها إلزامي. لا
 * تعديل لها بعد الحفظ: التصحيح بسحبها وإنشاء أخرى (F-UI-5). صفوف الإصدار لا تتغير.
 */
export function CostPolicy205LegacyForm({ state, version, glAccounts, glAccountsStatus, saving, onSubmit, onCancel }: {
  readonly state: CostPolicy205State
  readonly version: CostPolicyVersion205
  readonly glAccounts: readonly GlAccountOption205[]
  readonly glAccountsStatus: 'pending' | 'error' | 'success'
  readonly saving: boolean
  readonly onSubmit: (payload: LegacyResolutionPayload205, reason: string) => void
  readonly onCancel: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<LegacyResolutionForm>(() => legacyFormFor(version))
  const [invalid, setInvalid] = useState(false)
  const setPool = (index: number, p: Partial<AllocationPool>) => {
    setInvalid(false)
    setForm(f => ({ ...f, pools: f.pools.map((x, i) => (i === index ? { ...x, ...p } : x)) }))
  }
  const submit = () => {
    const payload = buildResolutionPayload(form, state.settings.unallocatedBudgetPolicy)
    if (hasInvalidNumber(payload)) { setInvalid(true); return }
    onSubmit(payload, form.reason.trim())
  }
  return (
    <form className="space-y-4 rounded-md border p-4" aria-label={t(`${P}.legacyForm.aria`, { version: version.version_no })}
      onSubmit={(e) => { e.preventDefault(); submit() }}>
      <p className="text-sm">{t(`${P}.legacyForm.help`)}</p>
      <CostPolicy205Allocation pools={form.pools} onPool={setPool} form={form}
        onChange={(a, remap) => { setInvalid(false); setForm(f => ({ ...f, ...a, ...(remap ? { pools: remapPools(f.pools, remap) } : {}) })) }}
        activities={state.supported.poolActivities} glAccounts={glAccounts} glAccountsStatus={glAccountsStatus}
        policy={state.settings.unallocatedBudgetPolicy} />
      <Input aria-label={t(`${P}.legacyForm.reason`)} maxLength={500} value={form.reason} required
        onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))} />
      {invalid && <p className="text-destructive" role="alert">{t(`${P}.form.invalidNumber`)}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || form.reason.trim() === ''}>{t(`${P}.legacyForm.submit`)}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t('manufacturingSettings.cancel')}</Button>
      </div>
    </form>
  )
}
