import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRecordQualityInspection } from '@/hooks/manufacturing/useQuality'
import type {
  Disposition,
  InspectionResult,
  InspectionType,
} from '@/services/manufacturing/qualityService'
import { qualityErrorMessage } from './qualityErrors'

export interface InspectionStageOption {
  id: string
  label: string
}

export interface InspectionDialogOrder {
  id: string
  order_number: string
  status: string
}

interface InspectionDialogProps {
  order: InspectionDialogOrder | null
  stages: readonly InspectionStageOption[]
  allowConditional: boolean
  onClose: () => void
}

const RESULTS: readonly InspectionResult[] = ['PASS', 'FAIL', 'CONDITIONAL']

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

export function InspectionDialog({ order, stages, allowConditional, onClose }: InspectionDialogProps) {
  const { t } = useTranslation()
  const record = useRecordQualityInspection()
  // One request id per opened form: a retry after a timeout replays the same
  // inspection instead of writing a second one.
  const [requestId, setRequestId] = useState(newRequestId)
  const [type, setType] = useState<InspectionType>('FINAL')
  const [stageId, setStageId] = useState('')
  const [result, setResult] = useState<InspectionResult>('PASS')
  const [passed, setPassed] = useState('')
  const [failed, setFailed] = useState('0')
  const [sample, setSample] = useState('')
  const [disposition, setDisposition] = useState<Disposition | ''>('')
  const [findings, setFindings] = useState('')
  const [corrective, setCorrective] = useState('')
  const [specifications, setSpecifications] = useState('')

  useEffect(() => {
    if (!order) return
    setRequestId(newRequestId())
    setType(order.status === 'quality_check' ? 'FINAL' : 'IN_PROCESS')
    setStageId('')
    setResult('PASS')
    setPassed('')
    setFailed('0')
    setSample('')
    setDisposition('')
    setFindings('')
    setCorrective('')
    setSpecifications('')
  }, [order])

  const failedQty = Number(failed) || 0
  const dispositions: Disposition[] = result === 'CONDITIONAL' ? ['use_as_is'] : ['scrap', 'rework']
  const finalBlocked = type === 'FINAL' && order?.status !== 'quality_check'

  const submit = () => {
    if (!order) return
    record.mutate(
      {
        moId: order.id,
        requestId,
        input: {
          inspection_type: type,
          result,
          passed_quantity: Number(passed) || 0,
          failed_quantity: failedQty,
          sample_size: sample === '' ? null : Number(sample),
          stage_id: type === 'IN_PROCESS' ? stageId || null : null,
          disposition: disposition || null,
          findings,
          corrective_action: corrective,
          specifications,
        },
      },
      {
        onSuccess: (data) => {
          toast.success(t(data.replayed ? 'quality.page.inspectReplayed' : 'quality.page.inspectSuccess',
            { number: data.inspection_number }))
          onClose()
        },
        onError: (error) => toast.error(qualityErrorMessage(t, error)),
      }
    )
  }

  return (
    <Dialog open={order !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('quality.form.title', { order: order?.order_number ?? '' })}</DialogTitle>
          <DialogDescription>{t('quality.form.immutableHint')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>{t('quality.form.type')}</Label>
            <Select value={type} onValueChange={(value) => setType(value as InspectionType)}>
              <SelectTrigger aria-label={t('quality.form.type')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="IN_PROCESS">{t('quality.type.IN_PROCESS')}</SelectItem>
                <SelectItem value="FINAL">{t('quality.type.FINAL')}</SelectItem>
              </SelectContent>
            </Select>
            {finalBlocked && (
              <p className="text-xs text-destructive">{t('quality.form.finalNeedsQualityCheck')}</p>
            )}
          </div>

          {type === 'IN_PROCESS' && (
            <div className="grid gap-1">
              <Label>{t('quality.form.stage')}</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger aria-label={t('quality.form.stage')}>
                  <SelectValue placeholder={t('quality.form.stagePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-1">
            <Label>{t('quality.form.result')}</Label>
            <Select value={result} onValueChange={(value) => {
              setResult(value as InspectionResult)
              setDisposition('')
            }}>
              <SelectTrigger aria-label={t('quality.form.result')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESULTS.filter((r) => r !== 'CONDITIONAL' || allowConditional).map((r) => (
                  <SelectItem key={r} value={r}>{t(`quality.result.${r}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!allowConditional && (
              <p className="text-xs text-muted-foreground">{t('quality.form.conditionalHint')}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="qi-passed">{t('quality.form.passed')}</Label>
              <Input id="qi-passed" type="number" min={0} value={passed} onChange={(e) => setPassed(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="qi-failed">{t('quality.form.failed')}</Label>
              <Input id="qi-failed" type="number" min={0} value={failed} onChange={(e) => setFailed(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="qi-sample">{t('quality.form.sample')}</Label>
              <Input id="qi-sample" type="number" min={0} value={sample} onChange={(e) => setSample(e.target.value)} />
            </div>
          </div>

          {failedQty > 0 && (
            <div className="grid gap-1">
              <Label>{t('quality.form.disposition')}</Label>
              <Select value={disposition} onValueChange={(value) => setDisposition(value as Disposition)}>
                <SelectTrigger aria-label={t('quality.form.disposition')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dispositions.map((d) => (
                    <SelectItem key={d} value={d}>{t(`quality.disposition.${d}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-1">
            <Label htmlFor="qi-findings">{t('quality.form.findings')}</Label>
            <Textarea id="qi-findings" rows={2} value={findings} onChange={(e) => setFindings(e.target.value)} />
          </div>
          {result !== 'PASS' && (
            <div className="grid gap-1">
              <Label htmlFor="qi-corrective">{t('quality.form.corrective')}</Label>
              <Textarea id="qi-corrective" rows={2} value={corrective} onChange={(e) => setCorrective(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1">
            <Label htmlFor="qi-specs">{t('quality.form.specifications')}</Label>
            <Input id="qi-specs" value={specifications} onChange={(e) => setSpecifications(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={record.isPending}>
            {t('quality.form.cancel')}
          </Button>
          <Button onClick={submit} disabled={record.isPending || finalBlocked}>
            {t('quality.form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
