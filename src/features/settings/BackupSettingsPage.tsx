/**
 * النسخ الاحتياطي — تصدير فعلي لبيانات المؤسسة (JSON/CSV) من الجداول الرئيسية.
 * بلا جدولة خادمية (بنية لاحقة) — تصدير يدوي موثوق من المتصفح.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Download } from 'lucide-react'
import {
  fetchExportRows, toCSV,
  EXPORTABLE_TABLES, type ExportableTable,
} from '@/services/org-settings-service'

const TABLE_LABELS: Record<ExportableTable, string> = {
  products: 'المنتجات',
  customers: 'العملاء',
  vendors: 'الموردون',
  sales_invoices: 'فواتير المبيعات',
  purchase_orders: 'أوامر الشراء',
  gl_entries: 'قيود اليومية (رؤوس)',
  gl_entry_lines: 'سطور قيود اليومية',
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
  const [busy, setBusy] = useState<string | null>(null)

  const exportTable = async (table: ExportableTable, format: 'json' | 'csv') => {
    setBusy(`${table}-${format}`)
    try {
      const rows = await fetchExportRows(table)
      if (rows.length === 0) {
        toast.info(`لا توجد بيانات في «${TABLE_LABELS[table]}» للتصدير`)
        return
      }
      const date = new Date().toISOString().split('T')[0]
      if (format === 'json') {
        download(`${table}_${date}.json`, JSON.stringify(rows, null, 2), 'application/json')
      } else {
        download(`${table}_${date}.csv`, toCSV(rows), 'text/csv')
      }
      toast.success(`تم تصدير ${TABLE_LABELS[table]} (${rows.length} صفاً)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'خطأ في التصدير')
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
      toast.success('تم تصدير البيانات الرئيسية — ليس نسخة احتياطية كاملة قابلة للاستعادة')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'خطأ في التصدير الكامل')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-right">
        <h1 className="text-3xl font-bold">النسخ الاحتياطي</h1>
        <p className="text-muted-foreground mt-2">
          تصدير البيانات الرئيسية لمؤسستك (JSON/CSV) — لا يشمل سطور الفواتير/الشراء
          ولا المخزون التفصيلي ولا التصنيع ولا HR، وليس بديلاً عن نسخ قاعدة البيانات
        </p>
      </div>

      <Card className="wardah-glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <Button onClick={exportAll} disabled={busy !== null}>
            <Download className="h-4 w-4 ml-2" />
            {busy === 'all' ? 'جارٍ التصدير…' : 'تصدير البيانات الرئيسية (JSON)'}
          </Button>
          <CardTitle className="text-right">تصدير الجداول الرئيسية</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {EXPORTABLE_TABLES.map((table) => (
              <div key={table} className="flex items-center justify-between py-3">
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    disabled={busy !== null}
                    onClick={() => exportTable(table, 'json')}
                  >
                    {busy === `${table}-json` ? '…' : 'JSON'}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={busy !== null}
                    onClick={() => exportTable(table, 'csv')}
                  >
                    {busy === `${table}-csv` ? '…' : 'CSV'}
                  </Button>
                </div>
                <span className="font-medium">{TABLE_LABELS[table]}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4 text-right">
            ملاحظة: قاعدة البيانات نفسها تُنسخ آلياً عبر منصة Supabase؛ هذا التصدير
            نسخة عمل للمراجعة أو النقل.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default BackupSettingsPage
