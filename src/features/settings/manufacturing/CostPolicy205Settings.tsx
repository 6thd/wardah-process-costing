import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { CostPolicy205State, CostPolicyVersion205, UnallocatedBudgetPolicy } from '@/services/mfg-cost-policy-205-service'
import { setSelfApproval205, setUnallocatedPolicy205 } from '@/services/mfg-cost-policy-205-write-service'
import { withdrawCostPolicyVersion } from '@/services/mfg-cost-policy-service'
import { ReasonForm } from './CostPolicy205Decisions'
import { useCostPolicy205Action } from './useCostPolicy205Action'

const P = 'manufacturingSettings.costPolicy205'

/**
 * تغيير إعدادَي الاعتماد (التصميم §8)، كلٌّ بسبب إلزامي وتأكيد يبين الأثر. الزر من `capabilities`
 * للعرض فقط. `COST_POLICY_SETTING_UNCHANGED` بعد انقطاع يعامل نجاحًا **بعد** قراءة تؤكد القيمة.
 */
export function CostPolicy205SettingsActions({ state }: { readonly state: CostPolicy205State }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<null | 'self' | 'policy'>(null)
  const nextSelf = !state.settings.selfApprovalEnabled
  const nextPolicy: UnallocatedBudgetPolicy = state.settings.unallocatedBudgetPolicy === 'block' ? 'controlled_exception' : 'block'
  const self = useCostPolicy205Action(state.orgId, {
    run: (org, vars: { enabled: boolean; reason: string }) => setSelfApproval205(org, vars.enabled, vars.reason),
    success: () => t(`${P}.done.settingChanged`),
    confirmed: (fresh, vars) => fresh.settings.selfApprovalEnabled === vars.enabled,
    onDone: () => setOpen(null),
  })
  const policy = useCostPolicy205Action(state.orgId, {
    run: (org, vars: { policy: UnallocatedBudgetPolicy; reason: string }) => setUnallocatedPolicy205(org, vars.policy, vars.reason),
    success: () => t(`${P}.done.settingChanged`),
    confirmed: (fresh, vars) => fresh.settings.unallocatedBudgetPolicy === vars.policy,
    onDone: () => setOpen(null),
  })
  const caps = state.capabilities
  if (!caps.can_manage_approval_settings && !caps.can_manage_unallocated_policy) return null
  return (
    <div className="space-y-2" data-testid="cp205-settings-actions">
      <div className="flex flex-wrap gap-2">
        {caps.can_manage_approval_settings && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen('self')}>
            {t(nextSelf ? `${P}.settingsActions.enableSelf` : `${P}.settingsActions.disableSelf`)}
          </Button>
        )}
        {caps.can_manage_unallocated_policy && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen('policy')}>
            {t(`${P}.settingsActions.setPolicy`, { policy: t(`${P}.unallocatedPolicies.${nextPolicy}`) })}
          </Button>
        )}
      </div>
      {open === 'self' && (
        <div className="space-y-1">
          <p className="text-xs" role="note">{t(nextSelf ? `${P}.settingsActions.enableSelfEffect` : `${P}.settingsActions.disableSelfEffect`)}</p>
          <ReasonForm label={t(`${P}.settingsActions.reason`)} confirm={t(`${P}.settingsActions.confirm`)} busy={self.isPending}
            onConfirm={(reason) => self.mutate({ enabled: nextSelf, reason })} onCancel={() => setOpen(null)} testId="cp205-self-form" />
        </div>
      )}
      {open === 'policy' && (
        <div className="space-y-1">
          <p className="text-xs" role="note">{t(`${P}.settingsActions.policyEffect.${nextPolicy}`)}</p>
          <ReasonForm label={t(`${P}.settingsActions.reason`)} confirm={t(`${P}.settingsActions.confirm`)} busy={policy.isPending}
            onConfirm={(reason) => policy.mutate({ policy: nextPolicy, reason })} onCancel={() => setOpen(null)} testId="cp205-policy-form" />
        </div>
      )}
    </div>
  )
}

/**
 * يظهر زر السحب تقديرًا (§16): `can_create`، وإصدار غير مسحوب يبدأ اليوم أو لاحقًا، وبلا أوامر مثبتة أو
 * بانتظار البدء. العميل لا يرى كل مراجع التوقيت، فالخادم هو الحكم.
 */
export function canOfferVersionWithdraw(state: CostPolicy205State, v: CostPolicyVersion205): boolean {
  return state.capabilities.can_create && v.status !== 'withdrawn' && v.effective_from >= state.today
    && v.pinned_order_count === 0 && v.awaiting_start_order_count === 0
}

/**
 * سحب إصدار بمسار 204 (قرار المالك Q-4)، ويشمل الإصدار المعتمد بمسار 205. يتطلب صلاحية التحديث لا
 * `approve`. بلا مفتاح تكرار: بعد انقطاع تُقرأ الحالة، و`ALREADY_WITHDRAWN` نجاح إن طابق السبب.
 */
export function VersionWithdraw({ state, version }: { readonly state: CostPolicy205State; readonly version: CostPolicyVersion205 }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const withdraw = useCostPolicy205Action(state.orgId, {
    run: (org, reason: string) => withdrawCostPolicyVersion(org, version.id, reason),
    success: () => t('manufacturingSettings.costPolicy.withdrawn'),
    confirmed: (fresh, reason) => fresh.versions.some(v => v.id === version.id && v.status === 'withdrawn' && v.withdraw_reason === reason),
    onDone: () => setOpen(false),
  })
  if (!canOfferVersionWithdraw(state, version)) return null
  const startsToday = version.effective_from === state.today
  return open ? (
    <div className="space-y-1">
      {startsToday && <p className="text-xs text-destructive" role="note">{t(`${P}.withdrawVersion.startsToday`)}</p>}
      <p className="text-xs">{t(`${P}.withdrawVersion.numberKept`)}</p>
      <ReasonForm label={t('manufacturingSettings.costPolicy.withdrawReason')} confirm={t('manufacturingSettings.costPolicy.confirmWithdraw')}
        busy={withdraw.isPending} onConfirm={(r) => withdraw.mutate(r)} onCancel={() => setOpen(false)} testId={`cp205-version-withdraw-${version.version_no}`} />
    </div>
  ) : (
    <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>{t('manufacturingSettings.costPolicy.withdraw')}</Button>
  )
}
