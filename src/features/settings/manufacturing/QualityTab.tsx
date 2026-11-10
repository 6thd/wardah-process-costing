import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { LoadingSpinner } from '@/components/ui/loading-state'
import {
  INSPECTION_SCOPES,
  RELEASE_GATE_MODES,
  getQualityPolicy,
  setQualityPolicy,
  manufacturingSettingsErrorKey,
  type QualityPolicyValues,
} from '@/services/manufacturing-settings-service'
import { QUALITY_POLICY_QUERY_KEY } from './queryKeys'
import { settingsErrorMessage } from './settingsError'

const BOOLEAN_FIELDS = [
  'allow_conditional_release',
  'segregation_of_duties',
  'admins_subject_to_quality_controls',
] as const

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'

export function QualityTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const policy = useQuery({ queryKey: QUALITY_POLICY_QUERY_KEY, queryFn: getQualityPolicy })
  const [values, setValues] = useState<QualityPolicyValues | null>(null)

  useEffect(() => {
    if (policy.data) {
      const { version: _version, canManage: _canManage, ...rest } = policy.data
      setValues(rest)
    }
  }, [policy.data])

  const save = useMutation({
    mutationFn: (next: QualityPolicyValues) => setQualityPolicy(next, policy.data?.version ?? -1),
    onSuccess: (data) => {
      queryClient.setQueryData(QUALITY_POLICY_QUERY_KEY, data)
      toast.success(t('manufacturingSettings.saved'))
    },
    onError: (error) => {
      toast.error(settingsErrorMessage(t, error))
      // Another session saved first: reload so the next attempt starts from it.
      if (manufacturingSettingsErrorKey(error instanceof Error ? error.message : '') ===
          'manufacturingSettings.errors.versionConflict') {
        void queryClient.invalidateQueries({ queryKey: QUALITY_POLICY_QUERY_KEY })
      }
    },
  })

  if (policy.isLoading || (policy.isSuccess && !values)) return <LoadingSpinner />
  if (policy.isError || !values || !policy.data) {
    return <p role="alert">{settingsErrorMessage(t, policy.error)}</p>
  }

  const canManage = policy.data.canManage
  const disabled = !canManage || save.isPending
  const dirty =
    values.release_gate_mode !== policy.data.release_gate_mode ||
    values.inspection_scope !== policy.data.inspection_scope ||
    BOOLEAN_FIELDS.some(field => values[field] !== policy.data[field])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('manufacturingSettings.quality.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('manufacturingSettings.quality.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="quality-release-gate">{t('manufacturingSettings.quality.release_gate_mode')}</Label>
          <select
            id="quality-release-gate"
            className={SELECT_CLASS}
            value={values.release_gate_mode}
            disabled={disabled}
            onChange={(e) => setValues({ ...values, release_gate_mode: e.target.value as QualityPolicyValues['release_gate_mode'] })}
          >
            {RELEASE_GATE_MODES.map(mode => (
              <option key={mode} value={mode}>{t(`manufacturingSettings.quality.releaseGate.${mode}`)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quality-scope">{t('manufacturingSettings.quality.inspection_scope')}</Label>
          <select
            id="quality-scope"
            className={SELECT_CLASS}
            value={values.inspection_scope}
            disabled={disabled}
            onChange={(e) => setValues({ ...values, inspection_scope: e.target.value as QualityPolicyValues['inspection_scope'] })}
          >
            {INSPECTION_SCOPES.map(scope => (
              <option key={scope} value={scope}>{t(`manufacturingSettings.quality.scope.${scope}`)}</option>
            ))}
          </select>
        </div>
        {BOOLEAN_FIELDS.map(field => (
          <div key={field} className="flex items-center justify-between gap-4">
            <Label htmlFor={`quality-${field}`}>{t(`manufacturingSettings.quality.${field}`)}</Label>
            <Switch
              id={`quality-${field}`}
              checked={values[field]}
              disabled={disabled}
              onCheckedChange={(checked) => setValues({ ...values, [field]: checked })}
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          {t('manufacturingSettings.version', { version: policy.data.version })}
        </p>
        <Button onClick={() => save.mutate(values)} disabled={disabled || !dirty}>
          {t('manufacturingSettings.save')}
        </Button>
      </CardContent>
    </Card>
  )
}
