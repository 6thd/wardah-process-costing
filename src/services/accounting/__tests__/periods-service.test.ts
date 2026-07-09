/**
 * Periods Service Tests — إدارة الفترات المحاسبية (Migration 79)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { PeriodsService } from '../periods-service';

describe('PeriodsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listPeriods', () => {
    it('should return periods from rpc_list_periods', async () => {
      const periods = [
        {
          id: 'p-1', period_code: '2026-01', period_name: 'الفترة 2026-01',
          period_type: 'month', start_date: '2026-01-01', end_date: '2026-01-31',
          fiscal_year: 2026, status: 'closed',
        },
        {
          id: 'p-2', period_code: '2026-02', period_name: 'الفترة 2026-02',
          period_type: 'month', start_date: '2026-02-01', end_date: '2026-02-28',
          fiscal_year: 2026, status: 'open',
        },
      ];
      mockRpc.mockResolvedValue({ data: periods, error: null });

      const result = await PeriodsService.listPeriods(2026);

      expect(mockRpc).toHaveBeenCalledWith('rpc_list_periods', {
        p_fiscal_year: 2026,
        p_tenant: null,
      });
      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('closed');
    });

    it('should return empty array when rpc returns null', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await PeriodsService.listPeriods();

      expect(result).toEqual([]);
    });

    it('should throw Migration 79 hint when function is missing', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function rpc_list_periods' },
      });

      await expect(PeriodsService.listPeriods()).rejects.toThrow('Migration 79');
    });
  });

  describe('generateFiscalPeriods', () => {
    it('should generate periods for a fiscal year', async () => {
      mockRpc.mockResolvedValue({
        data: { success: true, fiscal_year: 2026, periods_created: 12, periods_existing: 0 },
        error: null,
      });

      const result = await PeriodsService.generateFiscalPeriods(2026);

      expect(mockRpc).toHaveBeenCalledWith('rpc_generate_fiscal_periods', {
        p_year: 2026,
        p_tenant: null,
      });
      expect(result.periods_created).toBe(12);
    });

    it('should propagate invalid year error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'INVALID_YEAR: السنة المالية غير صالحة (1999)' },
      });

      await expect(PeriodsService.generateFiscalPeriods(1999)).rejects.toThrow('INVALID_YEAR');
    });
  });

  describe('setPeriodStatus / closePeriod / reopenPeriod', () => {
    it('should close a period', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true, period_code: '2026-01',
          previous_status: 'open', status: 'closed', changed: true,
        },
        error: null,
      });

      const result = await PeriodsService.closePeriod('2026-01');

      expect(mockRpc).toHaveBeenCalledWith('rpc_set_period_status', {
        p_period_code: '2026-01',
        p_status: 'closed',
        p_tenant: null,
      });
      expect(result.changed).toBe(true);
      expect(result.status).toBe('closed');
    });

    it('should reopen a closed period', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true, period_code: '2026-01',
          previous_status: 'closed', status: 'open', changed: true,
        },
        error: null,
      });

      const result = await PeriodsService.reopenPeriod('2026-01');

      expect(mockRpc).toHaveBeenCalledWith('rpc_set_period_status', {
        p_period_code: '2026-01',
        p_status: 'open',
        p_tenant: null,
      });
      expect(result.status).toBe('open');
    });

    it('should propagate PERIOD_LOCKED for permanently closed periods', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'PERIOD_LOCKED: الفترة "2025-12" مقفلة نهائياً ولا يمكن تغيير حالتها' },
      });

      await expect(PeriodsService.reopenPeriod('2025-12')).rejects.toThrow('PERIOD_LOCKED');
    });

    it('should propagate PERIOD_NOT_FOUND', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'PERIOD_NOT_FOUND: الفترة "2030-01" غير موجودة' },
      });

      await expect(PeriodsService.closePeriod('2030-01')).rejects.toThrow('PERIOD_NOT_FOUND');
    });
  });
});
