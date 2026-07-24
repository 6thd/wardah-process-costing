/**
 * عقد الرصيد التعاقدي ووحدة الإدخال في نموذج الاستلام (Migration 148).
 *
 * هذه الاختبارات تثبت الحساب الذي يقود ما تُرسله الواجهة إلى `rpc_post_goods_receipt`:
 *   - المتبقي رصيد **تعاقدي**: المقبول نهائي، وقيد الفحص محتجز، والمرفوض يتحرّر.
 *   - الكمية تُرسل بوحدة الإدخال التجارية لا بوحدة الأساس، وإلا ضربها الخادم
 *     في المعامل مرة ثانية وانتفخ الاستلام.
 */
import { describe, expect, it } from 'vitest'

type Line = {
  ordered_quantity: number
  accepted_quantity: number
  pending_quantity: number
  conversion_factor: number
}

// نسخة مطابقة لمنطق النموذج، معزولة لاختبار الحساب وحده.
const remainingBase = (line: Line) =>
  Math.max(line.ordered_quantity - line.accepted_quantity - line.pending_quantity, 0)

const remainingEntered = (line: Line) =>
  Math.round((remainingBase(line) / (line.conversion_factor || 1)) * 1e6) / 1e6

const line = (over: Partial<Line> = {}): Line => ({
  ordered_quantity: 120,
  accepted_quantity: 0,
  pending_quantity: 0,
  conversion_factor: 12,
  ...over,
})

describe('الرصيد التعاقدي لسطر أمر الشراء', () => {
  it('أمر جديد: كامل الكمية متاحة بوحدتي الأساس والإدخال', () => {
    expect(remainingBase(line())).toBe(120)
    expect(remainingEntered(line())).toBe(10)
  })

  it('المقبول يستهلك الرصيد', () => {
    const l = line({ accepted_quantity: 48 })
    expect(remainingBase(l)).toBe(72)
    expect(remainingEntered(l)).toBe(6)
  })

  it('المرفوض لا يستهلك الرصيد — يبقى الاستبدال مشروعًا', () => {
    // 120 مستلمة ماديًا: 48 مقبولة و72 مرفوضة ⇒ لا كمية قيد الفحص.
    const l = line({ accepted_quantity: 48, pending_quantity: 0 })
    expect(remainingBase(l)).toBe(72)
  })

  it('قيد الفحص يحتجز الرصيد لأنه قد يُقبل لاحقًا', () => {
    const l = line({ accepted_quantity: 48, pending_quantity: 72 })
    expect(remainingBase(l)).toBe(0)
    expect(remainingEntered(l)).toBe(0)
  })

  it('الاستلام الزائد لا يُنتج رصيدًا سالبًا', () => {
    const l = line({ accepted_quantity: 200 })
    expect(remainingBase(l)).toBe(0)
    expect(remainingEntered(l)).toBe(0)
  })

  it('معامل 1: وحدة الإدخال تساوي وحدة الأساس', () => {
    const l = line({ ordered_quantity: 5, conversion_factor: 1 })
    expect(remainingEntered(l)).toBe(5)
  })

  it('المعامل الغائب يعامَل كـ1 بدل قسمة على صفر', () => {
    const l = line({ ordered_quantity: 5, conversion_factor: 0 })
    expect(remainingEntered(l)).toBe(5)
  })

  it('الكسور تُقرَّب إلى ست خانات كما يفعل الخادم', () => {
    const l = line({ ordered_quantity: 1, accepted_quantity: 0, conversion_factor: 3 })
    expect(remainingEntered(l)).toBe(0.333333)
  })
})
