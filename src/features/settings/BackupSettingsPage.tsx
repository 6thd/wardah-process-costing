import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatNumber } from '@/lib/utils'
import {
  fetchExportRows,
  toCSV,
  EXPORTABLE_TABLES,
  type ExportableTable,
} from '@/services/org-settings-service'

const TABLE_LABELS: Record<ExportableTable, { ar: string; en: string }> = {
  products: { ar: 'المنتجات', en: 'Products' },
  customers: { ar: 'العملاء', en: 'Customers' },
  vendors: { ar: 'الموردون', en: 'Vendors' },
  sales_invoices: { ar: 'فواتير المبيعات', en: 'Sales invoices' },
  purchase_orders: { ar: 'أوامر الشراء', en: 'Purchase orders' },
  gl_entries: { ar: 'قيود اليومية (الرؤوس)', en: 'Journal entries (headers)' },
  gl_entry_lines: { ar: 'سطور قيود اليومية', en: 'Journal entry lines' },
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob(['﻿' + content], { type: `${mime};charset=utf-8;` })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export function BackupSettingsPage() {
  const { i18n } = useTranslation()
  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const tr = (ar: string, en: string) => isRTL ? ar : en
  const tableLabel = (table: ExportableTable) => isRTL ? TABLE_LABELS[table].ar : TABLE_LABELS[table].en
  const [busy, setBusy] = useState<string | null>(null)

  const exportTable = async (table: ExportableTable, format: 'json' | 'csv') => {
    setBusy(`${table}-${format}`)
    try {
      const rows = await fetchExportRows(table)
      if (rows.length === 0) {
        toast.info(tr(
          `لا توجد بيانات في «${tableLabel(table)}» للتصدير`,
          `There is no data in “${tableLabel(table)}” to export`,
        ))
        return
      }

      const date = new Date().toISOString().split('T')[0]
      if (format === 'json') {
        download(`${table}_${date}.json`, JSON.stringify(rows, null, 2), 'application/json')
      } else {
        download(`${table}_${date}.csv`, toCSV(rows), 'text/csv')
      }

      toast.success(tr(
        `تم تصدير ${tableLabel(table)} (${formatNumber(rows.length)} صف)`,
        `${tableLabel(table)} exported (${formatNumber(rows.length)} rows)`,
      ))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('فشل تصدير البيانات', 'Failed to export data'))
    } finally {
      setBusy(null)
    }
  }

  const exportAll = async () => {
    setBusy('all')
    try {
      const dump: Record<string, unknown[]> = {}
      for (const table of EXPORTABLE_TABLES) {
        dump[table] = await fetchExportRows(table)
      }

      const date = new Date().toISOString().split('T')[0]
      download(`wardah_main_data_export_${date}.json`, JSON.stringify(dump, null, 2), 'application/json')
      toast.success(tr(
        'تم تصدير الجداول الرئيسية. هذا تصدير عمل وليس نسخة قاعدة بيانات قابلة للاستعادة.',
        'Main tables exported. This is a working export, not a restorable database backup.',
      ))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('فشل تصدير الجداول الرئيسية', 'Failed to export main tables'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className={isRTL ? 'text-right' : 'text-left'}>
        <h1 className="text-3xl font-bold">{tr('تصدير البيانات', 'Data Export')}</h1>
        <p className="text-muted-foreground mt-2">
          {tr(
            'تصدير يدوي لبيانات المؤسسة بصيغة JSON أو CSV للمراجعة أو النقل. لا تمثل هذه الملفات نسخة احتياطية كاملة قابلة للاستعادة.',
            'Manually export organization data as JSON or CSV for review or transfer. These files are not a complete restorable backup.',
          )}
        </p>
      </div>

      <Card className="wardah-glass-card">
        <CardHeader className={cn('flex flex-row items-center justify-between gap-4', isRTL && 'flex-row-reverse')}>
          <CardTitle className={isRTL ? 'text-right' : 'text-left'}>
            {tr('الجداول الرئيسية', 'Main Tables')}
          </CardTitle>
          <Button onClick={exportAll} disabled={busy !== null}>
            <Download className={cn('h-4 w-4', isRTL ? 'ml-2' : 'mr-2')} />
            {busy === 'all'
              ? tr('جارٍ التصدير…', 'Exporting…')
              : tr('تصدير الكل بصيغة JSON', 'Export all as JSON')}
          </Button>
        </CardHeader>

        <CardContent>
          <div className="divide-y">
            {EXPORTABLE_TABLES.map((table) => (
              <div
                key={table}
                className={cn('flex items-center justify-between gap-4 py-3', isRTL && 'flex-row-reverse')}
              >
                <span className="font-medium">{tableLabel(table)}</span>
                <div className="flex gap-2" dir="ltr">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => exportTable(table, 'json')}
                  >
                    {busy === `${table}-json` ? '…' : 'JSON'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => exportTable(table, 'csv')}
                  >
                    {busy === `${table}-csv` ? '…' : 'CSV'}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <p className={cn('text-xs text-muted-foreground mt-4', isRTL ? 'text-right' : 'text-left')}>
            {tr(
              'ملاحظة: النسخ الاحتياطي الفعلي لقاعدة البيانات يُدار عبر منصة Supabase. هذه الصفحة مخصصة للتصدير اليدوي فقط.',
              'Note: actual database backups are managed through Supabase. This page provides manual exports only.',
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default BackupSettingsPage
