/**
 * شاشة تسوية الدفاتر الفرعية مع الأستاذ العام
 * المخزون (بادئات 131، 135) وWIP (بادئة 134) مقابل الدفاتر الفرعية — مع كشف الفروق فوراً
 * تتطلب Migration 81 — تظهر إرشاداً واضحاً إن لم تُطبَّق
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { RefreshCw, CheckCircle2, AlertTriangle, Scale, Printer } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/error-state'
import { ReportSkeleton } from '@/components/ui/loading-state'
import {
  ReconciliationService,
  type ReconciliationReport,
  type ReconciliationSection
} from '@/services/accounting/reconciliation-service'

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function money(v: number | null): string {
  return v === null || v === undefined ? '—' : nf.format(v)
}

function StatusBadge({ status, isRTL }: { readonly status: ReconciliationSection['status']; readonly isRTL: boolean }) {
  switch (status) {
    case 'balanced':
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-600 gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {isRTL ? 'متوازن' : 'Balanced'}
        </Badge>
      )
    case 'unbalanced':
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {isRTL ? 'يوجد فرق!' : 'Difference!'}
        </Badge>
      )
    case 'gl_unavailable':
      return <Badge variant="secondary">{isRTL ? 'GL غير متاح' : 'GL unavailable'}</Badge>
    default:
      return <Badge variant="secondary">{isRTL ? 'دفتر فرعي غير متاح' : 'Subledger unavailable'}</Badge>
  }
}

function SectionCard({ section, isRTL }: { readonly section: ReconciliationSection; readonly isRTL: boolean }) {
  return (
    <Card className={cn(
      'print:shadow-none print:border-black break-inside-avoid',
      section.status === 'unbalanced' && 'border-destructive'
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">{section.title_ar}</CardTitle>
          <StatusBadge status={section.status} isRTL={isRTL} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ملخص المقارنة */}
        <div className="overflow-x-auto">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>
                  {isRTL ? 'رصيد الأستاذ العام' : 'GL balance'}
                  <span className="text-xs text-muted-foreground mx-1">
                    ({section.gl_prefixes.join('*, ')}*)
                  </span>
                </TableCell>
                <TableCell className="text-end font-mono">{money(section.gl_balance)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  {isRTL ? 'رصيد الدفتر الفرعي' : 'Subledger balance'}
                  {section.subledger_source && (
                    <span className="text-xs text-muted-foreground mx-1">
                      ({section.subledger_source})
                    </span>
                  )}
                  {typeof section.open_mo_count === 'number' && section.open_mo_count > 0 && (
                    <span className="text-xs text-muted-foreground mx-1">
                      · {isRTL ? `${section.open_mo_count} أمر مفتوح` : `${section.open_mo_count} open MOs`}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-end font-mono">{money(section.subledger_balance)}</TableCell>
              </TableRow>
              <TableRow className={cn(
                'border-t-2 font-semibold',
                section.status === 'balanced' && 'text-green-700',
                section.status === 'unbalanced' && 'text-destructive'
              )}>
                <TableCell>{isRTL ? 'الفرق' : 'Difference'}</TableCell>
                <TableCell className="text-end font-mono">
                  {money(section.difference)} {section.status === 'balanced' ? '✓' : section.status === 'unbalanced' ? '✗' : ''}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* تفصيل حسابات GL */}
        {section.gl_accounts.length > 0 && (
          <div>
            <h4 className="font-semibold mb-2 text-sm text-muted-foreground">
              {isRTL ? 'تفصيل حسابات الأستاذ العام' : 'GL account detail'}
            </h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{isRTL ? 'الكود' : 'Code'}</TableHead>
                    <TableHead className="text-start">{isRTL ? 'الحساب' : 'Account'}</TableHead>
                    <TableHead className="text-end">{isRTL ? 'الرصيد' : 'Balance'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.gl_accounts.map((acc) => (
                    <TableRow key={acc.code}>
                      <TableCell className="font-mono">{acc.code}</TableCell>
                      <TableCell>{acc.name}</TableCell>
                      <TableCell className="text-end font-mono">{money(acc.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* إرشاد عند وجود فرق */}
        {section.status === 'unbalanced' && (
          <p className="text-sm text-destructive">
            {isRTL
              ? 'الفرق يعني قيداً يدوياً شارداً على حسابات هذا القسم أو حركة فرعية لم تُرحَّل — راجع قيود اليومية على هذه الحسابات بنفس التاريخ'
              : 'A difference means a stray manual entry on these accounts or an unposted subledger movement — review journal entries on these accounts as of this date'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ReconciliationPage() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10))

  const {
    data: report,
    isFetching,
    error,
    refetch
  } = useQuery<ReconciliationReport, Error>({
    queryKey: ['subledger-gl-reconciliation', asOfDate],
    queryFn: () => ReconciliationService.getReport(asOfDate),
    retry: false,
    staleTime: 30_000
  })

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Scale />}
        title={isRTL ? 'تسوية الدفاتر الفرعية مع الأستاذ العام' : 'Subledger ↔ GL Reconciliation'}
        description={isRTL
          ? 'مقارنة أرصدة المخزون والإنتاج تحت التشغيل الفرعية مع حسابات الأستاذ العام — أي فرق يظهر فوراً'
          : 'Compare inventory and WIP subledger balances against GL accounts — any difference surfaces immediately'}
      />

      {/* شريط التحكم */}
      <Card className="print:hidden">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="w-44"
                data-testid="as-of-date"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
              {isRTL ? 'تحديث' : 'Refresh'}
            </Button>
            <Button onClick={() => window.print()} disabled={!report} className="gap-2">
              <Printer className="h-4 w-4" />
              {isRTL ? 'طباعة' : 'Print'}
            </Button>
            {report && (
              <div className="ms-auto">
                {report.all_balanced ? (
                  <Badge variant="default" className="bg-green-600 hover:bg-green-600 gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {isRTL ? 'كل الأقسام متوازنة' : 'All sections balanced'}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {isRTL ? 'توجد فروق تحتاج مراجعة' : 'Differences need review'}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <ErrorState
          title={isRTL ? 'تعذر توليد تقرير التسوية' : 'Could not generate reconciliation report'}
          message={error.message}
          onRetry={() => refetch()}
          retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'}
        />
      )}

      {isFetching && !report && !error && <ReportSkeleton />}

      {report && (
        <div className="space-y-6" data-testid="reconciliation-report">
          {report.sections.map((section) => (
            <SectionCard key={section.section} section={section} isRTL={isRTL} />
          ))}
          <p className="text-xs text-muted-foreground">
            {isRTL ? 'حتى تاريخ' : 'As of'}: {report.as_of_date}
            {' · '}
            {isRTL ? 'أُنشئ في' : 'Generated'}: {new Date(report.generated_at).toLocaleString(isRTL ? 'ar-SA' : 'en-US')}
          </p>
        </div>
      )}
    </div>
  )
}

export default ReconciliationPage
