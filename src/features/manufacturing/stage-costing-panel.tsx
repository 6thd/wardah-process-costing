import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { 
  Calculator, 
  Clock, 
  DollarSign, 
  RefreshCw, 
  BarChart3,
  Users,
  Settings,
  TrendingUp,
  Check, 
} from 'lucide-react'

// Import and register actions
import { registerStageCostingActions, unregisterStageCostingActions } from './stage-costing-actions.js'

// Import our new hooks
import { useManufacturingOrders } from '@/hooks/useManufacturingOrders'
import { useWorkCenters } from '@/hooks/useWorkCenters'
import { useManufacturingStages } from '@/hooks/useManufacturingStages'
import { useStageCosts, StageCost } from '@/hooks/useStageCosts'
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription'

interface StageCostingFormData {
  manufacturingOrderId: string
  stageId: string  // Changed from stageNumber to stageId
  workCenterId: string
  goodQuantity: number
  scrapQuantity: number
  reworkQuantity: number
  directMaterialCost: number
  laborHours: number
  laborRate: number
  overheadRate: number
  employeeId?: string
  employeeName?: string
  operationCode?: string
  notes?: string
}

interface StageCostResult {
  stageId: string
  totalCost: number
  unitCost: number
  transferredIn: number
  laborCost: number
  overheadCost: number
  efficiency: number
  calculatedAt: string
}

