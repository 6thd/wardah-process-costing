/**
 * اختبارات شاشة تسوية الدفاتر الفرعية مع GL
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../../../../test/test-utils'

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key'

const mockRpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('test-tenant-id')),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' },
  }),
}))

import { ReconciliationPage } from '../index'

const balancedReport = {
  success: true,
  report_type: 'subledger_gl_reconciliation',
  as_of_date: '2026-07-09',
  generated_at: '2026-07-09T12:00:00Z',
  gl_available: true,
  sections: [
    {
      section: 'inventory',
      title_ar: 'المخزون (مواد خام + إنتاج تام)',
      gl_prefixes: ['131', '135'],
      gl_balance: 250000,
      gl_accounts: [{ code: '131100', name: 'مواد خام LDPE', balance: 250000 }],
      subledger_balance: 250000,
      subledger_source: 'inventory_ledger',
      difference: 0,
      is_balanced: true,
      status: 'balanced'
    },
    {
      section: 'wip',
      title_ar: 'الإنتاج تحت التشغيل',
      gl_prefixes: ['134'],
      gl_balance: 42000,
      gl_accounts: [],
      subledger_balance: 41000,
      subledger_source: 'stage_costs (أوامر مفتوحة)',
      open_mo_count: 2,
      difference: 1000,
      is_balanced: false,
      status: 'unbalanced'
    }
  ],
  all_balanced: false
}

describe('ReconciliationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ data: balancedReport, error: null })
  })

  it('يعرض العنوان وحقل التاريخ وأزرار التحكم', async () => {
    render(<ReconciliationPage />)

    expect(screen.getByText('تسوية الدفاتر الفرعية مع الأستاذ العام')).toBeInTheDocument()
    expect(screen.getByTestId('as-of-date')).toBeInTheDocument()
    expect(screen.getByText('طباعة')).toBeInTheDocument()
  })

  it('يعرض قسمي المخزون وWIP مع حالة كل قسم', async () => {
    render(<ReconciliationPage />)

    await waitFor(() => {
      expect(screen.getByTestId('reconciliation-report')).toBeInTheDocument()
    })

    expect(screen.getByText('المخزون (مواد خام + إنتاج تام)')).toBeInTheDocument()
    expect(screen.getByText('الإنتاج تحت التشغيل')).toBeInTheDocument()
    expect(screen.getByText('متوازن')).toBeInTheDocument()
    expect(screen.getByText('يوجد فرق!')).toBeInTheDocument()
    // الشارة الكلية تعكس وجود فرق
    expect(screen.getByText('توجد فروق تحتاج مراجعة')).toBeInTheDocument()
  })

  it('يعرض رسالة الخطأ عند غياب Migration 81', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' }
    })

    render(<ReconciliationPage />)

    await waitFor(() => {
      expect(screen.getByText(/Migration 81/)).toBeInTheDocument()
    })
  })
})
