import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase, getTenantId, getTableName } from '@/lib/supabase'
import { realtimeManager } from '@/lib/realtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface StageCostingFormData {
  manufacturingOrderId: string
  stageNumber: number
  workCenterId: string
  goodQuantity: number
  defectiveQuantity: number
  materialCost: number
  laborCost: number
  overheadCost: number
}

export default function StageCostingPanel() {
  const { t } = useTranslation()
  
  const [formData, setFormData] = useState<StageCostingFormData>({
    manufacturingOrderId: '',
    stageNumber: 1,
    workCenterId: '',
    goodQuantity: 0,
    defectiveQuantity: 0,
    materialCost: 0,
    laborCost: 0,
    overheadCost: 0
  })
  
  const [isCalculating, setIsCalculating] = useState(false)
  const [lastResult, setLastResult] = useState<{
    totalCost: number
    unitCost: number
    efficiency: number
  } | null>(null)
  
  const [realtimeSubscription, setRealtimeSubscription] = useState<string | null>(null)

  // Setup realtime subscription when MO ID changes
  useEffect(() => {
    if (formData.manufacturingOrderId && realtimeSubscription) {
      realtimeManager.unsubscribe(realtimeSubscription)
    }
    
    if (formData.manufacturingOrderId) {
      const subId = realtimeManager.subscribeManufacturingOrder(
        formData.manufacturingOrderId,
        (data) => {
          console.log('📊 Realtime update for MO:', data)
          toast.info('تحديث مباشر')
        }
      )
      setRealtimeSubscription(subId)
    }
    
    return () => {
      if (realtimeSubscription) {
        realtimeManager.unsubscribe(realtimeSubscription)
      }
    }
  }, [formData.manufacturingOrderId])

  const handleInputChange = (field: keyof StageCostingFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: typeof value === 'string' ? value : Number(value)
    }))
  }

  const calculateStageCost = async () => {
    try {
      setIsCalculating(true)
      
      const tenantId = await getTenantId()
      if (!tenantId) {
        toast.error('لا يوجد معرف مستأجر')
        return
      }

      // Calculate totals
      const totalQuantity = formData.goodQuantity + formData.defectiveQuantity
      const totalCost = formData.materialCost + formData.laborCost + formData.overheadCost
      const unitCost = formData.goodQuantity > 0 ? totalCost / formData.goodQuantity : 0
      const efficiency = totalQuantity > 0 ? (formData.goodQuantity / totalQuantity) * 100 : 0

      // Direct table insert
      const { error: insertError } = await supabase
        .from(getTableName('stage_costs'))
        .upsert({
          manufacturing_order_id: formData.manufacturingOrderId,
          stage_number: formData.stageNumber,
          work_center_id: formData.workCenterId,
          good_quantity: formData.goodQuantity,
          defective_quantity: formData.defectiveQuantity,
          material_cost: formData.materialCost,
          labor_cost: formData.laborCost,
          overhead_cost: formData.overheadCost,
          total_cost: totalCost,
          unit_cost: unitCost,
          status: 'precosted',
          tenant_id: tenantId
        })
      
      if (insertError) throw insertError

      setLastResult({ totalCost, unitCost, efficiency })
      toast.success(`تم احتساب المرحلة: إجمالي التكلفة = ${totalCost.toFixed(2)} ريال`)
    } catch (error: any) {
      console.error('Stage costing error:', error)
      toast.error('خطأ في احتساب تكلفة المرحلة')
    } finally {
      setIsCalculating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-lg border p-6">
        <h2 className="text-xl font-bold mb-4">احتساب تكلفة المرحلة</h2>
        
        {/* Form Grid */}
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">رقم أمر التصنيع</label>
            <Input 
              placeholder="MO-001"
              value={formData.manufacturingOrderId}
              onChange={(e) => handleInputChange('manufacturingOrderId', e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">رقم المرحلة</label>
            <Input 
              type="number"
              min="1"
              value={formData.stageNumber}
              onChange={(e) => handleInputChange('stageNumber', e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">مركز العمل</label>
            <Input 
              placeholder="WC-001"
              value={formData.workCenterId}
              onChange={(e) => handleInputChange('workCenterId', e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">الكمية الجيدة</label>
            <Input 
              type="number"
              min="0"
              value={formData.goodQuantity}
              onChange={(e) => handleInputChange('goodQuantity', e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">الكمية المعيبة</label>
            <Input 
              type="number"
              min="0"
              value={formData.defectiveQuantity}
              onChange={(e) => handleInputChange('defectiveQuantity', e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">تكلفة المواد (ريال)</label>
            <Input 
              type="number"
              min="0"
              step="0.01"
              value={formData.materialCost}
              onChange={(e) => handleInputChange('materialCost', e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">تكلفة العمالة (ريال)</label>
            <Input 
              type="number"
              min="0"
              step="0.01"
              value={formData.laborCost}
              onChange={(e) => handleInputChange('laborCost', e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">التكاليف غير المباشرة (ريال)</label>
            <Input 
              type="number"
              min="0"
              step="0.01"
              value={formData.overheadCost}
              onChange={(e) => handleInputChange('overheadCost', e.target.value)}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Button 
            onClick={calculateStageCost}
            disabled={isCalculating || !formData.manufacturingOrderId || !formData.workCenterId}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isCalculating ? 'جاري الاحتساب...' : 'احتساب المرحلة'}
          </Button>
        </div>

        {/* Results Display */}
        {lastResult && (
          <div className="grid md:grid-cols-3 gap-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700 dark:text-green-400">
                {lastResult.totalCost.toFixed(2)}
              </div>
              <div className="text-sm text-green-600 dark:text-green-300">إجمالي التكلفة (ريال)</div>
            </div>
            
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                {lastResult.unitCost.toFixed(2)}
              </div>
              <div className="text-sm text-blue-600 dark:text-blue-300">تكلفة الوحدة (ريال)</div>
            </div>
            
            <div className="text-center">
              <Badge variant={lastResult.efficiency >= 95 ? 'default' : 'destructive'}>
                {lastResult.efficiency.toFixed(1)}% كفاءة
              </Badge>
              <div className="text-sm text-gray-600 dark:text-gray-300">نسبة الجودة</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}