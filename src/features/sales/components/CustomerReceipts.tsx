/**
 * Customer Receipts Component
 * مكون سندات القبض للعملاء
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  getAllCustomerReceipts,
  createCustomerReceipt,
  postCustomerReceipt,
  updateCustomerReceiptDraft,
  cancelCustomerReceipt,
  resetCustomerReceiptToDraft,
  getCustomerOutstandingInvoices,
  getPaymentAccounts,
  type CustomerReceipt,
  type PaymentMethod,
} from '@/services/payment-vouchers-service'
import { accountMatchesMethod as sharedAccountMatchesMethod } from '@/services/voucher-payment-accounts'
import { VoucherAllocationsForm } from '@/components/vouchers/VoucherAllocationsForm'
import { VoucherReasonActionDialog, type VoucherReasonAction } from '@/components/vouchers/VoucherReasonActionDialog'
import { customersService } from '@/services/supabase-service'
import { usePermissions } from '@/hooks/usePermissions'

const CANCEL_PERMISSION = 'accounting.vouchers.cancel'
const UNPOST_PERMISSION = 'accounting.vouchers.unpost'

type ReceiptRow = CustomerReceipt & { collection_date?: string }
type PaymentAccount = {
  id: string
  code?: string
  name?: string
  name_ar?: string
  subtype?: string
  allow_posting?: boolean
}

function getReceiptDate(receipt: ReceiptRow): string | undefined {
  return receipt.receipt_date || receipt.collection_date
}

function accountMatchesMethod(account: PaymentAccount | undefined, method: PaymentMethod): boolean {
  return sharedAccountMatchesMethod(account, 'customer_receipt', method)
}

export function CustomerReceipts() {
  const { hasPermissionKey } = usePermissions()
  const canCancelVoucher = hasPermissionKey(CANCEL_PERMISSION)
  const canUnpostVoucher = hasPermissionKey(UNPOST_PERMISSION)
  const [receipts, setReceipts] = useState<CustomerReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState<CustomerReceipt | null>(null)
  const [editingReceipt, setEditingReceipt] = useState<CustomerReceipt | null>(null)
  const [pendingAction, setPendingAction] = useState<VoucherReasonAction | null>(null)

  useEffect(() => {
    void loadReceipts()
  }, [])

  const loadReceipts = async () => {
    setLoading(true)
    try {
      const result = await getAllCustomerReceipts()
      if (result.success && result.data) {
        setReceipts(result.data)
      } else {
        toast.error('خطأ في تحميل سندات القبض')
      }
    } catch (error: any) {
      toast.error(`خطأ: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handlePost = async (receiptId: string) => {
    try {
      const result = await postCustomerReceipt(receiptId)
      if (result.success) {
        toast.success('تم إقرار السند بنجاح')
        await loadReceipts()
      } else {
        toast.error(result.error || 'خطأ في إقرار السند')
      }
    } catch (error: any) {
      toast.error(`خطأ: ${error.message}`)
    }
  }

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      draft: { label: 'مسودة', variant: 'outline' },
      posted: { label: 'مقرر', variant: 'default' },
      cancelled: { label: 'ملغي', variant: 'destructive' },
    }
    const statusInfo = statusMap[status] || { label: status, variant: 'outline' as const }
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
  }

  const getPaymentMethodLabel = (method: PaymentMethod) => {
    const methods: Record<PaymentMethod, string> = {
      cash: 'نقدي',
      bank_transfer: 'تحويل بنكي',
      check: 'شيك',
      credit_card: 'بطاقة ائتمان',
      debit_card: 'بطاقة خصم',
      online_payment: 'دفع إلكتروني',
      mobile_payment: 'دفع محمول',
      other: 'أخرى',
    }
    return methods[method] || method
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">سندات القبض</h1>
          <p className="text-muted-foreground">إدارة سندات القبض من العملاء</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>إضافة سند قبض</Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>سند قبض جديد</DialogTitle>
              <DialogDescription>إنشاء سند قبض جديد من عميل</DialogDescription>
            </DialogHeader>
            <CreateReceiptForm
              onSuccess={() => {
                setShowCreateDialog(false)
                void loadReceipts()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">إجمالي السندات</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{receipts.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">المسودات</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-yellow-600">{receipts.filter(r => r.status === 'draft').length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">المقررة</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{receipts.filter(r => r.status === 'posted').length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">إجمالي المبلغ</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-blue-600">{receipts.reduce((sum, r) => sum + (r.amount || 0), 0).toFixed(2)} ريال</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>قائمة سندات القبض</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">جاري التحميل...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم السند</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>طريقة السداد</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد سندات قبض</TableCell></TableRow>
                ) : receipts.map(receipt => {
                  const receiptDate = getReceiptDate(receipt as ReceiptRow)
                  return (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">{receipt.receipt_number}</TableCell>
                      <TableCell>{receipt.customer?.name || 'غير محدد'}</TableCell>
                      <TableCell>{receiptDate ? new Date(`${receiptDate}T00:00:00`).toLocaleDateString('en-US') : '-'}</TableCell>
                      <TableCell>{receipt.amount?.toFixed(2) || '0.00'} ريال</TableCell>
                      <TableCell>{getPaymentMethodLabel(receipt.payment_method)}</TableCell>
                      <TableCell>{getStatusBadge(receipt.status)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {receipt.status === 'draft' && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => receipt.id && handlePost(receipt.id)}>إقرار</Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingReceipt(receipt)}>تعديل</Button>
                              {canCancelVoucher && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  aria-label={`إلغاء سند ${receipt.receipt_number}`}
                                  onClick={() => receipt.id && setPendingAction({ kind: 'cancel', voucherId: receipt.id })}
                                >
                                  إلغاء
                                </Button>
                              )}
                            </>
                          )}
                          {receipt.status === 'posted' && canUnpostVoucher && (
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`إعادة سند ${receipt.receipt_number} إلى مسودة`}
                              onClick={() => receipt.id && setPendingAction({ kind: 'reset', voucherId: receipt.id })}
                            >
                              إعادة إلى مسودة
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setSelectedReceipt(receipt)}>عرض</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedReceipt && (
        <Dialog open={Boolean(selectedReceipt)} onOpenChange={() => setSelectedReceipt(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>تفاصيل سند القبض</DialogTitle></DialogHeader>
            <ReceiptDetails receipt={selectedReceipt} />
          </DialogContent>
        </Dialog>
      )}

      {editingReceipt && (
        <Dialog open={Boolean(editingReceipt)} onOpenChange={() => setEditingReceipt(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>تعديل مسودة سند القبض {editingReceipt.receipt_number}</DialogTitle>
              <DialogDescription>
                تُستبدل مجموعة التخصيصات بالكامل بما تُدخله هنا — والمجموعة الفارغة تحذف كل السطور.
              </DialogDescription>
            </DialogHeader>
            <EditReceiptAllocationsForm
              receipt={editingReceipt}
              onCancel={() => setEditingReceipt(null)}
              onSuccess={() => {
                setEditingReceipt(null)
                void loadReceipts()
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      <VoucherReasonActionDialog
        action={pendingAction}
        resetDescription="يُفكّ ترحيل السند ويعود قيده إلى مسودة مع الاحتفاظ برقم القيد وسطوره، وتُعاد أرصدة الفواتير كما كانت."
        resetVoucher={resetCustomerReceiptToDraft}
        cancelVoucher={cancelCustomerReceipt}
        onClose={() => setPendingAction(null)}
        onChanged={loadReceipts}
      />
    </div>
  )
}

function EditReceiptAllocationsForm({
  receipt,
  onSuccess,
  onCancel,
}: Readonly<{ receipt: CustomerReceipt; onSuccess: () => void; onCancel: () => void }>) {
  return (
    <VoucherAllocationsForm
      voucherId={receipt.id}
      scopeId={receipt.customer_id}
      voucherAmount={receipt.amount}
      currentLines={receipt.lines}
      emptyMessage="لا توجد فواتير مفتوحة لهذا العميل"
      loadInvoices={getCustomerOutstandingInvoices}
      updateDraft={updateCustomerReceiptDraft}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  )
}

function CreateReceiptForm({ onSuccess }: Readonly<{ onSuccess: () => void }>) {
  const [customers, setCustomers] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [outstandingInvoices, setOutstandingInvoices] = useState<any[]>([])
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([])
  const [formData, setFormData] = useState({
    customer_id: '',
    receipt_date: new Date().toISOString().split('T')[0],
    amount: 0,
    payment_method: 'cash' as PaymentMethod,
    payment_account_id: '',
    check_number: '',
    check_date: '',
    check_bank: '',
    reference_number: '',
    notes: '',
  })
  const [selectedInvoices, setSelectedInvoices] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  const compatiblePaymentAccounts = useMemo(
    () => paymentAccounts.filter(account => accountMatchesMethod(account, formData.payment_method)),
    [paymentAccounts, formData.payment_method],
  )

  useEffect(() => {
    void loadCustomers()
    void loadPaymentAccounts()
  }, [])

  useEffect(() => {
    if (selectedCustomer) void loadOutstandingInvoices(selectedCustomer)
  }, [selectedCustomer])

  const loadCustomers = async () => {
    try {
      const data = await customersService.getAll()
      setCustomers(data || [])
    } catch (error) {
      console.error('Error loading customers:', error)
    }
  }

  const loadPaymentAccounts = async () => {
    try {
      const result = await getPaymentAccounts()
      if (result.success && result.data) {
        setPaymentAccounts(result.data)
        if (result.data.length === 0) console.warn('No payment accounts found. Please create cash/bank accounts in GL.')
      } else {
        console.error('Failed to load payment accounts:', result.error)
        toast.error('خطأ في تحميل حسابات السداد')
      }
    } catch (error: any) {
      console.error('Error loading payment accounts:', error)
      toast.error(`خطأ في تحميل حسابات السداد: ${error.message}`)
    }
  }

  const loadOutstandingInvoices = async (customerId: string) => {
    try {
      const result = await getCustomerOutstandingInvoices(customerId)
      if (result.success && result.data) setOutstandingInvoices(result.data || [])
    } catch (error) {
      console.error('Error loading invoices:', error)
    }
  }

  const handlePaymentMethodChange = (method: PaymentMethod) => {
    setFormData(prev => {
      const selected = paymentAccounts.find(account => account.id === prev.payment_account_id)
      return {
        ...prev,
        payment_method: method,
        payment_account_id: accountMatchesMethod(selected, method) ? prev.payment_account_id : '',
      }
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    const selectedAccount = paymentAccounts.find(account => account.id === formData.payment_account_id)
    if (!selectedAccount) {
      toast.error('اختر حساب السداد')
      return
    }
    if (!accountMatchesMethod(selectedAccount, formData.payment_method)) {
      toast.error('حساب السداد لا يتوافق مع طريقة السداد المختارة')
      return
    }

    setLoading(true)
    try {
      const lines = Object.entries(selectedInvoices)
        .filter(([, amount]) => amount > 0)
        .map(([invoiceId, amount]) => ({ invoice_id: invoiceId, allocated_amount: amount, discount_amount: 0 }))

      const result = await createCustomerReceipt({
        ...formData,
        customer_id: selectedCustomer,
        lines: lines.length > 0 ? lines : undefined,
      })
      if (result.success) {
        toast.success('تم إنشاء سند القبض بنجاح')
        onSuccess()
      } else {
        toast.error(result.error || 'خطأ في إنشاء سند القبض')
      }
    } catch (error: any) {
      toast.error(`خطأ: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const updateInvoiceAllocation = (invoiceId: string, amount: number) => {
    const next = { ...selectedInvoices, [invoiceId]: amount }
    setSelectedInvoices(next)
    setFormData(prev => ({ ...prev, amount: Object.values(next).reduce((sum, value) => sum + value, 0) }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>العميل *</Label>
          <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
            <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
            <SelectContent>{customers.map(customer => <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>تاريخ السند *</Label>
          <Input type="date" value={formData.receipt_date} onChange={event => setFormData(prev => ({ ...prev, receipt_date: event.target.value }))} required />
        </div>
        <div className="space-y-2">
          <Label>المبلغ *</Label>
          <Input type="number" step="0.01" value={formData.amount} onChange={event => setFormData(prev => ({ ...prev, amount: Number.parseFloat(event.target.value) || 0 }))} required />
        </div>
        <div className="space-y-2">
          <Label>طريقة السداد *</Label>
          <Select value={formData.payment_method} onValueChange={value => handlePaymentMethodChange(value as PaymentMethod)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">نقدي</SelectItem>
              <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
              <SelectItem value="check">شيك</SelectItem>
              <SelectItem value="credit_card">بطاقة ائتمان</SelectItem>
              <SelectItem value="debit_card">بطاقة خصم</SelectItem>
              <SelectItem value="online_payment">دفع إلكتروني</SelectItem>
              <SelectItem value="mobile_payment">دفع محمول</SelectItem>
              <SelectItem value="other">أخرى</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>حساب السداد *</Label>
          <Select value={formData.payment_account_id} onValueChange={value => setFormData(prev => ({ ...prev, payment_account_id: value }))}>
            <SelectTrigger><SelectValue placeholder="اختر الحساب المتوافق" /></SelectTrigger>
            <SelectContent>
              {compatiblePaymentAccounts.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">لا توجد حسابات متوافقة مع طريقة السداد</div>
              ) : compatiblePaymentAccounts.map(account => (
                <SelectItem key={account.id} value={account.id}>{account.code} - {account.name_ar || account.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {formData.payment_method === 'check' && (
          <>
            <div className="space-y-2"><Label>رقم الشيك</Label><Input value={formData.check_number} onChange={event => setFormData(prev => ({ ...prev, check_number: event.target.value }))} /></div>
            <div className="space-y-2"><Label>تاريخ الشيك</Label><Input type="date" value={formData.check_date} onChange={event => setFormData(prev => ({ ...prev, check_date: event.target.value }))} /></div>
            <div className="space-y-2"><Label>بنك الشيك</Label><Input value={formData.check_bank} onChange={event => setFormData(prev => ({ ...prev, check_bank: event.target.value }))} /></div>
          </>
        )}
        <div className="space-y-2"><Label>رقم المرجع</Label><Input value={formData.reference_number} onChange={event => setFormData(prev => ({ ...prev, reference_number: event.target.value }))} /></div>
      </div>

      {selectedCustomer && outstandingInvoices.length > 0 && (
        <div className="space-y-2">
          <Label>توزيع المبلغ على الفواتير</Label>
          <Card><CardContent className="pt-4"><Table>
            <TableHeader><TableRow><TableHead>رقم الفاتورة</TableHead><TableHead>التاريخ</TableHead><TableHead>المبلغ المستحق</TableHead><TableHead>المدفوع</TableHead><TableHead>المتبقي</TableHead><TableHead>المخصص</TableHead></TableRow></TableHeader>
            <TableBody>{outstandingInvoices.map(invoice => (
              <TableRow key={invoice.id}>
                <TableCell>{invoice.invoice_number}</TableCell>
                <TableCell>{new Date(invoice.invoice_date).toLocaleDateString('en-US')}</TableCell>
                <TableCell>{invoice.total_amount?.toFixed(2)} ريال</TableCell>
                <TableCell>{invoice.paid_amount?.toFixed(2) || '0.00'} ريال</TableCell>
                <TableCell>{invoice.outstanding_balance?.toFixed(2) || '0.00'} ريال</TableCell>
                <TableCell><Input type="number" step="0.01" value={selectedInvoices[invoice.id] || 0} onChange={event => updateInvoiceAllocation(invoice.id, Number.parseFloat(event.target.value) || 0)} max={invoice.outstanding_balance} /></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></CardContent></Card>
        </div>
      )}

      <div className="space-y-2"><Label>ملاحظات</Label><Textarea value={formData.notes} onChange={event => setFormData(prev => ({ ...prev, notes: event.target.value }))} rows={3} /></div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onSuccess}>إلغاء</Button>
        <Button type="submit" disabled={loading || !selectedCustomer || !formData.payment_account_id}>{loading ? 'جاري الحفظ...' : 'حفظ'}</Button>
      </div>
    </form>
  )
}

function ReceiptDetails({ receipt }: Readonly<{ receipt: CustomerReceipt }>) {
  const receiptDate = getReceiptDate(receipt as ReceiptRow)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label className="text-muted-foreground">رقم السند</Label><p className="font-medium">{receipt.receipt_number}</p></div>
        <div><Label className="text-muted-foreground">التاريخ</Label><p className="font-medium">{receiptDate ? new Date(`${receiptDate}T00:00:00`).toLocaleDateString('en-US') : '-'}</p></div>
        <div><Label className="text-muted-foreground">المبلغ</Label><p className="font-medium">{receipt.amount?.toFixed(2)} ريال</p></div>
        <div><Label className="text-muted-foreground">الحالة</Label><p className="font-medium">{receipt.status}</p></div>
      </div>

      {receipt.lines && receipt.lines.length > 0 && (
        <div>
          <Label className="text-muted-foreground mb-2 block">الفواتير المخصصة</Label>
          <Table>
            <TableHeader><TableRow><TableHead>رقم الفاتورة</TableHead><TableHead>المبلغ المخصص</TableHead><TableHead>الخصم</TableHead></TableRow></TableHeader>
            <TableBody>{receipt.lines.map(line => (
              <TableRow key={line.invoice_id || `${line.allocated_amount}-${line.discount_amount}`}>
                <TableCell>{line.invoice_id}</TableCell>
                <TableCell>{line.allocated_amount?.toFixed(2)} ريال</TableCell>
                <TableCell>{line.discount_amount?.toFixed(2) || '0.00'} ريال</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
