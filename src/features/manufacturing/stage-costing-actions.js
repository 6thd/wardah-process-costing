/**
 * Stage Costing Actions Registration
 * Registers all actions for the stage costing panel with the UI event system
 */

import uiEvents from '../../ui/events.js'
import { toast } from 'sonner'

// Import domain modules
const ProcessCosting = await import('../../domain/processCosting.js')
const Manufacturing = await import('../../domain/manufacturing.js')
const Audit = await import('../../domain/audit.js')

/**
 * Register all stage costing actions
 */
export function registerStageCostingActions() {
  console.log('🎯 Registering stage costing actions...')

  // Refresh stage costs action
  uiEvents.registerAction('refresh-stage-costs', async (context) => {
    const { element } = context
    const panel = element.closest('[data-panel="stage-costing"]')
    if (!panel) return

    // Show loading state
    element.disabled = true
    element.innerHTML = '<span class="animate-spin">⟳</span> جاري التحديث...'

    try {
      // Get current MO ID from the panel
      const moSelect = panel.querySelector('[name="manufacturingOrderId"]')
      const moId = moSelect?.value

      if (moId) {
        // Refresh stage costs data
        const result = await ProcessCosting.getStageCosts(moId)
        if (result.success) {
          // Trigger data refresh event
          panel.dispatchEvent(new CustomEvent('stageCostsRefreshed', {
            detail: { stageCosts: result.data }
          }))
          toast.success('تم تحديث بيانات المراحل')
        }
      }
    } catch (error) {
      console.error('Error refreshing stage costs:', error)
      toast.error('خطأ في تحديث البيانات')
    } finally {
      // Restore button state
      element.disabled = false
      element.innerHTML = '<svg class="h-4 w-4 mr-2">...</svg> تحديث'
    }
  })

  // View stage report action
  uiEvents.registerAction('view-stage-report', async (context) => {
    const { element } = context
    const panel = element.closest('[data-panel="stage-costing"]')
    if (!panel) return

    try {
      const moSelect = panel.querySelector('[name="manufacturingOrderId"]')
      const moId = moSelect?.value

      if (!moId) {
        toast.error('يجب اختيار أمر التصنيع أولاً')
        return
      }

      // Get stage costs for the report
      const result = await ProcessCosting.getStageCosts(moId)
      if (result.success) {
        // Generate and show stage cost report
        await generateStageCostReport(moId, result.data)
      }
    } catch (error) {
      console.error('Error generating stage report:', error)
      toast.error('خطأ في إنشاء التقرير')
    }
  })

  // Apply labor time action
  uiEvents.registerAction('apply-labor-time', async (context) => {
    const { element, form } = context
    if (!form) return

    const formData = new FormData(form)
    const laborHours = parseFloat(formData.get('laborHours'))
    const laborRate = parseFloat(formData.get('laborRate'))

    if (!laborHours || !laborRate) {
      toast.error('يجب إدخال ساعات العمل ومعدل الأجر')
      return
    }

    // Show loading state
    element.disabled = true
    const originalText = element.textContent
    element.textContent = 'جاري التسجيل...'

    try {
      const result = await ProcessCosting.applyLaborTime({
        moId: formData.get('manufacturingOrderId'),
        stageNo: parseInt(formData.get('stageNumber')),
        workCenterId: formData.get('workCenterId'),
        hours: laborHours,
        hourlyRate: laborRate,
        employeeName: formData.get('employeeName'),
        operationCode: formData.get('operationCode'),
        notes: formData.get('notes')
      })

      if (result.success) {
        toast.success(`تم تسجيل وقت العمل: ${result.data.totalLaborCost.toFixed(2)} ريال`)
        
        // Trigger refresh
        form.dispatchEvent(new CustomEvent('laborTimeApplied', {
          detail: result.data
        }))
      }
    } catch (error) {
      console.error('Error applying labor time:', error)
      toast.error('خطأ في تسجيل وقت العمل')
    } finally {
      element.disabled = false
      element.textContent = originalText
    }
  })

  // Apply overhead action
  uiEvents.registerAction('apply-overhead', async (context) => {
    const { element, form } = context
    if (!form) return

    const formData = new FormData(form)
    const overheadRate = parseFloat(formData.get('overheadRate'))

    if (!overheadRate) {
      toast.error('يجب إدخال معدل التكاليف غير المباشرة')
      return
    }

    // Show loading state
    element.disabled = true
    const originalText = element.textContent
    element.textContent = 'جاري التطبيق...'

    try {
      const laborHours = parseFloat(formData.get('laborHours'))
      const laborRate = parseFloat(formData.get('laborRate'))
      const baseAmount = laborHours * laborRate

      const result = await ProcessCosting.applyOverhead({
        moId: formData.get('manufacturingOrderId'),
        stageNo: parseInt(formData.get('stageNumber')),
        workCenterId: formData.get('workCenterId'),
        allocationBase: 'labor_cost',
        baseQty: baseAmount,
        overheadRate: overheadRate,
        overheadType: 'variable',
        notes: `Applied at ${(overheadRate * 100)}% of labor cost`
      })

      if (result.success) {
        toast.success(`تم تطبيق التكاليف غير المباشرة: ${result.data.overheadAmount.toFixed(2)} ريال`)
        
        // Trigger refresh
        form.dispatchEvent(new CustomEvent('overheadApplied', {
          detail: result.data
        }))
      }
    } catch (error) {
      console.error('Error applying overhead:', error)
      toast.error('خطأ في تطبيق التكاليف غير المباشرة')
    } finally {
      element.disabled = false
      element.textContent = originalText
    }
  })

  // Calculate stage cost action
  uiEvents.registerAction('calculate-stage-cost', async (context) => {
    const { element, form } = context
    if (!form) return

    const formData = new FormData(form)
    const moId = formData.get('manufacturingOrderId')
    const workCenterId = formData.get('workCenterId')
    const goodQuantity = parseFloat(formData.get('goodQuantity'))

    if (!moId || !workCenterId || !goodQuantity) {
      toast.error('يجب إدخال جميع البيانات المطلوبة')
      return
    }

    // Show loading state
    element.disabled = true
    const originalText = element.textContent
    element.textContent = 'جاري الاحتساب...'

    try {
      const result = await ProcessCosting.upsertStageCost({
        moId: moId,
        stageNo: parseInt(formData.get('stageNumber')),
        workCenterId: workCenterId,
        goodQty: goodQuantity,
        directMaterialCost: parseFloat(formData.get('directMaterialCost')) || 0,
        mode: 'actual',
        scrapQty: parseFloat(formData.get('scrapQuantity')) || 0,
        reworkQty: parseFloat(formData.get('reworkQuantity')) || 0,
        notes: formData.get('notes')
      })

      if (result.success) {
        const efficiency = goodQuantity / (goodQuantity + (parseFloat(formData.get('scrapQuantity')) || 0) + (parseFloat(formData.get('reworkQuantity')) || 0)) * 100
        
        toast.success(`تم احتساب المرحلة ${formData.get('stageNumber')}: ${result.data.totalCost.toFixed(2)} ريال`)
        
        // Log the operation
        await Audit.logProcessCostingOperation({
          operation: 'stage_cost_calculation',
          moId: moId,
          stageNo: parseInt(formData.get('stageNumber')),
          details: {
            goodQuantity: goodQuantity,
            totalCost: result.data.totalCost,
            unitCost: result.data.unitCost
          },
          newValues: result.data
        })
        
        // Trigger UI update
        form.dispatchEvent(new CustomEvent('stageCostCalculated', {
          detail: {
            stageId: result.data.stageId,
            totalCost: result.data.totalCost,
            unitCost: result.data.unitCost,
            transferredIn: result.data.transferredIn,
            laborCost: result.data.laborCost,
            overheadCost: result.data.overheadCost,
            efficiency: efficiency || 100,
            calculatedAt: new Date().toISOString()
          }
        }))
      }
    } catch (error) {
      console.error('Stage costing error:', error)
      toast.error(`خطأ في احتساب تكلفة المرحلة: ${error.message}`)
    } finally {
      element.disabled = false
      element.textContent = originalText
    }
  })

  // Post to GL action
  uiEvents.registerAction('post-stage-to-gl', async (context) => {
    const { element } = context
    const panel = element.closest('[data-panel="stage-costing"]')
    if (!panel) return

    // Show loading state
    element.disabled = true
    const originalText = element.textContent
    element.textContent = 'جاري الترحيل...'

    try {
      // Get the last calculated result
      const resultData = panel.querySelector('[data-result]')?.dataset.result
      if (!resultData) {
        toast.error('لا توجد نتائج للترحيل')
        return
      }

      const result = JSON.parse(resultData)
      
      // Create GL entry for stage cost
      const glResult = await ProcessCosting.postStageToGL({
        stageId: result.stageId,
        totalCost: result.totalCost,
        materialCost: result.totalCost - result.transferredIn - result.laborCost - result.overheadCost,
        laborCost: result.laborCost,
        overheadCost: result.overheadCost,
        description: `تكلفة المرحلة - أمر ${element.closest('form')?.manufacturingOrderId?.value}`
      })

      if (glResult.success) {
        toast.success(`تم ترحيل المرحلة للدفتر العام - قيد رقم: ${glResult.data.entryNumber}`)
        
        // Update UI to show posted status
        element.style.display = 'none'
        const postedBadge = panel.querySelector('[data-gl-status]')
        if (postedBadge) {
          postedBadge.className = 'bg-green-50 border-green-200 p-4 rounded-lg border'
          postedBadge.innerHTML = `
            <div class="flex items-center gap-2">
              <svg class="h-5 w-5 text-green-600">...</svg>
              <span class="font-medium text-green-800">تم ترحيل المرحلة للدفتر العام</span>
            </div>
            <div class="mt-2 text-sm text-green-700">
              <strong>رقم القيد:</strong> ${glResult.data.entryNumber}
            </div>
          `
        }
      }
    } catch (error) {
      console.error('Error posting to GL:', error)
      toast.error('خطأ في ترحيل المرحلة للدفتر العام')
    } finally {
      element.disabled = false
      element.textContent = originalText
    }
  })

  console.log('✅ Stage costing actions registered successfully')
}

