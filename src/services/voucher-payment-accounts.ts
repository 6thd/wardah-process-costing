/**
 * Voucher payment-account contract (client mirror)
 *
 * يعكس هذا الملف حرفيًا شرطَي القبول في trigger قاعدة البيانات
 * `wardah_validate_voucher_payment_account`:
 *
 * 1. الحساب صالح فقط إذا كان `is_active` و`allow_posting` — وإلا
 *    `VOUCHER_PAYMENT_ACCOUNT_INVALID_OR_CROSS_ORG`.
 * 2. `subtype` يجب أن يوافق طريقة السداد — وإلا
 *    `VOUCHER_PAYMENT_ACCOUNT_METHOD_MISMATCH`.
 *
 * والخريطة تختلف بين السندين: سند القبض يعامل `check` بوصفه نقدًا (شيك مقبوض
 * يودع في الخزينة)، بينما سند الصرف يعامله بوصفه بنكيًا (شيك مصروف يُسحب على
 * البنك). لا تغيّر هذه الخريطة هنا وحدها — الـtrigger هو المرجع القانوني،
 * وهذا الملف تابع له.
 */

import type { PaymentMethod } from './payment-vouchers-service'

export type VoucherKind = 'customer_receipt' | 'supplier_payment'

export interface PaymentAccountLike {
  id?: string
  code?: string
  name?: string
  name_ar?: string
  subtype?: string
  allow_posting?: boolean
}

/** الأنواع الفرعية المقبولة لطريقة سداد ونوع سند — مطابقة لـ`v_expected` في الـtrigger. */
export function allowedAccountSubtypes(
  kind: VoucherKind,
  method: PaymentMethod
): ReadonlySet<string> {
  if (method === 'other') return new Set(['CASH', 'BANK'])
  if (kind === 'customer_receipt') {
    return method === 'cash' || method === 'check' ? new Set(['CASH']) : new Set(['BANK'])
  }
  return method === 'cash' ? new Set(['CASH']) : new Set(['BANK'])
}

/** هل يقبل الـtrigger هذا الحساب مع هذه الطريقة؟ */
export function accountMatchesMethod(
  account: PaymentAccountLike | undefined,
  kind: VoucherKind,
  method: PaymentMethod
): boolean {
  if (!account?.subtype) return false
  if (account.allow_posting === false) return false
  return allowedAccountSubtypes(kind, method).has(account.subtype)
}

/** ترشيح قائمة الحسابات المعروضة في القائمة المنسدلة. */
export function filterAccountsForMethod<T extends PaymentAccountLike>(
  accounts: readonly T[],
  kind: VoucherKind,
  method: PaymentMethod
): T[] {
  return accounts.filter(account => accountMatchesMethod(account, kind, method))
}
