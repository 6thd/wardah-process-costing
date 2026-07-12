/**
 * نموذج إنشاء/تعديل سجل WIP لمرحلة تصنيع — يحفظ عبر stageWipLogService القائمة
 * ويحسب المشتقات (الوحدات المكافئة، الإجمالي، تكلفة الوحدة) آلياً قبل الحفظ.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { stageWipLogService } from '@/services/supabase-service'

export interface WipLogFormValues {
  mo_id: string
  stage_id: string
  period_start: string
  period_end: string
  units_beginning_wip: number
  units_started: number
  units_completed: number
  units_ending_wip: number
  material_completion_pct: number
  conversion_completion_pct: number
  cost_beginning_wip: number
  cost_material: number
  cost_labor: number
  cost_overhead: number
  notes: string
}

export interface WipDerived {
  cost_total: number
  equivalent_units_material: number
  equivalent_units_conversion: number
  cost_per_eu_material: number | null
  cost_per_eu_conversion: number | null
}

/** مشتقات WIP (متوسط مرجّح): EU = مكتمل + نهاية×نسبة الإكمال؛ تكلفة الوحدة = التكلفة/EU. */
export function computeWipDerived(v: WipLogFormValues): WipDerived {
  const euMaterial = (v.units_completed || 0) +
    (v.units_ending_wip || 0) * ((v.material_completion_pct || 0) / 100)
  const euConversion = (v.units_completed || 0) +
    (v.units_ending_wip || 0) * ((v.conversion_completion_pct || 0) / 100)
  const costTotal = (v.cost_beginning_wip || 0) + (v.cost_material || 0) +
    (v.cost_labor || 0) + (v.cost_overhead || 0)
  const conversionCost = (v.cost_labor || 0) + (v.cost_overhead || 0)
  return {
    cost_total: costTotal,
    equivalent_units_material: euMaterial,
    equivalent_units_conversion: euConversion,
    cost_per_eu_material: euMaterial > 0
      ? ((v.cost_beginning_wip || 0) + (v.cost_material || 0)) / euMaterial : null,
    cost_per_eu_conversion: euConversion > 0 ? conversionCost / euConversion : null,
  }
}

const EMPTY: WipLogFormValues = {
  mo_id: '', stage_id: '',
  period_start: new Date().toISOString().split('T')[0],
  period_end: new Date().toISOString().split('T')[0],
  units_beginning_wip: 0, units_started: 0, units_completed: 0, units_ending_wip: 0,
  material_completion_pct: 100, conversion_completion_pct: 50,
  cost_beginning_wip: 0, cost_material: 0, cost_labor: 0, cost_overhead: 0,
  notes: '',
}

interface Option { id: string; label: string }

interface WipLogFormDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly editing?: (Partial<WipLogFormValues> & { id: string }) | null
  readonly manufacturingOrders: Option[]
  readonly stages: Option[]
}

