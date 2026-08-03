/**
 * سلوك getPaymentAccounts على المخطط الكامل وعلى مخطط ناقص الأعمدة.
 * يثبّت أن الحسابات الأبوية غير القابلة للترحيل لا تصل إلى القائمة في أي مسار.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { accountMatchesMethod } from '../voucher-payment-accounts'

const orderResult = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({
          eq: () => ({
            order: () => orderResult(columns),
          }),
        }),
      }),
    }),
  },
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}))

const { getPaymentAccounts } = await import('../payment-vouchers-service')

// مقتطف من شجرة حسابات الإنتاج: أبوان غير قابلين للترحيل، وأوراق قابلة لها،
// وحسابات خارج نطاق السداد كانت تتسرب عبر شرط البادئة '110'.
const fullSchemaRows = [
  { id: '1', code: '110000', name: 'الأصول المتداولة', subtype: 'OTHER', allow_posting: false },
  { id: '2', code: '110100', name: 'النقد ومايعادله', subtype: 'CASH', allow_posting: false },
  { id: '3', code: '110101', name: 'النقدية في الخزينة', subtype: 'CASH', allow_posting: true },
  { id: '4', code: '110200', name: 'النقدية في البنوك', subtype: 'BANK', allow_posting: false },
  { id: '5', code: '110201', name: 'بنك الراجحي', subtype: 'BANK', allow_posting: true },
  { id: '6', code: '110300', name: 'المدينون', subtype: 'AR', allow_posting: true },
  { id: '7', code: '110600', name: 'ضريبة المدخلات', subtype: 'VAT_INPUT', allow_posting: true },
]

describe('getPaymentAccounts', () => {
  beforeEach(() => {
    orderResult.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('يعيد الأوراق القابلة للترحيل وحدها ويستبعد الأبوين وغير حسابات السداد', async () => {
    orderResult.mockResolvedValue({ data: fullSchemaRows, error: null })

    const result = await getPaymentAccounts()

    expect(result.success).toBe(true)
    expect(result.data?.map((a: any) => a.code)).toEqual(['110101', '110201'])
  })

  it('لا يمرّر حسابًا أبويًا إلى حارس الطريقة', async () => {
    orderResult.mockResolvedValue({ data: fullSchemaRows, error: null })

    const { data } = await getPaymentAccounts()
    const parents = (data ?? []).filter((a: any) => a.code === '110100' || a.code === '110200')

    expect(parents).toHaveLength(0)
    for (const account of data ?? []) {
      expect(accountMatchesMethod(account, 'supplier_payment', 'bank_transfer')
        || accountMatchesMethod(account, 'supplier_payment', 'cash')).toBe(true)
    }
  })

  it('يفشل مغلقًا على مخطط بلا subtype/allow_posting بدل استنتاجهما', async () => {
    orderResult.mockResolvedValue({ data: null, error: { code: '42703' } })

    const result = await getPaymentAccounts()

    // العرض ممنوع لأن الـtrigger يقرأ subtype: مخطط بلا العمود لا يقبل أي سند،
    // فأي حساب معروض سيفشل حتمًا. لا استنتاج من بادئة الرمز، ولا 110100/110200.
    expect(result.success).toBe(false)
    expect(result.data).toBeUndefined()
  })
})
