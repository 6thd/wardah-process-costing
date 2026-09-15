import { describe, expect, it } from 'vitest';
import type { ReportEmployee } from '@/services/hr/reports-service';
import {
  buildDepartmentAnalysis,
  buildTurnoverReport,
  UNASSIGNED_DEPARTMENT,
} from '../report-builders';

const employee = (
  id: string,
  hireDate: string,
  terminationDate: string | null,
  department: string | null = 'Production',
): ReportEmployee => ({
  id,
  employee_id: `E-${id}`,
  full_name: `Employee ${id}`,
  department,
  position: 'Operator',
  status: terminationDate ? 'terminated' : 'active',
  hire_date: hireDate,
  termination_date: terminationDate,
});

describe('HR report builders', () => {
  it('uses end-of-service events divided by average opening and closing headcount', () => {
    const report = buildTurnoverReport([
      employee('1', '2025-01-01', null),
      employee('2', '2025-01-01', '2026-06-30'),
      employee('3', '2026-02-01', null),
    ], { from: '2026-01-01', to: '2026-12-31' });

    expect(report.rows).toEqual([{
      from: '2026-01-01',
      to: '2026-12-31',
      startHeadcount: 2,
      endHeadcount: 2,
      endOfServiceEvents: 1,
      turnoverRate: 50,
    }]);
  });

  it('keeps employees without a department in an explicit unassigned bucket', () => {
    const report = buildDepartmentAnalysis([
      employee('1', '2025-01-01', null, null),
      employee('2', '2025-01-01', null, '  '),
      employee('3', '2025-01-01', null, 'Production'),
    ]);

    expect(report.rows).toContainEqual({
      department: UNASSIGNED_DEPARTMENT,
      count: 2,
      percentage: 66.67,
    });
  });
});
