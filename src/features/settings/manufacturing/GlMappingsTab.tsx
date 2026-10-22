import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { LoadingSpinner } from '@/components/ui/loading-state'
import {
  MANUFACTURING_GL_EVENTS,
  WORK_CENTER_OVERRIDE_EVENT,
  listActiveWorkCenters,
  listGlEventMappings,
  listPostingAccounts,
  setGlEventMapping,
  type GlEventMappingInput,
  type GlEventMappingRow,
} from '@/services/manufacturing-settings-service'
import { settingsErrorMessage } from './settingsError'
import { GL_MAPPINGS_QUERY_KEY, POSTING_ACCOUNTS_QUERY_KEY, WORK_CENTERS_QUERY_KEY } from './queryKeys'

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'

/** مفتاح صف في الجدول: الحدث + مركز العمل (فارغ للخريطة العامة). */
function rowKey(eventCode: string, workCenterCode: string | null) {
  return `${eventCode}|${workCenterCode ?? ''}`
}

export function GlMappingsTab({ canManage }: { readonly canManage: boolean }) {
  const { t, i18n } = useTranslation()
  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const queryClient = useQueryClient()
  const mappings = useQuery({ queryKey: GL_MAPPINGS_QUERY_KEY, queryFn: listGlEventMappings })
  const accounts = useQuery({ queryKey: POSTING_ACCOUNTS_QUERY_KEY, queryFn: listPostingAccounts, enabled: canManage })
  const workCenters = useQuery({ queryKey: WORK_CENTERS_QUERY_KEY, queryFn: listActiveWorkCenters, enabled: canManage })
  const [editing, setEditing] = useState<GlEventMappingInput | null>(null)

  const save = useMutation({
    mutationFn: (input: GlEventMappingInput) => setGlEventMapping(input),
    onSuccess: () => {
      setEditing(null)
      toast.success(t('manufacturingSettings.saved'))
      void queryClient.invalidateQueries({ queryKey: GL_MAPPINGS_QUERY_KEY })
    },
    onError: (error) => toast.error(settingsErrorMessage(t, error)),
  })

  if (mappings.isLoading) return <LoadingSpinner />
  if (mappings.isError) return <p role="alert">{settingsErrorMessage(t, mappings.error)}</p>

  const byKey = new Map<string, GlEventMappingRow>(
    (mappings.data ?? []).map(row => [rowKey(row.eventCode, row.workCenterCode), row]))
  const overrides = (mappings.data ?? []).filter(row => row.workCenterCode !== null)

  const startEdit = (eventCode: string, row: GlEventMappingRow | undefined, workCenterCode: string | null) =>
    setEditing({
      eventCode,
      workCenterCode,
      debitAccountCode: row?.debitAccountCode ?? '',
      creditAccountCode: row?.creditAccountCode ?? '',
      description: row?.description ?? null,
      isActive: row?.isActive ?? true,
    })

  const accountLabel = (code: string) => {
    const account = accounts.data?.find(a => a.code === code)
    if (!account) return code
    return `${code} — ${isRTL && account.nameAr ? account.nameAr : account.name}`
  }

  const renderRow = (eventCode: string, workCenterCode: string | null, postedBy: string | null) => {
    const row = byKey.get(rowKey(eventCode, workCenterCode))
    return (
      <tr key={rowKey(eventCode, workCenterCode)} className="border-b">
        <td className="p-2 font-mono text-xs">{eventCode}</td>
        <td className="p-2">{workCenterCode ?? t('manufacturingSettings.gl.allWorkCenters')}</td>
        <td className="p-2">
          {row ? accountLabel(row.debitAccountCode) : <Badge variant="destructive">{t('manufacturingSettings.gl.missing')}</Badge>}
        </td>
        <td className="p-2">{row ? accountLabel(row.creditAccountCode) : '—'}</td>
        <td className="p-2">
          {row && !row.isActive ? <Badge variant="secondary">{t('manufacturingSettings.gl.inactive')}</Badge> : null}
        </td>
        <td className="p-2 text-xs text-muted-foreground">
          {postedBy ? t('manufacturingSettings.gl.postedBy', { fn: postedBy }) : t('manufacturingSettings.gl.notPostedYet')}
        </td>
        <td className="p-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage}
            onClick={() => startEdit(eventCode, row, workCenterCode)}
            aria-label={t('manufacturingSettings.gl.editAria', { event: eventCode, wc: workCenterCode ?? '' })}
          >
            {t('manufacturingSettings.gl.edit')}
          </Button>
        </td>
      </tr>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('manufacturingSettings.gl.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('manufacturingSettings.gl.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="p-2 text-start">{t('manufacturingSettings.gl.event')}</th>
                <th className="p-2 text-start">{t('manufacturingSettings.gl.workCenter')}</th>
                <th className="p-2 text-start">{t('manufacturingSettings.gl.debit')}</th>
                <th className="p-2 text-start">{t('manufacturingSettings.gl.credit')}</th>
                <th className="p-2 text-start">{t('manufacturingSettings.gl.status')}</th>
                <th className="p-2 text-start">{t('manufacturingSettings.gl.usage')}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {MANUFACTURING_GL_EVENTS.map(event => renderRow(event.code, null, event.postedBy))}
              {overrides.map(row =>
                renderRow(row.eventCode, row.workCenterCode,
                  MANUFACTURING_GL_EVENTS.find(e => e.code === row.eventCode)?.postedBy ?? null))}
            </tbody>
          </table>
        </div>

        {canManage && (
          <Button variant="outline" onClick={() => startEdit(WORK_CENTER_OVERRIDE_EVENT, undefined, '')}>
            {t('manufacturingSettings.gl.addOverride')}
          </Button>
        )}

        {editing && (
          <form
            className="space-y-3 rounded-md border p-4"
            aria-label={t('manufacturingSettings.gl.formAria')}
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate({ ...editing, workCenterCode: editing.workCenterCode || null })
            }}
          >
            <p className="font-medium">
              {editing.eventCode}
              {editing.workCenterCode !== null && ` · ${t('manufacturingSettings.gl.workCenterOverride')}`}
            </p>
            {editing.workCenterCode !== null && (
              <div className="space-y-1">
                <Label htmlFor="gl-wc">{t('manufacturingSettings.gl.workCenter')}</Label>
                <select
                  id="gl-wc"
                  className={SELECT_CLASS}
                  value={editing.workCenterCode}
                  onChange={(e) => setEditing({ ...editing, workCenterCode: e.target.value })}
                  required
                >
                  <option value="">{t('manufacturingSettings.gl.choose')}</option>
                  {(workCenters.data ?? []).map(wc => (
                    <option key={wc.code} value={wc.code}>
                      {wc.code} — {isRTL && wc.nameAr ? wc.nameAr : wc.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(['debitAccountCode', 'creditAccountCode'] as const).map(field => (
              <div key={field} className="space-y-1">
                <Label htmlFor={`gl-${field}`}>
                  {t(field === 'debitAccountCode' ? 'manufacturingSettings.gl.debit' : 'manufacturingSettings.gl.credit')}
                </Label>
                <select
                  id={`gl-${field}`}
                  className={SELECT_CLASS}
                  value={editing[field]}
                  onChange={(e) => setEditing({ ...editing, [field]: e.target.value })}
                  required
                >
                  <option value="">{t('manufacturingSettings.gl.choose')}</option>
                  {(accounts.data ?? []).map(account => (
                    <option key={account.code} value={account.code}>{accountLabel(account.code)}</option>
                  ))}
                </select>
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="gl-description">{t('manufacturingSettings.gl.descriptionField')}</Label>
              <Input
                id="gl-description"
                value={editing.description ?? ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value || null })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="gl-active"
                checked={editing.isActive}
                onCheckedChange={(checked) => setEditing({ ...editing, isActive: checked })}
              />
              <Label htmlFor="gl-active">{t('manufacturingSettings.gl.active')}</Label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>{t('manufacturingSettings.save')}</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {t('manufacturingSettings.cancel')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
