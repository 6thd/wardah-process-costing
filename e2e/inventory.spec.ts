/**
 * End-to-End Tests for Inventory Management
 * Tests inventory transactions, stock movements, and valuations
 */

import { test, expect } from '@playwright/test'

test.describe('Inventory Management E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/inventory')
    await page.waitForLoadState('networkidle')
  })

  test.describe('Items Management', () => {
    test('should display items list', async ({ page }) => {
      await expect(page.locator('[data-testid="items-list"]')).toBeVisible()
      await expect(page.locator('text=قائمة الأصناف')).toBeVisible()
    })

    test('should search for items', async ({ page }) => {
      const searchInput = page.locator('[data-testid="search-items"]')
      await searchInput.fill('منتج')
      await page.waitForTimeout(500) // Debounce
      
      // Results should be filtered
      const items = page.locator('[data-testid="item-row"]')
      await expect(items.first()).toBeVisible()
    })

    test('should filter items by stock status', async ({ page }) => {
      // Filter by low stock
      await page.selectOption('[name="stockFilter"]', 'low')
      
      // Should show only low stock items
      await expect(page.locator('text=مخزون منخفض')).toBeVisible()
    })

    test('should sort items', async ({ page }) => {
      await page.selectOption('[name="sortBy"]', 'name')
      await page.waitForTimeout(300)
      
      // Items should be sorted alphabetically
      const firstItem = page.locator('[data-testid="item-row"]').first()
      await expect(firstItem).toBeVisible()
    })
  })

  test.describe('Stock Transactions', () => {
    test('should create goods receipt', async ({ page }) => {
      await page.click('[data-testid="stock-transactions-tab"]')
      await page.click('[data-testid="new-receipt-btn"]')
      
      // Fill goods receipt form
      await page.selectOption('[name="itemId"]', { index: 1 })
      await page.fill('[name="quantity"]', '100')
      await page.fill('[name="unitCost"]', '50')
      await page.selectOption('[name="warehouseId"]', { index: 0 })
      
      await page.click('[data-testid="save-receipt-btn"]')
      
      // Verify success
      await expect(page.locator('text=تم استلام البضاعة بنجاح')).toBeVisible()
    })

    test('should create goods issue', async ({ page }) => {
      await page.click('[data-testid="stock-transactions-tab"]')
      await page.click('[data-testid="new-issue-btn"]')
      
      // Fill goods issue form
      await page.selectOption('[name="itemId"]', { index: 1 })
      await page.fill('[name="quantity"]', '50')
      await page.selectOption('[name="warehouseId"]', { index: 0 })
      await page.fill('[name="reason"]', 'استهلاك إنتاج')
      
      await page.click('[data-testid="save-issue-btn"]')
      
      // Verify success
      await expect(page.locator('text=تم صرف البضاعة بنجاح')).toBeVisible()
    })

    test('should validate insufficient stock', async ({ page }) => {
      await page.click('[data-testid="stock-transactions-tab"]')
      await page.click('[data-testid="new-issue-btn"]')
      
      // Try to issue more than available
      await page.selectOption('[name="itemId"]', { index: 1 })
      await page.fill('[name="quantity"]', '999999')
      await page.selectOption('[name="warehouseId"]', { index: 0 })
      
      await page.click('[data-testid="save-issue-btn"]')
      
      // Should show error
      await expect(page.locator('text=الكمية المطلوبة غير متوفرة')).toBeVisible()
    })
  })

  test.describe('Stock Transfer', () => {
    test('should transfer stock between warehouses', async ({ page }) => {
      await page.click('[data-testid="stock-transfers-tab"]')
      await page.click('[data-testid="new-transfer-btn"]')
      
      // Fill transfer form
      await page.selectOption('[name="itemId"]', { index: 1 })
      await page.fill('[name="quantity"]', '25')
      await page.selectOption('[name="sourceWarehouseId"]', { index: 0 })
      await page.selectOption('[name="targetWarehouseId"]', { index: 1 })
      
      await page.click('[data-testid="save-transfer-btn"]')
      
      // Verify success
      await expect(page.locator('text=تم التحويل بنجاح')).toBeVisible()
    })

    test('should prevent transfer to same warehouse', async ({ page }) => {
      await page.click('[data-testid="stock-transfers-tab"]')
      await page.click('[data-testid="new-transfer-btn"]')
      
      await page.selectOption('[name="itemId"]', { index: 1 })
      await page.selectOption('[name="sourceWarehouseId"]', { index: 0 })
      await page.selectOption('[name="targetWarehouseId"]', { index: 0 })
      
      // Button should be disabled or show error
      const submitBtn = page.locator('[data-testid="save-transfer-btn"]')
      await expect(submitBtn).toBeDisabled()
    })
  })

  test.describe('Inventory Adjustments', () => {
    test('should create stock adjustment', async ({ page }) => {
      await page.click('[data-testid="adjustments-tab"]')
      await page.click('[data-testid="new-adjustment-btn"]')
      
      // Fill adjustment form
      await page.selectOption('[name="adjustmentType"]', 'count')
      await page.fill('[name="adjustmentReason"]', 'جرد فعلي')
      
      // Add item
      await page.click('[data-testid="add-adjustment-item"]')
      await page.selectOption('[name="itemId"]', { index: 1 })
      await page.fill('[name="actualQuantity"]', '95')
      
      await page.click('[data-testid="save-adjustment-btn"]')
      
      // Verify success
      await expect(page.locator('text=تم إنشاء تسوية المخزون')).toBeVisible()
    })

    test('should approve adjustment', async ({ page }) => {
      await page.click('[data-testid="adjustments-tab"]')
      
      // Find pending adjustment
      const pendingRow = page.locator('[data-status="pending"]').first()
      await pendingRow.click()
      
      await page.click('[data-testid="approve-adjustment-btn"]')
      
      // Verify approval
      await expect(page.locator('text=تم اعتماد التسوية')).toBeVisible()
    })
  })

  test.describe('Stock Valuation', () => {
    test('should display valuation report', async ({ page }) => {
      await page.click('[data-testid="valuation-tab"]')
      
      // Verify valuation table is shown
      await expect(page.locator('[data-testid="valuation-table"]')).toBeVisible()
      await expect(page.locator('text=قيمة المخزون')).toBeVisible()
    })

    test('should filter by valuation method', async ({ page }) => {
      await page.click('[data-testid="valuation-tab"]')
      await page.selectOption('[name="valuationMethod"]', 'FIFO')
      
      await page.waitForTimeout(300)
      
      // Should show only FIFO items
      await expect(page.locator('text=FIFO')).toBeVisible()
    })

    test('should calculate total inventory value', async ({ page }) => {
      await page.click('[data-testid="valuation-tab"]')
      
      // Verify total is calculated
      const totalValue = page.locator('[data-testid="total-inventory-value"]')
      await expect(totalValue).toBeVisible()
      
      // Value should be a formatted number
      const valueText = await totalValue.textContent()
      expect(valueText).toMatch(/[\d,]+/)
    })
  })

  test.describe('Stock Movements History', () => {
    test('should display movements history', async ({ page }) => {
      await page.click('[data-testid="movements-tab"]')
      
      await expect(page.locator('[data-testid="movements-table"]')).toBeVisible()
    })

    test('should filter movements by date', async ({ page }) => {
      await page.click('[data-testid="movements-tab"]')
      
      // Set date range
      await page.fill('[name="startDate"]', '2025-01-01')
      await page.fill('[name="endDate"]', '2025-12-31')
      
      await page.click('[data-testid="apply-filter-btn"]')
      
      // Results should be filtered
      await expect(page.locator('[data-testid="movements-table"]')).toBeVisible()
    })

    test('should filter movements by type', async ({ page }) => {
      await page.click('[data-testid="movements-tab"]')
      
      await page.selectOption('[name="movementType"]', 'receipt')
      
      // Should show only receipt movements
      const movements = page.locator('[data-testid="movement-row"][data-type="receipt"]')
      await expect(movements.first()).toBeVisible()
    })

    test('should export movements to Excel', async ({ page }) => {
      await page.click('[data-testid="movements-tab"]')
      
      // Start download
      const downloadPromise = page.waitForEvent('download')
      await page.click('[data-testid="export-excel-btn"]')
      const download = await downloadPromise
      
      // Verify download
      expect(download.suggestedFilename()).toContain('.xlsx')
    })
  })

  test.describe('Warehouse Management', () => {
    test('should display warehouses list', async ({ page }) => {
      await page.goto('/settings/warehouses')
      await page.waitForLoadState('networkidle')
      
      await expect(page.locator('[data-testid="warehouses-list"]')).toBeVisible()
    })

    test('should show warehouse stock levels', async ({ page }) => {
      await page.click('[data-testid="warehouse-stock-tab"]')
      
      // Select a warehouse
      await page.locator('[data-testid="warehouse-row"]').first().click()
      
      // Verify stock levels are shown
      await expect(page.locator('[data-testid="warehouse-stock-table"]')).toBeVisible()
    })
  })
})
