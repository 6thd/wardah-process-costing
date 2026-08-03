import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  accountMatchesMethod,
  allowedAccountSubtypes,
  filterAccountsForMethod,
} from '../voucher-payment-accounts'

const serviceSource = readFileSync(
  resolve(process.cwd(), 'src/services/payment-vouchers-service.ts'),
  'utf8'
)

describe('voucher payment account contract', () => {
  it('يعامل الشيك نقدًا في القبض وبنكيًا في الصرف', () => {
    expect([...allowedAccountSubtypes('customer_receipt', 'check')]).toEqual(['CASH'])
    expect([...allowedAccountSubtypes('supplier_payment', 'check')]).toEqual(['BANK'])
  })

  it('يقبل النوعين معًا مع طريقة other على الجانبين', () => {
    for (const kind of ['customer_receipt', 'supplier_payment'] as const) {
      expect([...allowedAccountSubtypes(kind, 'other')].sort()).toEqual(['BANK', 'CASH'])
    }
  })

  it('يحصر النقد في cash والباقي في البنك', () => {
    expect([...allowedAccountSubtypes('supplier_payment', 'cash')]).toEqual(['CASH'])
    expect([...allowedAccountSubtypes('supplier_payment', 'bank_transfer')]).toEqual(['BANK'])
    expect([...allowedAccountSubtypes('customer_receipt', 'credit_card')]).toEqual(['BANK'])
  })

  it('يرفض حسابًا صحيح النوع لكنه غير قابل للترحيل', () => {
    const parentCash = { id: 'a', code: '110100', subtype: 'CASH', allow_posting: false }
    expect(accountMatchesMethod(parentCash, 'customer_receipt', 'cash')).toBe(false)

    const leafCash = { id: 'b', code: '110101', subtype: 'CASH', allow_posting: true }
    expect(accountMatchesMethod(leafCash, 'customer_receipt', 'cash')).toBe(true)
  })

  it('يرفض حسابًا بلا subtype ولا يفترض قابلية الترحيل غيابًا', () => {
    expect(accountMatchesMethod({ id: 'c', code: '110300' }, 'supplier_payment', 'cash')).toBe(false)
    // allow_posting غير محدد يعني «لم يُصرَّح بالمنع» — مطابق لـcoalesce(allow_posting,true)
    expect(
      accountMatchesMethod({ id: 'd', subtype: 'BANK' }, 'supplier_payment', 'bank_transfer')
    ).toBe(true)
  })

  it('يستبعد الحسابات غير المطابقة من القائمة المعروضة', () => {
    const accounts = [
      { id: '1', subtype: 'CASH', allow_posting: true },
      { id: '2', subtype: 'BANK', allow_posting: true },
      { id: '3', subtype: 'CASH', allow_posting: false },
    ]
    expect(filterAccountsForMethod(accounts, 'supplier_payment', 'bank_transfer').map(a => a.id)).toEqual(['2'])
    expect(filterAccountsForMethod(accounts, 'supplier_payment', 'cash').map(a => a.id)).toEqual(['1'])
  })
})

describe('outstanding invoice filters mirror the RPC guards', () => {
  it('يعرض فواتير الموردين القابلة للسداد وحدها', () => {
    expect(serviceSource).toContain("in('status', ['approved', 'partially_paid', 'overdue'])")
    // الفلتر القديم كان يعرض draft/submitted فتفشل عند الترحيل ويخفي
    // partially_paid/overdue رغم قبول الدالة لها.
    expect(serviceSource).not.toContain('status.eq.draft,status.eq.submitted,status.eq.approved')
  })

  it('يقصر حسابات السداد على CASH/BANK القابلة للترحيل', () => {
    expect(serviceSource).toContain("acc.subtype === 'CASH' || acc.subtype === 'BANK'")
    expect(serviceSource).toContain('acc.allow_posting !== false')
    // الشرط القديم كان يقبل أي حساب يبدأ رمزه بـ110 فيسرّب المدينين
    // والمصروفات المقدمة وضريبة المدخلات والحسابات الأب.
    expect(serviceSource).not.toContain("acc.code?.toString().startsWith('110')")
  })
})
