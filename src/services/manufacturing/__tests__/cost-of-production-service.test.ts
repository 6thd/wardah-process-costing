/**
 * اختبارات خدمة تقرير تكلفة الإنتاج (Migration 80)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve(null)),
}))

import { CostOfProductionService } from '../cost-of-production-service'
import type { CostOfProductionReport } from '../cost-of-production-service'

/** تقرير نموذجي متوازن — مرحلة واحدة بالمتوسط المرجّح */
function sampleReport(overrides?: Partial<CostOfProductionReport>): CostOfProductionReport {
  return {
    success: true,
    report_type: 'cost_of_production',
    generated_at: '2026-07-09T12:00:00Z',
    manufacturing_order: {
      id: 'mo-1',
      order_number: 'MO-2026-0001',
      product_id: 'prod-1',
      status: 'in_progress',
      qty_planned: 1000
    },
    stages: [
      {
        stage_no: 1,
        work_center_id: 'wc-1',
        costing_method: 'weighted_average',
        mode: 'actual',
        quantity_schedule: {
          wip_beginning_qty: 100,
          units_started: 900,
          units_to_account: 1000,
          units_completed: 800,
          wip_ending_qty: 150,
          normal_scrap_qty: 40,
          abnormal_scrap_qty: 10,
          rework_qty: 0,
          units_accounted: 1000,
          qty_difference: 0,
          is_balanced: true
        },
        equivalent_units: {
          eup_dm: 950, // 800 + 150×100%
          eup_cc: 875, // 800 + 150×50%
          wip_end_dm_completion_pct: 100,
          wip_end_cc_completion_pct: 50,
          wip_beg_dm_completion_pct: 0,
          wip_beg_cc_completion_pct: 0
        },
        costs_to_account: {
          wip_beginning_cost: 500,
          transferred_in: 0,
          direct_materials: 9500,
          direct_labor: 5000,
          overhead_applied: 3750,
          conversion_costs: 8750,
          regrind_cost: 0,
          waste_credit: 0,
          total_costs_in: 18750
        },
        cost_per_eu: {
          transferred_in_per_eu: 0,
          dm_per_eu: 10,
          cc_per_eu: 10.571429,
          total_per_eu: 20.571429,
          stored_unit_cost: 20.57
        },
        cost_assignment: {
          completed_and_transferred: 16371.43,
          ending_wip: 2292.86,
          abnormal_scrap_loss: 85.71,
          normal_scrap_absorbed: 342.86,
          total_costs_out: 18750
        },
        reconciliation: {
          costs_in: 18750,
          costs_out: 18750,
          difference: 0,
          is_balanced: true,
          stored_total_cost: 18750,
          stored_vs_computed_diff: 0
        }
      }
    ],
    totals: {
      total_costs_in: 18750,
      total_completed: 16371.43,
      total_ending_wip: 2292.86,
      total_abnormal_scrap_loss: 85.71,
      all_stages_balanced: true
    },
    ...overrides
  }
}

describe('CostOfProductionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getReport', () => {
    it('يستدعي rpc_cost_of_production_report بالمعاملات الصحيحة', async () => {
      mockRpc.mockResolvedValue({ data: sampleReport(), error: null })

      await CostOfProductionService.getReport('mo-1')

      expect(mockRpc).toHaveBeenCalledWith('rpc_cost_of_production_report', {
        p_mo_id: 'mo-1',
        p_stage_no: null,
        p_tenant: null
      })
    })

    it('يمرّر رقم المرحلة وهوية المؤسسة عند تحديدهما', async () => {
      mockRpc.mockResolvedValue({ data: sampleReport(), error: null })

      await CostOfProductionService.getReport('mo-1', 2, 'org-9')

      expect(mockRpc).toHaveBeenCalledWith('rpc_cost_of_production_report', {
        p_mo_id: 'mo-1',
        p_stage_no: 2,
        p_tenant: 'org-9'
      })
    })

    it('يرجع التقرير كاملاً ببنيته الصحيحة', async () => {
      mockRpc.mockResolvedValue({ data: sampleReport(), error: null })

      const report = await CostOfProductionService.getReport('mo-1')

      expect(report.manufacturing_order.order_number).toBe('MO-2026-0001')
      expect(report.stages).toHaveLength(1)
      expect(report.stages[0].quantity_schedule.units_to_account).toBe(1000)
      expect(report.stages[0].equivalent_units.eup_dm).toBe(950)
      expect(report.stages[0].reconciliation.is_balanced).toBe(true)
      expect(report.totals.all_stages_balanced).toBe(true)
    })

    it('يرمي رسالة Migration 80 عند PGRST202', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' }
      })

      await expect(CostOfProductionService.getReport('mo-1'))
        .rejects.toThrow('Migration 80')
    })

    it('يمرّر أخطاء قاعدة البيانات الحقيقية كما هي', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'MO_NOT_FOUND: أمر التصنيع غير موجود' }
      })

      await expect(CostOfProductionService.getReport('mo-x'))
        .rejects.toThrow('MO_NOT_FOUND')
    })

    it('يرمي خطأً واضحاً إذا رجعت البيانات فارغة بلا خطأ', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null })

      await expect(CostOfProductionService.getReport('mo-1'))
        .rejects.toThrow('لم تُرجع قاعدة البيانات تقريراً')
    })
  })

  describe('isFullyReconciled', () => {
    it('يرجع true عندما تكون كل المراحل متوازنة', async () => {
      mockRpc.mockResolvedValue({ data: sampleReport(), error: null })

      await expect(CostOfProductionService.isFullyReconciled('mo-1')).resolves.toBe(true)
    })

    it('يرجع false عند وجود اختلال في أي مرحلة', async () => {
      const unbalanced = sampleReport({
        totals: {
          total_costs_in: 18750,
          total_completed: 16000,
          total_ending_wip: 2292.86,
          total_abnormal_scrap_loss: 85.71,
          all_stages_balanced: false
        }
      })
      mockRpc.mockResolvedValue({ data: unbalanced, error: null })

      await expect(CostOfProductionService.isFullyReconciled('mo-1')).resolves.toBe(false)
    })
  })
})
