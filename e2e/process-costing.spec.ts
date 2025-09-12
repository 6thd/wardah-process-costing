/**
 * End-to-End Tests for Process Costing Workflow
 * Tests the complete process costing journey from MO creation to GL posting
 */

import { test, expect } from '@playwright/test'

test.describe('Process Costing E2E Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the manufacturing module
    await page.goto('/manufacturing')
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle')
  })

  test('complete process costing workflow', async ({ page }) => {
    // Step 1: Create a Manufacturing Order
    await test.step('Create Manufacturing Order', async () => {
      await page.click('[data-testid="create-mo-button"]')
      
      // Fill MO form
      await page.selectOption('[name="itemId"]', 'test-item-001')
      await page.fill('[name="quantity"]', '100')
      await page.fill('[name="orderNumber"]', 'MO-E2E-001')
      
      await page.click('[data-testid="save-mo-button"]')
      
      // Verify MO creation
      await expect(page.locator('[data-testid="mo-success-message"]')).toBeVisible()
    })

    // Step 2: Navigate to Stage Costing Panel
    await test.step('Open Stage Costing Panel', async () => {
      await page.click('[data-testid="stage-costing-tab"]')
      
      // Verify panel is loaded
      await expect(page.locator('text=احتساب تكلفة المراحل')).toBeVisible()
    })

    // Step 3: Select Manufacturing Order and Work Center
    await test.step('Select MO and Work Center', async () => {
      await page.selectOption('[name="manufacturingOrderId"]', 'MO-E2E-001')
      await page.selectOption('[name="workCenterId"]', 'WC-001')
      await page.fill('[name="stageNumber"]', '1')
      
      // Verify form data
      await expect(page.locator('[name="manufacturingOrderId"]')).toHaveValue('MO-E2E-001')
    })

    // Step 4: Input Production Quantities
    await test.step('Input Production Data', async () => {
      await page.fill('[name="goodQuantity"]', '95')
      await page.fill('[name="scrapQuantity"]', '3')
      await page.fill('[name="reworkQuantity"]', '2')
      
      // Input costs
      await page.fill('[name="directMaterialCost"]', '5000')
      await page.fill('[name="laborHours"]', '40')
      await page.fill('[name="laborRate"]', '25')
      await page.fill('[name="overheadRate"]', '15')
    })

    // Step 5: Apply Labor Time
    await test.step('Apply Labor Time', async () => {
      await page.click('[data-action="apply-labor-time"]')
      
      // Wait for success message
      await expect(page.locator('text=تم تسجيل وقت العمل')).toBeVisible()
    })

    // Step 6: Apply Manufacturing Overhead
    await test.step('Apply Manufacturing Overhead', async () => {
      await page.click('[data-action="apply-overhead"]')
      
      // Wait for success message
      await expect(page.locator('text=تم تطبيق التكاليف غير المباشرة')).toBeVisible()
    })

    // Step 7: Calculate Stage Cost
    await test.step('Calculate Stage Cost', async () => {
      await page.click('[data-action="calculate-stage-cost"]')
      
      // Wait for calculation to complete
      await expect(page.locator('[data-testid="stage-results"]')).toBeVisible()
      
      // Verify results are displayed
      await expect(page.locator('text=إجمالي التكلفة')).toBeVisible()
      await expect(page.locator('text=تكلفة الوحدة')).toBeVisible()
      
      // Verify efficiency calculation (95/100 = 95%)
      await expect(page.locator('text=95.0% كفاءة')).toBeVisible()
    })

    // Step 8: Post to General Ledger
    await test.step('Post to General Ledger', async () => {
      await page.click('[data-action="post-stage-to-gl"]')
      
      // Wait for GL posting confirmation
      await expect(page.locator('text=تم ترحيل المرحلة للدفتر العام')).toBeVisible()
      await expect(page.locator('text=رقم القيد')).toBeVisible()
    })

    // Step 9: Verify Stage History
    await test.step('Verify Stage Cost History', async () => {
      await expect(page.locator('[data-testid="stage-history-table"]')).toBeVisible()
      
      // Check that our stage appears in history
      const historyRow = page.locator('tr:has-text("1")').first()
      await expect(historyRow).toBeVisible()
      await expect(historyRow.locator('text=مكتملة')).toBeVisible()
    })
  })

  test('stage costing validation and error handling', async ({ page }) => {
    await test.step('Test Required Field Validation', async () => {
      await page.click('[data-testid="stage-costing-tab"]')
      
      // Try to calculate without required fields
      const calculateButton = page.locator('[data-action="calculate-stage-cost"]')
      await expect(calculateButton).toBeDisabled()
      
      // Fill minimum required fields
      await page.selectOption('[name="manufacturingOrderId"]', 'MO-001')
      await page.selectOption('[name="workCenterId"]', 'WC-001')
      await page.fill('[name="goodQuantity"]', '100')
      
      // Button should now be enabled
      await expect(calculateButton).toBeEnabled()
    })

    await test.step('Test Labor Time Validation', async () => {
      const laborButton = page.locator('[data-action="apply-labor-time"]')
      await expect(laborButton).toBeDisabled()
      
      // Fill labor data
      await page.fill('[name="laborHours"]', '8')
      await page.fill('[name="laborRate"]', '30')
      
      await expect(laborButton).toBeEnabled()
    })

    await test.step('Test Error Handling', async () => {
      // Simulate API error by using invalid data
      await page.fill('[name="goodQuantity"]', '-5')
      await page.click('[data-action="calculate-stage-cost"]')
      
      // Should show error message
      await expect(page.locator('text=خطأ')).toBeVisible()
    })
  })

  test('multi-stage process costing flow', async ({ page }) => {
    await test.step('Setup Multi-Stage Process', async () => {
      await page.click('[data-testid="stage-costing-tab"]')
      await page.selectOption('[name="manufacturingOrderId"]', 'MO-MULTI-001')
    })

    // Stage 1: Raw Material Processing
    await test.step('Process Stage 1', async () => {
      await page.selectOption('[name="workCenterId"]', 'WC-CUTTING')
      await page.fill('[name="stageNumber"]', '1')
      await page.fill('[name="goodQuantity"]', '1000')
      await page.fill('[name="directMaterialCost"]', '20000')
      await page.fill('[name="laborHours"]', '100')
      await page.fill('[name="laborRate"]', '25')
      
      await page.click('[data-action="apply-labor-time"]')
      await page.click('[data-action="calculate-stage-cost"]')
      
      // Verify Stage 1 completion
      await expect(page.locator('text=تم احتساب المرحلة 1')).toBeVisible()
    })

    // Stage 2: Assembly
    await test.step('Process Stage 2', async () => {
      await page.selectOption('[name="workCenterId"]', 'WC-ASSEMBLY')
      await page.fill('[name="stageNumber"]', '2')
      await page.fill('[name="goodQuantity"]', '950') // Some loss from Stage 1
      await page.fill('[name="directMaterialCost"]', '15000')
      await page.fill('[name="laborHours"]', '80')
      await page.fill('[name="laborRate"]', '30')
      
      await page.click('[data-action="apply-labor-time"]')
      await page.click('[data-action="calculate-stage-cost"]')
      
      // Verify Stage 2 includes transferred-in costs
      await expect(page.locator('text=محول من مرحلة سابقة')).toBeVisible()
      await expect(page.locator('text=تم احتساب المرحلة 2')).toBeVisible()
    })

    // Stage 3: Finishing
    await test.step('Process Stage 3', async () => {
      await page.selectOption('[name="workCenterId"]', 'WC-FINISHING')
      await page.fill('[name="stageNumber"]', '3')
      await page.fill('[name="goodQuantity"]', '900')
      await page.fill('[name="directMaterialCost"]', '8000')
      await page.fill('[name="laborHours"]', '60')
      await page.fill('[name="laborRate"]', '35')
      
      await page.click('[data-action="apply-labor-time"]')
      await page.click('[data-action="calculate-stage-cost"]')
      
      // Verify final stage
      await expect(page.locator('text=تم احتساب المرحلة 3')).toBeVisible()
    })

    // Verify Complete History
    await test.step('Verify Multi-Stage History', async () => {
      const historyTable = page.locator('[data-testid="stage-history-table"]')
      await expect(historyTable).toBeVisible()
      
      // Should show all 3 stages
      await expect(historyTable.locator('text=1')).toBeVisible()
      await expect(historyTable.locator('text=2')).toBeVisible()
      await expect(historyTable.locator('text=3')).toBeVisible()
    })
  })

  test('cost variance analysis and reporting', async ({ page }) => {
    await test.step('Generate Stage Cost Report', async () => {
      await page.click('[data-testid="stage-costing-tab"]')
      await page.selectOption('[name="manufacturingOrderId"]', 'MO-001')
      
      await page.click('[data-action="view-stage-report"]')
      
      // Verify report opens in new window
      const reportPage = await page.waitForEvent('popup')
      await expect(reportPage.locator('text=تقرير مراحل التكلفة')).toBeVisible()
      
      // Verify report content
      await expect(reportPage.locator('text=أمر التصنيع')).toBeVisible()
      await expect(reportPage.locator('text=إجمالي التكلفة')).toBeVisible()
      
      await reportPage.close()
    })

    await test.step('Verify Cost Efficiency Metrics', async () => {
      // Check efficiency calculations
      await page.fill('[name="goodQuantity"]', '85')
      await page.fill('[name="scrapQuantity"]', '10')
      await page.fill('[name="reworkQuantity"]', '5')
      
      await page.click('[data-action="calculate-stage-cost"]')
      
      // Efficiency should be 85/100 = 85%
      await expect(page.locator('text=85.0% كفاءة')).toBeVisible()
    })
  })

  test('integration with inventory and GL modules', async ({ page }) => {
    await test.step('Verify Inventory Updates', async () => {
      // Complete a stage costing calculation
      await page.click('[data-testid="stage-costing-tab"]')
      await page.selectOption('[name="manufacturingOrderId"]', 'MO-INV-001')
      await page.selectOption('[name="workCenterId"]', 'WC-001')
      await page.fill('[name="goodQuantity"]', '100')
      await page.fill('[name="directMaterialCost"]', '5000')
      
      await page.click('[data-action="calculate-stage-cost"]')
      await page.click('[data-action="post-stage-to-gl"]')
      
      // Navigate to inventory to verify updates
      await page.goto('/inventory')
      await page.waitForLoadState('networkidle')
      
      // Verify inventory movements were recorded
      await page.click('[data-testid="stock-movements-tab"]')
      await expect(page.locator('text=تحديث تكلفة الإنتاج')).toBeVisible()
    })

    await test.step('Verify GL Integration', async () => {
      // Navigate to general ledger
      await page.goto('/general-ledger')
      await page.waitForLoadState('networkidle')
      
      // Check journal entries
      await page.click('[data-testid="journal-entries-tab"]')
      
      // Verify cost allocation entries were created
      await expect(page.locator('text=تكلفة المرحلة')).toBeVisible()
      await expect(page.locator('text=منشور')).toBeVisible()
    })
  })
})