/**
 * تقرير تكلفة الإنتاج بالوحدات المكافئة — Cost of Production Report
 * الشكل المحاسبي القياسي بخطواته الخمس + تسوية + طباعة
 * يتطلب Migration 80 (rpc_cost_of_production_report) — يظهر إرشاد واضح إن لم تُطبَّق
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Printer, RefreshCw, CheckCircle2, AlertTriangle, FileBarChart } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { ReportSkeleton } from '@/components/ui/loading-state'
import { useManufacturingOrders } from './hooks/useManufacturingOrders'
import {
  CostOfProductionService,
  type CostOfProductionReport as CPReport,
  type StageReport
} from '@/services/manufacturing/cost-of-production-service'

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

function money(v: number): string { return nf.format(v ?? 0) }
function qty(v: number): string { return qf.format(v ?? 0) }

function BalanceBadge({ balanced, isRTL }: { readonly balanced: boolean; readonly isRTL: boolean }) {
  return balanced ? (
    <Badge variant="default" className="bg-green-600 hover:bg-green-600 gap-1">
      <CheckCircle2 className="h-3 w-3" />
      {isRTL ? 'متوازن' : 'Balanced'}
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="h-3 w-3" />
      {isRTL ? 'غير متوازن' : 'Unbalanced'}
    </Badge>
  )
}

function StageSection({ stage, isRTL }: { readonly stage: StageReport; readonly isRTL: boolean }) {
  const qs = stage.quantity_schedule
  const eu = stage.equivalent_units
  const ca = stage.costs_to_account
  const pe = stage.cost_per_eu
  const asg = stage.cost_assignment
  const rec = stage.reconciliation
  const methodLabel = stage.costing_method === 'fifo'
    ? (isRTL ? 'الوارد أولاً صادر أولاً (FIFO)' : 'FIFO')
    : (isRTL ? 'المتوسط المرجّح' : 'Weighted Average')

  return (
    <Card className="print:shadow-none print:border-black break-inside-avoid">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">
            {isRTL ? `المرحلة ${stage.stage_no}` : `Stage ${stage.stage_no}`}
            <span className="text-sm font-normal text-muted-foreground mx-2">({methodLabel})</span>
          </CardTitle>
          <BalanceBadge balanced={rec.is_balanced && qs.is_balanced} isRTL={isRTL} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* ===== الخطوة 1: جدول الكميات ===== */}
        <section>
          <h4 className="font-semibold mb-2 text-sm">
            {isRTL ? '١) جدول الكميات' : '1) Quantity Schedule'}
          </h4>
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell>{isRTL ? 'وحدات تحت التشغيل أول المدة' : 'Beginning WIP'}</TableCell>
                  <TableCell className="text-end font-mono">{qty(qs.wip_beginning_qty)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'وحدات بدأ تشغيلها' : 'Units started'}</TableCell>
                  <TableCell className="text-end font-mono">{qty(qs.units_started)}</TableCell>
                </TableRow>
                <TableRow className="border-t-2 font-semibold bg-muted/50">
                  <TableCell>{isRTL ? 'الوحدات الواجب حسابها' : 'Units to account for'}</TableCell>
                  <TableCell className="text-end font-mono">{qty(qs.units_to_account)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'وحدات مكتملة ومحوَّلة' : 'Completed & transferred'}</TableCell>
                  <TableCell className="text-end font-mono">{qty(qs.units_completed)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'وحدات تحت التشغيل آخر المدة' : 'Ending WIP'}</TableCell>
                  <TableCell className="text-end font-mono">{qty(qs.wip_ending_qty)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'تالف طبيعي' : 'Normal scrap'}</TableCell>
                  <TableCell className="text-end font-mono">{qty(qs.normal_scrap_qty)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'تالف غير طبيعي' : 'Abnormal scrap'}</TableCell>
                  <TableCell className="text-end font-mono">{qty(qs.abnormal_scrap_qty)}</TableCell>
                </TableRow>
                {qs.rework_qty > 0 && (
                  <TableRow>
                    <TableCell>{isRTL ? 'إعادة تشغيل' : 'Rework'}</TableCell>
                    <TableCell className="text-end font-mono">{qty(qs.rework_qty)}</TableCell>
                  </TableRow>
                )}
                <TableRow className="border-t-2 font-semibold bg-muted/50">
                  <TableCell>{isRTL ? 'الوحدات المحسوبة' : 'Units accounted for'}</TableCell>
                  <TableCell className="text-end font-mono">{qty(qs.units_accounted)}</TableCell>
                </TableRow>
                {!qs.is_balanced && (
                  <TableRow className="text-destructive font-semibold">
                    <TableCell>{isRTL ? '⚠ فرق كميات' : '⚠ Quantity difference'}</TableCell>
                    <TableCell className="text-end font-mono">{qty(qs.qty_difference)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ===== الخطوة 2: الوحدات المكافئة ===== */}
        <section>
          <h4 className="font-semibold mb-2 text-sm">
            {isRTL ? '٢) الوحدات المكافئة (EUP)' : '2) Equivalent Units (EUP)'}
          </h4>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{isRTL ? 'عنصر التكلفة' : 'Cost element'}</TableHead>
                  <TableHead className="text-end">{isRTL ? 'نسبة إتمام WIP النهائي' : 'Ending WIP %'}</TableHead>
                  <TableHead className="text-end">{isRTL ? 'الوحدات المكافئة' : 'EUP'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>{isRTL ? 'مواد مباشرة' : 'Direct materials'}</TableCell>
                  <TableCell className="text-end font-mono">{eu.wip_end_dm_completion_pct}%</TableCell>
                  <TableCell className="text-end font-mono">{qty(eu.eup_dm)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'تكاليف تحويل (عمالة + أوفرهيد)' : 'Conversion costs'}</TableCell>
                  <TableCell className="text-end font-mono">{eu.wip_end_cc_completion_pct}%</TableCell>
                  <TableCell className="text-end font-mono">{qty(eu.eup_cc)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ===== الخطوة 3: التكاليف الواجب حسابها ===== */}
        <section>
          <h4 className="font-semibold mb-2 text-sm">
            {isRTL ? '٣) التكاليف الواجب حسابها' : '3) Costs to Account For'}
          </h4>
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                {ca.wip_beginning_cost > 0 && (
                  <TableRow>
                    <TableCell>{isRTL ? 'تكلفة WIP أول المدة' : 'Beginning WIP cost'}</TableCell>
                    <TableCell className="text-end font-mono">{money(ca.wip_beginning_cost)}</TableCell>
                  </TableRow>
                )}
                {ca.transferred_in > 0 && (
                  <TableRow>
                    <TableCell>{isRTL ? 'محوَّل وارد من المرحلة السابقة' : 'Transferred in'}</TableCell>
                    <TableCell className="text-end font-mono">{money(ca.transferred_in)}</TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell>{isRTL ? 'مواد مباشرة' : 'Direct materials'}</TableCell>
                  <TableCell className="text-end font-mono">{money(ca.direct_materials)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'عمالة مباشرة' : 'Direct labor'}</TableCell>
                  <TableCell className="text-end font-mono">{money(ca.direct_labor)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'أوفرهيد محمَّل' : 'Overhead applied'}</TableCell>
                  <TableCell className="text-end font-mono">{money(ca.overhead_applied)}</TableCell>
                </TableRow>
                {ca.regrind_cost > 0 && (
                  <TableRow>
                    <TableCell>{isRTL ? 'تكلفة إعادة طحن' : 'Regrind cost'}</TableCell>
                    <TableCell className="text-end font-mono">{money(ca.regrind_cost)}</TableCell>
                  </TableRow>
                )}
                {ca.waste_credit > 0 && (
                  <TableRow>
                    <TableCell>{isRTL ? '(−) رصيد بيع خردة' : '(−) Waste credit'}</TableCell>
                    <TableCell className="text-end font-mono">({money(ca.waste_credit)})</TableCell>
                  </TableRow>
                )}
                <TableRow className="border-t-2 font-semibold bg-muted/50">
                  <TableCell>{isRTL ? 'إجمالي التكاليف الواجب حسابها' : 'Total costs to account for'}</TableCell>
                  <TableCell className="text-end font-mono">{money(ca.total_costs_in)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ===== الخطوة 4: تكلفة الوحدة المكافئة ===== */}
        <section>
          <h4 className="font-semibold mb-2 text-sm">
            {isRTL ? '٤) تكلفة الوحدة المكافئة' : '4) Cost per Equivalent Unit'}
          </h4>
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                {pe.transferred_in_per_eu > 0 && (
                  <TableRow>
                    <TableCell>{isRTL ? 'محوَّل وارد / وحدة' : 'Transferred-in per EU'}</TableCell>
                    <TableCell className="text-end font-mono">{money(pe.transferred_in_per_eu)}</TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell>{isRTL ? 'مواد / وحدة مكافئة' : 'DM per EU'}</TableCell>
                  <TableCell className="text-end font-mono">{money(pe.dm_per_eu)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'تحويل / وحدة مكافئة' : 'CC per EU'}</TableCell>
                  <TableCell className="text-end font-mono">{money(pe.cc_per_eu)}</TableCell>
                </TableRow>
                <TableRow className="border-t-2 font-semibold bg-muted/50">
                  <TableCell>{isRTL ? 'إجمالي تكلفة الوحدة' : 'Total per EU'}</TableCell>
                  <TableCell className="text-end font-mono">{money(pe.total_per_eu)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ===== الخطوة 5: توزيع التكاليف + التسوية ===== */}
        <section>
          <h4 className="font-semibold mb-2 text-sm">
            {isRTL ? '٥) توزيع التكاليف والتسوية' : '5) Cost Assignment & Reconciliation'}
          </h4>
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell>{isRTL ? 'مكتمل ومحوَّل للمرحلة التالية / مخزون تام' : 'Completed & transferred out'}</TableCell>
                  <TableCell className="text-end font-mono">{money(asg.completed_and_transferred)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{isRTL ? 'تحت التشغيل آخر المدة' : 'Ending WIP'}</TableCell>
                  <TableCell className="text-end font-mono">{money(asg.ending_wip)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    {isRTL ? 'خسارة تالف غير طبيعي (مصروف فترة)' : 'Abnormal scrap loss (period expense)'}
                  </TableCell>
                  <TableCell className="text-end font-mono">{money(asg.abnormal_scrap_loss)}</TableCell>
                </TableRow>
                {asg.normal_scrap_absorbed > 0 && (
                  <TableRow className="text-muted-foreground text-sm">
                    <TableCell>
                      {isRTL ? '(للعلم: تالف طبيعي مُمتص في تكلفة الوحدات الجيدة)' : '(Memo: normal scrap absorbed by good units)'}
                    </TableCell>
                    <TableCell className="text-end font-mono">{money(asg.normal_scrap_absorbed)}</TableCell>
                  </TableRow>
                )}
                <TableRow className="border-t-2 font-semibold bg-muted/50">
                  <TableCell>{isRTL ? 'إجمالي التكاليف الموزَّعة' : 'Total costs accounted for'}</TableCell>
                  <TableCell className="text-end font-mono">{money(asg.total_costs_out)}</TableCell>
                </TableRow>
                <TableRow className={cn('font-semibold', rec.is_balanced ? 'text-green-700' : 'text-destructive')}>
                  <TableCell>
                    {isRTL ? 'التسوية: داخل − خارج' : 'Reconciliation: in − out'}
                  </TableCell>
                  <TableCell className="text-end font-mono">
                    {money(rec.difference)} {rec.is_balanced ? '✓' : '✗'}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

export function CostOfProductionReportView() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const { orders, loading: ordersLoading } = useManufacturingOrders()
  const [selectedMoId, setSelectedMoId] = useState<string>('')

  const {
    data: report,
    isFetching,
    error,
    refetch
  } = useQuery<CPReport, Error>({
    queryKey: ['cost-of-production-report', selectedMoId],
    queryFn: () => CostOfProductionService.getReport(selectedMoId),
    enabled: !!selectedMoId,
    retry: false,
    staleTime: 30_000
  })

  return (
    <div className="space-y-6">
      {/* شريط التحكم — يختفي عند الطباعة */}
      <Card className="print:hidden">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-64">
              <Select value={selectedMoId} onValueChange={setSelectedMoId} disabled={ordersLoading}>
                <SelectTrigger data-testid="mo-select">
                  <SelectValue placeholder={isRTL ? 'اختر أمر التصنيع…' : 'Select MO…'} />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((mo) => (
                    <SelectItem key={mo.id} value={mo.id}>
                      {mo.order_number || mo.id} {mo.product_name ? `— ${mo.product_name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={!selectedMoId || isFetching}
              className="gap-2"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
              {isRTL ? 'تحديث' : 'Refresh'}
            </Button>
            <Button
              onClick={() => window.print()}
              disabled={!report}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              {isRTL ? 'طباعة' : 'Print'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* حالات: خطأ / فارغ / التقرير */}
      {error && (
        <ErrorState
          title={isRTL ? 'تعذر توليد التقرير' : 'Could not generate report'}
          message={error.message}
          onRetry={() => refetch()}
          retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'}
        />
      )}

      {!selectedMoId && !error && (
        <Card>
          <EmptyState
            icon={<FileBarChart aria-hidden="true" />}
            title={isRTL ? 'لم يُحدَّد أمر تصنيع بعد' : 'No manufacturing order selected'}
            description={isRTL
              ? 'اختر أمر تصنيع من القائمة أعلاه لعرض تقرير تكلفة الإنتاج بالوحدات المكافئة بخطواته الخمس'
              : 'Select a manufacturing order above to view the five-step Cost of Production Report'}
          />
        </Card>
      )}

      {isFetching && !report && !error && selectedMoId && <ReportSkeleton />}

      {report && (
        <div className="space-y-6" data-testid="cpr-report">
          {/* رأس التقرير */}
          <Card className="print:shadow-none print:border-black">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl font-bold">
                    {isRTL ? 'تقرير تكلفة الإنتاج' : 'Cost of Production Report'}
                  </h2>
                  <p className="text-muted-foreground mt-1">
                    {isRTL ? 'أمر التصنيع' : 'MO'}: <span className="font-mono font-semibold">{report.manufacturing_order.order_number}</span>
                    {' · '}
                    {isRTL ? 'الحالة' : 'Status'}: {report.manufacturing_order.status}
                    {' · '}
                    {isRTL ? 'الكمية المخططة' : 'Planned qty'}: {qty(report.manufacturing_order.qty_planned)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isRTL ? 'أُنشئ في' : 'Generated'}: {new Date(report.generated_at).toLocaleString(isRTL ? 'ar-SA' : 'en-US')}
                  </p>
                </div>
                <BalanceBadge balanced={report.totals.all_stages_balanced} isRTL={isRTL} />
              </div>
            </CardContent>
          </Card>

          {/* المراحل */}
          {report.stages.map((stage) => (
            <StageSection key={stage.stage_no} stage={stage} isRTL={isRTL} />
          ))}

          {/* الإجماليات */}
          <Card className="print:shadow-none print:border-black break-inside-avoid">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {isRTL ? 'إجمالي أمر التصنيع (كل المراحل)' : 'Grand Totals (all stages)'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell>{isRTL ? 'إجمالي التكاليف الداخلة' : 'Total costs in'}</TableCell>
                      <TableCell className="text-end font-mono">{money(report.totals.total_costs_in)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{isRTL ? 'مكتمل ومحوَّل' : 'Completed & transferred'}</TableCell>
                      <TableCell className="text-end font-mono">{money(report.totals.total_completed)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{isRTL ? 'تحت التشغيل آخر المدة' : 'Ending WIP'}</TableCell>
                      <TableCell className="text-end font-mono">{money(report.totals.total_ending_wip)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{isRTL ? 'خسائر تالف غير طبيعي' : 'Abnormal scrap losses'}</TableCell>
                      <TableCell className="text-end font-mono">{money(report.totals.total_abnormal_scrap_loss)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default CostOfProductionReportView
