import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import { applyRuntimeLocaleSettings } from '@/lib/runtime-locale-settings'
import {
  getSystemSettings, saveSystemSettings,
  DEFAULT_SYSTEM_SETTINGS, type SystemSettingsValues,
} from '@/services/org-settings-service'

interface WarehouseOption { id: string; code: string | null; name: string | null }

export function SystemSettingsPage() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
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
        applyRuntimeLocaleSettings(settings)
        setWarehouses((whRes.data ?? []) as WarehouseOption[])
      } catch (error) {
        console.error('Error loading system settings:', error)
        toast.error(error instanceof Error ? error.message : t('systemSettings.loadError'))
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [t])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveSystemSettings(values)
      applyRuntimeLocaleSettings(values)
      toast.success(t('systemSettings.saved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('systemSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner label={t('systemSettings.loading')} />

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className={isRTL ? 'text-right' : 'text-left'}>
        <h1 className="text-3xl font-bold">{t('systemSettings.title')}</h1>
        <p className="text-muted-foreground mt-2">{t('systemSettings.subtitle')}</p>
      </div>

      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className={isRTL ? 'text-right' : 'text-left'}>{t('systemSettings.display')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sys-currency">{t('systemSettings.currency')}</Label>
              <Input id="sys-currency" value={values.currency}
                onChange={(e) => setValues((p) => ({ ...p, currency: e.target.value.toUpperCase() }))}
                placeholder="SAR" dir="ltr" />
            </div>
            <div>
              <Label htmlFor="sys-numfmt">{t('systemSettings.numberFormat')}</Label>
              <Select value={values.numberFormat}
                onValueChange={(v) => setValues((p) => ({ ...p, numberFormat: v }))}>
                <SelectTrigger id="sys-numfmt"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">{t('systemSettings.latinNumbers')}</SelectItem>
                  <SelectItem value="ar-SA">{t('systemSettings.arabicNumbers')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sys-datefmt">{t('systemSettings.dateFormat')}</Label>
              <Select value={values.dateFormat}
                onValueChange={(v) => setValues((p) => ({ ...p, dateFormat: v }))}>
                <SelectTrigger id="sys-datefmt"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">{t('systemSettings.gregorian')}</SelectItem>
                  <SelectItem value="ar-SA">{t('systemSettings.hijri')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sys-warehouse">{t('systemSettings.defaultWarehouse')}</Label>
              <Select value={values.defaultWarehouseId || 'none'}
                onValueChange={(v) => setValues((p) => ({ ...p, defaultWarehouseId: v === 'none' ? '' : v }))}>
                <SelectTrigger id="sys-warehouse"><SelectValue placeholder={t('common.none')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— {t('common.none')} —</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.code} - {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="sys-footer">{t('systemSettings.printFooter')}</Label>
              <Input id="sys-footer" value={values.printFooter}
                onChange={(e) => setValues((p) => ({ ...p, printFooter: e.target.value }))}
                placeholder={t('systemSettings.printFooterPlaceholder')} />
            </div>
          </div>

          <div className={`mt-6 flex ${isRTL ? 'justify-start' : 'justify-end'}`}>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default SystemSettingsPage
