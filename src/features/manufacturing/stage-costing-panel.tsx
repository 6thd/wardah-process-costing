import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { 
  Calculator, 
  Clock, 
  DollarSign, 
  Factory, 
  Plus, 
  Save, 
  RefreshCw, 
  BarChart3,
  Users,
  Settings,
  TrendingUp,
  Check, 
  X, 
  AlertCircle 
} from 'lucide-react'

// Import our domain modules (using regular imports instead of await import)
import * as ProcessCosting from '../../domain/processCosting.js'
import * as Manufacturing from '../../domain/manufacturing.js'
import * as Audit from '../../domain/audit.js'

// Import and register actions
import { registerStageCostingActions, unregisterStageCostingActions } from './stage-costing-actions.js'

interface StageCostingFormData {
  manufacturingOrderId: string
  stageNumber: number
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
  const { t } = useTranslation()
  
  const [formData, setFormData] = useState<StageCostingFormData>({
    manufacturingOrderId: '',
    stageNumber: 1,
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
  
  const [isCalculating, setIsCalculating] = useState(false)
  const [lastResult, setLastResult] = useState<StageCostResult | null>(null)
  const [workCenters, setWorkCenters] = useState<any[]>([])
  const [manufacturingOrders, setManufacturingOrders] = useState<any[]>([])
  const [stageCosts, setStageCosts] = useState<any[]>([])
  const [selectedMO, setSelectedMO] = useState<any>(null)

  // Load initial data
  useEffect(() => {
    // Register actions when component mounts
    registerStageCostingActions()
    
    loadWorkCenters()
    loadManufacturingOrders()
    
    // Cleanup function
    return () => {
      unregisterStageCostingActions()
    }
  }, [])

  // Load stage costs when MO changes
  useEffect(() => {
    if (formData.manufacturingOrderId) {
      loadStageCosts()
      loadMODetails()
    }
  }, [formData.manufacturingOrderId])
  
  // Add event listeners for custom events
  useEffect(() => {
    const form = document.querySelector('form')
    if (!form) return
    
    const handleStageCostsRefreshed = (event: any) => {
      setStageCosts(event.detail.stageCosts)
    }
    
    const handleLaborTimeApplied = (event: any) => {
      toast.success('تم تسجيل وقت العمل بنجاح')
      loadStageCosts() // Refresh the stage costs
    }
    
    const handleOverheadApplied = (event: any) => {
      toast.success('تم تطبيق التكاليف غير المباشرة بنجاح')
      loadStageCosts() // Refresh the stage costs
    }
    
    const handleStageCostCalculated = (event: any) => {
      setLastResult(event.detail)
      loadStageCosts() // Refresh the stage costs list
    }
    
    // Add event listeners
    form.addEventListener('stageCostsRefreshed', handleStageCostsRefreshed)
    form.addEventListener('laborTimeApplied', handleLaborTimeApplied)
    form.addEventListener('overheadApplied', handleOverheadApplied)
    form.addEventListener('stageCostCalculated', handleStageCostCalculated)
    
    // Cleanup
    return () => {
      form.removeEventListener('stageCostsRefreshed', handleStageCostsRefreshed)
      form.removeEventListener('laborTimeApplied', handleLaborTimeApplied)
      form.removeEventListener('overheadApplied', handleOverheadApplied)
      form.removeEventListener('stageCostCalculated', handleStageCostCalculated)
    }
  }, [])

  const loadWorkCenters = async () => {
    try {
      const result = await Manufacturing.getAllWorkCenters()
      if (result.success && 'data' in result && result.data) {
        setWorkCenters(result.data)
      }
    } catch (error) {
      console.error('Error loading work centers:', error)
    }
  }

  const loadManufacturingOrders = async () => {
    try {
      const result = await Manufacturing.getAllManufacturingOrders() as any
      if (result.success && result.data) {
        const activeOrders = result.data.filter((order: any) => 
          ['pending', 'in_progress'].includes(order.status)
        )
        setManufacturingOrders(activeOrders)
      }
    } catch (error) {
      console.error('Error loading manufacturing orders:', error)
    }
  }

  const loadMODetails = async () => {
    try {
      const result = await Manufacturing.getManufacturingOrderById(formData.manufacturingOrderId)
      if (result.success && 'data' in result && result.data) {
        setSelectedMO(result.data)
      }
    } catch (error) {
      console.error('Error loading MO details:', error)
    }
  }

  const loadStageCosts = async () => {
    try {
      const result = await ProcessCosting.getStageCosts(formData.manufacturingOrderId)
      if (result.success && 'data' in result && result.data) {
        setStageCosts(result.data)
      }
    } catch (error) {
      console.error('Error loading stage costs:', error)
    }
  }

  const handleInputChange = (field: keyof StageCostingFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: typeof value === 'string' ? value : Number(value)
    }))
  }

  // Apply labor time first
  const applyLaborTime = async () => {
    if (!formData.laborHours || !formData.laborRate) {
      toast.error('يجب إدخال ساعات العمل ومعدل الأجر')
      return
    }

    try {
      setIsCalculating(true)
      
      const result = await (ProcessCosting.applyLaborTime as any)({
        moId: formData.manufacturingOrderId,
        stageNo: formData.stageNumber,
        workCenterId: formData.workCenterId,
        hours: formData.laborHours,
        hourlyRate: formData.laborRate,
        employeeName: formData.employeeName || null,
        operationCode: formData.operationCode || null,
        notes: formData.notes || null
      })

      if (result.success && result.data) {
        toast.success(`تم تسجيل وقت العمل: ${result.data.totalLaborCost?.toFixed(2)} ريال`)
        await loadStageCosts() // Refresh stage costs
      }
    } catch (error: any) {
      console.error('Error applying labor time:', error)
      toast.error('خطأ في تسجيل وقت العمل')
    } finally {
      setIsCalculating(false)
    }
  }

  // Apply overhead
  const applyOverhead = async () => {
    if (!formData.overheadRate) {
      toast.error('يجب إدخال معدل التكاليف غير المباشرة')
      return
    }

    try {
      setIsCalculating(true)
      
      const baseAmount = formData.laborHours * formData.laborRate // Use labor cost as base
      
      const result = await (ProcessCosting.applyOverhead as any)({
        moId: formData.manufacturingOrderId,
        stageNo: formData.stageNumber,
        workCenterId: formData.workCenterId,
        allocationBase: 'labor_cost',
        baseQty: baseAmount,
        overheadRate: formData.overheadRate,
        overheadType: 'variable',
        notes: `Applied at ${(formData.overheadRate * 100)}% of labor cost`
      })

      if (result.success && result.data) {
        toast.success(`تم تطبيق التكاليف غير المباشرة: ${result.data.overheadAmount?.toFixed(2)} ريال`)
        await loadStageCosts() // Refresh stage costs
      }
    } catch (error: any) {
      console.error('Error applying overhead:', error)
      toast.error('خطأ في تطبيق التكاليف غير المباشرة')
    } finally {
      setIsCalculating(false)
    }
  }

  // Calculate final stage cost using process costing methodology
  const calculateStageCost = async () => {
    if (!formData.manufacturingOrderId || !formData.workCenterId || !formData.goodQuantity) {
      toast.error('يجب إدخال جميع البيانات المطلوبة')
      return
    }

    try {
      setIsCalculating(true)
      
      // Calculate stage cost using our process costing formula
      const result = await (ProcessCosting.upsertStageCost as any)({
        moId: formData.manufacturingOrderId,
        stageNo: formData.stageNumber,
        workCenterId: formData.workCenterId,
        goodQty: formData.goodQuantity,
        directMaterialCost: formData.directMaterialCost,
        mode: 'actual',
        scrapQty: formData.scrapQuantity,
        reworkQty: formData.reworkQuantity,
        notes: formData.notes || null
      })

      if (result.success && result.data) {
        const efficiency = formData.goodQuantity / (formData.goodQuantity + formData.scrapQuantity + formData.reworkQuantity) * 100
        
        setLastResult({
          stageId: result.data.stageId || '',
          totalCost: result.data.totalCost || 0,
          unitCost: result.data.unitCost || 0,
          transferredIn: result.data.transferredIn || 0,
          laborCost: result.data.laborCost || 0,
          overheadCost: result.data.overheadCost || 0,
          efficiency: efficiency || 100,
          calculatedAt: new Date().toISOString()
        })
        
        toast.success(`تم احتساب المرحلة ${formData.stageNumber}: ${result.data.totalCost?.toFixed(2)} ريال`)
        
        // Log the operation
        await Audit.logProcessCostingOperation({
          operation: 'stage_cost_calculation',
          moId: formData.manufacturingOrderId,
          stageNo: formData.stageNumber as any,
          details: {
            goodQuantity: formData.goodQuantity,
            totalCost: result.data.totalCost || 0,
            unitCost: result.data.unitCost || 0
          },
          newValues: result.data
        })
        
        // Refresh stage costs
        await loadStageCosts()
      }
    } catch (error: any) {
      console.error('Stage costing error:', error)
      toast.error(`خطأ في احتساب تكلفة المرحلة: ${error.message}`)
    } finally {
      setIsCalculating(false)
    }
  }

  return (
    <div className="space-y-6" data-panel="stage-costing">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border p-6">
        <form onSubmit={(e) => e.preventDefault()}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Calculator className="h-6 w-6 text-primary" />
              <h2 className="text-xl font-bold">احتساب تكلفة المراحل (Process Costing)</h2>
            </div>
            <div className="flex gap-2">
              <Button 
                type="button"
                variant="outline" 
                size="sm"
                data-action="refresh-stage-costs"
                disabled={isCalculating}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
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
        
          {/* Manufacturing Order Selection */}
          <div className="grid md:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium mb-2">أمر التصنيع</label>
              <select 
                name="manufacturingOrderId"
                className="w-full px-3 py-2 border rounded-md"
                value={formData.manufacturingOrderId}
                onChange={(e) => handleInputChange('manufacturingOrderId', e.target.value)}
              >
                <option value="">اختر أمر التصنيع</option>
                {manufacturingOrders.map(order => (
                  <option key={order.id} value={order.id}>
                    {order.order_number} - {order.item?.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">رقم المرحلة</label>
              <Input 
                name="stageNumber"
                type="number"
                min="1"
                value={formData.stageNumber}
                onChange={(e) => handleInputChange('stageNumber', parseInt(e.target.value))}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">مركز العمل</label>
              <select 
                name="workCenterId"
                className="w-full px-3 py-2 border rounded-md"
                value={formData.workCenterId}
                onChange={(e) => handleInputChange('workCenterId', e.target.value)}
              >
                <option value="">اختر مركز العمل</option>
                {workCenters.map(wc => (
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
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
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
                />
              </div>
            </div>
          </div>
        
          {/* Cost Components */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
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
                />
              </div>
            </div>
          </div>
        
          {/* Labor Details */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
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
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">كود العملية</label>
                <Input 
                  name="operationCode"
                  value={formData.operationCode || ''}
                  onChange={(e) => handleInputChange('operationCode', e.target.value)}
                  placeholder="OP001, WELD, CUT, etc."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">ملاحظات</label>
                <Input 
                  name="notes"
                  value={formData.notes || ''}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  placeholder="أي ملاحظات إضافية"
                />
              </div>
            </div>
          </div>
        
          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 mb-6">
            <Button 
              type="button"
              data-action="apply-labor-time"
              disabled={isCalculating || !formData.laborHours || !formData.laborRate}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Clock className="h-4 w-4 mr-2" />
              تسجيل وقت العمل
            </Button>
            
            <Button 
              type="button"
              data-action="apply-overhead"
              disabled={isCalculating || !formData.overheadRate}
              className="bg-orange-600 hover:bg-orange-700"
            >
              <Settings className="h-4 w-4 mr-2" />
              تطبيق التكاليف غير المباشرة
            </Button>
            
            <Button 
              type="button"
              data-action="calculate-stage-cost"
              disabled={isCalculating || !formData.manufacturingOrderId || !formData.workCenterId || !formData.goodQuantity}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Calculator className="h-4 w-4 mr-2" />
              {isCalculating ? 'جاري الاحتساب...' : 'احتساب تكلفة المرحلة'}
            </Button>
          </div>
        </form>

        {/* Results Display */}
        {lastResult && (
          <div className="space-y-4" data-result={JSON.stringify(lastResult)}>
            <div className="grid md:grid-cols-4 gap-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
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
            <div className="grid md:grid-cols-3 gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
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
                className="bg-green-600 hover:bg-green-700"
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
        <div className="bg-white dark:bg-slate-900 rounded-lg border p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
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
                    <td className="p-2 font-medium">{stage.stage_number}</td>
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