export default function StageCostingPanel() {
  const queryClient = useQueryClient()
  
  const [formData, setFormData] = useState<StageCostingFormData>({
    manufacturingOrderId: '',
    stageId: '',  // Changed from stageNumber to stageId
    workCenterId: '',
    goodQuantity: 0,
    scrapQuantity: 0,
    reworkQuantity: 0,
    directMaterialCost: 0,
    laborHours: 0,
    laborRate: 0,
    overheadRate: 0.15, // Default 15% overhead rate
    employeeName: '',
    operationCode: '',
    notes: ''
  })
  
  const [lastResult, setLastResult] = useState<StageCostResult | null>(null)
  const [selectedMO, setSelectedMO] = useState<any>(null)

  // Use our new React Query hooks
  const { data: manufacturingOrders = [], isLoading: isMOLoading, isError: isMOError } = useManufacturingOrders()
  const { data: workCenters = [], isLoading: isWCLoading, isError: isWCError } = useWorkCenters()
  const { data: stages = [], isLoading: isStagesLoading, isError: isStagesError } = useManufacturingStages()
  const { data: stageCosts = [], isLoading: isSCLoading, isError: isSCError } = useStageCosts(formData.manufacturingOrderId) as { data: StageCost[], isLoading: boolean, isError: boolean }

  // Setup realtime subscriptions
  useRealtimeSubscription('manufacturing_orders', 'manufacturing-orders')
  useRealtimeSubscription('work_centers', 'work-centers')
  useRealtimeSubscription('stage_costs', ['stage-costs', formData.manufacturingOrderId])

  // Load MO details when MO changes
  useEffect(() => {
    if (formData.manufacturingOrderId) {
      const mo = manufacturingOrders.find((order: any) => order.id === formData.manufacturingOrderId)
      setSelectedMO(mo)
    }
  }, [formData.manufacturingOrderId, manufacturingOrders])

  // Register actions when component mounts
  useEffect(() => {
    registerStageCostingActions()
    
    // Cleanup function
    return () => {
      unregisterStageCostingActions()
    }
  }, [])

  // Add event listeners for custom events
  useEffect(() => {
    const form = document.querySelector('form')
    if (!form) return
    
    const handleLaborTimeApplied = () => {
      toast.success('تم تسجيل وقت العمل بنجاح')
      queryClient.invalidateQueries({ queryKey: ['stage-costs', formData.manufacturingOrderId] })
    }
    
    const handleOverheadApplied = () => {
      toast.success('تم تطبيق التكاليف غير المباشرة بنجاح')
      queryClient.invalidateQueries({ queryKey: ['stage-costs', formData.manufacturingOrderId] })
    }
    
    const handleStageCostCalculated = (event: any) => {
      setLastResult(event.detail)
      queryClient.invalidateQueries({ queryKey: ['stage-costs', formData.manufacturingOrderId] })
    }
    
    // Add event listeners
    form.addEventListener('laborTimeApplied', handleLaborTimeApplied)
    form.addEventListener('overheadApplied', handleOverheadApplied)
    form.addEventListener('stageCostCalculated', handleStageCostCalculated)
    
    // Cleanup
    return () => {
      form.removeEventListener('laborTimeApplied', handleLaborTimeApplied)
      form.removeEventListener('overheadApplied', handleOverheadApplied)
      form.removeEventListener('stageCostCalculated', handleStageCostCalculated)
    }
  }, [formData.manufacturingOrderId, queryClient])

  // Load stage costs is now handled by React Query hooks
  const loadStageCosts = async () => {
    // Invalidate the query to trigger a refetch
    queryClient.invalidateQueries({ queryKey: ['stage-costs', formData.manufacturingOrderId] })
  }

  const handleInputChange = (field: keyof StageCostingFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: typeof value === 'string' ? value : Number(value)
    }))
  }

  // Apply labor time first
  // This functionality is handled by the action handler in stage-costing-actions.js
  // The button with data-action="apply-labor-time" triggers the action

  // Apply overhead functionality is handled by the action handler in stage-costing-actions.js
  // The button with data-action="apply-overhead" triggers the action

  return (
    <div className="space-y-6" data-panel="stage-costing">
      {/* Header */}
      <div className="wardah-glass-card p-6">
        <form onSubmit={(e) => e.preventDefault()}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Calculator className="h-6 w-6 text-primary" />
              <h2 className="text-xl font-bold wardah-text-gradient-google">احتساب تكلفة المراحل (Process Costing)</h2>
            </div>
            <div className="flex gap-2">
              <Button 
                type="button"
                variant="outline" 
                size="sm"
                data-action="refresh-stage-costs"
                onClick={loadStageCosts}
                disabled={isSCLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isSCLoading ? 'animate-spin' : ''}`} />
                تحديث
              </Button>
              <Button 
                type="button"
                variant="outline" 
                size="sm"
                data-action="view-stage-report"
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                تقرير المراحل
              </Button>
            </div>
          </div>
        
          {/* Loading and Error States */}
          {(isMOLoading || isWCLoading || isStagesLoading || isSCLoading) && (
            <div className="mb-4 p-4 wardah-glass-card">
              <p>جاري تحميل البيانات...</p>
            </div>
          )}
          
          {(isMOError || isWCError || isStagesError || isSCError) && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <p className="text-red-700 dark:text-red-300">خطأ في تحميل البيانات. يرجى التحديث.</p>
            </div>
          )}
        
          {/* Manufacturing Order Selection */}
          <div className="grid md:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium mb-2">أمر التصنيع</label>
              <select 
                name="manufacturingOrderId"
                className="w-full px-3 py-2 border rounded-md wardah-glass-card"
                value={formData.manufacturingOrderId}
                onChange={(e) => handleInputChange('manufacturingOrderId', e.target.value)}
                disabled={isMOLoading}
              >
                <option value="">اختر أمر التصنيع</option>
                {manufacturingOrders.map((order: any) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number} - {order.product_id ? `Product ${order.product_id}` : 'N/A'}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">المرحلة</label>
              <select 
                name="stageId"
                className="w-full px-3 py-2 border rounded-md wardah-glass-card"
                value={formData.stageId}
                onChange={(e) => handleInputChange('stageId', e.target.value)}
                disabled={isStagesLoading}
              >
                <option value="">اختر المرحلة</option>
                {stages
                  .filter((stage: any) => stage.is_active)
                  .sort((a: any, b: any) => (a.order_sequence || 0) - (b.order_sequence || 0))
                  .map((stage: any) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.code} - {stage.name_ar || stage.name} (الترتيب: {stage.order_sequence})
                    </option>
                  ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">مركز العمل</label>
              <select 
                name="workCenterId"
                className="w-full px-3 py-2 border rounded-md wardah-glass-card"
                value={formData.workCenterId}
                onChange={(e) => handleInputChange('workCenterId', e.target.value)}
                disabled={isWCLoading}
              >
                <option value="">اختر مركز العمل</option>
                {workCenters.map((wc: any) => (
                  <option key={wc.id} value={wc.id}>
                    {wc.code} - {wc.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">حالة الأمر</label>
              <div className="pt-2">
                {selectedMO && (
                  <Badge variant={selectedMO.status === 'in_progress' ? 'default' : 'outline'}>
                    {selectedMO.status === 'pending' ? 'في الانتظار' :
                     selectedMO.status === 'in_progress' ? 'قيد التنفيذ' :
                     selectedMO.status === 'completed' ? 'مكتمل' : selectedMO.status}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        
          {/* Quantities Section */}
          <div className="wardah-glass-card p-4 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2 wardah-text-gradient-google">
              <BarChart3 className="h-5 w-5" />
              الكميات المنتجة
            </h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">الكمية الجيدة</label>
                <Input 
                  name="goodQuantity"
                  type="number"
                  min="0"
                  value={formData.goodQuantity}
                  onChange={(e) => handleInputChange('goodQuantity', e.target.value)}
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">الكمية المعيبة</label>
                <Input 
                  name="scrapQuantity"
                  type="number"
                  min="0"
                  value={formData.scrapQuantity}
                  onChange={(e) => handleInputChange('scrapQuantity', e.target.value)}
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">كمية إعادة التشغيل</label>
                <Input 
                  name="reworkQuantity"
                  type="number"
                  min="0"
                  value={formData.reworkQuantity}
                  onChange={(e) => handleInputChange('reworkQuantity', e.target.value)}
                  className="wardah-glass-card"
                />
              </div>
            </div>
          </div>
        
          {/* Cost Components */}
          <div className="wardah-glass-card p-4 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2 wardah-text-gradient-google">
              <DollarSign className="h-5 w-5" />
              مكونات التكلفة
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">تكلفة المواد المباشرة (ريال)</label>
                <Input 
                  name="directMaterialCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.directMaterialCost}
                  onChange={(e) => handleInputChange('directMaterialCost', e.target.value)}
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">ساعات العمل</label>
                <Input 
                  name="laborHours"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.laborHours}
                  onChange={(e) => handleInputChange('laborHours', e.target.value)}
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">معدل الأجر بالساعة (ريال)</label>
                <Input 
                  name="laborRate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.laborRate}
                  onChange={(e) => handleInputChange('laborRate', e.target.value)}
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">معدل التكاليف غير المباشرة (%)</label>
                <Input 
                  name="overheadRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.overheadRate * 100}
                  onChange={(e) => handleInputChange('overheadRate', parseFloat(e.target.value) / 100)}
                  className="wardah-glass-card"
                />
              </div>
            </div>
          </div>
        
          {/* Labor Details */}
          <div className="wardah-glass-card p-4 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2 wardah-text-gradient-google">
              <Users className="h-5 w-5" />
              تفاصيل العمالة والتشغيل
            </h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">اسم الموظف</label>
                <Input 
                  name="employeeName"
                  value={formData.employeeName || ''}
                  onChange={(e) => handleInputChange('employeeName', e.target.value)}
                  placeholder="اسم الموظف أو المشغل"
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">كود العملية</label>
                <Input 
                  name="operationCode"
                  value={formData.operationCode || ''}
                  onChange={(e) => handleInputChange('operationCode', e.target.value)}
                  placeholder="OP001, WELD, CUT, etc."
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">ملاحظات</label>
                <Input 
                  name="notes"
                  value={formData.notes || ''}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  placeholder="أي ملاحظات إضافية"
                  className="wardah-glass-card"
                />
              </div>
            </div>
          </div>
        
          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 mb-6">
            <Button 
              type="button"
              data-action="apply-labor-time"
              disabled={!formData.laborHours || !formData.laborRate}
              className="bg-purple-600 hover:bg-purple-700 wardah-glass-card"
            >
              <Clock className="h-4 w-4 mr-2" />
              تسجيل وقت العمل
            </Button>
            
            <Button 
              type="button"
              data-action="apply-overhead"
              disabled={!formData.overheadRate}
              className="bg-orange-600 hover:bg-orange-700 wardah-glass-card"
            >
              <Settings className="h-4 w-4 mr-2" />
              تطبيق التكاليف غير المباشرة
            </Button>
            
            <Button 
              type="button"
              data-action="calculate-stage-cost"
              disabled={!formData.manufacturingOrderId || !formData.workCenterId || !formData.goodQuantity}
              className="bg-blue-600 hover:bg-blue-700 wardah-glass-card"
            >
              <Calculator className="h-4 w-4 mr-2" />
              {'احتساب تكلفة المرحلة'}
            </Button>
          </div>
        </form>

        {/* Results Display */}
        {lastResult && (
          <div className="space-y-4" data-result={JSON.stringify(lastResult)}>
            <div className="grid md:grid-cols-4 gap-4 p-4 wardah-glass-card">
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
                <div className="text-xl font-bold text-purple-700 dark:text-purple-400">
                  {lastResult.transferredIn.toFixed(2)}
                </div>
                <div className="text-sm text-purple-600 dark:text-purple-300">محول من مرحلة سابقة</div>
              </div>
              
              <div className="text-center">
                <Badge variant={lastResult.efficiency >= 95 ? 'default' : 'destructive'}>
                  {lastResult.efficiency.toFixed(1)}% كفاءة
                </Badge>
                <div className="text-sm text-gray-600 dark:text-gray-300">نسبة الجودة</div>
              </div>
            </div>
            
            {/* Cost Breakdown */}
            <div className="grid md:grid-cols-3 gap-4 p-4 wardah-glass-card">
              <div className="text-center">
                <div className="text-lg font-bold text-orange-700 dark:text-orange-400">
                  {lastResult.laborCost.toFixed(2)}
                </div>
                <div className="text-sm text-orange-600 dark:text-orange-300">تكلفة العمالة المباشرة</div>
              </div>
              
              <div className="text-center">
                <div className="text-lg font-bold text-indigo-700 dark:text-indigo-400">
                  {lastResult.overheadCost.toFixed(2)}
                </div>
                <div className="text-sm text-indigo-600 dark:text-indigo-300">التكاليف غير المباشرة</div>
              </div>
              
              <div className="text-center">
                <div className="text-lg font-bold text-gray-700 dark:text-gray-400">
                  {(lastResult.totalCost - lastResult.transferredIn - lastResult.laborCost - lastResult.overheadCost).toFixed(2)}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300">المواد المباشرة</div>
              </div>
            </div>
            
            {/* Post to GL Button */}
            <div className="flex justify-center">
              <Button 
                type="button"
                data-action="post-stage-to-gl"
                className="bg-green-600 hover:bg-green-700 wardah-glass-card"
              >
                <Check className="h-4 w-4 mr-2" />
                ترحيل للدفتر العام
              </Button>
            </div>
            
            <div className="text-xs text-gray-500 text-center">
              تم الحساب في: {new Date(lastResult.calculatedAt).toLocaleString('ar-SA')}
            </div>
          </div>
        )}
      </div>
      
      {/* Stage Costs History */}
      {stageCosts.length > 0 && (
        <div className="wardah-glass-card p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 wardah-text-gradient-google">
            <TrendingUp className="h-5 w-5" />
            تاريخ مراحل التكلفة
          </h3>
          
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-right p-2">المرحلة</th>
                  <th className="text-right p-2">مركز العمل</th>
                  <th className="text-right p-2">الكمية الجيدة</th>
                  <th className="text-right p-2">التكلفة الإجمالية</th>
                  <th className="text-right p-2">تكلفة الوحدة</th>
                  <th className="text-right p-2">الحالة</th>
                  <th className="text-right p-2">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {stageCosts.map((stage, index) => (
                  <tr key={stage.id || index} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="p-2 font-medium">
                      {stage.manufacturing_stage?.name_ar || 
                       stage.manufacturing_stage?.name || 
                       `Stage ${stage.stage_number || stage.stage_id || 'N/A'}`}
                    </td>
                    <td className="p-2">{stage.work_center?.name || stage.work_center_id}</td>
                    <td className="p-2">{stage.good_quantity}</td>
                    <td className="p-2 font-medium">{stage.total_cost?.toFixed(2)} ريال</td>
                    <td className="p-2">{stage.unit_cost?.toFixed(2)} ريال</td>
                    <td className="p-2">
                      <Badge variant={stage.status === 'completed' ? 'default' : 'outline'}>
                        {stage.status === 'precosted' ? 'تكلفة مُقدرة' :
                         stage.status === 'actual' ? 'تكلفة فعلية' :
                         stage.status === 'completed' ? 'مكتملة' : stage.status}
                      </Badge>
                    </td>
                    <td className="p-2 text-sm text-gray-600">
                      {new Date(stage.updated_at || stage.created_at).toLocaleDateString('ar-SA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}