/**
 * خدمة القوائم المالية المصغّرة — قائمة دخل وملخص ميزانية من أرصدة GL الفعلية
 * حسب تصنيف الحساب (تحترم اتجاه الرصيد الطبيعي). سياسة «لا تلفيق»: السطور التي
 * لا تطابق شجرة الحسابات تُستبعَد، وغياب البيانات يظهر أصفاراً صادقة.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export interface AccountBalanceRow {
  code: string;
  name: string;
  category: string;
  balance: number; // موجَّه حسب الرصيد الطبيعي
}

export interface FinancialStatements {
  incomeStatement: {
    revenue: number;
    expenses: number;
    netIncome: number;
    revenueAccounts: AccountBalanceRow[];
    expenseAccounts: AccountBalanceRow[];
  };
  balanceSheet: {
    assets: number;
    liabilities: number;
    equity: number;
    assetAccounts: AccountBalanceRow[];
    liabilityAccounts: AccountBalanceRow[];
    equityAccounts: AccountBalanceRow[];
  };
  unmatchedLinesCount: number; // سطور GL لا تطابق شجرة الحسابات (شفافية)
}

interface GLAccountMeta {
  code: string;
  name: string;
  category: string;
  normal_balance: string;
}

interface GLLine {
  account_code: string;
  debit_amount?: number;
  credit_amount?: number;
  debit?: number;
  credit?: number;
}

const signedAmount = (line: GLLine, normal: string): number => {
  const debit = line.debit_amount ?? line.debit ?? 0;
  const credit = line.credit_amount ?? line.credit ?? 0;
  return normal === 'DEBIT' ? debit - credit : credit - debit;
};

function pickCategory(rows: AccountBalanceRow[], category: string): AccountBalanceRow[] {
  return rows
    .filter((r) => r.category === category && r.balance !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

const totalOf = (rows: AccountBalanceRow[]): number =>
  rows.reduce((s, r) => s + r.balance, 0);

/** أرصدة كل حساب موجَّهة + عدد السطور غير المطابِقة. */
export async function fetchAccountBalances(
  orgId: string,
): Promise<{ rows: AccountBalanceRow[]; unmatched: number }> {
  const [{ data: accounts }, { data: lines }] = await Promise.all([
    supabase.from('gl_accounts')
      .select('code, name, category, normal_balance').eq('org_id', orgId),
    supabase.from('gl_entry_lines')
      .select('account_code, debit_amount, credit_amount, debit, credit').eq('org_id', orgId),
  ]);

  const meta = new Map<string, GLAccountMeta>();
  for (const a of (accounts ?? []) as GLAccountMeta[]) meta.set(a.code, a);

  const balances = new Map<string, number>();
  let unmatched = 0;
  for (const l of (lines ?? []) as GLLine[]) {
    const m = meta.get(l.account_code);
    if (!m) { unmatched++; continue; } // لا يطابق شجرة الحسابات ⇒ يُستبعَد بشفافية
    balances.set(l.account_code, (balances.get(l.account_code) ?? 0) + signedAmount(l, m.normal_balance));
  }

  const rows: AccountBalanceRow[] = [];
  for (const [code, balance] of balances) {
    const m = meta.get(code)!;
    rows.push({ code, name: m.name, category: m.category, balance });
  }
  return { rows, unmatched };
}

export interface Profitability {
  revenue: number;        // من فواتير المبيعات الفعلية
  cogs: number;           // رصيد حسابات COGS المزروعة في gl_mappings (sale_delivery_*)
  grossProfit: number;
  margin: number | null;  // null عند غياب إيراد (لا تلفيق)
  cogsAccounts: string[]; // الحسابات المعتمدة (شفافية)
}

/** تحليل الربحية: إيراد الفواتير مقابل COGS من قيود GL على حسابات الخريطة المزروعة. */
export async function fetchProfitability(): Promise<Profitability> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  // حسابات COGS القانونية من gl_mappings (الطرف المدين لأحداث sale_delivery_*)
  const { data: mappings } = await supabase
    .from('gl_mappings')
    .select('key_value, debit_account_code')
    .eq('org_id', orgId)
    .eq('key_type', 'EVENT')
    .like('key_value', 'sale_delivery%');

  const cogsAccounts = [...new Set(
    ((mappings ?? []) as { debit_account_code: string }[])
      .map((m) => m.debit_account_code)
      .filter(Boolean),
  )];

  const [invoicesRes, cogsLinesRes] = await Promise.all([
    supabase.from('sales_invoices').select('total_amount').eq('org_id', orgId),
    cogsAccounts.length
      ? supabase.from('gl_entry_lines')
          .select('account_code, debit_amount, credit_amount, debit, credit')
          .eq('org_id', orgId)
          .in('account_code', cogsAccounts)
      : Promise.resolve({ data: [] as GLLine[] }),
  ]);

  const revenue = ((invoicesRes.data ?? []) as { total_amount: number }[])
    .reduce((s, r) => s + (r.total_amount || 0), 0);
  const cogs = ((cogsLinesRes.data ?? []) as GLLine[])
    .reduce((s, l) => s + signedAmount(l, 'DEBIT'), 0);

  const grossProfit = revenue - cogs;
  return {
    revenue,
    cogs,
    grossProfit,
    margin: revenue > 0 ? (grossProfit / revenue) * 100 : null,
    cogsAccounts,
  };
}

/** القوائم المالية المصغّرة الكاملة (org-scoped). */
export async function fetchFinancialStatements(): Promise<FinancialStatements> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  const { rows, unmatched } = await fetchAccountBalances(orgId);

  const revenueAccounts = pickCategory(rows, 'REVENUE');
  const expenseAccounts = pickCategory(rows, 'EXPENSE');
  const assetAccounts = pickCategory(rows, 'ASSET');
  const liabilityAccounts = pickCategory(rows, 'LIABILITY');
  const equityAccounts = pickCategory(rows, 'EQUITY');

  const revenue = totalOf(revenueAccounts);
  const expenses = totalOf(expenseAccounts);

  return {
    incomeStatement: {
      revenue,
      expenses,
      netIncome: revenue - expenses,
      revenueAccounts,
      expenseAccounts,
    },
    balanceSheet: {
      assets: totalOf(assetAccounts),
      liabilities: totalOf(liabilityAccounts),
      equity: totalOf(equityAccounts),
      assetAccounts,
      liabilityAccounts,
      equityAccounts,
    },
    unmatchedLinesCount: unmatched,
  };
}
