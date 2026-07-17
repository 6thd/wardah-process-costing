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

function StatusBadge({ status }: { readonly status: ReconciliationSection['status'] }) {
  const { t } = useTranslation()
  switch (status) {
    case 'balanced':
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-600 gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {t('reconciliation.balanced')}
        </Badge>
      )
    case 'unbalanced':
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {t('reconciliation.unbalanced')}
        </Badge>
      )
    case 'gl_unavailable':
      return <Badge variant="secondary">{t('reconciliation.glUnavailable')}</Badge>
    default:
      return <Badge variant="secondary">{t('reconciliation.subledgerUnavailable')}</Badge>
  }
}

function SectionCard({ section }: { readonly section: ReconciliationSection }) {
  const { t } = useTranslation()
  return (
    <Card className={cn(
      'print:shadow-none print:border-black break-inside-avoid',
      section.status === 'unbalanced' && 'border-destructive'
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">{section.title_ar}</CardTitle>
          <StatusBadge status={section.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ملخص المقارنة */}
        <div className="overflow-x-auto">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>
                  {t('reconciliation.glBalance')}
                  <span className="text-xs text-muted-foreground mx-1">
                    ({section.gl_prefixes.join('*, ')}*)
                  </span>
                </TableCell>
                <TableCell className="text-end font-mono">{money(section.gl_balance)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  {t('reconciliation.subledgerBalance')}
                  {section.subledger_source && (
                    <span className="text-xs text-muted-foreground mx-1">
                      ({section.subledger_source})
                    </span>
                  )}
                  {typeof section.open_mo_count === 'number' && section.open_mo_count > 0 && (
                    <span className="text-xs text-muted-foreground mx-1">
                      · {t('reconciliation.openMos', { count: section.open_mo_count })}
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
                <TableCell>{t('reconciliation.difference')}</TableCell>
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
              {t('reconciliation.glDetail')}
            </h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t('reconciliation.code')}</TableHead>
                    <TableHead className="text-start">{t('reconciliation.account')}</TableHead>
                    <TableHead className="text-end">{t('reconciliation.balance')}</TableHead>
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
            {t('reconciliation.diffNote')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ReconciliationPage() {
  const { t, i18n } = useTranslation()
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
        title={t('reconciliation.title')}
        description={t('reconciliation.description')}
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
              {t('reconciliation.refresh')}
            </Button>
            <Button onClick={() => window.print()} disabled={!report} className="gap-2">
              <Printer className="h-4 w-4" />
              {t('reconciliation.print')}
            </Button>
            {report && (
              <div className="ms-auto">
                {report.all_balanced ? (
                  <Badge variant="default" className="bg-green-600 hover:bg-green-600 gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {t('reconciliation.allBalanced')}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {t('reconciliation.diffsFound')}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <ErrorState
          title={t('reconciliation.errorTitle')}
          message={error.message}
          onRetry={() => refetch()}
          retryLabel={t('reconciliation.retry')}
        />
      )}

      {isFetching && !report && !error && <ReportSkeleton />}

      {report && (
        <div className="space-y-6" data-testid="reconciliation-report">
          {report.sections.map((section) => (
            <SectionCard key={section.section} section={section} />
          ))}
          <p className="text-xs text-muted-foreground">
            {t('reconciliation.asOf')}: {report.as_of_date}
            {' · '}
            {t('reconciliation.generated')}: {new Date(report.generated_at).toLocaleString('en-US')}
          </p>
        </div>
      )}
    </div>
  )
}

export default ReconciliationPage
