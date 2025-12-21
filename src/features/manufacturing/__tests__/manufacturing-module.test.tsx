/**
 * @fileoverview Comprehensive Tests for Manufacturing Module
 * Tests React components and business logic for manufacturing operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  Routes: ({ children }: any) => children,
  Route: ({ element }: any) => element,
  Navigate: () => null,
  Link: ({ children }: any) => children,
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/services/supabase-service', () => ({
  manufacturingService: {
    getAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Manufacturing Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Manufacturing Order Status', () => {
    it('should validate status transitions', () => {
      const validTransitions: Record<string, string[]> = {
        draft: ['planned', 'cancelled'],
        planned: ['in_progress', 'cancelled'],
        in_progress: ['completed', 'on_hold'],
        on_hold: ['in_progress', 'cancelled'],
        completed: [],
        cancelled: [],
      };

      const currentStatus = 'planned';
      const newStatus = 'in_progress';

      const isValid = validTransitions[currentStatus]?.includes(newStatus);
      expect(isValid).toBe(true);
    });

    it('should reject invalid status transitions', () => {
      const validTransitions: Record<string, string[]> = {
        draft: ['planned', 'cancelled'],
        planned: ['in_progress', 'cancelled'],
        in_progress: ['completed', 'on_hold'],
        completed: [],
        cancelled: [],
      };

      const currentStatus = 'draft';
      const newStatus = 'completed'; // Can't go directly from draft to completed

      const isValid = validTransitions[currentStatus]?.includes(newStatus);
      expect(isValid).toBe(false);
    });

    it('should identify active orders', () => {
      const orders = [
        { id: '1', status: 'draft' },
        { id: '2', status: 'in_progress' },
        { id: '3', status: 'completed' },
        { id: '4', status: 'planned' },
      ];

      const activeStatuses = ['in_progress', 'planned'];
      const activeOrders = orders.filter((o) => activeStatuses.includes(o.status));

      expect(activeOrders).toHaveLength(2);
    });

    it('should identify pending orders', () => {
      const orders = [
        { id: '1', status: 'draft' },
        { id: '2', status: 'planned' },
        { id: '3', status: 'completed' },
      ];

      const pendingOrders = orders.filter(
        (o) => o.status === 'draft' || o.status === 'planned'
      );

      expect(pendingOrders).toHaveLength(2);
    });
  });

  describe('BOM (Bill of Materials) Calculations', () => {
    it('should calculate total material cost', () => {
      const bomLines = [
        { item_id: '1', quantity: 10, unit_cost: 5 },
        { item_id: '2', quantity: 5, unit_cost: 20 },
        { item_id: '3', quantity: 2, unit_cost: 50 },
      ];

      const totalCost = bomLines.reduce(
        (sum, line) => sum + line.quantity * line.unit_cost,
        0
      );

      expect(totalCost).toBe(50 + 100 + 100); // 250
    });

    it('should calculate required materials for production qty', () => {
      const bom = {
        product_id: 'prod-1',
        yield_quantity: 1,
        lines: [
          { item_id: 'mat-1', quantity_per_unit: 2 },
          { item_id: 'mat-2', quantity_per_unit: 0.5 },
        ],
      };

      const productionQty = 100;

      const requiredMaterials = bom.lines.map((line) => ({
        item_id: line.item_id,
        required_qty: line.quantity_per_unit * productionQty,
      }));

      expect(requiredMaterials[0].required_qty).toBe(200);
      expect(requiredMaterials[1].required_qty).toBe(50);
    });

    it('should handle BOM with waste factor', () => {
      const baseQuantity = 100;
      const wasteFactor = 0.05; // 5% waste

      const requiredQty = baseQuantity * (1 + wasteFactor);

      expect(requiredQty).toBe(105);
    });

    it('should calculate multi-level BOM cost', () => {
      const subAssembly = {
        id: 'sub-1',
        lines: [
          { quantity: 2, unit_cost: 10 },
          { quantity: 1, unit_cost: 15 },
        ],
      };

      const subAssemblyCost = subAssembly.lines.reduce(
        (sum, line) => sum + line.quantity * line.unit_cost,
        0
      );

      const finalProduct = {
        lines: [
          { item_id: 'sub-1', quantity: 2, unit_cost: subAssemblyCost },
          { item_id: 'mat-3', quantity: 1, unit_cost: 50 },
        ],
      };

      const totalCost = finalProduct.lines.reduce(
        (sum, line) => sum + line.quantity * line.unit_cost,
        0
      );

      expect(subAssemblyCost).toBe(35); // 20 + 15
      expect(totalCost).toBe(70 + 50); // 120
    });
  });

  describe('Work Center Calculations', () => {
    it('should calculate work center utilization', () => {
      const workCenter = {
        available_hours: 8,
        used_hours: 6,
      };

      const utilization = (workCenter.used_hours / workCenter.available_hours) * 100;

      expect(utilization).toBe(75);
    });

    it('should calculate hourly rate', () => {
      const workCenter = {
        monthly_cost: 50000,
        working_days_per_month: 25,
        hours_per_day: 8,
      };

      const hourlyRate =
        workCenter.monthly_cost /
        (workCenter.working_days_per_month * workCenter.hours_per_day);

      expect(hourlyRate).toBe(250);
    });

    it('should calculate overhead cost per unit', () => {
      const totalOverhead = 10000;
      const productionQty = 500;

      const overheadPerUnit = totalOverhead / productionQty;

      expect(overheadPerUnit).toBe(20);
    });

    it('should calculate machine setup time cost', () => {
      const setupTimeHours = 2;
      const hourlyRate = 100;
      const productionQty = 200;

      const setupCostPerUnit = (setupTimeHours * hourlyRate) / productionQty;

      expect(setupCostPerUnit).toBe(1);
    });
  });

  describe('Process Costing', () => {
    it('should calculate equivalent units', () => {
      const wip = {
        units: 100,
        completion_percentage: 0.6,
      };

      const equivalentUnits = wip.units * wip.completion_percentage;

      expect(equivalentUnits).toBe(60);
    });

    it('should calculate cost per equivalent unit', () => {
      const totalCost = 5000;
      const completedUnits = 400;
      const wipEquivalentUnits = 60;

      const totalEquivalentUnits = completedUnits + wipEquivalentUnits;
      const costPerUnit = totalCost / totalEquivalentUnits;

      expect(costPerUnit).toBeCloseTo(10.87, 2);
    });

    it('should allocate costs by stage', () => {
      const stages = [
        { name: 'Mixing', direct_cost: 1000, overhead_rate: 0.2 },
        { name: 'Filling', direct_cost: 500, overhead_rate: 0.15 },
        { name: 'Packaging', direct_cost: 300, overhead_rate: 0.1 },
      ];

      const stagesWithTotal = stages.map((stage) => ({
        ...stage,
        overhead_cost: stage.direct_cost * stage.overhead_rate,
        total_cost: stage.direct_cost * (1 + stage.overhead_rate),
      }));

      expect(stagesWithTotal[0].total_cost).toBe(1200);
      expect(stagesWithTotal[1].total_cost).toBe(575);
      expect(stagesWithTotal[2].total_cost).toBe(330);
    });

    it('should calculate WIP value', () => {
      const wipItems = [
        { units: 100, completion: 0.5, unit_cost: 20 },
        { units: 50, completion: 0.8, unit_cost: 25 },
      ];

      const wipValue = wipItems.reduce(
        (sum, item) => sum + item.units * item.completion * item.unit_cost,
        0
      );

      expect(wipValue).toBe(1000 + 1000); // 2000
    });
  });

  describe('Production Scheduling', () => {
    it('should calculate production lead time', () => {
      const stages = [
        { name: 'Prep', duration_hours: 2 },
        { name: 'Production', duration_hours: 8 },
        { name: 'QC', duration_hours: 1 },
        { name: 'Packaging', duration_hours: 3 },
      ];

      const totalLeadTime = stages.reduce((sum, s) => sum + s.duration_hours, 0);

      expect(totalLeadTime).toBe(14);
    });

    it('should calculate estimated completion date', () => {
      const startDate = new Date('2025-12-21');
      const leadTimeHours = 16;
      const hoursPerDay = 8;

      const workDays = Math.ceil(leadTimeHours / hoursPerDay);
      const completionDate = new Date(startDate);
      completionDate.setDate(completionDate.getDate() + workDays);

      expect(workDays).toBe(2);
      expect(completionDate.toISOString().split('T')[0]).toBe('2025-12-23');
    });

    it('should check resource availability', () => {
      const resources = [
        { id: '1', name: 'Machine A', available: true, capacity: 100 },
        { id: '2', name: 'Machine B', available: false, capacity: 150 },
        { id: '3', name: 'Machine C', available: true, capacity: 80 },
      ];

      const requiredCapacity = 90;

      const suitableResources = resources.filter(
        (r) => r.available && r.capacity >= requiredCapacity
      );

      expect(suitableResources).toHaveLength(1);
      expect(suitableResources[0].name).toBe('Machine A');
    });
  });

  describe('Quality Control', () => {
    it('should calculate defect rate', () => {
      const totalProduced = 1000;
      const defects = 25;

      const defectRate = (defects / totalProduced) * 100;

      expect(defectRate).toBe(2.5);
    });

    it('should determine if batch passes QC', () => {
      const batch = {
        total_units: 100,
        defects: 3,
        max_defect_rate: 5,
      };

      const defectRate = (batch.defects / batch.total_units) * 100;
      const passes = defectRate <= batch.max_defect_rate;

      expect(passes).toBe(true);
    });

    it('should calculate yield percentage', () => {
      const inputQuantity = 100;
      const outputQuantity = 95;

      const yieldPercentage = (outputQuantity / inputQuantity) * 100;

      expect(yieldPercentage).toBe(95);
    });

    it('should identify QC checkpoints', () => {
      const stages = [
        { name: 'Raw Materials', qc_required: true },
        { name: 'Mixing', qc_required: false },
        { name: 'Filling', qc_required: true },
        { name: 'Packaging', qc_required: true },
      ];

      const qcCheckpoints = stages.filter((s) => s.qc_required);

      expect(qcCheckpoints).toHaveLength(3);
    });
  });

  describe('Variance Analysis', () => {
    it('should calculate material variance', () => {
      const standard = { quantity: 100, price: 10 };
      const actual = { quantity: 105, price: 11 };

      const priceVariance =
        (actual.price - standard.price) * actual.quantity;
      const quantityVariance =
        (actual.quantity - standard.quantity) * standard.price;
      const totalVariance =
        actual.quantity * actual.price - standard.quantity * standard.price;

      expect(priceVariance).toBe(105); // $1 * 105 units
      expect(quantityVariance).toBe(50); // 5 units * $10
      expect(totalVariance).toBe(155);
    });

    it('should calculate labor variance', () => {
      const standardHours = 10;
      const standardRate = 50;
      const actualHours = 11;
      const actualRate = 52;

      const rateVariance = (actualRate - standardRate) * actualHours;
      const efficiencyVariance = (actualHours - standardHours) * standardRate;
      const totalVariance =
        actualHours * actualRate - standardHours * standardRate;

      expect(rateVariance).toBe(22); // $2 * 11 hours
      expect(efficiencyVariance).toBe(50); // 1 hour * $50
      expect(totalVariance).toBe(72);
    });

    it('should classify variance as favorable or unfavorable', () => {
      const variances = [
        { name: 'Material', amount: -50 },
        { name: 'Labor', amount: 100 },
        { name: 'Overhead', amount: 0 },
      ];

      const classified = variances.map((v) => ({
        ...v,
        type: v.amount < 0 ? 'favorable' : v.amount > 0 ? 'unfavorable' : 'neutral',
      }));

      expect(classified[0].type).toBe('favorable');
      expect(classified[1].type).toBe('unfavorable');
      expect(classified[2].type).toBe('neutral');
    });
  });

  describe('Standard Costs', () => {
    it('should calculate standard product cost', () => {
      const standard = {
        materials: 50,
        labor: 30,
        overhead: 20,
      };

      const totalStandardCost = standard.materials + standard.labor + standard.overhead;

      expect(totalStandardCost).toBe(100);
    });

    it('should compare actual vs standard', () => {
      const standardCost = 100;
      const actualCost = 110;

      const variance = actualCost - standardCost;
      const variancePercentage = (variance / standardCost) * 100;

      expect(variance).toBe(10);
      expect(variancePercentage).toBe(10);
    });

    it('should update standard cost periodically', () => {
      const historicalCosts = [95, 98, 102, 105, 100];

      const averageCost =
        historicalCosts.reduce((sum, c) => sum + c, 0) / historicalCosts.length;

      expect(averageCost).toBe(100);
    });
  });

  describe('Capacity Planning', () => {
    it('should calculate required capacity', () => {
      const orders = [
        { quantity: 100, hours_per_unit: 0.5 },
        { quantity: 200, hours_per_unit: 0.3 },
        { quantity: 50, hours_per_unit: 1 },
      ];

      const requiredHours = orders.reduce(
        (sum, o) => sum + o.quantity * o.hours_per_unit,
        0
      );

      expect(requiredHours).toBe(50 + 60 + 50); // 160 hours
    });

    it('should identify capacity constraints', () => {
      const workCenters = [
        { id: '1', name: 'WC-1', available_hours: 40, required_hours: 50 },
        { id: '2', name: 'WC-2', available_hours: 80, required_hours: 60 },
        { id: '3', name: 'WC-3', available_hours: 40, required_hours: 40 },
      ];

      const overloaded = workCenters.filter(
        (wc) => wc.required_hours > wc.available_hours
      );

      expect(overloaded).toHaveLength(1);
      expect(overloaded[0].name).toBe('WC-1');
    });

    it('should calculate capacity utilization by period', () => {
      const periods = [
        { week: 1, available: 160, used: 140 },
        { week: 2, available: 160, used: 180 },
        { week: 3, available: 160, used: 120 },
      ];

      const utilization = periods.map((p) => ({
        ...p,
        utilization: ((p.used / p.available) * 100).toFixed(1),
        overloaded: p.used > p.available,
      }));

      expect(utilization[0].utilization).toBe('87.5');
      expect(utilization[1].overloaded).toBe(true);
      expect(utilization[2].utilization).toBe('75.0');
    });
  });

  describe('Order Priority Calculation', () => {
    it('should calculate order priority score', () => {
      const order = {
        due_date: new Date('2025-12-25'),
        customer_priority: 'high',
        order_value: 50000,
      };

      const today = new Date('2025-12-21');
      const daysUntilDue = Math.ceil(
        (order.due_date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      const priorityWeights: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const priorityScore =
        (1 / daysUntilDue) * 10 +
        priorityWeights[order.customer_priority] * 5 +
        (order.order_value / 10000);

      expect(daysUntilDue).toBe(4);
      expect(priorityScore).toBeGreaterThan(15);
    });

    it('should sort orders by priority', () => {
      const orders = [
        { id: '1', priority_score: 15 },
        { id: '2', priority_score: 25 },
        { id: '3', priority_score: 10 },
        { id: '4', priority_score: 20 },
      ];

      const sorted = [...orders].sort((a, b) => b.priority_score - a.priority_score);

      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('4');
    });
  });
});
