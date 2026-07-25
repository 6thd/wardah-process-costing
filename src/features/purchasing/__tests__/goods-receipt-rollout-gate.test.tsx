/**
 * بوابة طرح محرك الوحدات على شاشة الاستلام (Migration 148).
 *
 * العقد: العلم `uom_engine_enabled` يحكم **المسار الجديد** ولا يقطع المسار
 * التشغيلي القائم. والعلم مطفأ اليوم في كل المؤسسات، فأي ربط للشاشة به بلا
 * مسار بديل يعني توقف الاستلام في الإنتاج كليًا.
 *
 * هذه الاختبارات تثبت الحالتين صراحةً:
 *   - العلم مطفأ  ⇒ نموذج الاستلام التقليدي + قائمة السندات القائمة ظاهرة.
 *   - العلم مفعّل ⇒ نموذج UoM الجديد، والقائمة تبقى ظاهرة.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  isEnabled: false,
  getAllGoodsReceipts: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => ({ isEnabled: mocks.isEnabled }),
}))

vi.mock('@/services/purchasing-service', () => ({
  getAllGoodsReceipts: mocks.getAllGoodsReceipts,
  getAllSuppliers: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getAllPurchaseOrders: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getAllSupplierInvoices: vi.fn().mockResolvedValue({ success: true, data: [] }),
}))

vi.mock('@/components/forms/GoodsReceiptForm', () => ({
  GoodsReceiptForm: ({ open }: { open: boolean }) =>
    open ? <div>نموذج الاستلام التقليدي</div> : null,
}))

vi.mock('@/components/forms/UomGoodsReceiptForm', () => ({
  UomGoodsReceiptForm: ({ open }: { open: boolean }) =>
    open ? <div>نموذج استلام وحدات القياس</div> : null,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { PurchasingModule } from '../index'

const renderReceiptsScreen = () =>
  render(
    <MemoryRouter initialEntries={['/receipts']}>
      <PurchasingModule />
    </MemoryRouter>
  )

describe('شاشة الاستلام — بوابة طرح محرك الوحدات', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isEnabled = false
    mocks.getAllGoodsReceipts.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'gr-1',
          receipt_number: 'GR-000001',
          receipt_date: '2026-07-24',
          status: 'confirmed',
        },
      ],
    })
  })

  it('العلم مطفأ: الاستلام التقليدي يعمل والقائمة القائمة ظاهرة', async () => {
    renderReceiptsScreen()

    // قائمة السندات القائمة لا تختفي بإطفاء العلم.
    await waitFor(() => expect(mocks.getAllGoodsReceipts).toHaveBeenCalled())
    expect(await screen.findByText('GR-000001')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /إضافة استلام/ }))

    expect(await screen.findByText('نموذج الاستلام التقليدي')).toBeInTheDocument()
    expect(screen.queryByText('نموذج استلام وحدات القياس')).not.toBeInTheDocument()
  })

  it('العلم مفعّل: نموذج وحدات القياس هو العامل والقائمة تبقى ظاهرة', async () => {
    mocks.isEnabled = true
    renderReceiptsScreen()

    await waitFor(() => expect(mocks.getAllGoodsReceipts).toHaveBeenCalled())
    expect(await screen.findByText('GR-000001')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /إضافة استلام/ }))

    expect(await screen.findByText('نموذج استلام وحدات القياس')).toBeInTheDocument()
    expect(screen.queryByText('نموذج الاستلام التقليدي')).not.toBeInTheDocument()
  })

  it('فشل قراءة العلم لا يعطّل الاستلام — fail-closed إلى المسار التقليدي', async () => {
    // useUomEngineEnabled يعيد isEnabled=false أثناء التحميل وعند الخطأ.
    mocks.isEnabled = false
    renderReceiptsScreen()

    await userEvent.click(await screen.findByRole('button', { name: /إضافة استلام/ }))

    expect(await screen.findByText('نموذج الاستلام التقليدي')).toBeInTheDocument()
  })
})
