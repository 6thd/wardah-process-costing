/**
 * خدمة إعدادات المؤسسة — قراءة/حفظ key/value JSONB في org_settings (Migration 98).
 * upsert على (org_id, key)؛ org-scoped عبر RLS + فلتر صريح.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import type { Json } from '@/types/database.generated';

export interface SystemSettingsValues {
  currency: string;        // عملة العرض (مثل SAR)
  numberFormat: string;    // locale للأرقام (en-US افتراضياً — أرقام لاتينية)
  dateFormat: string;      // locale للتواريخ
  defaultWarehouseId: string;
  printFooter: string;     // تذييل المطبوعات
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValues = {
  currency: 'SAR',
  numberFormat: 'en-US',
  dateFormat: 'en-US',
  defaultWarehouseId: '',
  printFooter: '',
};

export const UOM_ENGINE_SETTING_KEY = 'uom_engine_enabled' as const;

export interface UomEngineSettingValue {
  enabled: boolean;
}

export const DEFAULT_UOM_ENGINE_SETTING: Readonly<UomEngineSettingValue> = {
  enabled: false,
};

/** يقرأ قيمة إعداد؛ يعيد null إن لم يُحفَظ بعد. */
export async function getOrgSetting<T>(key: string): Promise<T | null> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  const { data, error } = await supabase
    .from('org_settings')
    .select('value')
    .eq('org_id', orgId)
    .eq('key', key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.value as T) ?? null;
}

/** يحفظ قيمة إعداد (upsert على org_id+key). */
export async function setOrgSetting<T>(key: string, value: T): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  const { error } = await supabase
    .from('org_settings')
    .upsert(
      { org_id: orgId, key, value: value as Json },
      { onConflict: 'org_id,key' },
    );

  if (error) throw new Error(error.message);
}

/** إعدادات النظام مدموجة مع الافتراضيات (القيم المحفوظة تتقدّم). */
export async function getSystemSettings(): Promise<SystemSettingsValues> {
  const saved = await getOrgSetting<Partial<SystemSettingsValues>>('system');
  return { ...DEFAULT_SYSTEM_SETTINGS, ...(saved ?? {}) };
}

export async function saveSystemSettings(values: SystemSettingsValues): Promise<void> {
  await setOrgSetting('system', values);
}

/**
 * علم إطلاق محرك الوحدات لمؤسسة صريحة. القيمة الافتراضية مغلقة دائمًا.
 *
 * يقرأ عبر RPC ذرية (`rpc_get_org_uom_engine_enabled`) تتحقق من عضوية المتصل في
 * `p_org_id` وتقرأ العلم لتلك المؤسسة بالتحديد. هذا يحترم المؤسسة المختارة في
 * الواجهة (currentOrgId) لمستخدمي المؤسسات المتعددة، بخلاف القراءة المباشرة من
 * `org_settings` المقيّدة بـ RLS بالمؤسسة الفعلية للجلسة `wardah_org_id(NULL)`.
 */
export async function getUomEngineEnabled(orgId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('rpc_get_org_uom_engine_enabled', {
    p_org_id: orgId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/** حفظ العلم ككائن JSONB صريح بدل قيمة scalar لتسهيل التوسع والتدقيق لاحقًا. */
export async function setUomEngineEnabled(enabled: boolean): Promise<void> {
  await setOrgSetting<UomEngineSettingValue>(UOM_ENGINE_SETTING_KEY, { enabled });
}

// ===== تصدير بيانات (نسخ احتياطي يدوي من الشاشة) =====

/**
 * الجداول المسموح تصديرها (قائمة بيضاء ثابتة — لا إدخال حر).
 * هذا «تصدير البيانات الرئيسية» وليس نسخة كاملة قابلة للاستعادة: لا يشمل سطور
 * الفواتير/أوامر الشراء ولا المخزون التفصيلي ولا التصنيع ولا HR ولا الإعدادات.
 * gl_entry_lines أضيفت حتى لا تُصدَّر رؤوس القيود بلا سطورها.
 */
export const EXPORTABLE_TABLES = [
  'products', 'customers', 'vendors',
  'sales_invoices', 'purchase_orders', 'gl_entries', 'gl_entry_lines',
] as const;
export type ExportableTable = (typeof EXPORTABLE_TABLES)[number];

/** صفوف جدول مسموح، org-scoped. */
export async function fetchExportRows(table: ExportableTable): Promise<Record<string, unknown>[]> {
  if (!EXPORTABLE_TABLES.includes(table)) throw new Error('جدول غير مسموح بتصديره');
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  const { data, error } = await supabase.from(table).select('*').eq('org_id', orgId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/** تحويل صفوف إلى CSV (ترويسة من مفاتيح أول صف، تهريب فواصل/اقتباسات). */
export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(
      typeof v === 'object' ? JSON.stringify(v) : v,
    );
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n');
}
