/**
 * اختبارات خدمة تسوية الدفاتر الفرعية مع GL (Migration 81)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve(null)),
}))

import { ReconciliationService } from '../reconciliation-service'
import type { ReconciliationReport } from '../reconciliation-service'

function sampleReport(overrides?: Partial<ReconciliationReport>): ReconciliationReport {
  return {
    success: true,
    report_type: 'subledger_gl_reconciliation',
    as_of_date: '2026-07-09',
    generated_at: '2026-07-09T12:00:00Z',
    gl_available: true,
    sections: [
      {
        section: 'inventory',
        title_ar: 'المخزون (مواد خام + إنتاج تام)',
        gl_prefixes: ['131', '132', '133', '135'],
        gl_balance: 250000,
        gl_accounts: [
          { code: '131100', name: 'مواد خام LDPE', balance: 150000 },
          { code: '135100', name: 'FG أكياس مطبوعة', balance: 100000 }
        ],
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
        gl_accounts: [{ code: '134100', name: 'WIP الخلط', balance: 42000 }],
        subledger_balance: 42000,
        subledger_source: 'stage_costs (أوامر مفتوحة)',
        open_mo_count: 3,
        difference: 0,
        is_balanced: true,
        status: 'balanced'
      }
    ],
    all_balanced: true,
    ...overrides
  }
}

describe('ReconciliationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('يستدعي rpc_subledger_gl_reconciliation بتاريخ اليوم افتراضياً', async () => {
    mockRpc.mockResolvedValue({ data: sampleReport(), error: null })

    await ReconciliationService.getReport()

    const today = new Date().toISOString().slice(0, 10)
    expect(mockRpc).toHaveBeenCalledWith('rpc_subledger_gl_reconciliation', {
      p_as_of_date: today,
      p_tenant: null
    })
  })

  it('يمرّر التاريخ وهوية المؤسسة عند تحديدهما', async () => {
    mockRpc.mockResolvedValue({ data: sampleReport(), error: null })

    await ReconciliationService.getReport('2026-06-30', 'org-7')

    expect(mockRpc).toHaveBeenCalledWith('rpc_subledger_gl_reconciliation', {
      p_as_of_date: '2026-06-30',
      p_tenant: 'org-7'
    })
  })

  it('يرجع التقرير ببنيته الكاملة', async () => {
    mockRpc.mockResolvedValue({ data: sampleReport(), error: null })

    const report = await ReconciliationService.getReport()

    expect(report.sections).toHaveLength(2)
    expect(report.sections[0].section).toBe('inventory')
    expect(report.sections[1].open_mo_count).toBe(3)
    expect(report.all_balanced).toBe(true)
  })

  it('يرمي رسالة Migration 81 عند PGRST202', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' }
    })

    await expect(ReconciliationService.getReport()).rejects.toThrow('Migration 81')
  })

  it('يمرّر أخطاء قاعدة البيانات الحقيقية كما هي', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'ORG_NOT_RESOLVED: تعذر تحديد هوية المؤسسة' }
    })

    await expect(ReconciliationService.getReport()).rejects.toThrow('ORG_NOT_RESOLVED')
  })

  it('isBalanced يرجع false عند وجود فرق', async () => {
    mockRpc.mockResolvedValue({
      data: sampleReport({ all_balanced: false }),
      error: null
    })

    await expect(ReconciliationService.isBalanced()).resolves.toBe(false)
  })
})
