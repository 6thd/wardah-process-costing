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
  Lock,
} from 'lucide-react'

// Import and register actions
import { registerStageCostingActions, unregisterStageCostingActions } from './stage-costing-actions.js'

// Import our new hooks
import { useManufacturingOrders } from '@/hooks/useManufacturingOrders'
import { useWorkCenters } from '@/hooks/useWorkCenters'
import { useManufacturingStages } from '@/hooks/useManufacturingStages'
import { useStageCosts, StageCost } from '@/hooks/useStageCosts'
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription'
import { usePermissions } from '@/hooks/usePermissions'
import { STAGE_COSTING_PERMISSIONS } from './stage-costing-permissions'

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

  // Every reference-data query and every live write on this screen is gated
  // by its own exact catalog key. manufacturing.stage_costs.read (checked by
  // ModuleGuard to reach this route at all) used to be treated as sufficient
  // for all four queries and all three writes below — a user holding only
  // that one key could read manufacturing orders, stages and work centers
  // they have no grant for, and reach live write actions registered
  // globally by stage-costing-actions.js under manufacturing.stage_costs.read
  // as well. Each resource now checks its own key.
  const { hasPermissionKey } = usePermissions()
  const canReadOrders = hasPermissionKey(STAGE_COSTING_PERMISSIONS.ORDERS_READ)
  const canReadStages = hasPermissionKey(STAGE_COSTING_PERMISSIONS.STAGES_READ)
  const canReadWorkCenters = hasPermissionKey(STAGE_COSTING_PERMISSIONS.WORK_CENTERS_READ)
  const canReadStageCosts = hasPermissionKey(STAGE_COSTING_PERMISSIONS.STAGE_COSTS_READ)
  // apply-labor-time / apply-overhead always INSERT a new cost-input row
  // (labor_time_logs / moh_applied), so create alone authorizes them.
  // calculate-stage-cost UPSERTs stage_costs itself — the actual statement
  // executed (INSERT or UPDATE) depends on whether a row already exists for
  // this MO/stage, which the client cannot safely predict. Requiring only
  // one of create/update would be a bypass: create-only could UPDATE an
  // existing conflicting row, and update-only could INSERT a new one. Both
  // exact keys are required.
  const canApplyLaborTime = hasPermissionKey(STAGE_COSTING_PERMISSIONS.STAGE_COSTS_CREATE)
  const canApplyOverhead = hasPermissionKey(STAGE_COSTING_PERMISSIONS.STAGE_COSTS_CREATE)
  const canCalculateStageCost =
    hasPermissionKey(STAGE_COSTING_PERMISSIONS.STAGE_COSTS_CREATE) &&
    hasPermissionKey(STAGE_COSTING_PERMISSIONS.STAGE_COSTS_UPDATE)

  // Use our new React Query hooks — each disabled independently when the
  // matching read key is absent, so no request for that resource is even
  // sent (not merely hidden from the rendered result).
  const { data: manufacturingOrdersData, isLoading: isMOLoading, isError: isMOError } = useManufacturingOrders({ enabled: canReadOrders })
  const { data: workCentersData, isLoading: isWCLoading, isError: isWCError } = useWorkCenters({ enabled: canReadWorkCenters })
  const { data: stagesData, isLoading: isStagesLoading, isError: isStagesError } = useManufacturingStages({ enabled: canReadStages })
  const { data: stageCostsData, isLoading: isSCLoading, isError: isSCError } = useStageCosts(formData.manufacturingOrderId, { enabled: canReadStageCosts })

  // Type assertions for data - needed because hooks return unknown types.
  // Re-gated here (not just via `enabled` above) because TanStack Query
  // keeps a query's last-known cache around after `enabled` flips to false —
  // it pauses fetching, it does not erase what a prior authorized fetch (or
  // one already in flight when permission was revoked) already stored. A
  // user whose grant is revoked mid-session must not keep seeing rows from
  // before the revocation just because the cache still holds them, so the
  // rendered arrays check the live permission flag directly rather than
  // trusting cache presence alone.
  const manufacturingOrders = canReadOrders && Array.isArray(manufacturingOrdersData) ? manufacturingOrdersData as Array<Record<string, unknown>> : []
  const workCenters = canReadWorkCenters && Array.isArray(workCentersData) ? (workCentersData as unknown as Array<Record<string, unknown>>) : []
  const stages = canReadStages && Array.isArray(stagesData) ? stagesData as Array<Record<string, unknown>> : []
  const stageCosts = canReadStageCosts && Array.isArray(stageCostsData) ? stageCostsData as StageCost[] : []

  // Setup realtime subscriptions — disabled (and torn down if already open)
  // for any resource the user cannot read, so a revoked grant also stops
  // silent background invalidation from a channel the UI has no business
  // listening to.
  useRealtimeSubscription('manufacturing_orders', 'manufacturing-orders', { enabled: canReadOrders })
  useRealtimeSubscription('work_centers', 'work-centers', { enabled: canReadWorkCenters })
  useRealtimeSubscription('stage_costs', ['stage-costs', formData.manufacturingOrderId], { enabled: canReadStageCosts })

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
                disabled={isSCLoading || !canReadStageCosts}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isSCLoading ? 'animate-spin' : ''}`} />
                تحديث
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-action="view-stage-report"
                disabled={!canReadStageCosts}
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
              <label htmlFor="manufacturingOrderId" className="block text-sm font-medium mb-2">أمر التصنيع</label>
              <select
                id="manufacturingOrderId"
                name="manufacturingOrderId"
                className="w-full px-3 py-2 border rounded-md wardah-glass-card"
                value={formData.manufacturingOrderId}
                onChange={(e) => handleInputChange('manufacturingOrderId', e.target.value)}
                disabled={isMOLoading || !canReadOrders}
              >
                <option value="">اختر أمر التصنيع</option>
                {manufacturingOrders.map((order: any) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number} - {order.product_id ? `Product ${order.product_id}` : 'N/A'}
                  </option>
                ))}
              </select>
              {!canReadOrders && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" /> لا تملك صلاحية عرض أوامر التصنيع
                </p>
              )}
            </div>

            <div>
              <label htmlFor="stageId" className="block text-sm font-medium mb-2">المرحلة</label>
              <select
                id="stageId"
                name="stageId"
                className="w-full px-3 py-2 border rounded-md wardah-glass-card"
                value={formData.stageId}
                onChange={(e) => handleInputChange('stageId', e.target.value)}
                disabled={isStagesLoading || !canReadStages}
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
              {!canReadStages && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" /> لا تملك صلاحية عرض مراحل التصنيع
                </p>
              )}
            </div>

            <div>
              <label htmlFor="workCenterId" className="block text-sm font-medium mb-2">مركز العمل</label>
              <select
                id="workCenterId"
                name="workCenterId"
                className="w-full px-3 py-2 border rounded-md wardah-glass-card"
                value={formData.workCenterId}
                onChange={(e) => handleInputChange('workCenterId', e.target.value)}
                disabled={isWCLoading || !canReadWorkCenters}
              >
                <option value="">اختر مركز العمل</option>
                {workCenters.map((wc: any) => (
                  <option key={wc.id} value={wc.id}>
                    {wc.code} - {wc.name}
                  </option>
                ))}
              </select>
              {!canReadWorkCenters && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" /> لا تملك صلاحية عرض مراكز العمل
                </p>
              )}
            </div>
            
            <div>
              <label htmlFor="mo-status" className="block text-sm font-medium mb-2">حالة الأمر</label>
              <div id="mo-status" className="pt-2">
                {selectedMO && (
                  <Badge variant={selectedMO.status === 'in_progress' ? 'default' : 'outline'}>
                    {(() => {
                      if (selectedMO.status === 'pending') return 'في الانتظار';
                      if (selectedMO.status === 'in_progress') return 'قيد التنفيذ';
                      if (selectedMO.status === 'completed') return 'مكتمل';
                      return selectedMO.status;
                    })()}
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
                <label htmlFor="goodQuantity" className="block text-sm font-medium mb-2">الكمية الجيدة</label>
                <Input 
                  id="goodQuantity"
                  name="goodQuantity"
                  type="number"
                  min="0"
                  value={formData.goodQuantity}
                  onChange={(e) => handleInputChange('goodQuantity', e.target.value)}
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label htmlFor="scrapQuantity" className="block text-sm font-medium mb-2">الكمية المعيبة</label>
                <Input 
                  id="scrapQuantity"
                  name="scrapQuantity"
                  type="number"
                  min="0"
                  value={formData.scrapQuantity}
                  onChange={(e) => handleInputChange('scrapQuantity', e.target.value)}
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label htmlFor="reworkQuantity" className="block text-sm font-medium mb-2">كمية إعادة التشغيل</label>
                <Input 
                  id="reworkQuantity"
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
                <label htmlFor="directMaterialCost" className="block text-sm font-medium mb-2">تكلفة المواد المباشرة (ريال)</label>
                <Input 
                  id="directMaterialCost"
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
                <label htmlFor="laborHours" className="block text-sm font-medium mb-2">ساعات العمل</label>
                <Input 
                  id="laborHours"
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
                <label htmlFor="laborRate" className="block text-sm font-medium mb-2">معدل الأجر بالساعة (ريال)</label>
                <Input 
                  id="laborRate"
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
                <label htmlFor="overheadRate" className="block text-sm font-medium mb-2">معدل التكاليف غير المباشرة (%)</label>
                <Input 
                  id="overheadRate"
                  name="overheadRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.overheadRate * 100}
                  onChange={(e) => handleInputChange('overheadRate', Number.parseFloat(e.target.value) / 100)}
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
                <label htmlFor="employeeName" className="block text-sm font-medium mb-2">اسم الموظف</label>
                <Input 
                  id="employeeName"
                  name="employeeName"
                  value={formData.employeeName || ''}
                  onChange={(e) => handleInputChange('employeeName', e.target.value)}
                  placeholder="اسم الموظف أو المشغل"
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label htmlFor="operationCode" className="block text-sm font-medium mb-2">كود العملية</label>
                <Input 
                  id="operationCode"
                  name="operationCode"
                  value={formData.operationCode || ''}
                  onChange={(e) => handleInputChange('operationCode', e.target.value)}
                  placeholder="OP001, WELD, CUT, etc."
                  className="wardah-glass-card"
                />
              </div>
              
              <div>
                <label htmlFor="notes" className="block text-sm font-medium mb-2">ملاحظات</label>
                <Input 
                  id="notes"
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
              disabled={!formData.laborHours || !formData.laborRate || !canApplyLaborTime}
              title={canApplyLaborTime ? undefined : 'لا تملك صلاحية تسجيل وقت العمل'}
              className="bg-purple-600 hover:bg-purple-700 wardah-glass-card"
            >
              <Clock className="h-4 w-4 mr-2" />
              تسجيل وقت العمل
            </Button>

            <Button
              type="button"
              data-action="apply-overhead"
              disabled={!formData.overheadRate || !canApplyOverhead}
              title={canApplyOverhead ? undefined : 'لا تملك صلاحية تطبيق التكاليف غير المباشرة'}
              className="bg-orange-600 hover:bg-orange-700 wardah-glass-card"
            >
              <Settings className="h-4 w-4 mr-2" />
              تطبيق التكاليف غير المباشرة
            </Button>

            <Button
              type="button"
              data-action="calculate-stage-cost"
              disabled={!formData.manufacturingOrderId || !formData.workCenterId || !formData.goodQuantity || !canCalculateStageCost}
              title={canCalculateStageCost ? undefined : 'لا تملك صلاحية احتساب تكلفة المرحلة'}
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
                <div className="text-sm text-muted-foreground dark:text-gray-300">نسبة الجودة</div>
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
                <div className="text-lg font-bold text-foreground dark:text-muted-foreground">
                  {(lastResult.totalCost - lastResult.transferredIn - lastResult.laborCost - lastResult.overheadCost).toFixed(2)}
                </div>
                <div className="text-sm text-muted-foreground dark:text-gray-300">المواد المباشرة</div>
              </div>
            </div>
            
            {/*
              "Post to GL" has no real implementation — the action handler it
              used to call (post-stage-to-gl) only ever returned a fabricated
              success response and never wrote a GL entry. Rather than gate a
              write that doesn't exist behind a permission check (which would
              misrepresent it as a protected real GL write), the control is
              shown disabled and labeled unavailable.
            */}
            <div className="flex flex-col items-center gap-1">
              <Button
                type="button"
                disabled
                title="ترحيل المرحلة للدفتر العام غير متاح حاليًا"
                className="wardah-glass-card"
              >
                <Lock className="h-4 w-4 mr-2" />
                ترحيل للدفتر العام (غير متاح حاليًا)
              </Button>
            </div>

            <div className="text-xs text-muted-foreground text-center">
              تم الحساب في: {new Date(lastResult.calculatedAt).toLocaleString('en-US')}
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
                  <tr key={stage.id || index} className="border-b hover:bg-muted/50 dark:hover:bg-gray-800">
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
                        {(() => {
                          if (stage.status === 'precosted') return 'تكلفة مُقدرة';
                          if (stage.status === 'actual') return 'تكلفة فعلية';
                          if (stage.status === 'completed') return 'مكتملة';
                          return stage.status;
                        })()}
                      </Badge>
                    </td>
                    <td className="p-2 text-sm text-muted-foreground">
                      {new Date(stage.updated_at || stage.created_at).toLocaleDateString('en-US')}
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