/**
 * نموذج الاستلام الجزئي بوحدة أمر الشراء (Migration 148).
 *
 * النموذج نفسه **لا يُستبدل بـmock**؛ تُعزل حدوده الخارجية فقط: خدمة قراءة الأوامر
 * القابلة للاستلام، دالة الترحيل، سياق المؤسسة، ومحدد المخزن. الباقي — تحويل
 * السطور إلى مسودات، حساب كمية الأساس، التحقق، بصمة idempotency، وخرائط الأخطاء —
 * يعمل فعليًا لأن هذه هي المنطقة التي يقع فيها الخطأ المالي.
 *
 * الحمولة إلى الخادم بوحدة **الإدخال** التجارية: 0.25 طن لا 250 كجم. إرسال كمية
 * الأساس يجعل الخادم يضربها في المعامل مرة ثانية.
 */
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Radix Select يعتمد Pointer Capture وscrollIntoView وjsdom لا يوفّرهما.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

const mocks = vi.hoisted(() => ({
  listOrders: vi.fn(),
  receiveGoods: vi.fn(),
  currentOrgId: 'org-1' as string | null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: mocks.currentOrgId }),
}))

vi.mock('@/services/purchasing-service', () => ({
  receiveGoods: mocks.receiveGoods,
}))

vi.mock('@/components/ui/warehouse-selector', () => ({
  WarehouseSelector: ({ value, onChange, disabled }: {
    value: string
    onChange: (next: string) => void
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled} onClick={() => onChange('wh-1')}>
      {value ? `مخزن:${value}` : 'اختر المخزن'}
    </button>
  ),
}))

// خدمة القراءة وحدها تُعزل؛ منطق بناء الحمولة والتحقق يبقى حقيقيًا.
vi.mock('@/services/uom-goods-receipt-service', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/uom-goods-receipt-service')
  >('@/services/uom-goods-receipt-service')
  return { ...actual, listUomReceivablePurchaseOrders: mocks.listOrders }
})

import { UomGoodsReceiptForm } from '../UomGoodsReceiptForm'
import { validateReceiptQuantity } from '@/services/uom-goods-receipt-service'

// 0.5 طن مطلوبة بمعامل 1000 ⇒ 500 كجم أساس، و2000 ريال/طن ⇒ 2 ريال/كجم.
const receivableOrder = () => ({
  id: 'po-1',
  order_number: 'PO-UOM-1',
  vendor_id: 'vendor-1',
  vendor: { id: 'vendor-1', code: 'V1', name: 'مورد الاختبار' },
  order_date: '2026-07-24',
  expected_delivery_date: null,
  status: 'approved' as const,
  total_amount: 1150,
  lines: [
    {
      id: 'pol-1',
      line_number: 1,
      product_id: 'prod-1',
      product: { code: 'RM-1', name: 'PP Sheet', name_ar: 'صفائح' },
      uom_id: 'uom-ton',
      uom: {
        id: 'uom-ton', code: 'TON', name: 'Metric ton',
        name_ar: 'طن', symbol: 'طن', decimal_places: 3,
      },
      conversion_factor_snapshot: 1000,
      ordered_qty_entered: 0.5,
      ordered_qty_base: 500,
      received_qty_entered: 0,
      received_qty_base: 0,
      accepted_qty_base: 0,
      rejected_qty_base: 0,
      pending_qty_base: 0,
      remaining_qty_entered: 0.5,
      remaining_qty_base: 500,
      unit_cost_entered: 2000,
      unit_cost_base: 2,
    },
  ],
})

const renderForm = (onSuccess = vi.fn(), onOpenChange = vi.fn()) => {
  render(<UomGoodsReceiptForm open onOpenChange={onOpenChange} onSuccess={onSuccess} />)
  return { onSuccess, onOpenChange }
}

/** يختار الأمر ويحدد المخزن — الحد الأدنى لجعل النموذج قابلًا للإرسال. */
const prepareOrder = async () => {
  await userEvent.click(await screen.findByRole('combobox', { name: /أمر الشراء المعتمد/ }))
  await userEvent.click(await screen.findByRole('option', { name: /PO-UOM-1/ }))
  await userEvent.click(screen.getByRole('button', { name: 'اختر المخزن' }))
}

const quantityInput = () =>
  screen.getByRole('spinbutton', { name: 'كمية استلام صفائح' })