export function WipLogFormDialog({
  open, onOpenChange, editing, manufacturingOrders, stages,
}: WipLogFormDialogProps) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<WipLogFormValues>(EMPTY)

  useEffect(() => {
    if (open) {
      setValues(editing ? { ...EMPTY, ...editing } : EMPTY)
    }
  }, [open, editing])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!values.mo_id || !values.stage_id) {
        throw new Error('اختر أمر التصنيع والمرحلة')
      }
      if (!values.period_start || !values.period_end) {
        throw new Error('حدّد فترة السجل')
      }
      if (values.period_end < values.period_start) {
        throw new Error('نهاية الفترة قبل بدايتها')
      }
      const derived = computeWipDerived(values)
      const payload = { ...values, ...derived }
      if (editing?.id) {
        return stageWipLogService.update(editing.id, payload)
      }
      return stageWipLogService.create(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stage-wip-log'] })
      toast.success(editing ? 'تم تحديث سجل WIP' : 'تم إنشاء سجل WIP')
      onOpenChange(false)
    },
    onError: (error: unknown) => {
      const err = error as { message?: string }
      toast.error(err.message || 'خطأ في حفظ السجل')
    },
  })

  const setNum = (field: keyof WipLogFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setValues((prev) => ({ ...prev, [field]: Number.parseFloat(e.target.value) || 0 }))

  const derived = computeWipDerived(values)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">
            {editing ? 'تعديل سجل WIP' : 'سجل WIP جديد'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="wip-mo">أمر التصنيع *</Label>
            <Select value={values.mo_id} onValueChange={(v) => setValues((p) => ({ ...p, mo_id: v }))}>
              <SelectTrigger id="wip-mo"><SelectValue placeholder="اختر أمر التصنيع" /></SelectTrigger>
              <SelectContent>
                {manufacturingOrders.map((mo) => (
                  <SelectItem key={mo.id} value={mo.id}>{mo.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="wip-stage">المرحلة *</Label>
            <Select value={values.stage_id} onValueChange={(v) => setValues((p) => ({ ...p, stage_id: v }))}>
              <SelectTrigger id="wip-stage"><SelectValue placeholder="اختر المرحلة" /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="wip-start">بداية الفترة *</Label>
            <Input id="wip-start" type="date" value={values.period_start}
              onChange={(e) => setValues((p) => ({ ...p, period_start: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="wip-end">نهاية الفترة *</Label>
            <Input id="wip-end" type="date" value={values.period_end}
              onChange={(e) => setValues((p) => ({ ...p, period_end: e.target.value }))} />
          </div>

          <div>
            <Label htmlFor="wip-u-beg">وحدات بداية WIP</Label>
            <Input id="wip-u-beg" type="number" min="0" value={values.units_beginning_wip} onChange={setNum('units_beginning_wip')} />
          </div>
          <div>
            <Label htmlFor="wip-u-started">وحدات بدأت</Label>
            <Input id="wip-u-started" type="number" min="0" value={values.units_started} onChange={setNum('units_started')} />
          </div>
          <div>
            <Label htmlFor="wip-u-completed">وحدات مكتملة</Label>
            <Input id="wip-u-completed" type="number" min="0" value={values.units_completed} onChange={setNum('units_completed')} />
          </div>
          <div>
            <Label htmlFor="wip-u-end">وحدات نهاية WIP</Label>
            <Input id="wip-u-end" type="number" min="0" value={values.units_ending_wip} onChange={setNum('units_ending_wip')} />
          </div>

          <div>
            <Label htmlFor="wip-pct-mat">نسبة إكمال المواد %</Label>
            <Input id="wip-pct-mat" type="number" min="0" max="100" value={values.material_completion_pct} onChange={setNum('material_completion_pct')} />
          </div>
          <div>
            <Label htmlFor="wip-pct-conv">نسبة إكمال التحويل %</Label>
            <Input id="wip-pct-conv" type="number" min="0" max="100" value={values.conversion_completion_pct} onChange={setNum('conversion_completion_pct')} />
          </div>

          <div>
            <Label htmlFor="wip-c-beg">تكلفة بداية WIP</Label>
            <Input id="wip-c-beg" type="number" min="0" step="0.01" value={values.cost_beginning_wip} onChange={setNum('cost_beginning_wip')} />
          </div>
          <div>
            <Label htmlFor="wip-c-mat">تكلفة المواد</Label>
            <Input id="wip-c-mat" type="number" min="0" step="0.01" value={values.cost_material} onChange={setNum('cost_material')} />
          </div>
          <div>
            <Label htmlFor="wip-c-labor">تكلفة العمل</Label>
            <Input id="wip-c-labor" type="number" min="0" step="0.01" value={values.cost_labor} onChange={setNum('cost_labor')} />
          </div>
          <div>
            <Label htmlFor="wip-c-oh">الأوفرهيد</Label>
            <Input id="wip-c-oh" type="number" min="0" step="0.01" value={values.cost_overhead} onChange={setNum('cost_overhead')} />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="wip-notes">ملاحظات</Label>
            <Input id="wip-notes" value={values.notes}
              onChange={(e) => setValues((p) => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>

        {/* معاينة المشتقات المحسوبة آلياً */}
        <div className="bg-muted/50 rounded-lg p-3 text-sm text-right space-y-1">
          <div>الإجمالي: <span className="font-medium">{derived.cost_total.toFixed(2)}</span></div>
          <div>
            EU مواد: <span className="font-medium">{derived.equivalent_units_material.toFixed(2)}</span>
            {' · '}EU تحويل: <span className="font-medium">{derived.equivalent_units_conversion.toFixed(2)}</span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'جارٍ الحفظ…' : (editing ? 'تحديث' : 'حفظ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
