/**
 * إعدادات النظام — شاشة حقيقية تقرأ/تحفظ في org_settings (Migration 98).
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import {
  getSystemSettings, saveSystemSettings,
  DEFAULT_SYSTEM_SETTINGS, type SystemSettingsValues,
} from '@/services/org-settings-service'

interface WarehouseOption { id: string; code: string | null; name: string | null }

export function SystemSettingsPage() {
  const [values, setValues] = useState<SystemSettingsValues>(DEFAULT_SYSTEM_SETTINGS)
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [settings, whRes] = await Promise.all([
          getSystemSettings(),
          supabase.from('warehouses').select('id, code, name').eq('is_active', true).order('name'),
        ])
        setValues(settings)
        setWarehouses((whRes.data ?? []) as WarehouseOption[])
      } catch (error) {
        console.error('Error loading system settings:', error)
        toast.error(error instanceof Error ? error.message : 'خطأ في تحميل الإعدادات')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveSystemSettings(values)
      toast.success('تم حفظ إعدادات النظام')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'خطأ في حفظ الإعدادات')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">جاري تحميل الإعدادات...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-right">
        <h1 className="text-3xl font-bold">إعدادات النظام</h1>
        <p className="text-muted-foreground mt-2">
          إعدادات العرض والتشغيل — تُحفظ لمؤسستك في قاعدة البيانات
        </p>
      </div>

      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="text-right">العرض والتنسيق</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sys-currency">عملة العرض</Label>
              <Input
                id="sys-currency"
                value={values.currency}
                onChange={(e) => setValues((p) => ({ ...p, currency: e.target.value }))}
                placeholder="SAR"
              />
            </div>
            <div>
              <Label htmlFor="sys-numfmt">تنسيق الأرقام</Label>
              <Select
                value={values.numberFormat}
                onValueChange={(v) => setValues((p) => ({ ...p, numberFormat: v }))}
              >
                <SelectTrigger id="sys-numfmt"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">أرقام لاتينية (1,234.56)</SelectItem>
                  <SelectItem value="ar-SA">أرقام هندية-عربية (١٬٢٣٤٫٥٦)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sys-datefmt">تنسيق التاريخ</Label>
              <Select
                value={values.dateFormat}
                onValueChange={(v) => setValues((p) => ({ ...p, dateFormat: v }))}
              >
                <SelectTrigger id="sys-datefmt"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">ميلادي (7/11/2026)</SelectItem>
                  <SelectItem value="ar-SA">هجري (١٤٤٨/١/٢٦)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sys-warehouse">المخزن الافتراضي</Label>
              <Select
                value={values.defaultWarehouseId || 'none'}
                onValueChange={(v) => setValues((p) => ({ ...p, defaultWarehouseId: v === 'none' ? '' : v }))}
              >
                <SelectTrigger id="sys-warehouse"><SelectValue placeholder="بلا" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بلا —</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} - {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="sys-footer">تذييل المطبوعات</Label>
              <Input
                id="sys-footer"
                value={values.printFooter}
                onChange={(e) => setValues((p) => ({ ...p, printFooter: e.target.value }))}
                placeholder="نص يظهر أسفل التقارير المطبوعة"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-start">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default SystemSettingsPage
