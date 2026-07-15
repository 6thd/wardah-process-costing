/**
 * Gemini Financial Service - Real Data Integration
 * خدمة مالية متقدمة لربط لوحة Gemini بالبيانات الحقيقية
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export interface FinancialKPIs {
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
  breakEvenPoint: number;
  marginOfSafety: number;
  contributionMargin: number;
  contributionMarginRatio: number;
}

export interface MonthlyFinancialData {
  month: string;
  monthNameAr: string;
  sales: number;
  cogs: number;
  grossProfit: number;
  sellingExpenses: number;
  adminExpenses: number;
  netProfit: number;
  fixedCosts: number;
  variableCosts: number;
}

export interface BreakEvenAnalysis {
  breakEvenSales: number;
  breakEvenUnits: number;
  marginOfSafety: number;
  marginOfSafetyPercent: number;
  contributionMargin: number;
  contributionMarginRatio: number;
  fixedCosts: number;
  variableCosts: number;
  currentSales: number;
}

export interface ProfitLossAnalysis {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  profitMargin: number;
  operatingMargin: number;
  grossMargin: number;
}

class GeminiFinancialService {
  /**
   * جلب KPIs المالية الحقيقية من قاعدة البيانات
   */
  async fetchRealFinancialKPIs(startDate?: Date, endDate?: Date): Promise<FinancialKPIs> {
    try {
      const tenantId = await getEffectiveTenantId();
      if (!tenantId) throw new Error('Tenant ID not found');

      const start = startDate || new Date(new Date().getFullYear(), 0, 1);
      const end = endDate || new Date();

      // جلب كل سطور القيود المرحّلة في الفترة (استدعاء واحد يُعاد استخدامه)
      const periodLines = await this.fetchPostedLines(start, end);

      // 1. الإيرادات
      const { data: revenueAccounts } = await supabase
        .from('gl_accounts').select('id').eq('category', 'REVENUE').eq('is_active', true);
      const revenueIds = new Set((revenueAccounts || []).map((a: { id: string }) => a.id));
      const totalRevenue = periodLines
        .filter(l => l.account_id && revenueIds.has(l.account_id))
        .reduce((sum, l) => sum + (l.credit - l.debit), 0);

      // 2. COGS
      const { data: cogsAccounts } = await supabase
        .from('gl_accounts').select('id').eq('category', 'COGS').eq('is_active', true);
      const cogsIds = new Set((cogsAccounts || []).map((a: { id: string }) => a.id));
      const totalCOGS = periodLines
        .filter(l => l.account_id && cogsIds.has(l.account_id))
        .reduce((sum, l) => sum + (l.debit - l.credit), 0);

      // 3. المصروفات التشغيلية
      const { data: expenseAccounts } = await supabase
        .from('gl_accounts').select('id').eq('category', 'EXPENSE').eq('is_active', true);
      const expenseIds = new Set((expenseAccounts || []).map((a: { id: string }) => a.id));
      const totalExpenses = periodLines
        .filter(l => l.account_id && expenseIds.has(l.account_id))
        .reduce((sum, l) => sum + (l.debit - l.credit), 0);

      // 4. حساب قيم المخزون
      const { data: inventoryItems } = await supabase
        .from('products')
        .select('stock_quantity, cost_price')
        .eq('is_active', true);

      const inventoryValue = (inventoryItems || []).reduce(
        (sum, item) => sum + (Number(item.stock_quantity || 0) * Number(item.cost_price || 0)),
        0
      );

      // 5. حساب الأصول والخصوم من الميزانية العمومية
      const { data: assetAccounts } = await supabase
        .from('gl_accounts')
        .select('id')
        .eq('category', 'ASSET')
        .eq('is_active', true);

      const { data: liabilityAccounts } = await supabase
        .from('gl_accounts')
        .select('id')
        .eq('category', 'LIABILITY')
        .eq('is_active', true);

      // Calculate balances
      const totalAssets = await this.calculateAccountGroupBalance(assetAccounts?.map(a => a.id) || []);
      const totalLiabilities = await this.calculateAccountGroupBalance(liabilityAccounts?.map(a => a.id) || []);

      // Calculations
      const grossProfit = totalRevenue - totalCOGS;
      const netProfit = grossProfit - totalExpenses;
      const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
      const equity = totalAssets - totalLiabilities;

      // Break-even calculations
      const contributionMargin = grossProfit;
      const contributionMarginRatio = totalRevenue > 0 ? (contributionMargin / totalRevenue) : 0;
      const fixedCosts = totalExpenses; // Simplified - all expenses as fixed
      const breakEvenPoint = contributionMarginRatio > 0 ? (fixedCosts / contributionMarginRatio) : 0;
      const marginOfSafety = totalRevenue > breakEvenPoint ? totalRevenue - breakEvenPoint : 0;

      // Growth calculation (compare with previous period)
      const previousStart = new Date(start);
      previousStart.setMonth(previousStart.getMonth() - 12);
      const previousRevenue = await this.getRevenueForPeriod(previousStart, start);
      const revenueGrowth = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0;

      // Operational efficiency
      const operationalEfficiency = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

      return {
        totalSales: totalRevenue,
        totalCosts: totalCOGS + totalExpenses,
        netProfit,
        grossProfit,
        inventoryValue,
        totalAssets,
        totalLiabilities,
        equity,
        profitMargin,
        revenueGrowth,
        operationalEfficiency,
        breakEvenPoint,
        marginOfSafety,
        contributionMargin,
        contributionMarginRatio
      };
    } catch (error: unknown) {
      console.error('Error fetching financial KPIs:', error);
      throw error;
    }
  }

  /**
   * حساب نقطة التعادل
   */
  async calculateBreakEvenAnalysis(): Promise<BreakEvenAnalysis> {
    try {
      const kpis = await this.fetchRealFinancialKPIs();
      
      const fixedCosts = kpis.totalCosts - (kpis.totalCosts * 0.3); // Assume 30% variable
      const variableCosts = kpis.totalCosts * 0.3;
      const contributionMargin = kpis.grossProfit;
      const contributionMarginRatio = kpis.contributionMarginRatio;
      
      const breakEvenSales = contributionMarginRatio > 0 
        ? fixedCosts / contributionMarginRatio 
        : 0;
      
      // Assume average unit price (simplified)
      const avgUnitPrice = kpis.totalSales > 0 ? kpis.totalSales / 1000 : 0; // Simplified
      const breakEvenUnits = avgUnitPrice > 0 ? breakEvenSales / avgUnitPrice : 0;
      
      const marginOfSafety = kpis.totalSales - breakEvenSales;
      const marginOfSafetyPercent = kpis.totalSales > 0 
        ? (marginOfSafety / kpis.totalSales) * 100 
        : 0;

      return {
        breakEvenSales,
        breakEvenUnits,
        marginOfSafety,
        marginOfSafetyPercent,
        contributionMargin,
        contributionMarginRatio,
        fixedCosts,
        variableCosts,
        currentSales: kpis.totalSales
      };
    } catch (error: unknown) {
      console.error('Error calculating break-even:', error);
      throw error;
    }
  }

  /**
   * تحليل الربح والخسارة الشهري
   */
  async fetchMonthlyFinancialData(year: number = new Date().getFullYear()): Promise<MonthlyFinancialData[]> {
    try {
      const tenantId = await getEffectiveTenantId();
      if (!tenantId) throw new Error('Tenant ID not found');

      const months = [
        { num: 1, nameAr: 'يناير' }, { num: 2, nameAr: 'فبراير' }, { num: 3, nameAr: 'مارس' },
        { num: 4, nameAr: 'أبريل' }, { num: 5, nameAr: 'مايو' }, { num: 6, nameAr: 'يونيو' },
        { num: 7, nameAr: 'يوليو' }, { num: 8, nameAr: 'أغسطس' }, { num: 9, nameAr: 'سبتمبر' },
        { num: 10, nameAr: 'أكتوبر' }, { num: 11, nameAr: 'نوفمبر' }, { num: 12, nameAr: 'ديسمبر' }
      ];

      const monthlyData: MonthlyFinancialData[] = [];

      for (const month of months) {
        const startDate = new Date(year, month.num - 1, 1);
        const endDate = new Date(year, month.num, 0);

        const monthKPIs = await this.fetchRealFinancialKPIs(startDate, endDate);

        monthlyData.push({
          month: `${year}-${String(month.num).padStart(2, '0')}`,
          monthNameAr: month.nameAr,
          sales: monthKPIs.totalSales,
          cogs: monthKPIs.totalCosts - (monthKPIs.totalCosts * 0.4), // Simplified split
          grossProfit: monthKPIs.grossProfit,
          sellingExpenses: monthKPIs.totalCosts * 0.2, // Simplified
          adminExpenses: monthKPIs.totalCosts * 0.4, // Simplified
          netProfit: monthKPIs.netProfit,
          fixedCosts: monthKPIs.totalCosts * 0.7,
          variableCosts: monthKPIs.totalCosts * 0.3
        });
      }

      return monthlyData;
    } catch (error: unknown) {
      console.error('Error fetching monthly data:', error);
      throw error;
    }
  }

  /**
   * تحليل الربح والخسارة
   */
  async analyzeProfitLoss(startDate: Date, endDate: Date): Promise<ProfitLossAnalysis> {
    try {
      const kpis = await this.fetchRealFinancialKPIs(startDate, endDate);

      const operatingMargin = kpis.totalSales > 0 
        ? (kpis.netProfit / kpis.totalSales) * 100 
        : 0;

      const grossMargin = kpis.totalSales > 0 
        ? (kpis.grossProfit / kpis.totalSales) * 100 
        : 0;

      return {
        revenue: kpis.totalSales,
        cogs: kpis.totalCosts - (kpis.totalCosts * 0.4), // Simplified
        grossProfit: kpis.grossProfit,
        operatingExpenses: kpis.totalCosts * 0.6, // Simplified
        netProfit: kpis.netProfit,
        profitMargin: kpis.profitMargin,
        operatingMargin,
        grossMargin
      };
    } catch (error: unknown) {
      console.error('Error analyzing profit/loss:', error);
      throw error;
    }
  }

  /**
   * Helper: جلب سطور القيود المرحّلة من الجداول القانونية (gl_entry_lines / gl_entries)
   * خطوتان: (1) تصفية gl_entries بالتاريخ/الحالة → (2) جلب gl_entry_lines بمعرفاتها
   */
  private async fetchPostedLines(
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{ account_id: string | null; debit: number; credit: number }>> {
    try {
      let entriesQuery = supabase
        .from('gl_entries')
        .select('id')
        .eq('status', 'posted');

      if (startDate) entriesQuery = entriesQuery.gte('entry_date', startDate.toISOString().split('T')[0]);
      if (endDate)   entriesQuery = entriesQuery.lte('entry_date', endDate.toISOString().split('T')[0]);

      const { data: entries } = await entriesQuery;
      if (!entries || entries.length === 0) return [];

      const entryIds = entries.map((e: { id: string }) => e.id);
      const { data: lines } = await supabase
        .from('gl_entry_lines')
        .select('account_id, debit, credit')
        .in('entry_id', entryIds);

      return (lines || []).map(l => ({
        account_id: l.account_id ?? null,
        debit:  Number(l.debit  || 0),
        credit: Number(l.credit || 0),
      }));
    } catch (error) {
      console.error('Error fetching posted GL lines:', error);
      return [];
    }
  }

  /**
   * Helper: حساب رصيد مجموعة حسابات (كل التاريخ)
   */
  private async calculateAccountGroupBalance(accountIds: string[]): Promise<number> {
    if (accountIds.length === 0) return 0;
    try {
      const lines = await this.fetchPostedLines();
      const idSet = new Set(accountIds);
      return lines
        .filter(l => l.account_id && idSet.has(l.account_id))
        .reduce((sum, l) => sum + (l.debit - l.credit), 0);
    } catch (error) {
      console.error('Error calculating account group balance:', error);
      return 0;
    }
  }

  /**
   * Helper: جلب الإيرادات لفترة محددة
   */
  private async getRevenueForPeriod(startDate: Date, endDate: Date): Promise<number> {
    try {
      const { data: revenueAccounts } = await supabase
        .from('gl_accounts')
        .select('id')
        .eq('category', 'REVENUE')
        .eq('is_active', true);

      const revenueAccountIds = new Set((revenueAccounts || []).map((a: { id: string }) => a.id));
      const lines = await this.fetchPostedLines(startDate, endDate);

      return lines
        .filter(l => l.account_id && revenueAccountIds.has(l.account_id))
        .reduce((sum, l) => sum + (l.credit - l.debit), 0);
    } catch (error) {
      console.error('Error getting revenue for period:', error);
      return 0;
    }
  }

  /**
   * تنسيق البيانات للوحة Gemini
   */
  formatForGeminiDashboard(kpis: FinancialKPIs, monthlyData: MonthlyFinancialData[]): Record<string, unknown> {
    const formattedMonthly: Record<string, unknown> = {};
    
    monthlyData.forEach(month => {
      formattedMonthly[month.monthNameAr] = {
        'p': [month.sales, 0, 0], // Sales
        's_exp': [month.sellingExpenses, 0], // Selling expenses
        'a_exp': [
          month.adminExpenses,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ], // Admin expenses
        'cogs': month.cogs,
        'grossProfit': month.grossProfit,
        'netProfit': month.netProfit
      };
    });

    return {
      kpis: {
        totalSales: kpis.totalSales,
        totalCosts: kpis.totalCosts,
        netProfit: kpis.netProfit,
        grossProfit: kpis.grossProfit,
        profitMargin: kpis.profitMargin,
        breakEvenPoint: kpis.breakEvenPoint,
        marginOfSafety: kpis.marginOfSafety,
        contributionMargin: kpis.contributionMargin,
        contributionMarginRatio: kpis.contributionMarginRatio
      },
      monthlyData: formattedMonthly,
      breakEven: {
        breakEvenSales: kpis.breakEvenPoint,
        marginOfSafety: kpis.marginOfSafety,
        marginOfSafetyPercent: kpis.totalSales > 0 
          ? (kpis.marginOfSafety / kpis.totalSales) * 100 
          : 0
      },
      timestamp: new Date().toISOString()
    };
  }
}

export const geminiFinancialService = new GeminiFinancialService();

