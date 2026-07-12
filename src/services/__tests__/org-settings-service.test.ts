/**
 * اختبارات خدمة إعدادات المؤسسة (org_settings) — قراءة/دمج الافتراضيات، upsert
 * على (org_id,key)، القائمة البيضاء للتصدير، وتحويل CSV بتهريب صحيح.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: { savedValue: unknown; upserts: unknown[] } = { savedValue: null, upserts: [] };

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({
    data: state.savedValue === null ? null : { value: state.savedValue },
    error: null,
  });
  chain.upsert = (row: unknown, opts: unknown) => {
    state.upserts.push({ table, row, opts });
    return Promise.resolve({ error: null });
  };
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [{ id: 'p1', name: 'صنف, "خاص"', qty: 5 }], error: null });
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => makeChain(t) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}));

import {
  getSystemSettings, setOrgSetting, DEFAULT_SYSTEM_SETTINGS,
  fetchExportRows, toCSV,
} from '../org-settings-service';

describe('org-settings-service', () => {
  beforeEach(() => {
    state.savedValue = null;
    state.upserts = [];
  });

  it('getSystemSettings: بلا حفظ سابق ⇒ الافتراضيات', async () => {
    const s = await getSystemSettings();
    expect(s).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });

  it('getSystemSettings: القيم المحفوظة تتقدّم على الافتراضيات (دمج جزئي)', async () => {
    state.savedValue = { currency: 'USD' };
    const s = await getSystemSettings();
    expect(s.currency).toBe('USD');
    expect(s.numberFormat).toBe(DEFAULT_SYSTEM_SETTINGS.numberFormat);
  });

  it('setOrgSetting: upsert على org_id+key', async () => {
    await setOrgSetting('system', { currency: 'SAR' });
    expect(state.upserts).toHaveLength(1);
    const u = state.upserts[0] as { row: { org_id: string; key: string }; opts: { onConflict: string } };
    expect(u.row.org_id).toBe('org-1');
    expect(u.row.key).toBe('system');
    expect(u.opts.onConflict).toBe('org_id,key');
  });

  it('fetchExportRows: جدول خارج القائمة البيضاء يُرفض', async () => {
    await expect(fetchExportRows('user_organizations' as never)).rejects.toThrow('غير مسموح');
  });

  it('fetchExportRows: جدول مسموح يعيد صفوفاً org-scoped', async () => {
    const rows = await fetchExportRows('products');
    expect(rows).toHaveLength(1);
  });
});

describe('toCSV', () => {
  it('يبني ترويسة من مفاتيح أول صف ويهرّب الفواصل والاقتباسات', () => {
    const csv = toCSV([{ id: 'p1', name: 'صنف, "خاص"', qty: 5 }]);
    const [header, row] = csv.split('\n');
    expect(header).toBe('id,name,qty');
    expect(row).toBe('p1,"صنف, ""خاص""",5');
  });

  it('صفوف فارغة ⇒ نص فارغ', () => {
    expect(toCSV([])).toBe('');
  });

  it('القيم الكائنية تُسلسل JSON وnull تُفرَّغ', () => {
    const csv = toCSV([{ a: null, b: { x: 1 } }]);
    expect(csv.split('\n')[1]).toBe(',"{""x"":1}"');
  });
});
