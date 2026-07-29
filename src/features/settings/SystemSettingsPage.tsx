import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import { applyRuntimeLocaleSettings } from '@/lib/runtime-locale-settings'
import {
  getSystemSettings,
  saveSystemSettings,
  DEFAULT_SYSTEM_SETTINGS,
  type SystemSettingsValues,
} from '@/services/org-settings-service'

interface WarehouseOption {
  id: string
  code: string | null
  name: string | null
}

export function SystemSettingsPage() {
  const { i18n } = useTranslation()
  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const tr = (ar: string, en: string) => isRTL ? ar : en
  const [values, setValues] = useState<SystemSettingsValues>(DEFAULT_SYSTEM_SETTINGS)
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [settings, warehouseResult] = await Promise.all([
          getSystemSettings(),
          supabase.from('warehouses').select('id, code, name').eq('is_active', true).order('name'),
        ])

        if (cancelled) return
        setValues(settings)
        applyRuntimeLocaleSettings(settings)
        setWarehouses((warehouseResult.data ?? []) as WarehouseOption[])
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading system settings:', error)
          toast.error(error instanceof Error ? error.message : 'Failed to load system settings')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveSystemSettings(values)
      applyRuntimeLocaleSettings(values)
      toast.success(tr('تم حفظ إعدادات النظام', 'System settings saved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('خطأ في حفظ الإعدادات', 'Failed to save settings'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <LoadingSpinner label={tr('جاري تحميل الإعدادات...', 'Loading settings...')} />
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className={isRTL ? 'text-right' : 'text-left'}>
        <h1 className="text-3xl font-bold">{tr('إعدادات النظام', 'System Settings')}</h1>
        <p className="text-muted-foreground mt-2">
          {tr('إعدادات العرض والتشغيل المحفوظة للمؤسسة', 'Organization display and operation settings')}
        </p>
      </div>

      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className={isRTL ? 'text-right' : 'text-left'}>
            {tr('العرض والتنسيق', 'Display & Formatting')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sys-currency">{tr('عملة العرض', 'Display Currency')}</Label>
              <Input
                id="sys-currency"
                value={values.currency}
                onChange={(event) => setValues((previous) => ({
                  ...previous,
                  currency: event.target.value.toUpperCase(),
                }))}
                placeholder="SAR"
                dir="ltr"
              />
            </div>

            <div>
              <Label htmlFor="sys-numfmt">{tr('تنسيق الأرقام', 'Number Format')}</Label>
              <Select
                value={values.numberFormat}
                onValueChange={(value) => setValues((previous) => ({ ...previous, numberFormat: value }))}
              >
                <SelectTrigger id="sys-numfmt"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">{tr('أرقام لاتينية (1,234.56)', 'Latin digits (1,234.56)')}</SelectItem>
                  <SelectItem value="ar-SA">{tr('أرقام هندية-عربية (١٬٢٣٤٫٥٦)', 'Arabic-Indic digits (١٬٢٣٤٫٥٦)')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="sys-datefmt">{tr('التقويم', 'Calendar')}</Label>
              <Select
                value={values.dateFormat}
                onValueChange={(value) => setValues((previous) => ({ ...previous, dateFormat: value }))}
              >
                <SelectTrigger id="sys-datefmt"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">{tr('ميلادي', 'Gregorian')}</SelectItem>
                  <SelectItem value="ar-SA">{tr('هجري أم القرى', 'Hijri (Umm al-Qura)')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="sys-warehouse">{tr('المخزن الافتراضي', 'Default Warehouse')}</Label>
              <Select
                value={values.defaultWarehouseId || 'none'}
                onValueChange={(value) => setValues((previous) => ({
                  ...previous,
                  defaultWarehouseId: value === 'none' ? '' : value,
                }))}
              >
                <SelectTrigger id="sys-warehouse">
                  <SelectValue placeholder={tr('بلا', 'None')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— {tr('بلا', 'None')} —</SelectItem>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.code} - {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="sys-footer">{tr('تذييل المطبوعات', 'Print Footer')}</Label>
              <Input
                id="sys-footer"
                value={values.printFooter}
                onChange={(event) => setValues((previous) => ({ ...previous, printFooter: event.target.value }))}
                placeholder={tr('نص يظهر أسفل التقارير المطبوعة', 'Text shown below printed reports')}
              />
            </div>
          </div>

          <div className={`mt-6 flex ${isRTL ? 'justify-start' : 'justify-end'}`}>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ الإعدادات', 'Save Settings')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default SystemSettingsPage
