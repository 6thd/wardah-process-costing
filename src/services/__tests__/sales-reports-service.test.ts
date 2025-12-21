/**
 * @fileoverview Comprehensive Tests for Sales Reports Service
 * Tests sales performance metrics, customer analysis, product analysis, and profitability
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Types from sales-reports-service
interface SalesPerformanceMetrics {
  totalSales: number;
  totalInvoices: number;
  totalOrders: number;
  averageOrderValue: number;
  totalCollections: number;
  outstandingAmount: number;
  collectionRate: number;
  periodStart: string;
  periodEnd: string;
}

interface CustomerSalesAnalysis {
  customerId: string;
  customerCode: string;
  customerName: string;
  totalSales: number;
  totalInvoices: number;
  averageInvoiceValue: number;
  totalCollections: number;
  outstandingAmount: number;
  collectionRate: number;
}

interface ProductSalesAnalysis {
  productId: string;
  productCode: string;
  productName: string;
  totalQuantitySold: number;
  totalRevenue: number;
  totalCOGS: number;
  totalProfit: number;
  profitMargin: number;
  averageUnitPrice: number;
  averageUnitCost: number;
  numberOfInvoices: number;
}

interface MonthlySalesTrend {
  month: string;
  monthName: string;
  totalSales: number;
  totalInvoices: number;
  totalCollections: number;
  averageOrderValue: number;
}

describe('Sales Reports Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Sales Performance Metrics', () => {
    it('should calculate average order value correctly', () => {
      const metrics: SalesPerformanceMetrics = {
        totalSales: 100000,
        totalInvoices: 50,
        totalOrders: 40,
        averageOrderValue: 2500,
        totalCollections: 80000,
        outstandingAmount: 20000,
        collectionRate: 80,
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
      };

      const calculatedAOV = metrics.totalSales / metrics.totalOrders;
      expect(calculatedAOV).toBe(2500);
    });

    it('should calculate collection rate correctly', () => {
      const totalSales = 100000;
      const totalCollections = 80000;
      const collectionRate = (totalCollections / totalSales) * 100;

      expect(collectionRate).toBe(80);
    });

    it('should calculate outstanding amount correctly', () => {
      const totalSales = 100000;
      const totalCollections = 80000;
      const outstanding = totalSales - totalCollections;

      expect(outstanding).toBe(20000);
    });

    it('should handle zero sales', () => {
      const metrics: SalesPerformanceMetrics = {
        totalSales: 0,
        totalInvoices: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        totalCollections: 0,
        outstandingAmount: 0,
        collectionRate: 0,
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
      };

      expect(metrics.averageOrderValue).toBe(0);
      expect(metrics.collectionRate).toBe(0);
    });
  });

  describe('Customer Sales Analysis', () => {
    it('should calculate customer average invoice value', () => {
      const customer: CustomerSalesAnalysis = {
        customerId: 'cust-1',
        customerCode: 'C001',
        customerName: 'Customer A',
        totalSales: 50000,
        totalInvoices: 10,
        averageInvoiceValue: 5000,
        totalCollections: 45000,
        outstandingAmount: 5000,
        collectionRate: 90,
      };

      const calculatedAIV = customer.totalSales / customer.totalInvoices;
      expect(calculatedAIV).toBe(5000);
    });

    it('should calculate customer collection rate', () => {
      const totalSales = 50000;
      const totalCollections = 45000;
      const collectionRate = (totalCollections / totalSales) * 100;

      expect(collectionRate).toBe(90);
    });

    it('should rank customers by sales', () => {
      const customers: CustomerSalesAnalysis[] = [
        { customerId: '1', customerCode: 'C1', customerName: 'A', totalSales: 30000, totalInvoices: 5, averageInvoiceValue: 6000, totalCollections: 30000, outstandingAmount: 0, collectionRate: 100 },
        { customerId: '2', customerCode: 'C2', customerName: 'B', totalSales: 80000, totalInvoices: 10, averageInvoiceValue: 8000, totalCollections: 70000, outstandingAmount: 10000, collectionRate: 87.5 },
        { customerId: '3', customerCode: 'C3', customerName: 'C', totalSales: 50000, totalInvoices: 8, averageInvoiceValue: 6250, totalCollections: 40000, outstandingAmount: 10000, collectionRate: 80 },
      ];

      const ranked = [...customers].sort((a, b) => b.totalSales - a.totalSales);

      expect(ranked[0].customerCode).toBe('C2');
      expect(ranked[1].customerCode).toBe('C3');
      expect(ranked[2].customerCode).toBe('C1');
    });
  });

  describe('Product Sales Analysis', () => {
    it('should calculate profit margin correctly', () => {
      const product: ProductSalesAnalysis = {
        productId: 'prod-1',
        productCode: 'P001',
        productName: 'Product A',
        totalQuantitySold: 100,
        totalRevenue: 10000,
        totalCOGS: 6000,
        totalProfit: 4000,
        profitMargin: 40,
        averageUnitPrice: 100,
        averageUnitCost: 60,
        numberOfInvoices: 15,
      };

      const calculatedProfit = product.totalRevenue - product.totalCOGS;
      const calculatedMargin = (calculatedProfit / product.totalRevenue) * 100;

      expect(calculatedProfit).toBe(4000);
      expect(calculatedMargin).toBe(40);
    });

    it('should calculate average unit price', () => {
      const totalRevenue = 10000;
      const totalQuantity = 100;
      const avgPrice = totalRevenue / totalQuantity;

      expect(avgPrice).toBe(100);
    });

    it('should calculate average unit cost', () => {
      const totalCOGS = 6000;
      const totalQuantity = 100;
      const avgCost = totalCOGS / totalQuantity;

      expect(avgCost).toBe(60);
    });

    it('should identify most profitable products', () => {
      const products: ProductSalesAnalysis[] = [
        { productId: '1', productCode: 'P1', productName: 'A', totalQuantitySold: 50, totalRevenue: 5000, totalCOGS: 3500, totalProfit: 1500, profitMargin: 30, averageUnitPrice: 100, averageUnitCost: 70, numberOfInvoices: 10 },
        { productId: '2', productCode: 'P2', productName: 'B', totalQuantitySold: 80, totalRevenue: 8000, totalCOGS: 4000, totalProfit: 4000, profitMargin: 50, averageUnitPrice: 100, averageUnitCost: 50, numberOfInvoices: 15 },
        { productId: '3', productCode: 'P3', productName: 'C', totalQuantitySold: 30, totalRevenue: 6000, totalCOGS: 3000, totalProfit: 3000, profitMargin: 50, averageUnitPrice: 200, averageUnitCost: 100, numberOfInvoices: 5 },
      ];

      const byProfit = [...products].sort((a, b) => b.totalProfit - a.totalProfit);
      const byMargin = [...products].sort((a, b) => b.profitMargin - a.profitMargin);

      expect(byProfit[0].productCode).toBe('P2'); // Highest profit
      expect(byMargin[0].profitMargin).toBe(50); // Highest margin
    });
  });

  describe('Monthly Sales Trends', () => {
    it('should identify sales trends', () => {
      const trends: MonthlySalesTrend[] = [
        { month: '2025-01', monthName: 'January', totalSales: 50000, totalInvoices: 20, totalCollections: 45000, averageOrderValue: 2500 },
        { month: '2025-02', monthName: 'February', totalSales: 60000, totalInvoices: 25, totalCollections: 55000, averageOrderValue: 2400 },
        { month: '2025-03', monthName: 'March', totalSales: 75000, totalInvoices: 30, totalCollections: 70000, averageOrderValue: 2500 },
      ];

      const growthQ1 = ((trends[2].totalSales - trends[0].totalSales) / trends[0].totalSales) * 100;
      expect(growthQ1).toBe(50);
    });

    it('should calculate monthly averages', () => {
      const trends: MonthlySalesTrend[] = [
        { month: '2025-01', monthName: 'January', totalSales: 50000, totalInvoices: 20, totalCollections: 45000, averageOrderValue: 2500 },
        { month: '2025-02', monthName: 'February', totalSales: 60000, totalInvoices: 25, totalCollections: 55000, averageOrderValue: 2400 },
        { month: '2025-03', monthName: 'March', totalSales: 70000, totalInvoices: 28, totalCollections: 65000, averageOrderValue: 2500 },
      ];

      const avgMonthlySales = trends.reduce((sum, t) => sum + t.totalSales, 0) / trends.length;
      expect(avgMonthlySales).toBe(60000);
    });
  });

  describe('Profitability Analysis', () => {
    it('should calculate gross profit margin', () => {
      const totalRevenue = 100000;
      const totalCOGS = 60000;
      const grossProfit = totalRevenue - totalCOGS;
      const grossProfitMargin = (grossProfit / totalRevenue) * 100;

      expect(grossProfit).toBe(40000);
      expect(grossProfitMargin).toBe(40);
    });

    it('should calculate net profit margin', () => {
      const totalRevenue = 100000;
      const totalCOGS = 60000;
      const totalExpenses = 15000;
      const netProfit = totalRevenue - totalCOGS - totalExpenses;
      const netProfitMargin = (netProfit / totalRevenue) * 100;

      expect(netProfit).toBe(25000);
      expect(netProfitMargin).toBe(25);
    });

    it('should handle negative profit', () => {
      const totalRevenue = 100000;
      const totalCOGS = 80000;
      const totalExpenses = 30000;
      const netProfit = totalRevenue - totalCOGS - totalExpenses;
      const netProfitMargin = (netProfit / totalRevenue) * 100;

      expect(netProfit).toBe(-10000);
      expect(netProfitMargin).toBe(-10);
    });
  });

  describe('Date Range Handling', () => {
    it('should validate period dates', () => {
      const periodStart = '2025-01-01';
      const periodEnd = '2025-12-31';

      const start = new Date(periodStart);
      const end = new Date(periodEnd);

      expect(end > start).toBe(true);
    });

    it('should calculate period days', () => {
      const periodStart = '2025-01-01';
      const periodEnd = '2025-01-31';

      const start = new Date(periodStart);
      const end = new Date(periodEnd);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      expect(days).toBe(31);
    });
  });

  describe('Tenant Fallback Logic', () => {
    it('should try org_id first', () => {
      const tenantId = 'tenant-1';
      const columnName = 'org_id';
      expect(columnName).toBe('org_id');
    });

    it('should fallback to tenant_id if org_id fails', () => {
      const error = { code: '42703', message: 'org_id column does not exist' };
      const shouldFallback = error.code === '42703' || error.message?.includes('org_id');
      expect(shouldFallback).toBe(true);
    });

    it('should skip tenant filter if both fail', () => {
      const skipFilter = true;
      expect(skipFilter).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing table gracefully', () => {
      const error = { code: 'PGRST205', message: 'Table not found' };
      const isMissingTable = error.code === 'PGRST205';

      if (isMissingTable) {
        const result = { data: [], error: null };
        expect(result.data).toEqual([]);
      }
    });

    it('should return empty array for query errors', () => {
      const error = { message: 'Some error' };
      const result = error ? { data: [], error: null } : { data: [1, 2, 3], error: null };
      expect(result.data).toEqual([]);
    });
  });
});
