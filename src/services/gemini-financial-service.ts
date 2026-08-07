/**
 * Gemini Financial Service - Real Data Integration
 * خدمة مالية متقدمة لربط لوحة Gemini بالبيانات الحقيقية
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export interface FinancialKPIs {
  totalSales: number;
  totalCosts: number;
  // Real, separately-queried totals (category='COGS' vs category='EXPENSE'
  // in gl_accounts) — kept apart so callers never need to guess a split of
  // the combined totalCosts figure above.
  totalCOGS: number;
  totalOperatingExpenses: number;
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

export interface MonthlyFinancialData {
  month: string;
  monthNameAr: string;
  sales: number;
  cogs: number;
  grossProfit: number;
  // A single real operating-expenses figure (category='EXPENSE' GL
  // accounts). There is no selling-vs-administrative subtype recorded in
  // gl_accounts today, so this is deliberately not split into two —
  // inventing a percentage split between two categories neither the chart
  // of accounts nor the ledger actually distinguishes would itself be
  // fabricated data, the exact failure mode this file exists to avoid.
  operatingExpenses: number;
  netProfit: number;
  // True only for the current calendar month of the current year — a
  // partial (month-to-date) figure, not a complete month. Callers must not
  // plot it against complete months in a trend/regression as if equivalent
  // (see fetchMonthlyFinancialData()'s month-range comment and
  // dashboard.js's generatePredictiveData()).
  isMTD: boolean;
}

// Break-even/margin-of-safety requires a real fixed-vs-variable cost
// classification to be meaningful (breakEvenSales = fixedCosts /
// contributionMarginRatio). No such classification exists anywhere in this
// schema (gl_accounts has no cost-behavior column), so this is a
// discriminated union instead of a single always-numeric shape: every
// caller must handle the unavailable case explicitly rather than a
// silently-fabricated split (e.g. "assume 30% variable") standing in for
// real data. See calculateBreakEvenAnalysis() below.
export type BreakEvenAnalysis =
  | {
      available: false;
      reason: 'fixed_variable_classification_unavailable';
      currentSales: number;
    }
  | {
      available: true;
      breakEvenSales: number;
      breakEvenUnits: number;
      marginOfSafety: number;
      marginOfSafetyPercent: number;
      contributionMargin: number;
      contributionMarginRatio: number;
      fixedCosts: number;
      variableCosts: number;
      currentSales: number;
    };

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

// Supabase's PostgREST layer caps an unranged select at 1000 rows by
// default — silently, with no error, just a truncated `data` array. A
// years-old GL or a product catalog past that size would otherwise
// under-report every total that reads it, with no signal anything was
// dropped. fetchAllRows() below pages through with .range() until a page
// comes back short.
const SUPABASE_PAGE_SIZE = 1000;
// gl_entry_lines is looked up by `entry_id IN (...)` — a very large entries
// result would otherwise build one enormous IN-list. Batched to keep each
// query a reasonable size regardless of how many entries a period covers.
const ENTRY_ID_BATCH_SIZE = 500;

interface SupabaseSelectResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

class GeminiFinancialService {
  // entry_date (and every other date filter in this file) is a DATE
  // column compared against a plain YYYY-MM-DD string — built here from
  // the Date object's LOCAL year/month/day, never date.toISOString()
  // (which reads UTC components). For any timezone ahead of UTC (e.g.
  // Asia/Riyadh, UTC+3), a local midnight Date's toISOString() falls on
  // the *previous* UTC calendar day, so every month's boundary silently
  // shifted back by one day: 2026-01-01 00:00 Asia/Riyadh serialized as
  // "2025-12-31", 2026-08-01 00:00 Asia/Riyadh as "2026-07-31" — verified
  // directly. That doesn't crash or error; it just quietly queries the
  // wrong 30-day window every single month.
  private toLocalDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Every caller of fetchRealFinancialKPIs/fetchPostedLines treats endDate
  // as INCLUSIVE (e.g. "up to and including today", or a month's last
  // calendar day) — converted here to a half-open (exclusive) SQL bound,
  // one local calendar day past endDate, so entries dated exactly on
  // endDate are still included regardless of any time-of-day component
  // rather than relying on a `<=` string comparison against a bare date.
  private toExclusiveUpperBoundDateString(inclusiveEndDate: Date): string {
    const next = new Date(
      inclusiveEndDate.getFullYear(),
      inclusiveEndDate.getMonth(),
      inclusiveEndDate.getDate() + 1
    );
    return this.toLocalDateString(next);
  }

  // Pages through a query with .range() until a page comes back shorter
  // than SUPABASE_PAGE_SIZE, accumulating every row — never silently
  // truncates at Supabase's default 1000-row cap. Throws on any page's
  // error instead of treating it the same as "no rows": a permission or
  // network failure must never be indistinguishable from a real, correct
  // zero/empty result.
  private async fetchAllRows<T>(
    buildQuery: (from: number, to: number) => PromiseLike<SupabaseSelectResult<T>>,
    context: string
  ): Promise<T[]> {
    const rows: T[] = [];
    let from = 0;
    for (;;) {
      const to = from + SUPABASE_PAGE_SIZE - 1;
      const { data, error } = await buildQuery(from, to);
      if (error) throw new Error(`${context}: ${error.message}`);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < SUPABASE_PAGE_SIZE) break;
      from += SUPABASE_PAGE_SIZE;
    }
    return rows;
  }

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
      const revenueAccounts = await this.fetchAllRows<{ id: string }>(
        (from, to) => supabase.from('gl_accounts').select('id').eq('category', 'REVENUE').eq('is_active', true).range(from, to),
        'Error fetching revenue accounts'
      );
      const revenueIds = new Set(revenueAccounts.map(a => a.id));
      const totalRevenue = periodLines
        .filter(l => l.account_id && revenueIds.has(l.account_id))
        .reduce((sum, l) => sum + (l.credit - l.debit), 0);

      // 2. COGS
      const cogsAccounts = await this.fetchAllRows<{ id: string }>(
        (from, to) => supabase.from('gl_accounts').select('id').eq('category', 'COGS').eq('is_active', true).range(from, to),
        'Error fetching COGS accounts'
      );
      const cogsIds = new Set(cogsAccounts.map(a => a.id));
      const totalCOGS = periodLines
        .filter(l => l.account_id && cogsIds.has(l.account_id))
        .reduce((sum, l) => sum + (l.debit - l.credit), 0);

      // 3. المصروفات التشغيلية
      const expenseAccounts = await this.fetchAllRows<{ id: string }>(
        (from, to) => supabase.from('gl_accounts').select('id').eq('category', 'EXPENSE').eq('is_active', true).range(from, to),
        'Error fetching expense accounts'
      );
      const expenseIds = new Set(expenseAccounts.map(a => a.id));
      const totalExpenses = periodLines
        .filter(l => l.account_id && expenseIds.has(l.account_id))
        .reduce((sum, l) => sum + (l.debit - l.credit), 0);

      // 4. حساب قيم المخزون
      const inventoryItems = await this.fetchAllRows<{ stock_quantity: number | null; cost_price: number | null }>(
        (from, to) => supabase.from('products').select('stock_quantity, cost_price').eq('is_active', true).range(from, to),
        'Error fetching inventory items'
      );

      const inventoryValue = inventoryItems.reduce(
        (sum, item) => sum + (Number(item.stock_quantity || 0) * Number(item.cost_price || 0)),
        0
      );

      // 5. حساب الأصول والخصوم من الميزانية العمومية
      const assetAccounts = await this.fetchAllRows<{ id: string }>(
        (from, to) => supabase.from('gl_accounts').select('id').eq('category', 'ASSET').eq('is_active', true).range(from, to),
        'Error fetching asset accounts'
      );

      const liabilityAccounts = await this.fetchAllRows<{ id: string }>(
        (from, to) => supabase.from('gl_accounts').select('id').eq('category', 'LIABILITY').eq('is_active', true).range(from, to),
        'Error fetching liability accounts'
      );

      // Calculate balances
      const totalAssets = await this.calculateAccountGroupBalance(assetAccounts.map(a => a.id));
      const totalLiabilities = await this.calculateAccountGroupBalance(liabilityAccounts.map(a => a.id));

      // Calculations
      const grossProfit = totalRevenue - totalCOGS;
      const netProfit = grossProfit - totalExpenses;
      const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
      const equity = totalAssets - totalLiabilities;

      // No contributionMargin/contributionMarginRatio here: contribution
      // margin is revenue minus VARIABLE costs specifically, not gross
      // profit (revenue minus COGS) — an earlier version of this function
      // computed contributionMargin = grossProfit, which silently relabels
      // gross margin as contribution margin. Since gl_accounts has no
      // fixed-vs-variable cost classification (the same gap
      // calculateBreakEvenAnalysis() documents below), a real contribution
      // margin cannot be computed at all — not even as a ratio — so this
      // never reintroduces it under either name.

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
        totalCOGS,
        totalOperatingExpenses: totalExpenses,
        netProfit,
        grossProfit,
        inventoryValue,
        totalAssets,
        totalLiabilities,
        equity,
        profitMargin,
        revenueGrowth,
        operationalEfficiency
      };
    } catch (error: unknown) {
      console.error('Error fetching financial KPIs:', error);
      throw error;
    }
  }

  /**
   * حساب نقطة التعادل
   *
   * Always returns `available: false`: a real break-even point requires a
   * real fixed-vs-variable cost classification, and gl_accounts has no
   * such column today (only category/subtype, neither of which encodes
   * cost behavior). Earlier versions of this method assumed "30% of total
   * costs are variable" and derived an average unit price as
   * totalSales/1000 — both invented constants with no basis in any real
   * data, silently feeding into net profit, break-even, and margin of
   * safety displayed as if they were real financial figures. Do not
   * reintroduce a guessed split here; wire this up to a real cost-behavior
   * classification (e.g. a column on gl_accounts) when one exists instead.
   */
  async calculateBreakEvenAnalysis(): Promise<BreakEvenAnalysis> {
    try {
      const kpis = await this.fetchRealFinancialKPIs();
      return {
        available: false,
        reason: 'fixed_variable_classification_unavailable',
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

      const allMonths = [
        { num: 1, nameAr: 'يناير' }, { num: 2, nameAr: 'فبراير' }, { num: 3, nameAr: 'مارس' },
        { num: 4, nameAr: 'أبريل' }, { num: 5, nameAr: 'مايو' }, { num: 6, nameAr: 'يونيو' },
        { num: 7, nameAr: 'يوليو' }, { num: 8, nameAr: 'أغسطس' }, { num: 9, nameAr: 'سبتمبر' },
        { num: 10, nameAr: 'أكتوبر' }, { num: 11, nameAr: 'نوفمبر' }, { num: 12, nameAr: 'ديسمبر' }
      ];

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthNum = now.getMonth() + 1;

      // Never generate a month that hasn't started yet. For the current
      // year this caps the list at the current month (e.g. requesting
      // August 7th only returns يناير..أغسطس, not September-December as
      // zero-filled entries that would otherwise plot as real completed
      // months with zero sales/profit — a fabricated-looking figure, not
      // an honest "no data yet"). A future year returns no months at all;
      // a past year returns the full twelve, since every month in it has
      // already happened.
      const months = year > currentYear
        ? []
        : year === currentYear
          ? allMonths.filter(m => m.num <= currentMonthNum)
          : allMonths;

      const monthlyData: MonthlyFinancialData[] = [];

      for (const month of months) {
        const startDate = new Date(year, month.num - 1, 1);
        const endDate = new Date(year, month.num, 0);
        const isMTD = year === currentYear && month.num === currentMonthNum;

        const monthKPIs = await this.fetchRealFinancialKPIs(startDate, endDate);

        monthlyData.push({
          month: `${year}-${String(month.num).padStart(2, '0')}`,
          monthNameAr: month.nameAr,
          sales: monthKPIs.totalSales,
          cogs: monthKPIs.totalCOGS,
          grossProfit: monthKPIs.grossProfit,
          operatingExpenses: monthKPIs.totalOperatingExpenses,
          netProfit: monthKPIs.netProfit,
          isMTD
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
        cogs: kpis.totalCOGS,
        grossProfit: kpis.grossProfit,
        operatingExpenses: kpis.totalOperatingExpenses,
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
   *
   * Every query here throws on error and is fully paginated (see
   * fetchAllRows()) rather than the previous pattern of discarding
   * `error` and treating a truncated or failed query the same as a real,
   * correct empty result — a permission or network failure must surface
   * as a thrown error, not a silently zeroed total that still reports
   * success. entry IDs are looked up in gl_entry_lines in batches (see
   * ENTRY_ID_BATCH_SIZE) so a large period's IN-list stays bounded.
   */
  private async fetchPostedLines(
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{ account_id: string | null; debit: number; credit: number }>> {
    const entries = await this.fetchAllRows<{ id: string }>((from, to) => {
      let q = supabase.from('gl_entries').select('id').eq('status', 'posted');
      if (startDate) q = q.gte('entry_date', this.toLocalDateString(startDate));
      if (endDate) q = q.lt('entry_date', this.toExclusiveUpperBoundDateString(endDate));
      return q.range(from, to);
    }, 'Error fetching posted GL entries');

    if (entries.length === 0) return [];

    const entryIds = entries.map(e => e.id);
    const lines: Array<{ account_id: string | null; debit: number; credit: number }> = [];

    for (let i = 0; i < entryIds.length; i += ENTRY_ID_BATCH_SIZE) {
      const batch = entryIds.slice(i, i + ENTRY_ID_BATCH_SIZE);
      const batchLines = await this.fetchAllRows<{ account_id: string | null; debit: number | null; credit: number | null }>(
        (from, to) => supabase.from('gl_entry_lines').select('account_id, debit, credit').in('entry_id', batch).range(from, to),
        'Error fetching posted GL entry lines'
      );
      lines.push(...batchLines.map(l => ({
        account_id: l.account_id ?? null,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      })));
    }

    return lines;
  }

  /**
   * Helper: حساب رصيد مجموعة حسابات (كل التاريخ)
   */
  private async calculateAccountGroupBalance(accountIds: string[]): Promise<number> {
    if (accountIds.length === 0) return 0;
    const lines = await this.fetchPostedLines();
    const idSet = new Set(accountIds);
    return lines
      .filter(l => l.account_id && idSet.has(l.account_id))
      .reduce((sum, l) => sum + (l.debit - l.credit), 0);
  }

  /**
   * Helper: جلب الإيرادات لفترة محددة
   */
  private async getRevenueForPeriod(startDate: Date, endDate: Date): Promise<number> {
    const revenueAccounts = await this.fetchAllRows<{ id: string }>(
      (from, to) => supabase.from('gl_accounts').select('id').eq('category', 'REVENUE').eq('is_active', true).range(from, to),
      'Error fetching revenue accounts for period comparison'
    );

    const revenueAccountIds = new Set(revenueAccounts.map(a => a.id));
    const lines = await this.fetchPostedLines(startDate, endDate);

    return lines
      .filter(l => l.account_id && revenueAccountIds.has(l.account_id))
      .reduce((sum, l) => sum + (l.credit - l.debit), 0);
  }

  /**
   * تنسيق البيانات للوحة Gemini
   */
  formatForGeminiDashboard(kpis: FinancialKPIs, monthlyData: MonthlyFinancialData[]): Record<string, unknown> {
    const formattedMonthly: Record<string, unknown> = {};
    
    monthlyData.forEach(month => {
      formattedMonthly[month.monthNameAr] = {
        'p': [month.sales, 0, 0], // Sales
        // A single real operating-expenses figure — see MonthlyFinancialData's
        // operatingExpenses comment for why this is not split into
        // selling/admin sub-categories.
        'opex': [month.operatingExpenses, 0],
        'cogs': month.cogs,
        'grossProfit': month.grossProfit,
        'netProfit': month.netProfit,
        'isMTD': month.isMTD
      };
    });

    // No breakEven/breakEvenPoint field here: a real one requires a real
    // fixed-vs-variable cost classification this schema doesn't have (see
    // BreakEvenAnalysis/calculateBreakEvenAnalysis() above) — callers that
    // need break-even data call calculateBreakEvenAnalysis() directly and
    // handle its `available: false` case instead of reading a number from
    // here.
    return {
      kpis: {
        totalSales: kpis.totalSales,
        totalCosts: kpis.totalCosts,
        netProfit: kpis.netProfit,
        grossProfit: kpis.grossProfit,
        profitMargin: kpis.profitMargin
      },
      monthlyData: formattedMonthly,
      timestamp: new Date().toISOString()
    };
  }
}

export const geminiFinancialService = new GeminiFinancialService();

