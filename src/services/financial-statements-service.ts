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
  // Fail-visible: فشل RLS/المخطط يظهر خطأً صريحاً لا قوائم صفرية مضللة
  const [accountsRes, linesRes] = await Promise.all([
    supabase.from('gl_accounts')
      .select('code, name, category, normal_balance').eq('org_id', orgId),
    supabase.from('gl_entry_lines')
      .select('account_code, debit_amount, credit_amount, debit, credit').eq('org_id', orgId),
  ]);
  if (accountsRes.error) throw new Error(`تعذّر جلب شجرة الحسابات: ${accountsRes.error.message}`);
  if (linesRes.error) throw new Error(`تعذّر جلب سطور القيود: ${linesRes.error.message}`);
  const accounts = accountsRes.data;
  const lines = linesRes.data;

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
  revenue: number;        // قيمة فواتير المبيعات غير الملغاة (ليس إيراداً محاسبياً نهائياً — انظر التعليق أدناه)
  cogs: number;           // رصيد حسابات COGS من قيود GL المرحّلة (أحداث COGS_EVENT_KEYS)
  grossProfit: number;
  margin: number | null;  // null عند غياب إيراد (لا تلفيق)
  cogsAccounts: string[]; // الحسابات المعتمدة (شفافية)
}

export interface ProfitabilityParams {
  /** بداية الفترة (YYYY-MM-DD) على invoice_date/entry_date — اختياري */
  from?: string;
  /** نهاية الفترة (YYYY-MM-DD) شاملة — invoice_date/entry_date أعمدة DATE فلا مشكلة نهاية يوم */
  to?: string;
}

/**
 * قائمة أحداث COGS المعتمدة — كانت الخريطة تُفلتر بـ sale_delivery% بينما مسار
 * التسليم يرحّل بحدث COGS_DELIVERY حصراً (الحساب المدين الحي 544000 وليس
 * 511100 الافتراضي في ملف 85) ⇒ كان COGS يظهر صفراً دائماً. الحساب يُقرأ من
 * الخريطة الحية لا يُفترض. أي حدث COGS جديد يُضاف هنا صراحةً.
 */
export const COGS_EVENT_KEYS = ['COGS_DELIVERY'] as const;

/** حسابات COGS القانونية: الطرف المدين لأحداث القائمة، بعد التحقق أنها حسابات مصروف. */
export async function fetchCogsAccounts(orgId: string): Promise<string[]> {
  const { data: mappings, error } = await supabase
    .from('gl_mappings')
    .select('key_value, debit_account_code')
    .eq('org_id', orgId)
    .eq('key_type', 'EVENT')
    .in('key_value', [...COGS_EVENT_KEYS]);
  if (error) throw new Error(`تعذّر جلب خريطة COGS: ${error.message}`);

  const candidates = [...new Set(
    ((mappings ?? []) as { debit_account_code: string }[])
      .map((m) => m.debit_account_code)
      .filter(Boolean),
  )];
  if (!candidates.length) return [];

  // تحقق أن الطرف المدين حساب مصروف فعلاً (خريطة مضبوطة خطأً لا تُدخل أصولاً في COGS)
  const { data: accounts, error: accErr } = await supabase
    .from('gl_accounts')
    .select('code, category')
    .eq('org_id', orgId)
    .in('code', candidates);
  if (accErr) throw new Error(`تعذّر التحقق من حسابات COGS: ${accErr.message}`);
  const expenseCodes = new Set(
    ((accounts ?? []) as { code: string; category: string }[])
      .filter((a) => a.category === 'EXPENSE')
      .map((a) => a.code),
  );
  return candidates.filter((c) => expenseCodes.has(c));
}

/**
 * تحليل الربحية: قيمة الفواتير غير الملغاة مقابل COGS من قيود GL المرحّلة.
 * ملاحظة موثقة: العميل لا يكتب sales_invoices.status بعد الإنشاء (تبقى draft)
 * فالفلتر الصحيح مرحلياً هو استبعاد cancelled فقط — اشتراط paid/posted كان
 * سيصفّر الإيراد كله. اعتماد الإيراد من GL أو من الفواتير المرحلة فقط يتطلب
 * إصلاح دورة حالة الفاتورة أولاً (بند متابعة).
 */
export async function fetchProfitability(params?: ProfitabilityParams): Promise<Profitability> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  const cogsAccounts = await fetchCogsAccounts(orgId);

  let invoicesQuery = supabase.from('sales_invoices')
    .select('total_amount')
    .eq('org_id', orgId)
    .neq('status', 'cancelled');
  if (params?.from) invoicesQuery = invoicesQuery.gte('invoice_date', params.from);
  if (params?.to) invoicesQuery = invoicesQuery.lte('invoice_date', params.to);

  // سطور COGS مقيدة برأس قيد مرحّل (لا draft/reversed) وبنفس حدود الفترة
  let cogsQuery = supabase.from('gl_entry_lines')
    .select('account_code, debit_amount, credit_amount, debit, credit, gl_entries!inner(entry_date, status, org_id)')
    .eq('org_id', orgId)
    .eq('gl_entries.org_id', orgId)
    .eq('gl_entries.status', 'posted')
    .in('account_code', cogsAccounts);
  if (params?.from) cogsQuery = cogsQuery.gte('gl_entries.entry_date', params.from);
  if (params?.to) cogsQuery = cogsQuery.lte('gl_entries.entry_date', params.to);

  const [invoicesRes, cogsLinesRes] = await Promise.all([
    invoicesQuery,
    cogsAccounts.length ? cogsQuery : Promise.resolve({ data: [] as GLLine[], error: null }),
  ]);
  if (invoicesRes.error) throw new Error(`تعذّر جلب الفواتير: ${invoicesRes.error.message}`);
  if (cogsLinesRes.error) throw new Error(`تعذّر جلب سطور COGS: ${cogsLinesRes.error.message}`);

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
