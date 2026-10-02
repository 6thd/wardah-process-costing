import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LoadingSpinner } from '@/components/ui/loading-state'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import {
  useMoQualityStatus,
  useQualityInspections,
  useQualityPolicy,
  useSetMoQualityHold,
} from '@/hooks/manufacturing/useQuality'
import { InspectionDialog, type InspectionStageOption } from './InspectionDialog'
import { qualityErrorMessage } from './qualityErrors'

export interface QualityQueueOrder {
  id: string
  order_number: string
  status: string
  quantity: number | null
  maintenance_version: number
}

const QUEUE_STATUSES = ['in_progress', 'quality_check'] as const

function useQualityQueue(enabled: boolean) {
  const { currentOrgId } = useAuth()
  return useQuery({
    queryKey: ['manufacturing-quality-queue', currentOrgId],
    enabled: enabled && Boolean(currentOrgId),
    queryFn: async (): Promise<QualityQueueOrder[]> => {
      const { data, error } = await supabase
        .from('manufacturing_orders')
        .select('id, order_number, status, quantity, maintenance_version')
        .eq('org_id', currentOrgId as string)
        .in('status', [...QUEUE_STATUSES])
        .order('order_number')
        .limit(100)
      if (error) throw error
      return (data ?? []) as QualityQueueOrder[]
    },
  })
}

function useInspectionStages(enabled: boolean, isArabic: boolean) {
  const { currentOrgId } = useAuth()
  return useQuery({
    queryKey: ['manufacturing-quality-stages', currentOrgId],
    enabled: enabled && Boolean(currentOrgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manufacturing_stages')
        .select('id, code, name, name_ar')
        .eq('org_id', currentOrgId as string)
        .eq('is_active', true)
        .order('order_sequence')
      if (error) throw error
      return data ?? []
    },
    select: (rows): InspectionStageOption[] => rows.map((row) => ({
      id: row.id,
      label: `${row.code} — ${(isArabic && row.name_ar) || row.name}`,
    })),
  })
}

function ReleaseBadge({ moId }: { moId: string }) {
  const { t } = useTranslation()
  const status = useMoQualityStatus(moId)
  if (status.isLoading) return <span className="text-muted-foreground">{t('quality.page.release.loading')}</span>
  if (status.isError || !status.data) return <span className="text-destructive">{qualityErrorMessage(t, status.error)}</span>
  const release = status.data.release
  if (!release.required) return <Badge variant="outline">{t('quality.page.release.notRequired')}</Badge>
  if (release.ready) {
    return <Badge variant="success">{t('quality.page.release.ready', { qty: release.released_quantity })}</Badge>
  }
  return (
    <Badge variant="warning" title={release.reason ? t(`quality.errors.${release.reason}`) : undefined}>
      {t('quality.page.release.blocked')}
    </Badge>
  )
}

