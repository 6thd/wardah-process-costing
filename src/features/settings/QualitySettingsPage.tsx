import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { useQualityPolicy, useSaveQualityPolicy } from '@/hooks/manufacturing/useQuality'
import { qualityErrorMessage } from '@/features/manufacturing/quality/qualityErrors'
import type {
  InspectionScope,
  QualityPolicy,
  QualityPolicySettings,
  ReleaseGateMode,
} from '@/services/manufacturing/qualityService'

const GATE_MODES: readonly ReleaseGateMode[] = ['off', 'all_orders', 'routing_flagged']
const SCOPES: readonly InspectionScope[] = ['final_only', 'stages_and_final']

function toSettings(policy: QualityPolicy): QualityPolicySettings {
  return {
    release_gate_mode: policy.release_gate_mode,
    inspection_scope: policy.inspection_scope,
    allow_conditional_release: policy.allow_conditional_release,
    segregation_of_duties: policy.segregation_of_duties,
    admins_subject_to_quality_controls: policy.admins_subject_to_quality_controls,
  }
}

function sameSettings(a: QualityPolicySettings, b: QualityPolicySettings): boolean {
  return (Object.keys(a) as (keyof QualityPolicySettings)[]).every((key) => a[key] === b[key])
}

function Question({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {help && <CardDescription>{help}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

/**
 * Settings › Quality. Each card is one decision from the quality-control
 * inventory; the server (rpc_get_quality_policy) decides who may edit.
 */
export function QualitySettingsPage() {
  const { t } = useTranslation()
  const policyQuery = useQualityPolicy()
  const savePolicy = useSaveQualityPolicy()
  const policy = policyQuery.data
  const [draft, setDraft] = useState<QualityPolicySettings | null>(null)

  useEffect(() => {
    if (policy) setDraft(toSettings(policy))
  }, [policy])

  if (policyQuery.isLoading || (policy && !draft)) {
    return <LoadingSpinner />
  }
  if (policyQuery.isError || !policy || !draft) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('quality.settings.title')} description={t('quality.settings.subtitle')} />
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {qualityErrorMessage(t, policyQuery.error)}
          </CardContent>
        </Card>
      </div>
    )
  }

  const canManage = policy.capabilities.can_manage_policy
  const dirty = !sameSettings(draft, toSettings(policy))
  const update = <K extends keyof QualityPolicySettings>(key: K, value: QualityPolicySettings[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current))

  const handleSave = () => {
    savePolicy.mutate(
      { settings: draft, expectedVersion: policy.version },
      {
        onSuccess: () => toast.success(t('quality.settings.saved')),
        onError: (error) => {
          toast.error(qualityErrorMessage(t, error))
          // A version conflict means our copy is stale: reload it.
          void policyQuery.refetch()
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('quality.settings.title')}
        description={t('quality.settings.subtitle')}
        hideOnPrint={false}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t('quality.settings.version', { version: policy.version })}</Badge>
        {!canManage && <Badge variant="secondary">{t('quality.settings.readOnly')}</Badge>}
      </div>

      <Question title={t('quality.settings.q1.title')} help={t('quality.settings.q1.help')}>
        <Select
          value={draft.inspection_scope}
          onValueChange={(value) => update('inspection_scope', value as InspectionScope)}
          disabled={!canManage}
        >
          <SelectTrigger aria-label={t('quality.settings.q1.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((scope) => (
              <SelectItem key={scope} value={scope}>{t(`quality.settings.q1.${scope}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Question>

      <Question title={t('quality.settings.q2.title')} help={t('quality.settings.q2.help')}>
        <Select
          value={draft.release_gate_mode}
          onValueChange={(value) => update('release_gate_mode', value as ReleaseGateMode)}
          disabled={!canManage}
        >
          <SelectTrigger aria-label={t('quality.settings.q2.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GATE_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>{t(`quality.settings.q2.${mode}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Question>

      <Question title={t('quality.settings.q3.title')} help={t('quality.settings.q3.help')}>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="quality-allow-conditional">{t('quality.settings.q3.allowConditional')}</Label>
          <Switch
            id="quality-allow-conditional"
            checked={draft.allow_conditional_release}
            onCheckedChange={(checked) => update('allow_conditional_release', checked)}
            disabled={!canManage}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('quality.settings.q3.allowConditionalHint')}</p>
      </Question>

      <Question title={t('quality.settings.q4.title')}>
        <Badge variant="secondary">{t('quality.settings.q4.badge')}</Badge>
        <p className="text-sm text-muted-foreground">{t('quality.settings.q4.body')}</p>
      </Question>

      <Question title={t('quality.settings.q5.title')} help={t('quality.settings.q5.help')}>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="quality-sod">{t('quality.settings.q5.label')}</Label>
          <Switch
            id="quality-sod"
            checked={draft.segregation_of_duties}
            onCheckedChange={(checked) => update('segregation_of_duties', checked)}
            disabled={!canManage}
          />
        </div>
      </Question>

      <Question title={t('quality.settings.q6.title')} help={t('quality.settings.q6.help')}>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="quality-admins-subject">{t('quality.settings.q6.label')}</Label>
          <Switch
            id="quality-admins-subject"
            checked={draft.admins_subject_to_quality_controls}
            onCheckedChange={(checked) => update('admins_subject_to_quality_controls', checked)}
            disabled={!canManage}
          />
        </div>
      </Question>

      <p className="text-sm text-muted-foreground">{t('quality.settings.rolesHint')}</p>

      {canManage && (
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={!dirty || savePolicy.isPending}>
            {t('quality.settings.save')}
          </Button>
          <Button
            variant="outline"
            onClick={() => setDraft(toSettings(policy))}
            disabled={!dirty || savePolicy.isPending}
          >
            {t('quality.settings.reset')}
          </Button>
        </div>
      )}
    </div>
  )
}
