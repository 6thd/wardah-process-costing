/**
 * End-to-End Tests for Sales Module
 * Tests sales orders, invoices, and customer management
 */

import { test, expect } from '@playwright/test'

test.describe('Sales Module E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sales')
    await page.waitForLoadState('networkidle')
  })

  test.describe('Sales Orders', () => {
    test('should display sales orders list', async ({ page }) => {
      await page.click('[data-testid="sales-orders-tab"]')
      
      await expect(page.locator('[data-testid="orders-list"]')).toBeVisible()
      await expect(page.locator('text=أوامر البيع')).toBeVisible()
    })

    test('should create new sales order', async ({ page }) => {
      await page.click('[data-testid="sales-orders-tab"]')
      await page.click('[data-testid="new-order-btn"]')
      
      // Fill order header
      await page.fill('[name="orderNumber"]', 'SO-E2E-001')
      await page.selectOption('[name="customerId"]', { index: 1 })
      await page.fill('[name="orderDate"]', '2025-01-15')
      
      // Add line item
      await page.click('[data-testid="add-line-btn"]')
      await page.selectOption('[name="itemId-0"]', { index: 1 })
      await page.fill('[name="quantity-0"]', '10')
      await page.fill('[name="unitPrice-0"]', '100')
      
      // Verify line total
      await expect(page.locator('[data-testid="line-total-0"]')).toContainText('1,000')
      
      await page.click('[data-testid="save-order-btn"]')
      
      // Verify success
      await expect(page.locator('text=تم حفظ أمر البيع بنجاح')).toBeVisible()
    })

    test('should calculate order totals', async ({ page }) => {
      await page.click('[data-testid="sales-orders-tab"]')
      await page.click('[data-testid="new-order-btn"]')
      
      // Add multiple lines
      await page.click('[data-testid="add-line-btn"]')
      await page.selectOption('[name="itemId-0"]', { index: 1 })
      await page.fill('[name="quantity-0"]', '10')
      await page.fill('[name="unitPrice-0"]', '100')
      
      await page.click('[data-testid="add-line-btn"]')
      await page.selectOption('[name="itemId-1"]', { index: 2 })
      await page.fill('[name="quantity-1"]', '5')
      await page.fill('[name="unitPrice-1"]', '200')
      
      // Verify subtotal (10*100 + 5*200 = 2000)
      await expect(page.locator('[data-testid="order-subtotal"]')).toContainText('2,000')
    })

    test('should apply discount', async ({ page }) => {
      await page.click('[data-testid="sales-orders-tab"]')
      await page.click('[data-testid="new-order-btn"]')
      
      await page.click('[data-testid="add-line-btn"]')
      await page.selectOption('[name="itemId-0"]', { index: 1 })
      await page.fill('[name="quantity-0"]', '10')
      await page.fill('[name="unitPrice-0"]', '100')
      
      // Apply 10% discount
      await page.fill('[name="discount"]', '10')
      
      // Verify discounted total (1000 - 10% = 900)
      await expect(page.locator('[data-testid="order-total"]')).toContainText('900')
    })

    test('should confirm sales order', async ({ page }) => {
      await page.click('[data-testid="sales-orders-tab"]')
      
      // Find draft order
      const draftOrder = page.locator('[data-status="draft"]').first()
      await draftOrder.click()
      
      await page.click('[data-testid="confirm-order-btn"]')
      
      // Verify confirmed
      await expect(page.locator('text=تم تأكيد أمر البيع')).toBeVisible()
    })

    test('should search sales orders', async ({ page }) => {
      await page.click('[data-testid="sales-orders-tab"]')
      
      await page.fill('[data-testid="search-orders"]', 'SO-001')
      
      // Results should be filtered
      await expect(page.locator('text=SO-001')).toBeVisible()
    })
  })

  test.describe('Delivery Notes', () => {
    test('should create delivery note from sales order', async ({ page }) => {
      await page.click('[data-testid="sales-orders-tab"]')
      
      // Find confirmed order
      const confirmedOrder = page.locator('[data-status="confirmed"]').first()
      await confirmedOrder.click()
      
      await page.click('[data-testid="create-delivery-btn"]')
      
      // Fill delivery details
      await page.fill('[name="deliveryDate"]', '2025-01-20')
      await page.selectOption('[name="warehouseId"]', { index: 0 })
      
      // Verify items are pre-filled
      await expect(page.locator('[data-testid="delivery-line-0"]')).toBeVisible()
      
      await page.click('[data-testid="save-delivery-btn"]')
      
      // Verify success
      await expect(page.locator('text=تم إنشاء إذن التسليم')).toBeVisible()
    })

    test('should complete delivery', async ({ page }) => {
      await page.click('[data-testid="deliveries-tab"]')
      
      // Find pending delivery
      const pendingDelivery = page.locator('[data-status="pending"]').first()
      await pendingDelivery.click()
      
      await page.click('[data-testid="complete-delivery-btn"]')
      
      // Confirm stock reduction
      await page.click('[data-testid="confirm-stock-reduction"]')
      
      // Verify completed
      await expect(page.locator('text=تم إتمام التسليم')).toBeVisible()
    })

    test('should validate stock availability', async ({ page }) => {
      await page.click('[data-testid="deliveries-tab"]')
      await page.click('[data-testid="new-delivery-btn"]')
      
      // Try to deliver more than available
      await page.selectOption('[name="itemId"]', { index: 1 })
      await page.fill('[name="quantity"]', '999999')
      
      await page.click('[data-testid="save-delivery-btn"]')
      
      // Should show error
      await expect(page.locator('text=الكمية غير متوفرة')).toBeVisible()
    })
  })

  test.describe('Sales Invoices', () => {
    test('should create invoice from delivery', async ({ page }) => {
      await page.click('[data-testid="deliveries-tab"]')
      
      // Find completed delivery without invoice
      const delivery = page.locator('[data-status="completed"][data-invoiced="false"]').first()
      await delivery.click()
      
      await page.click('[data-testid="create-invoice-btn"]')
      
      // Fill invoice details
      await page.fill('[name="invoiceDate"]', '2025-01-25')
      await page.fill('[name="dueDate"]', '2025-02-25')
      
      await page.click('[data-testid="save-invoice-btn"]')
      
      // Verify success
      await expect(page.locator('text=تم إنشاء الفاتورة')).toBeVisible()
    })

    test('should calculate VAT', async ({ page }) => {
      await page.click('[data-testid="invoices-tab"]')
      await page.click('[data-testid="new-invoice-btn"]')
      
      // Add line with VAT
      await page.click('[data-testid="add-line-btn"]')
      await page.selectOption('[name="itemId-0"]', { index: 1 })
      await page.fill('[name="quantity-0"]', '10')
      await page.fill('[name="unitPrice-0"]', '100')
      await page.selectOption('[name="taxRate-0"]', '15') // 15% VAT
      
      // Verify VAT calculation (1000 * 15% = 150)
      await expect(page.locator('[data-testid="line-vat-0"]')).toContainText('150')
      await expect(page.locator('[data-testid="invoice-total"]')).toContainText('1,150')
    })

    test('should post invoice to GL', async ({ page }) => {
      await page.click('[data-testid="invoices-tab"]')
      
      // Find draft invoice
      const draftInvoice = page.locator('[data-status="draft"]').first()
      await draftInvoice.click()
      
      await page.click('[data-testid="post-invoice-btn"]')
      
      // Verify GL posting
      await expect(page.locator('text=تم ترحيل الفاتورة للدفتر العام')).toBeVisible()
      await expect(page.locator('[data-testid="gl-entry-number"]')).toBeVisible()
    })

    test('should print invoice', async ({ page }) => {
      await page.click('[data-testid="invoices-tab"]')
      
      const invoice = page.locator('[data-testid="invoice-row"]').first()
      await invoice.click()
      
      await page.click('[data-testid="print-invoice-btn"]')
      
      // Print preview should open
    })
  })

  test.describe('Customer Payments', () => {
    test('should record customer payment', async ({ page }) => {
      await page.click('[data-testid="payments-tab"]')
      await page.click('[data-testid="new-payment-btn"]')
      
      // Select customer and invoice
      await page.selectOption('[name="customerId"]', { index: 1 })
      
      // Select unpaid invoices
      await page.click('[data-testid="select-invoice-1"]')
      
      // Enter payment amount
      await page.fill('[name="paymentAmount"]', '1000')
      await page.selectOption('[name="paymentMethod"]', 'bank_transfer')
      await page.fill('[name="reference"]', 'PAY-001')
      
      await page.click('[data-testid="save-payment-btn"]')
      
      // Verify success
      await expect(page.locator('text=تم تسجيل الدفعة بنجاح')).toBeVisible()
    })

    test('should show customer balance', async ({ page }) => {
      await page.click('[data-testid="customers-tab"]')
      
      const customer = page.locator('[data-testid="customer-row"]').first()
      await customer.click()
      
      // Should show customer balance
      await expect(page.locator('[data-testid="customer-balance"]')).toBeVisible()
    })

    test('should generate customer statement', async ({ page }) => {
      await page.click('[data-testid="customers-tab"]')
      
      const customer = page.locator('[data-testid="customer-row"]').first()
      await customer.click()
      
      await page.click('[data-testid="generate-statement-btn"]')
      
      // Set date range
      await page.fill('[name="startDate"]', '2025-01-01')
      await page.fill('[name="endDate"]', '2025-03-31')
      
      await page.click('[data-testid="view-statement-btn"]')
      
      // Statement should be displayed
      await expect(page.locator('[data-testid="customer-statement"]')).toBeVisible()
    })
  })

  test.describe('Sales Reports', () => {
    test('should generate sales by customer report', async ({ page }) => {
      await page.click('[data-testid="reports-tab"]')
      await page.click('[data-testid="sales-by-customer-btn"]')
      
      await page.fill('[name="startDate"]', '2025-01-01')
      await page.fill('[name="endDate"]', '2025-03-31')
      
      await page.click('[data-testid="generate-report-btn"]')
      
      await expect(page.locator('[data-testid="sales-report"]')).toBeVisible()
    })

    test('should generate sales by product report', async ({ page }) => {
      await page.click('[data-testid="reports-tab"]')
      await page.click('[data-testid="sales-by-product-btn"]')
      
      await page.fill('[name="startDate"]', '2025-01-01')
      await page.fill('[name="endDate"]', '2025-03-31')
      
      await page.click('[data-testid="generate-report-btn"]')
      
      await expect(page.locator('[data-testid="product-sales-report"]')).toBeVisible()
    })

    test('should export sales report to Excel', async ({ page }) => {
      await page.click('[data-testid="reports-tab"]')
      await page.click('[data-testid="sales-by-customer-btn"]')
      
      await page.fill('[name="startDate"]', '2025-01-01')
      await page.fill('[name="endDate"]', '2025-03-31')
      await page.click('[data-testid="generate-report-btn"]')
      
      const downloadPromise = page.waitForEvent('download')
      await page.click('[data-testid="export-excel-btn"]')
      const download = await downloadPromise
      
      expect(download.suggestedFilename()).toContain('.xlsx')
    })
  })
})
