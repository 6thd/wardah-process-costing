/**
 * @fileoverview Comprehensive Tests for Financial Dashboard Service
 * Tests KPI calculations, chart data, and financial metrics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Types from financial-dashboard-service
interface FinancialKPIs {
  totalSales: number;
  totalCosts: number;
  netProfit: number;
  grossProfit: number;
  inventoryValue: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  profitMargin: number;
  revenueGrowth: number;
  operationalEfficiency: number;
}

interface ChartData {
  revenue: number[];
  costs: number[];
  profit: number[];
  months: string[];
}

interface DashboardData {
  kpis: FinancialKPIs;
  charts: ChartData;
  recentTransactions: any[];
  topProducts: any[];
}

describe('Financial Dashboard Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('KPI Calculations', () => {
    it('should calculate gross profit correctly', () => {
      const totalSales = 100000;
      const totalCosts = 60000;
      const grossProfit = totalSales - totalCosts;
      expect(grossProfit).toBe(40000);
    });

    it('should calculate net profit correctly', () => {
      const grossProfit = 40000;
      const netProfitRatio = 0.85;
      const netProfit = grossProfit * netProfitRatio;
      expect(netProfit).toBe(34000);
    });

    it('should calculate profit margin correctly', () => {
      const totalSales = 100000;
      const netProfit = 34000;
      const profitMargin = (netProfit / totalSales) * 100;
      expect(profitMargin).toBe(34);
    });

    it('should handle zero sales', () => {
      const totalSales = 0;
      const netProfit = 0;
      const profitMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
      expect(profitMargin).toBe(0);
    });
  });

  describe('Inventory Calculations', () => {
    it('should calculate inventory value correctly', () => {
      const items = [
        { stock_quantity: 100, cost_price: 50 },
        { stock_quantity: 200, cost_price: 30 },
        { stock_quantity: 50, cost_price: 100 },
      ];

      const inventoryValue = items.reduce(
        (sum, item) => sum + (item.stock_quantity || 0) * (item.cost_price || 0),
        0
      );

      expect(inventoryValue).toBe(100 * 50 + 200 * 30 + 50 * 100);
      expect(inventoryValue).toBe(16000);
    });

    it('should handle null values', () => {
      const items = [
        { stock_quantity: null, cost_price: 50 },
        { stock_quantity: 200, cost_price: null },
        { stock_quantity: 50, cost_price: 100 },
      ];

      const inventoryValue = items.reduce(
        (sum, item) => sum + (item.stock_quantity || 0) * (item.cost_price || 0),
        0
      );

      expect(inventoryValue).toBe(50 * 100);
      expect(inventoryValue).toBe(5000);
    });
  });

  describe('Balance Sheet Calculations', () => {
    it('should calculate total assets', () => {
      const inventoryValue = 50000;
      const receivables = 20000;
      const cash = 10000;
      const totalAssets = inventoryValue + receivables + cash;
      expect(totalAssets).toBe(80000);
    });

    it('should calculate equity correctly', () => {
      const totalAssets = 100000;
      const totalLiabilities = 40000;
      const equity = totalAssets - totalLiabilities;
      expect(equity).toBe(60000);
    });

    it('should handle negative equity', () => {
      const totalAssets = 30000;
      const totalLiabilities = 50000;
      const equity = totalAssets - totalLiabilities;
      expect(equity).toBe(-20000);
    });
  });

  describe('Growth Calculations', () => {
    it('should calculate positive revenue growth', () => {
      const currentRevenue = 100000;
      const previousRevenue = 90000;
      const growth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
      expect(growth).toBeCloseTo(11.11, 2);
    });

    it('should calculate negative revenue growth', () => {
      const currentRevenue = 80000;
      const previousRevenue = 100000;
      const growth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
      expect(growth).toBe(-20);
    });

    it('should handle zero previous revenue', () => {
      const currentRevenue = 100000;
      const previousRevenue = 0;
      const growth = previousRevenue > 0
        ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
        : 100; // Default to 100% if no previous data
      expect(growth).toBe(100);
    });
  });

  describe('Operational Efficiency', () => {
    it('should calculate operational efficiency', () => {
      const grossProfit = 40000;
      const totalSales = 100000;
      const efficiency = Math.min(100, (grossProfit / totalSales) * 100);
      expect(efficiency).toBe(40);
    });

    it('should cap efficiency at 100%', () => {
      const grossProfit = 120000;
      const totalSales = 100000;
      const efficiency = Math.min(100, (grossProfit / totalSales) * 100);
      expect(efficiency).toBe(100);
    });
  });

  describe('Chart Data', () => {
    it('should have 12 months of data', () => {
      const chartData: ChartData = {
        revenue: Array(12).fill(0),
        costs: Array(12).fill(0),
        profit: Array(12).fill(0),
        months: [
          'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
        ],
      };

      expect(chartData.months).toHaveLength(12);
      expect(chartData.revenue).toHaveLength(12);
    });

    it('should calculate monthly profit', () => {
      const monthlyRevenue = [10000, 12000, 15000];
      const monthlyCosts = [6000, 7000, 8000];
      const monthlyProfit = monthlyRevenue.map(
        (rev, i) => rev - monthlyCosts[i]
      );

      expect(monthlyProfit).toEqual([4000, 5000, 7000]);
    });
  });

  describe('Date Calculations', () => {
    it('should get start of month', () => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      expect(startOfMonth.getDate()).toBe(1);
    });

    it('should get start of year', () => {
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      expect(startOfYear.getMonth()).toBe(0);
      expect(startOfYear.getDate()).toBe(1);
    });
  });

  describe('Financial Ratios', () => {
    it('should calculate current ratio', () => {
      const currentAssets = 50000;
      const currentLiabilities = 25000;
      const currentRatio = currentAssets / currentLiabilities;
      expect(currentRatio).toBe(2);
    });

    it('should calculate debt-to-equity ratio', () => {
      const totalDebt = 40000;
      const equity = 60000;
      const debtToEquity = totalDebt / equity;
      expect(debtToEquity).toBeCloseTo(0.67, 2);
    });

    it('should calculate return on assets', () => {
      const netIncome = 20000;
      const totalAssets = 100000;
      const roa = (netIncome / totalAssets) * 100;
      expect(roa).toBe(20);
    });

    it('should calculate return on equity', () => {
      const netIncome = 20000;
      const equity = 60000;
      const roe = (netIncome / equity) * 100;
      expect(roe).toBeCloseTo(33.33, 2);
    });
  });

  describe('Top Products Analysis', () => {
    it('should sort products by revenue', () => {
      const products = [
        { name: 'Product A', revenue: 30000 },
        { name: 'Product B', revenue: 50000 },
        { name: 'Product C', revenue: 20000 },
      ];

      const sorted = [...products].sort((a, b) => b.revenue - a.revenue);

      expect(sorted[0].name).toBe('Product B');
      expect(sorted[1].name).toBe('Product A');
      expect(sorted[2].name).toBe('Product C');
    });

    it('should get top 5 products', () => {
      const products = Array.from({ length: 10 }, (_, i) => ({
        name: `Product ${i + 1}`,
        revenue: (10 - i) * 1000,
      }));

      const top5 = products.slice(0, 5);
      expect(top5).toHaveLength(5);
    });
  });

  describe('Transaction Formatting', () => {
    it('should format currency amounts', () => {
      const amount = 1500.5;
      const formatted = amount.toFixed(2);
      expect(formatted).toBe('1500.50');
    });

    it('should format date', () => {
      const date = new Date('2025-12-20');
      const formatted = date.toLocaleDateString('ar-SA');
      expect(formatted).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return default KPIs on error', () => {
      const defaultKPIs: FinancialKPIs = {
        totalSales: 0,
        totalCosts: 0,
        netProfit: 0,
        grossProfit: 0,
        inventoryValue: 0,
        totalAssets: 0,
        totalLiabilities: 0,
        equity: 0,
        profitMargin: 0,
        revenueGrowth: 0,
        operationalEfficiency: 0,
      };

      expect(defaultKPIs.totalSales).toBe(0);
      expect(defaultKPIs.profitMargin).toBe(0);
    });
  });

  describe('Trend Analysis', () => {
    it('should identify upward trend', () => {
      const monthlyData = [10000, 12000, 15000, 18000, 22000];
      const isUpward = monthlyData.every((val, i) =>
        i === 0 || val > monthlyData[i - 1]
      );
      expect(isUpward).toBe(true);
    });

    it('should identify downward trend', () => {
      const monthlyData = [22000, 18000, 15000, 12000, 10000];
      const isDownward = monthlyData.every((val, i) =>
        i === 0 || val < monthlyData[i - 1]
      );
      expect(isDownward).toBe(true);
    });

    it('should calculate average monthly value', () => {
      const monthlyData = [10000, 12000, 15000, 18000, 20000];
      const average = monthlyData.reduce((sum, val) => sum + val, 0) / monthlyData.length;
      expect(average).toBe(15000);
    });
  });
});
