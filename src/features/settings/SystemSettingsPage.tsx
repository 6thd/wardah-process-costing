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
import { usePermissions } from '@/hooks/usePermissions'

interface WarehouseOption {
  id: string
  code: string | null
  name: string | null
}

export function SystemSettingsPage() {
  const { i18n } = useTranslation()
  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const tr = (ar: string, en: string) => isRTL ? ar : en
  const { hasPermissionKey } = usePermissions()
  // لا مورد "settings.system" مخصص في الكتالوج الحي — /settings/system
  // مُحكَم عند دخول المسار بـ settings.organization.read فقط (بديل رؤية لا
  // تفويض كتابة حقيقي، انظر route-permissions.ts)، والصف المكتوب فعليًا
  // (org_settings بمفتاح 'system') مورد مختلف تمامًا عن organizations. تُغلَق
  // الكتابة هنا افتراضيًا (fail-closed) بدل ربطها بـ settings.organization.update
  // خطأً، وتُبلَّغ كفجوة كتالوج/منتج تحتاج مفتاحًا مخصصًا قبل إعادة التفعيل.
  const canSave = false
  // org_settings (key 'system') has no dedicated catalog resource either —
  // same gap documented above for canSave. settings.organization.read is
  // the same fallback view key route-permissions.ts already requires to
  // reach this route at all; reusing it here (rather than firing the read
  // unconditionally) closes the fail-open gap at the query itself, not just
  // at route entry.
  const canReadSystemSettings = hasPermissionKey('settings.organization.read')
  const canReadWarehouses = hasPermissionKey('inventory.warehouses.read')
  const [values, setValues] = useState<SystemSettingsValues>(DEFAULT_SYSTEM_SETTINGS)
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!canReadSystemSettings) {
      // Revoked (or never granted): no request, and any previously loaded
      // values are dropped rather than left on screen.
      setValues(DEFAULT_SYSTEM_SETTINGS)
      setWarehouses([])
      setLoading(false)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const [settings, warehouseResult] = await Promise.all([
          getSystemSettings(),
          canReadWarehouses
            ? supabase.from('warehouses').select('id, code, name').eq('is_active', true).order('name')
            : Promise.resolve({ data: [] as WarehouseOption[] }),
        ])

        // Superseded by a re-render whose effect already tore this one
        // down — most importantly a revocation of settings.organization.read
        // that happened while this request was in flight. Applying a
        // response that lands after that must not repopulate the screen.
        if (cancelled) return
        setValues(settings)
        applyRuntimeLocaleSettings(settings)
        setWarehouses((warehouseResult.data ?? []) as WarehouseOption[])
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading system settings:', error)
          // الاتجاه يُقرأ من `i18n.dir()` لا من `tr` المُنشأ كل render: الـeffect
          // بتبعيات فارغة عمدًا، وإدراج `tr` فيها كان سيعيد تحميل الإعدادات عند
          // كل render. و`i18n` مرجع مستقر من useTranslation فإدراجه لا يُعيد
          // التنفيذ، بخلاف قراءة `i18n.language` مباشرةً. والنتيجة أدقّ أيضًا:
          // تعكس اللغة لحظة الخطأ لا لحظة التركيب.
          toast.error(
            error instanceof Error
              ? error.message
              : (i18n.dir() === 'rtl'
                  ? 'فشل تحميل إعدادات النظام'
                  : 'Failed to load system settings')
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // `i18n` عمدًا خارج المصفوفة: catch أعلاه يقرأ `i18n.dir()` عند وقوع
    // الخطأ فعليًا لا عند كل تصيير، فلا حاجة لإعادة تشغيل الأثر عند تغيّره —
    // وإدراجه هنا كان يفترض استقرار مرجعه، وهو افتراض ينكسر مع أي مستهلك
    // (اختبار أو غيره) يُعيد بناء كائن i18n في كل استدعاء لـ useTranslation()،
    // فيُشغِّل الأثر عند كل تصيير: الفرع أعلاه لغياب الصلاحية يستدعي
    // setWarehouses([]) بمرجع مصفوفة جديد في كل مرة (لا يوقفه Object.is
    // bailout كما يحدث مع setValues(DEFAULT_SYSTEM_SETTINGS))، فيُصيِّر من
    // جديد، فيُعاد بناء i18n، فيُعاد تشغيل الأثر — حلقة تصيير لا نهائية.
    // canReadWarehouses/canReadSystemSettings يُعيدان التحميل فعليًا عند سحب/منح صلاحياتهما.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadWarehouses, canReadSystemSettings])

  const handleSave = async () => {
    if (!canSave) {
      toast.error(tr('لا تملك صلاحية حفظ إعدادات النظام', 'You do not have permission to save system settings'))
      return
    }
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

          {canSave && (
            <div className={`mt-6 flex ${isRTL ? 'justify-start' : 'justify-end'}`}>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ الإعدادات', 'Save Settings')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default SystemSettingsPage
