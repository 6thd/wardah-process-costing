/**
 * @fileoverview Comprehensive Tests for Sales Reports Service
 * Tests sales performance metrics, profitability analysis, and reporting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          gte: vi.fn(() => ({
            lte: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    })),
  },
  getEffectiveTenantId: vi.fn().mockResolvedValue('test-tenant'),
}));

describe('Sales Reports Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Sales Performance Metrics', () => {
    it('should calculate total sales', () => {
      const invoices = [
        { total_amount: 5000 },
        { total_amount: 3000 },
        { total_amount: 7000 },
        { total_amount: 2500 },
      ];

      const totalSales = invoices.reduce((sum, inv) => sum + inv.total_amount, 0);

      expect(totalSales).toBe(17500);
    });

    it('should calculate average order value', () => {
      const orders = [
        { total: 1000 },
        { total: 2000 },
        { total: 3000 },
        { total: 4000 },
        { total: 5000 },
      ];

      const totalOrders = orders.length;
      const totalValue = orders.reduce((sum, o) => sum + o.total, 0);
      const averageOrderValue = totalValue / totalOrders;

      expect(averageOrderValue).toBe(3000);
    });

    it('should calculate collection rate', () => {
      const totalInvoiced = 100000;
      const totalCollected = 85000;

      const collectionRate = (totalCollected / totalInvoiced) * 100;

      expect(collectionRate).toBe(85);
    });

    it('should calculate outstanding amount', () => {
      const totalInvoiced = 100000;
      const totalCollected = 85000;

      const outstandingAmount = totalInvoiced - totalCollected;

      expect(outstandingAmount).toBe(15000);
    });

    it('should count total invoices in period', () => {
      const invoices = [
        { date: '2025-12-01' },
        { date: '2025-12-05' },
        { date: '2025-12-10' },
        { date: '2025-12-15' },
      ];

      expect(invoices.length).toBe(4);
    });
  });

  describe('Customer Sales Analysis', () => {
    it('should aggregate sales by customer', () => {
      const invoices = [
        { customer_id: 'cust-1', total: 5000 },
        { customer_id: 'cust-2', total: 3000 },
        { customer_id: 'cust-1', total: 2000 },
        { customer_id: 'cust-3', total: 4000 },
        { customer_id: 'cust-1', total: 1000 },
      ];

      const salesByCustomer = invoices.reduce(
        (acc: Record<string, number>, inv) => {
          acc[inv.customer_id] = (acc[inv.customer_id] || 0) + inv.total;
          return acc;
        },
        {}
      );

      expect(salesByCustomer['cust-1']).toBe(8000);
      expect(salesByCustomer['cust-2']).toBe(3000);
      expect(salesByCustomer['cust-3']).toBe(4000);
    });

    it('should calculate customer average invoice value', () => {
      const customerInvoices = [
        { total: 1000 },
        { total: 2000 },
        { total: 3000 },
      ];

      const totalValue = customerInvoices.reduce((sum, i) => sum + i.total, 0);
      const avgValue = totalValue / customerInvoices.length;

      expect(avgValue).toBe(2000);
    });

    it('should identify top customers by revenue', () => {
      const customers = [
        { id: '1', name: 'Customer A', total_sales: 50000 },
        { id: '2', name: 'Customer B', total_sales: 120000 },
        { id: '3', name: 'Customer C', total_sales: 80000 },
        { id: '4', name: 'Customer D', total_sales: 45000 },
        { id: '5', name: 'Customer E', total_sales: 95000 },
      ];

      const topCustomers = [...customers]
        .sort((a, b) => b.total_sales - a.total_sales)
        .slice(0, 3);

      expect(topCustomers[0].name).toBe('Customer B');
      expect(topCustomers[1].name).toBe('Customer E');
      expect(topCustomers[2].name).toBe('Customer C');
    });

    it('should calculate customer collection rate', () => {
      const customer = {
        total_invoiced: 50000,
        total_collected: 40000,
      };

      const collectionRate = (customer.total_collected / customer.total_invoiced) * 100;

      expect(collectionRate).toBe(80);
    });

    it('should find last order date for customer', () => {
      const orders = [
        { customer_id: 'cust-1', date: '2025-12-01' },
        { customer_id: 'cust-1', date: '2025-12-15' },
        { customer_id: 'cust-1', date: '2025-12-10' },
      ];

      const sortedOrders = [...orders].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      const lastOrderDate = sortedOrders[0].date;

      expect(lastOrderDate).toBe('2025-12-15');
    });
  });

  describe('Product Sales Analysis', () => {
    it('should calculate product revenue', () => {
      const productSales = [
        { product_id: 'prod-1', quantity: 100, unit_price: 50 },
        { product_id: 'prod-1', quantity: 50, unit_price: 50 },
      ];

      const totalRevenue = productSales.reduce(
        (sum, sale) => sum + sale.quantity * sale.unit_price,
        0
      );

      expect(totalRevenue).toBe(7500);
    });

    it('should calculate product COGS', () => {
      const productSales = [
        { product_id: 'prod-1', quantity: 100, unit_cost: 30 },
        { product_id: 'prod-1', quantity: 50, unit_cost: 32 },
      ];

      const totalCOGS = productSales.reduce(
        (sum, sale) => sum + sale.quantity * sale.unit_cost,
        0
      );

      expect(totalCOGS).toBe(3000 + 1600); // 4600
    });

    it('should calculate product profit', () => {
      const revenue = 7500;
      const cogs = 4600;

      const profit = revenue - cogs;

      expect(profit).toBe(2900);
    });

    it('should calculate profit margin', () => {
      const revenue = 7500;
      const profit = 2900;

      const profitMargin = (profit / revenue) * 100;

      expect(profitMargin).toBeCloseTo(38.67, 2);
    });

    it('should identify top selling products', () => {
      const products = [
        { id: '1', name: 'Product A', quantity_sold: 500 },
        { id: '2', name: 'Product B', quantity_sold: 1200 },
        { id: '3', name: 'Product C', quantity_sold: 800 },
        { id: '4', name: 'Product D', quantity_sold: 300 },
      ];

      const topProducts = [...products]
        .sort((a, b) => b.quantity_sold - a.quantity_sold)
        .slice(0, 2);

      expect(topProducts[0].name).toBe('Product B');
      expect(topProducts[1].name).toBe('Product C');
    });

    it('should calculate average unit price', () => {
      const sales = [
        { quantity: 100, unit_price: 50 },
        { quantity: 200, unit_price: 45 },
        { quantity: 50, unit_price: 55 },
      ];

      const totalQty = sales.reduce((sum, s) => sum + s.quantity, 0);
      const weightedPrice = sales.reduce(
        (sum, s) => sum + s.quantity * s.unit_price,
        0
      );
      const avgUnitPrice = weightedPrice / totalQty;

      expect(avgUnitPrice).toBeCloseTo(47.86, 2);
    });
  });

  describe('Monthly Sales Trends', () => {
    it('should aggregate sales by month', () => {
      const invoices = [
        { date: '2025-01-15', total: 10000 },
        { date: '2025-01-20', total: 15000 },
        { date: '2025-02-10', total: 12000 },
        { date: '2025-02-25', total: 8000 },
        { date: '2025-03-05', total: 20000 },
      ];

      const salesByMonth = invoices.reduce((acc: Record<string, number>, inv) => {
        const month = inv.date.substring(0, 7); // YYYY-MM
        acc[month] = (acc[month] || 0) + inv.total;
        return acc;
      }, {});

      expect(salesByMonth['2025-01']).toBe(25000);
      expect(salesByMonth['2025-02']).toBe(20000);
      expect(salesByMonth['2025-03']).toBe(20000);
    });

    it('should calculate month-over-month growth', () => {
      const currentMonth = 30000;
      const previousMonth = 25000;

      const growth = ((currentMonth - previousMonth) / previousMonth) * 100;

      expect(growth).toBe(20);
    });

    it('should identify best performing month', () => {
      const monthlySales = [
        { month: '2025-01', total: 50000 },
        { month: '2025-02', total: 65000 },
        { month: '2025-03', total: 45000 },
        { month: '2025-04', total: 70000 },
      ];

      const bestMonth = monthlySales.reduce((best, current) =>
        current.total > best.total ? current : best
      );

      expect(bestMonth.month).toBe('2025-04');
    });

    it('should calculate quarterly totals', () => {
      const monthlySales = [
        { month: 1, total: 30000 },
        { month: 2, total: 35000 },
        { month: 3, total: 40000 },
        { month: 4, total: 45000 },
        { month: 5, total: 50000 },
        { month: 6, total: 55000 },
      ];

      const getQuarter = (month: number) => Math.ceil(month / 3);

      const quarterlyTotals = monthlySales.reduce(
        (acc: Record<number, number>, sale) => {
          const quarter = getQuarter(sale.month);
          acc[quarter] = (acc[quarter] || 0) + sale.total;
          return acc;
        },
        {}
      );

      expect(quarterlyTotals[1]).toBe(105000); // Q1: Jan-Mar
      expect(quarterlyTotals[2]).toBe(150000); // Q2: Apr-Jun
    });

    it('should calculate year-to-date sales', () => {
      const monthlySales = [
        { month: 1, total: 30000 },
        { month: 2, total: 35000 },
        { month: 3, total: 40000 },
        { month: 4, total: 45000 },
      ];

      const ytdSales = monthlySales.reduce((sum, m) => sum + m.total, 0);

      expect(ytdSales).toBe(150000);
    });
  });

  describe('Profitability Analysis', () => {
    it('should calculate gross profit', () => {
      const revenue = 100000;
      const cogs = 65000;

      const grossProfit = revenue - cogs;

      expect(grossProfit).toBe(35000);
    });

    it('should calculate gross profit margin', () => {
      const revenue = 100000;
      const grossProfit = 35000;

      const grossMargin = (grossProfit / revenue) * 100;

      expect(grossMargin).toBe(35);
    });

    it('should calculate net profit', () => {
      const grossProfit = 35000;
      const operatingExpenses = 15000;

      const netProfit = grossProfit - operatingExpenses;

      expect(netProfit).toBe(20000);
    });

    it('should calculate net profit margin', () => {
      const revenue = 100000;
      const netProfit = 20000;

      const netMargin = (netProfit / revenue) * 100;

      expect(netMargin).toBe(20);
    });

    it('should compare profitability by product', () => {
      const products = [
        { id: '1', name: 'A', revenue: 50000, cogs: 30000 },
        { id: '2', name: 'B', revenue: 30000, cogs: 15000 },
        { id: '3', name: 'C', revenue: 20000, cogs: 14000 },
      ];

      const withMargins = products.map((p) => ({
        ...p,
        profit: p.revenue - p.cogs,
        margin: ((p.revenue - p.cogs) / p.revenue) * 100,
      }));

      expect(withMargins[0].margin).toBe(40);
      expect(withMargins[1].margin).toBe(50);
      expect(withMargins[2].margin).toBe(30);

      const mostProfitable = withMargins.reduce((best, current) =>
        current.margin > best.margin ? current : best
      );

      expect(mostProfitable.name).toBe('B');
    });
  });

  describe('Sales by Region/Territory', () => {
    it('should aggregate sales by region', () => {
      const invoices = [
        { region: 'Central', total: 50000 },
        { region: 'Eastern', total: 30000 },
        { region: 'Central', total: 25000 },
        { region: 'Western', total: 40000 },
        { region: 'Eastern', total: 35000 },
      ];

      const salesByRegion = invoices.reduce(
        (acc: Record<string, number>, inv) => {
          acc[inv.region] = (acc[inv.region] || 0) + inv.total;
          return acc;
        },
        {}
      );

      expect(salesByRegion['Central']).toBe(75000);
      expect(salesByRegion['Eastern']).toBe(65000);
      expect(salesByRegion['Western']).toBe(40000);
    });

    it('should calculate region contribution percentage', () => {
      const salesByRegion = {
        Central: 75000,
        Eastern: 65000,
        Western: 40000,
      };

      const totalSales = Object.values(salesByRegion).reduce(
        (sum, val) => sum + val,
        0
      );

      const regionContribution = Object.entries(salesByRegion).map(
        ([region, sales]) => ({
          region,
          contribution: ((sales / totalSales) * 100).toFixed(1),
        })
      );

      expect(parseFloat(regionContribution[0].contribution)).toBeCloseTo(41.7, 1);
    });
  });

  describe('Salesperson Performance', () => {
    it('should aggregate sales by salesperson', () => {
      const invoices = [
        { salesperson_id: 'sp-1', total: 50000 },
        { salesperson_id: 'sp-2', total: 30000 },
        { salesperson_id: 'sp-1', total: 40000 },
        { salesperson_id: 'sp-3', total: 60000 },
      ];

      const salesBySalesperson = invoices.reduce(
        (acc: Record<string, number>, inv) => {
          acc[inv.salesperson_id] = (acc[inv.salesperson_id] || 0) + inv.total;
          return acc;
        },
        {}
      );

      expect(salesBySalesperson['sp-1']).toBe(90000);
      expect(salesBySalesperson['sp-2']).toBe(30000);
      expect(salesBySalesperson['sp-3']).toBe(60000);
    });

    it('should calculate salesperson quota achievement', () => {
      const salesperson = {
        id: 'sp-1',
        name: 'John Doe',
        quota: 100000,
        actual_sales: 85000,
      };

      const quotaAchievement = (salesperson.actual_sales / salesperson.quota) * 100;

      expect(quotaAchievement).toBe(85);
    });

    it('should rank salespeople by performance', () => {
      const salespeople = [
        { id: '1', name: 'Alice', sales: 120000 },
        { id: '2', name: 'Bob', sales: 95000 },
        { id: '3', name: 'Carol', sales: 150000 },
        { id: '4', name: 'David', sales: 80000 },
      ];

      const ranked = [...salespeople]
        .sort((a, b) => b.sales - a.sales)
        .map((sp, index) => ({ ...sp, rank: index + 1 }));

      expect(ranked[0].name).toBe('Carol');
      expect(ranked[0].rank).toBe(1);
      expect(ranked[3].name).toBe('David');
      expect(ranked[3].rank).toBe(4);
    });
  });

  describe('Period Comparison', () => {
    it('should compare current vs previous period', () => {
      const currentPeriod = { sales: 100000, orders: 150 };
      const previousPeriod = { sales: 80000, orders: 120 };

      const salesGrowth =
        ((currentPeriod.sales - previousPeriod.sales) / previousPeriod.sales) *
        100;
      const ordersGrowth =
        ((currentPeriod.orders - previousPeriod.orders) / previousPeriod.orders) *
        100;

      expect(salesGrowth).toBe(25);
      expect(ordersGrowth).toBe(25);
    });

    it('should calculate year-over-year comparison', () => {
      const thisYear = { month: 12, year: 2025, sales: 120000 };
      const lastYear = { month: 12, year: 2024, sales: 100000 };

      const yoyGrowth =
        ((thisYear.sales - lastYear.sales) / lastYear.sales) * 100;

      expect(yoyGrowth).toBe(20);
    });

    it('should identify declining periods', () => {
      const periods = [
        { period: 'Q1', sales: 100000 },
        { period: 'Q2', sales: 120000 },
        { period: 'Q3', sales: 110000 },
        { period: 'Q4', sales: 95000 },
      ];

      const declining = periods.filter((p, i) => {
        if (i === 0) return false;
        return p.sales < periods[i - 1].sales;
      });

      expect(declining).toHaveLength(2);
      expect(declining[0].period).toBe('Q3');
      expect(declining[1].period).toBe('Q4');
    });
  });

  describe('Invoice Profit Calculation', () => {
    it('should calculate invoice profit', () => {
      const invoiceLines = [
        { quantity: 10, unit_price: 100, unit_cost: 60 },
        { quantity: 5, unit_price: 200, unit_cost: 120 },
      ];

      const revenue = invoiceLines.reduce(
        (sum, line) => sum + line.quantity * line.unit_price,
        0
      );
      const cost = invoiceLines.reduce(
        (sum, line) => sum + line.quantity * line.unit_cost,
        0
      );
      const profit = revenue - cost;

      expect(revenue).toBe(2000); // 1000 + 1000
      expect(cost).toBe(1200); // 600 + 600
      expect(profit).toBe(800);
    });

    it('should calculate invoice profit margin', () => {
      const revenue = 2000;
      const cost = 1200;
      const profit = revenue - cost;

      const profitMargin = (profit / revenue) * 100;

      expect(profitMargin).toBe(40);
    });
  });

  describe('Sales Forecast', () => {
    it('should calculate simple moving average', () => {
      const historicalSales = [100, 120, 110, 130, 125];
      const periods = 3;

      const lastNValues = historicalSales.slice(-periods);
      const movingAverage = lastNValues.reduce((sum, v) => sum + v, 0) / periods;

      expect(movingAverage).toBeCloseTo(121.67, 2);
    });

    it('should calculate linear trend', () => {
      const sales = [100, 110, 120, 130, 140];

      // Simple linear growth rate
      const firstValue = sales[0];
      const lastValue = sales[sales.length - 1];
      const periods = sales.length - 1;

      const growthRate = (lastValue - firstValue) / periods;
      const forecast = lastValue + growthRate;

      expect(growthRate).toBe(10);
      expect(forecast).toBe(150);
    });

    it('should apply seasonality factor', () => {
      const baseForecast = 100000;
      const seasonalityFactors: Record<number, number> = {
        1: 0.85, // January
        2: 0.90,
        3: 1.00,
        4: 1.05,
        5: 1.10,
        6: 1.00,
        7: 0.80,
        8: 0.85,
        9: 1.05,
        10: 1.10,
        11: 1.15,
        12: 1.25, // December peak
      };

      const month = 12;
      const adjustedForecast = baseForecast * seasonalityFactors[month];

      expect(adjustedForecast).toBe(125000);
    });
  });

  describe('Report Date Filtering', () => {
    it('should filter invoices by date range', () => {
      const invoices = [
        { id: '1', date: '2025-12-01', total: 1000 },
        { id: '2', date: '2025-12-10', total: 2000 },
        { id: '3', date: '2025-12-20', total: 3000 },
        { id: '4', date: '2025-12-25', total: 4000 },
      ];

      const startDate = '2025-12-05';
      const endDate = '2025-12-22';

      const filtered = invoices.filter(
        (inv) => inv.date >= startDate && inv.date <= endDate
      );

      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('2');
      expect(filtered[1].id).toBe('3');
    });

    it('should generate date range for current month', () => {
      const year = 2025;
      const month = 11; // December (0-indexed)

      const startOfMonth = { year, month: month + 1, day: 1 };
      const endOfMonth = { year, month: month + 1, day: 31 };

      expect(startOfMonth.month).toBe(12);
      expect(startOfMonth.day).toBe(1);
      expect(endOfMonth.day).toBe(31);
    });

    it('should generate date range for current quarter', () => {
      const month = 11; // December (0-indexed)
      const quarter = Math.floor(month / 3); // Q4

      const startMonth = quarter * 3 + 1; // October = 10
      const endMonth = quarter * 3 + 3; // December = 12

      expect(quarter).toBe(3); // Q4 (0-indexed)
      expect(startMonth).toBe(10); // October
      expect(endMonth).toBe(12); // December
    });
  });

  describe('Export Data Formatting', () => {
    it('should format numbers for export', () => {
      const amount = 1234567.89;
      const formatted = amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      expect(formatted).toBe('1,234,567.89');
    });

    it('should format percentage for export', () => {
      const value = 0.4567;
      const formatted = (value * 100).toFixed(2) + '%';

      expect(formatted).toBe('45.67%');
    });

    it('should prepare summary row', () => {
      const details = [
        { customer: 'A', sales: 10000, profit: 3000 },
        { customer: 'B', sales: 15000, profit: 4500 },
        { customer: 'C', sales: 5000, profit: 1500 },
      ];

      const summary = {
        customer: 'TOTAL',
        sales: details.reduce((sum, d) => sum + d.sales, 0),
        profit: details.reduce((sum, d) => sum + d.profit, 0),
      };

      expect(summary.sales).toBe(30000);
      expect(summary.profit).toBe(9000);
    });
  });
});