/**
 * Generate stage cost report
 */
async function generateStageCostReport(moId, stageCosts) {
  try {
    // Get MO details
    const moResult = await Manufacturing.getManufacturingOrderById(moId)
    if (!moResult.success) return

    const mo = moResult.data
    
    // Create report window
    const reportWindow = window.open('', '_blank', 'width=800,height=600')
    reportWindow.document.write(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>تقرير مراحل التكلفة - ${mo.order_number}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; direction: rtl; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
          .info { margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
          th { background-color: #f5f5f5; }
          .total-row { font-weight: bold; background-color: #e8f5e8; }
          .print-btn { margin: 10px 0; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>تقرير مراحل التكلفة</h1>
          <h2>أمر التصنيع: ${mo.order_number}</h2>
        </div>
        
        <div class="info">
          <p><strong>الصنف:</strong> ${mo.item?.name || 'غير محدد'}</p>
          <p><strong>الكمية المطلوبة:</strong> ${mo.quantity}</p>
          <p><strong>حالة الأمر:</strong> ${mo.status}</p>
          <p><strong>تاريخ التقرير:</strong> ${new Date().toLocaleDateString('ar-SA')}</p>
        </div>

        <table>
          <thead>
            <tr>
              <th>المرحلة</th>
              <th>مركز العمل</th>
              <th>الكمية الجيدة</th>
              <th>التكلفة الإجمالية</th>
              <th>تكلفة الوحدة</th>
              <th>الحالة</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            ${stageCosts.map(stage => `
              <tr>
                <td>${stage.stage_number}</td>
                <td>${stage.work_center?.name || stage.work_center_id}</td>
                <td>${stage.good_quantity}</td>
                <td>${stage.total_cost?.toFixed(2)} ريال</td>
                <td>${stage.unit_cost?.toFixed(2)} ريال</td>
                <td>${stage.status === 'completed' ? 'مكتملة' : stage.status === 'actual' ? 'فعلية' : 'مقدرة'}</td>
                <td>${new Date(stage.updated_at || stage.created_at).toLocaleDateString('ar-SA')}</td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td colspan="3">الإجمالي</td>
              <td>${stageCosts.reduce((sum, stage) => sum + (stage.total_cost || 0), 0).toFixed(2)} ريال</td>
              <td colspan="3">متوسط التكلفة: ${(stageCosts.reduce((sum, stage) => sum + (stage.total_cost || 0), 0) / mo.quantity).toFixed(2)} ريال/وحدة</td>
            </tr>
          </tbody>
        </table>

        <button class="print-btn no-print" onclick="window.print()">طباعة التقرير</button>
        <button class="print-btn no-print" onclick="window.close()">إغلاق</button>
      </body>
      </html>
    `)
    reportWindow.document.close()
  } catch (error) {
    console.error('Error generating report:', error)
    toast.error('خطأ في إنشاء التقرير')
  }
}

/**
 * Unregister stage costing actions
 */
export function unregisterStageCostingActions() {
  const actions = [
    'refresh-stage-costs',
    'view-stage-report', 
    'apply-labor-time',
    'apply-overhead',
    'calculate-stage-cost',
    'post-stage-to-gl'
  ]

  actions.forEach(action => {
    uiEvents.unregisterAction(action)
  })

  console.log('🗑️ Stage costing actions unregistered')
}