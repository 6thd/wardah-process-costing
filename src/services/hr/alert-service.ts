/**
 * مولّد التنبيهات الاستباقية (P12-F) — يكتب hr_alerts بـ upsert.
 * يُستدعى من لوحة التحكم / يدوياً من صفحة التنبيهات.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export interface AlertRow {
  id: string;
  org_id: string;
  employee_id: string | null;
  title: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  description: string | null;
  due_date: string | null;
  source: string | null;
  is_resolved: boolean;
  created_at: string;
}

export async function listAlerts(limit = 50): Promise<AlertRow[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('hr_alerts')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_resolved', false)
    .order('severity', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as AlertRow[];
}

export async function resolveAlert(alertId: string): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { error } = await supabase
    .from('hr_alerts')
    .update({ is_resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('org_id', orgId);

  if (error) throw new Error(error.message);
}

/**
 * يُنشئ أو يُحدِّث تنبيهات استباقية بناءً على بيانات الموظفين الحالية.
 * يعود بعدد التنبيهات التي أُنشئت أو حُدِّثت.
 */
export async function generateAlerts(): Promise<number> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // جلب بيانات الموظفين النشطين
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, full_name, contract_end_date, hire_date, iban')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (empErr) throw new Error(empErr.message);

  type AlertInsert = Omit<AlertRow, 'id' | 'is_resolved' | 'created_at'> & {
  resolved_at?: string | null;
  resolved_by?: string | null;
  updated_at?: string;
};
const alertsToUpsert: AlertInsert[] = [];

  for (const emp of employees ?? []) {
    const name = emp.full_name ?? 'موظف';

    // ── تنبيهات انتهاء العقد ─────────────────────────────────────────────
    if (emp.contract_end_date) {
      const contractEnd = new Date(emp.contract_end_date);
      const daysLeft = Math.round(
        (contractEnd.getTime() - today.getTime()) / 86_400_000,
      );

      if (daysLeft >= 0 && daysLeft <= 30) {
        const severity: AlertRow['severity'] =
          daysLeft <= 7 ? 'critical' : daysLeft <= 15 ? 'warning' : 'info';
        alertsToUpsert.push({
          org_id: orgId,
          employee_id: emp.id,
          title: `انتهاء عقد: ${name}`,
          category: 'contract',
          severity,
          description: `ينتهي عقد ${name} خلال ${daysLeft} يوم (${emp.contract_end_date})`,
          due_date: emp.contract_end_date,
          source: 'alert-generator',
          resolved_at: null,
          resolved_by: null,
          updated_at: todayStr,
        });
      }
    }

    // ── تنبيه غياب IBAN ──────────────────────────────────────────────────
    if (!emp.iban) {
      alertsToUpsert.push({
        org_id: orgId,
        employee_id: emp.id,
        title: `بيانات ناقصة: IBAN — ${name}`,
        category: 'data_gap',
        severity: 'warning',
        description: `الموظف ${name} لا يوجد له رقم IBAN — قد يتأخر صرف الراتب`,
        due_date: null,
        source: 'alert-generator',
        resolved_at: null,
        resolved_by: null,
        updated_at: todayStr,
      });
    }
  }

  if (alertsToUpsert.length === 0) return 0;

  // Upsert بمفتاح (org_id, employee_id, title) — يتجنب التكرار
  const rows = alertsToUpsert.map((a) => ({
    ...a,
    is_resolved: false,
  }));

  const { error: upsertErr } = await supabase
    .from('hr_alerts')
    .upsert(rows, { onConflict: 'org_id,employee_id,title', ignoreDuplicates: false });

  if (upsertErr) {
    // لو لم يكن هناك unique constraint بعد — نُدرج فقط إن لم يكن موجوداً
    const { error: insertErr } = await supabase.from('hr_alerts').insert(rows);
    if (insertErr) throw new Error(insertErr.message);
  }

  return rows.length;
}
