/**
 * اختبارات شاشة تقرير تكلفة الإنتاج
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../../../test/test-utils'

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key'

const mockRpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('test-tenant-id')),
}))

// أوامر تصنيع جاهزة للاختيار
vi.mock('../hooks/useManufacturingOrders', () => ({
  useManufacturingOrders: () => ({
    orders: [
      { id: 'mo-1', order_number: 'MO-2026-0001', product_name: 'منتج تجريبي', status: 'in_progress', quantity: 1000, item_id: 'item-1' },
    ],
    loading: false,
    loadOrders: vi.fn(),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' },
  }),
}))

import { CostOfProductionReportView } from '../cost-of-production-report'

describe('CostOfProductionReportView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('يعرض الشاشة بدون أخطاء مع حالة فارغة موجِّهة', async () => {
    render(<CostOfProductionReportView />)

    expect(screen.getByText('لم يُحدَّد أمر تصنيع بعد')).toBeInTheDocument()
    expect(
      screen.getByText(/اختر أمر تصنيع من القائمة أعلاه/)
    ).toBeInTheDocument()
  })

  it('يعرض قائمة اختيار أوامر التصنيع وأزرار التحكم', async () => {
    render(<CostOfProductionReportView />)

    expect(screen.getByTestId('mo-select')).toBeInTheDocument()
    expect(screen.getByText('طباعة')).toBeInTheDocument()
    expect(screen.getByText('تحديث')).toBeInTheDocument()
  })

  it('زر الطباعة معطَّل قبل توليد التقرير', () => {
    render(<CostOfProductionReportView />)

    const printBtn = screen.getByText('طباعة').closest('button')
    expect(printBtn).toBeDisabled()
  })
})
