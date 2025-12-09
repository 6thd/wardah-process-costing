/**
 * BOM Settings Component
 * مكون إعدادات BOM
 */

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
// import { Switch } from '@/components/ui/switch' // TODO: Add switch component
import { Settings, Save } from 'lucide-react'
import { bomTreeService, BOMTreeSettings } from '@/services/manufacturing/bomTreeService'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/auth-store'

export function BOMSettings() {
  const { user } = useAuthStore()
  const [settings, setSettings] = useState<BOMTreeSettings>({
    bom_tree_cache_duration_hours: 1,
    bom_max_levels: 20,
    bom_auto_calculate_cost: true
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const data = await bomTreeService.getBOMSettings()
      setSettings(data)
    } catch (error: any) {
      toast.error(`خطأ في تحميل الإعدادات: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      await bomTreeService.updateBOMSettings(settings, user?.id)
      toast.success('تم حفظ الإعدادات بنجاح')
    } catch (error: any) {
      toast.error(`خطأ في حفظ الإعدادات: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">جاري التحميل...</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          إعدادات BOM
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="cache_duration">
            مدة صلاحية Cache (بالساعات)
          </Label>
          <Input
            id="cache_duration"
            type="number"
            min="0.5"
            max="24"
            step="0.5"
            value={settings.bom_tree_cache_duration_hours}
            onChange={(e) => setSettings({
              ...settings,
              bom_tree_cache_duration_hours: Number.parseFloat(e.target.value) || 1
            })}
          />
          <p className="text-sm text-muted-foreground">
            المدة التي يتم فيها الاحتفاظ بـ cache شجرة BOM قبل إعادة الحساب
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max_levels">
            الحد الأقصى لمستويات BOM
          </Label>
          <Input
            id="max_levels"
            type="number"
            min="1"
            max="50"
            value={settings.bom_max_levels}
            onChange={(e) => setSettings({
              ...settings,
              bom_max_levels: Number.parseInt(e.target.value, 10) || 20
            })}
          />
          <p className="text-sm text-muted-foreground">
            الحد الأقصى لعدد المستويات في شجرة BOM متعددة المستويات
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto_calculate">
              حساب التكلفة تلقائياً
            </Label>
            <p className="text-sm text-muted-foreground">
              حساب تكلفة BOM تلقائياً عند تحديث المكونات
            </p>
          </div>
          <input
            id="auto_calculate"
            type="checkbox"
            checked={settings.bom_auto_calculate_cost}
            onChange={(e) => setSettings({
              ...settings,
              bom_auto_calculate_cost: e.target.checked
            })}
            className="h-4 w-4"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={saveSettings} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