export function QualityControlPage() {
  const { t, i18n } = useTranslation()
  const isArabic = (i18n.resolvedLanguage ?? i18n.language ?? '').toLowerCase().startsWith('ar')
  const { hasPermissionKey } = usePermissions()
  const policyQuery = useQualityPolicy()
  const capabilities = policyQuery.data?.capabilities
  const canRead = Boolean(capabilities?.can_read)
  const canInspect = Boolean(capabilities?.can_inspect)
  const queue = useQualityQueue(canRead)
  const stages = useInspectionStages(canInspect && hasPermissionKey('manufacturing.stages.read'), isArabic)
  const inspections = useQualityInspections(null, { enabled: canRead })
  const hold = useSetMoQualityHold()
  const [inspecting, setInspecting] = useState<QualityQueueOrder | null>(null)
  const [returning, setReturning] = useState<QualityQueueOrder | null>(null)
  const [returnReason, setReturnReason] = useState('')

  const header = (
    <PageHeader
      title={t('quality.page.title')}
      description={t('quality.page.subtitle')}
      hideOnPrint={false}
      actions={(
        <Button variant="outline" asChild>
          <Link to="/settings/quality">{t('quality.page.settingsLink')}</Link>
        </Button>
      )}
    />
  )

  if (policyQuery.isLoading) return <LoadingSpinner />
  if (policyQuery.isError || !policyQuery.data) {
    return (
      <div className="space-y-6">
        {header}
        <Card><CardContent className="py-6 text-sm text-destructive">{qualityErrorMessage(t, policyQuery.error)}</CardContent></Card>
      </div>
    )
  }
  if (!canRead) {
    return (
      <div className="space-y-6">
        {header}
        <Card><CardContent className="py-6 text-sm">{t('quality.page.noReadPermission')}</CardContent></Card>
      </div>
    )
  }

  const policy = policyQuery.data
  const runHold = (order: QualityQueueOrder) => {
    hold.mutate(
      { moId: order.id, action: 'hold', expectedVersion: order.maintenance_version },
      {
        onSuccess: () => toast.success(t('quality.page.holdSuccess')),
        onError: (error) => toast.error(qualityErrorMessage(t, error)),
      }
    )
  }
  const runReturn = () => {
    if (!returning) return
    hold.mutate(
      { moId: returning.id, action: 'return', expectedVersion: returning.maintenance_version, reason: returnReason },
      {
        onSuccess: () => {
          toast.success(t('quality.page.returnSuccess'))
          setReturning(null)
          setReturnReason('')
        },
        onError: (error) => toast.error(qualityErrorMessage(t, error)),
      }
    )
  }

  return (
    <div className="space-y-6">
      {header}

      <Card>
        <CardContent className="py-4 text-sm">
          {policy.release_gate_mode === 'off' ? t('quality.page.gateOff') : t('quality.page.gateOn')}
          {!canInspect && <p className="mt-2 text-muted-foreground">{t('quality.page.noInspectPermission')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('quality.page.queueTitle')}</CardTitle></CardHeader>
        <CardContent>
          {queue.isLoading && <LoadingSpinner />}
          {queue.isError && <p className="text-sm text-destructive">{t('quality.page.loadError')}</p>}
          {queue.data && queue.data.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('quality.page.queueEmpty')}</p>
          )}
          {queue.data && queue.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('quality.page.columns.order')}</TableHead>
                  <TableHead>{t('quality.page.columns.status')}</TableHead>
                  <TableHead>{t('quality.page.columns.quantity')}</TableHead>
                  <TableHead>{t('quality.page.columns.release')}</TableHead>
                  <TableHead>{t('quality.page.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.data.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.order_number}</TableCell>
                    <TableCell>{t(`quality.status.${order.status}`)}</TableCell>
                    <TableCell>{order.quantity ?? '—'}</TableCell>
                    <TableCell><ReleaseBadge moId={order.id} /></TableCell>
                    <TableCell>
                      {canInspect && (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => setInspecting(order)}>
                            {t('quality.page.actions.inspect')}
                          </Button>
                          {order.status === 'in_progress' && (
                            <Button size="sm" variant="outline" disabled={hold.isPending} onClick={() => runHold(order)}>
                              {t('quality.page.actions.hold')}
                            </Button>
                          )}
                          {order.status === 'quality_check' && (
                            <Button size="sm" variant="outline" disabled={hold.isPending} onClick={() => setReturning(order)}>
                              {t('quality.page.actions.return')}
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('quality.page.logTitle')}</CardTitle></CardHeader>
        <CardContent>
          {inspections.isLoading && <LoadingSpinner />}
          {inspections.isError && <p className="text-sm text-destructive">{qualityErrorMessage(t, inspections.error)}</p>}
          {inspections.data && inspections.data.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('quality.page.logEmpty')}</p>
          )}
          {inspections.data && inspections.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('quality.page.columns.number')}</TableHead>
                  <TableHead>{t('quality.page.columns.order')}</TableHead>
                  <TableHead>{t('quality.page.columns.type')}</TableHead>
                  <TableHead>{t('quality.page.columns.stage')}</TableHead>
                  <TableHead>{t('quality.page.columns.result')}</TableHead>
                  <TableHead>{t('quality.page.columns.passed')}</TableHead>
                  <TableHead>{t('quality.page.columns.failed')}</TableHead>
                  <TableHead>{t('quality.page.columns.disposition')}</TableHead>
                  <TableHead>{t('quality.page.columns.cycle')}</TableHead>
                  <TableHead>{t('quality.page.columns.inspector')}</TableHead>
                  <TableHead>{t('quality.page.columns.date')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspections.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.inspection_number}</TableCell>
                    <TableCell>{row.order_number ?? '—'}</TableCell>
                    <TableCell>{t(`quality.type.${row.inspection_type}`, { defaultValue: row.inspection_type })}</TableCell>
                    <TableCell>{(isArabic && row.stage_name_ar) || row.stage_name || '—'}</TableCell>
                    <TableCell>
                      {row.result ? (
                        <Badge variant={row.result === 'PASS' ? 'success' : row.result === 'FAIL' ? 'destructive' : 'warning'}>
                          {t(`quality.result.${row.result}`)}
                        </Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{row.passed_quantity ?? '—'}</TableCell>
                    <TableCell>{row.failed_quantity ?? '—'}</TableCell>
                    <TableCell>{row.disposition ? t(`quality.disposition.${row.disposition}`) : '—'}</TableCell>
                    <TableCell>{row.qc_cycle ?? '—'}</TableCell>
                    <TableCell>{row.inspector_name ?? '—'}</TableCell>
                    <TableCell>{new Date(row.inspection_date).toLocaleString(i18n.language)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <InspectionDialog
        order={inspecting}
        stages={stages.data ?? []}
        allowConditional={policy.allow_conditional_release && Boolean(capabilities?.can_approve_conditional)}
        onClose={() => setInspecting(null)}
      />

      <Dialog open={returning !== null} onOpenChange={(open) => { if (!open) setReturning(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('quality.page.returnTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="quality-return-reason">{t('quality.page.returnReason')}</Label>
            <Textarea
              id="quality-return-reason"
              rows={3}
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)}>{t('quality.form.cancel')}</Button>
            <Button onClick={runReturn} disabled={hold.isPending || returnReason.trim() === ''}>
              {t('quality.page.returnConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
