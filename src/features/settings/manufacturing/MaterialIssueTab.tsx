import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading-state'
import {
  MATERIAL_ISSUE_OPTIONAL_STATUSES,
  MATERIAL_ISSUE_REQUIRED_STATUS,
  getMaterialIssueStatuses,
  setMaterialIssueStatuses,
  type MaterialIssueOptionalStatus,
} from '@/services/manufacturing-settings-service'
import { settingsErrorMessage } from './settingsError'
import { MATERIAL_ISSUE_QUERY_KEY as QUERY_KEY } from './queryKeys'

export function MaterialIssueTab({ canManage }: { readonly canManage: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const policy = useQuery({ queryKey: QUERY_KEY, queryFn: getMaterialIssueStatuses })
  const [selected, setSelected] = useState<MaterialIssueOptionalStatus[]>([])

  useEffect(() => {
    if (policy.data) {
      setSelected(MATERIAL_ISSUE_OPTIONAL_STATUSES.filter(s => policy.data.allowedStatuses.includes(s)))
    }
  }, [policy.data])

  const save = useMutation({
    mutationFn: () => setMaterialIssueStatuses(selected),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data)
      toast.success(t('manufacturingSettings.saved'))
    },
    onError: (error) => toast.error(settingsErrorMessage(t, error)),
  })

  if (policy.isLoading) return <LoadingSpinner />
  if (policy.isError) return <p role="alert">{settingsErrorMessage(t, policy.error)}</p>

  const saved = MATERIAL_ISSUE_OPTIONAL_STATUSES.filter(s => policy.data?.allowedStatuses.includes(s))
  const dirty = saved.length !== selected.length || saved.some(s => !selected.includes(s))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('manufacturingSettings.materialIssue.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('manufacturingSettings.materialIssue.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Checkbox id="mi-in-progress" checked disabled />
          <Label htmlFor="mi-in-progress">
            {t(`manufacturingSettings.materialIssue.status.${MATERIAL_ISSUE_REQUIRED_STATUS}`)}
            {' — '}
            {t('manufacturingSettings.materialIssue.required')}
          </Label>
        </div>
        {MATERIAL_ISSUE_OPTIONAL_STATUSES.map(status => (
          <div key={status} className="flex items-center gap-2">
            <Checkbox
              id={`mi-${status}`}
              checked={selected.includes(status)}
              disabled={!canManage || save.isPending}
              onCheckedChange={(checked) =>
                setSelected(prev => checked === true ? [...prev, status] : prev.filter(s => s !== status))}
            />
            <Label htmlFor={`mi-${status}`}>{t(`manufacturingSettings.materialIssue.status.${status}`)}</Label>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          {t('manufacturingSettings.version', { version: policy.data?.version })}
        </p>
        <Button onClick={() => save.mutate()} disabled={!canManage || !dirty || save.isPending}>
          {t('manufacturingSettings.save')}
        </Button>
      </CardContent>
    </Card>
  )
}