const submit = () => userEvent.click(screen.getByRole('button', { name: 'تأكيد الاستلام' }))

// حقل type="number" لا يستقبل الكسور والإشارة السالبة بموثوقية عبر userEvent.type،
// فتُضبط القيمة مباشرة كما يفعل المتصفح عند اللصق أو استخدام أسهم الزيادة.
const setQuantity = (value: string) => {
  fireEvent.change(quantityInput(), { target: { value } })
}

describe('UomGoodsReceiptForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentOrgId = 'org-1'
    mocks.listOrders.mockResolvedValue([receivableOrder()])
    mocks.receiveGoods.mockResolvedValue({
      success: true,
      data: { id: 'gr-1', receipt_number: 'GR-000001' },
    })
  })

  describe('تحميل الأوامر', () => {
    it('يعرض حالة التحميل ثم الأمر القابل للاستلام', async () => {
      let resolveOrders: (value: unknown) => void = () => {}
      mocks.listOrders.mockReturnValue(new Promise((resolve) => { resolveOrders = resolve }))
      renderForm()

      expect(screen.getByText('جاري التحميل…')).toBeInTheDocument()

      resolveOrders([receivableOrder()])
      await waitFor(() => expect(screen.queryByText('جاري التحميل…')).not.toBeInTheDocument())

      await userEvent.click(screen.getByRole('combobox', { name: /أمر الشراء المعتمد/ }))
      expect(await screen.findByRole('option', { name: /PO-UOM-1/ })).toBeInTheDocument()
    })

    it('قائمة فارغة تُبلَّغ صراحة بدل شاشة صامتة', async () => {
      mocks.listOrders.mockResolvedValue([])
      renderForm()

      await waitFor(() =>
        expect(mocks.toast.info).toHaveBeenCalledWith('لا توجد أوامر شراء معتمدة قابلة للاستلام')
      )
    })

    it('فشل التحميل يُعرض كخطأ ولا يُسقط النموذج', async () => {
      mocks.listOrders.mockRejectedValue(new Error('UOM_ENGINE_NOT_ENABLED_FOR_ORG'))
      renderForm()

      await waitFor(() =>
        expect(mocks.toast.error).toHaveBeenCalledWith('تعذر تحميل أوامر الشراء القابلة للاستلام')
      )
      expect(screen.getByRole('button', { name: 'تأكيد الاستلام' })).toBeDisabled()
    })

    it('غياب المؤسسة المختارة يمنع القراءة أصلًا', async () => {
      mocks.currentOrgId = null
      renderForm()

      await waitFor(() => expect(mocks.listOrders).not.toHaveBeenCalled())
    })
  })

  describe('تحويل السطور إلى مسودة', () => {
    it('يعرض القيم التجارية وSnapshot ومعاينة وحدة الأساس', async () => {
      renderForm()
      await prepareOrder()

      const productRow = screen
        .getAllByRole('row')
        .find((row) => within(row).queryByText('صفائح')) as HTMLElement
      expect(productRow).toBeDefined()

      const cells = within(productRow).getAllByRole('cell')
      expect(cells[2]).toHaveTextContent('طن')
      // المطلوب والمتبقي بوحدة الإدخال التجارية لا بوحدة الأساس.
      expect(cells[3]).toHaveTextContent('0.5')
      expect(cells[4]).toHaveTextContent('0.5')
      // معاينة وحدة الأساس مشتقة من Snapshot: 0.5 × 1000 = 500.
      expect(cells[6]).toHaveTextContent('500')
      expect(cells[6]).toHaveTextContent('× 1,000')
      // التكلفة معروضة بالوحدة التجارية (2000/طن) لا بوحدة الأساس (2/كجم).
      expect(cells[8]).toHaveTextContent('2,000.00 ريال')

      expect(quantityInput()).toHaveValue(0.5)
    })
  })

  describe('حالات العرض الحدّية', () => {
    it('اسم المنتج يتدرّج: العربي ثم الإنجليزي ثم الكود', async () => {
      mocks.listOrders.mockResolvedValue([{
        ...receivableOrder(),
        lines: [
          { ...receivableOrder().lines[0], id: 'l-ar' },
          {
            ...receivableOrder().lines[0], id: 'l-en',
            product: { code: 'RM-2', name: 'English only', name_ar: null },
          },
          {
            ...receivableOrder().lines[0], id: 'l-code',
            product: { code: 'RM-3', name: null, name_ar: null },
          },
        ],
      }])
      renderForm()
      await prepareOrder()

      expect(screen.getAllByText('صفائح').length).toBeGreaterThan(0)
      expect(screen.getAllByText('English only').length).toBeGreaterThan(0)
      expect(screen.getAllByText('RM-3').length).toBeGreaterThan(0)
    })

    it('الوحدة بلا رمز تعود إلى الكود ثم إلى شرطة', async () => {
      mocks.listOrders.mockResolvedValue([{
        ...receivableOrder(),
        lines: [{
          ...receivableOrder().lines[0],
          uom: { id: 'u', code: 'TON', name: null, name_ar: null, symbol: null, decimal_places: null },
        }],
      }])
      renderForm()
      await prepareOrder()

      const productRow = screen
        .getAllByRole('row')
        .find((row) => within(row).queryByText('صفائح')) as HTMLElement
      expect(within(productRow).getAllByRole('cell')[2]).toHaveTextContent('TON')
    })

    // سطر استُلم بالكامل لا رصيد مفتوح له: لا يجوز اختياره أصلًا.
    it('سطر بلا رصيد مفتوح يُعطَّل اختياره', async () => {
      mocks.listOrders.mockResolvedValue([{
        ...receivableOrder(),
        lines: [{
          ...receivableOrder().lines[0],
          remaining_qty_entered: 0,
          remaining_qty_base: 0,
          accepted_qty_base: 500,
        }],
      }])
      renderForm()
      await prepareOrder()

      screen.getAllByRole('checkbox').forEach((box) => expect(box).toBeDisabled())
      expect(screen.getByRole('button', { name: 'تأكيد الاستلام' })).toBeEnabled()
    })

    it('إلغاء تحديد السطر يعطّل حقل الكمية واختيار الجودة', async () => {
      renderForm()
      await prepareOrder()

      const checkboxes = screen.getAllByRole('checkbox')
      await userEvent.click(checkboxes[checkboxes.length - 1])

      expect(quantityInput()).toBeDisabled()
    })

    it('إغلاق النموذج يدويًا يعيد ضبط الاختيار', async () => {
      const { onOpenChange } = renderForm()
      await prepareOrder()
      expect(quantityInput()).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'إلغاء' }))

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(screen.queryByRole('spinbutton', { name: 'كمية استلام صفائح' })).not.toBeInTheDocument()
    })
  })

  describe('الترحيل', () => {
    it('استلام جزئي مقبول يرسل وحدة الإدخال لا وحدة الأساس', async () => {
      renderForm()
      await prepareOrder()
      setQuantity('0.25')
      await submit()

      await waitFor(() => expect(mocks.receiveGoods).toHaveBeenCalled())
      const [receipt, lines] = mocks.receiveGoods.mock.calls[0]

      expect(receipt).toMatchObject({
        purchase_order_id: 'po-1',
        vendor_id: 'vendor-1',
        warehouse_id: 'wh-1',
      })
      expect(lines[0]).toMatchObject({
        purchase_order_line_id: 'pol-1',
        uom_id: 'uom-ton',
        qty_entered: 0.25,
        unit_cost_entered: 2000,
        quality_status: 'accepted',
        // كمية الأساس محسوبة من Snapshot: 0.25 × 1000.
        received_quantity: 250,
        unit_cost: 2,
      })
    })

    it('الرفض يُرسل كما اختاره المستخدم ولا يُحوَّل إلى مقبول', async () => {
      renderForm()
      await prepareOrder()

      const qualityTriggers = screen.getAllByRole('combobox').filter(
        (element) => element.textContent?.includes('مقبول')
      )
      await userEvent.click(qualityTriggers[qualityTriggers.length - 1])
      await userEvent.click(await screen.findByRole('option', { name: 'مرفوض' }))
      await submit()

      await waitFor(() => expect(mocks.receiveGoods).toHaveBeenCalled())
      expect(mocks.receiveGoods.mock.calls[0][1][0]).toMatchObject({
        quality_status: 'rejected',
        qty_entered: 0.5,
      })
    })

    it('النجاح يغلق النموذج ويستدعي onSuccess', async () => {
      const { onSuccess, onOpenChange } = renderForm()
      await prepareOrder()
      await submit()

      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onSuccess).toHaveBeenCalled()
    })

    it('تحذير القيد المحاسبي يُعرض ولا يُبتلع', async () => {
      mocks.receiveGoods.mockResolvedValue({
        success: true,
        data: { id: 'gr-2' },
        glWarning: 'تعذر ترحيل قيد GRNI',
      })
      renderForm()
      await prepareOrder()
      await submit()

      await waitFor(() =>
        expect(mocks.toast.warning).toHaveBeenCalledWith(
          'تعذر ترحيل قيد GRNI',
          expect.objectContaining({ duration: 10000 })
        )
      )
    })
  })

  describe('التحقق قبل الإرسال', () => {
    it('بلا مخزن لا يُرسل شيء', async () => {
      renderForm()
      await userEvent.click(await screen.findByRole('combobox', { name: /أمر الشراء المعتمد/ }))
      await userEvent.click(await screen.findByRole('option', { name: /PO-UOM-1/ }))
      await submit()

      expect(mocks.toast.error).toHaveBeenCalledWith('اختر المخزن')
      expect(mocks.receiveGoods).not.toHaveBeenCalled()
    })

    it('بلا سطر محدد لا يُرسل شيء', async () => {
      renderForm()
      await prepareOrder()
      const checkboxes = screen.getAllByRole('checkbox')
      await userEvent.click(checkboxes[checkboxes.length - 1])
      await submit()

      expect(mocks.toast.error).toHaveBeenCalledWith('اختر سطرًا واحدًا على الأقل')
      expect(mocks.receiveGoods).not.toHaveBeenCalled()
    })

    it('الكمية صفر تُرفض في JS لأن min="0" يسمح بها أصلًا', async () => {
      renderForm()
      await prepareOrder()
      setQuantity('0')
      await submit()

      expect(mocks.toast.error).toHaveBeenCalledWith('أدخل كمية استلام صحيحة وأكبر من صفر')
      expect(mocks.receiveGoods).not.toHaveBeenCalled()
    })

    it('الحقل الفارغ يُرفض ولا يُرسل كمية غير محددة', async () => {
      renderForm()
      await prepareOrder()
      setQuantity('')
      await submit()

      expect(mocks.toast.error).toHaveBeenCalledWith('أدخل كمية استلام صحيحة وأكبر من صفر')
      expect(mocks.receiveGoods).not.toHaveBeenCalled()
    })

    // الحقل يحمل min="0" وmax=الرصيد المتبقي، فالمتصفح يمنع الإرسال قبل بلوغ JS.
    // هذه هي الطبقة الأولى، ويُثبَت أنها تمنع الترحيل فعلًا لا أنها تعرض رسالة.
    it.each([
      ['-3', 'السالب دون min'],
      ['0.75', 'المتجاوز فوق max'],
    ])('الكمية %s (%s) يمنعها تحقق المتصفح فلا يصل شيء إلى الخادم', async (value) => {
      renderForm()
      await prepareOrder()
      setQuantity(value)
      await submit()

      expect(mocks.receiveGoods).not.toHaveBeenCalled()
      expect(mocks.toast.success).not.toHaveBeenCalled()
    })
  })

  // الطبقة الثانية: الحارس البرمجي نفسه. لا يعتمد على المتصفح، ويحمي أي مسار
  // يتجاوز قيود الحقل — لصق برمجي أو متصفح لا يفرض القيود.
  describe('حارس الكمية البرمجي', () => {
    it.each([
      [0, 'صفر'],
      [-3, 'سالب'],
      [Number.NaN, 'NaN'],
      [Number.POSITIVE_INFINITY, 'لا نهائي'],
    ])('%s (%s) يُرفض بـRECEIPT_QUANTITY_MUST_BE_POSITIVE', (quantity) => {
      expect(() => validateReceiptQuantity(quantity as number, 0.5))
        .toThrow('RECEIPT_QUANTITY_MUST_BE_POSITIVE')
    })

    it('رصيد مفتوح غير صالح يُرفض بـNO_OPEN_QUANTITY', () => {
      expect(() => validateReceiptQuantity(1, 0)).toThrow('NO_OPEN_QUANTITY')
      expect(() => validateReceiptQuantity(1, Number.NaN)).toThrow('NO_OPEN_QUANTITY')
    })

    it('تجاوز الرصيد يُرفض بـRECEIPT_QUANTITY_EXCEEDS_OPEN_BALANCE', () => {
      expect(() => validateReceiptQuantity(0.75, 0.5))
        .toThrow('RECEIPT_QUANTITY_EXCEEDS_OPEN_BALANCE')
    })

    it('الاستلام الكامل للرصيد مشروع، وفرق التقريب دون 1e-6 مقبول', () => {
      expect(() => validateReceiptQuantity(0.5, 0.5)).not.toThrow()
      expect(() => validateReceiptQuantity(0.5000005, 0.5)).not.toThrow()
    })
  })

  describe('بصمة مفتاح idempotency', () => {
    it('إعادة محاولة نفس الحمولة تحتفظ بالمفتاح فلا يتكرر السند', async () => {
      mocks.receiveGoods.mockRejectedValueOnce(new Error('network timeout'))
      renderForm()
      await prepareOrder()
      setQuantity('0.25')

      await submit()
      await waitFor(() => expect(mocks.receiveGoods).toHaveBeenCalledTimes(1))
      await submit()
      await waitFor(() => expect(mocks.receiveGoods).toHaveBeenCalledTimes(2))

      const firstKey = mocks.receiveGoods.mock.calls[0][2]
      const secondKey = mocks.receiveGoods.mock.calls[1][2]
      expect(typeof firstKey).toBe('string')
      expect(secondKey).toBe(firstKey)
    })

    it('تغيير الكمية بعد فشل يولّد مفتاحًا جديدًا — عملية مختلفة لا إعادة محاولة', async () => {
      mocks.receiveGoods.mockRejectedValueOnce(new Error('network timeout'))
      renderForm()
      await prepareOrder()
      setQuantity('0.25')

      await submit()
      await waitFor(() => expect(mocks.receiveGoods).toHaveBeenCalledTimes(1))

      setQuantity('0.3')
      await submit()
      await waitFor(() => expect(mocks.receiveGoods).toHaveBeenCalledTimes(2))

      expect(mocks.receiveGoods.mock.calls[1][2]).not.toBe(mocks.receiveGoods.mock.calls[0][2])
    })

    it('تغيير التاريخ بعد فشل يولّد مفتاحًا جديدًا كذلك', async () => {
      mocks.receiveGoods.mockRejectedValueOnce(new Error('network timeout'))
      renderForm()
      await prepareOrder()

      await submit()
      await waitFor(() => expect(mocks.receiveGoods).toHaveBeenCalledTimes(1))

      const dateInput = screen.getByLabelText(/تاريخ الاستلام/)
      await userEvent.clear(dateInput)
      await userEvent.type(dateInput, '2026-07-20')

      await submit()
      await waitFor(() => expect(mocks.receiveGoods).toHaveBeenCalledTimes(2))

      expect(mocks.receiveGoods.mock.calls[1][2]).not.toBe(mocks.receiveGoods.mock.calls[0][2])
    })
  })

  describe('خرائط أخطاء الخادم', () => {
    it.each([
      ['OVER_RECEIPT: remaining=1', 'الكمية تجاوزت الرصيد المفتوح وتم رفض العملية بالكامل'],
      ['PO_NOT_RECEIVABLE: draft', 'أمر الشراء غير معتمد أو لم يعد قابلًا للاستلام'],
      ['PENDING_INSPECTION_REQUIRES_RESOLUTION_FLOW', 'قيد الفحص غير متاح حتى اكتمال مسار حسم الجودة'],
      ['23514 raw database detail', 'تعذر تسجيل سند الاستلام'],
    ])('«%s» يُترجم إلى رسالة مفهومة', async (serverError, expected) => {
      mocks.receiveGoods.mockRejectedValue(new Error(serverError))
      const { onSuccess } = renderForm()
      await prepareOrder()
      await submit()

      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(expected))
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('نتيجة غير ناجحة من الخدمة تُعامل كفشل لا كنجاح صامت', async () => {
      mocks.receiveGoods.mockResolvedValue({ success: false, error: new Error('OVER_RECEIPT') })
      const { onSuccess, onOpenChange } = renderForm()
      await prepareOrder()
      await submit()

      await waitFor(() =>
        expect(mocks.toast.error).toHaveBeenCalledWith(
          'الكمية تجاوزت الرصيد المفتوح وتم رفض العملية بالكامل'
        )
      )
      expect(mocks.toast.success).not.toHaveBeenCalled()
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })
  })
})
