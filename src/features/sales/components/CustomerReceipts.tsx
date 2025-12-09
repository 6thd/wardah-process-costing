/**
 * Customer Receipts Component
 * مكون سندات القبض للعملاء
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
  getCustomerOutstandingInvoices,
  getPaymentAccounts,
  type CustomerReceipt,
  type PaymentMethod
} from '@/services/payment-vouchers-service'
import { customersService } from '@/services/supabase-service'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'
import { ar } from 'date-fns/locale'

export function CustomerReceipts() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [receipts, setReceipts] = useState<CustomerReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState<CustomerReceipt | null>(null)

  useEffect(() => {
    loadReceipts()
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
        loadReceipts()
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
      cancelled: { label: 'ملغي', variant: 'destructive' }
    }
    const statusInfo = statusMap[status] || { label: status, variant: 'outline' }
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
      other: 'أخرى'
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
                loadReceipts()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">إجمالي السندات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{receipts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">المسودات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {receipts.filter(r => r.status === 'draft').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">المقررة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {receipts.filter(r => r.status === 'posted').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">إجمالي المبلغ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {receipts.reduce((sum, r) => sum + (r.amount || 0), 0).toFixed(2)} ريال
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Receipts Table */}
      <Card>
        <CardHeader>
          <CardTitle>قائمة سندات القبض</CardTitle>
        </CardHeader>
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
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      لا توجد سندات قبض
                    </TableCell>
                  </TableRow>
                ) : (
                  receipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">{receipt.receipt_number}</TableCell>
                      <TableCell>{receipt.customer?.name || 'غير محدد'}</TableCell>
                      <TableCell>
                        {receipt.receipt_date ? new Date(receipt.receipt_date).toLocaleDateString('ar-SA') : '-'}
                      </TableCell>
                      <TableCell>{receipt.amount?.toFixed(2) || '0.00'} ريال</TableCell>
                      <TableCell>{getPaymentMethodLabel(receipt.payment_method)}</TableCell>
                      <TableCell>{getStatusBadge(receipt.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {receipt.status === 'draft' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePost(receipt.id!)}
                            >
                              إقرار
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedReceipt(receipt)}
                          >
                            عرض
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Receipt Details Dialog */}
      {selectedReceipt && (
        <Dialog open={!!selectedReceipt} onOpenChange={() => setSelectedReceipt(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>تفاصيل سند القبض</DialogTitle>
            </DialogHeader>
            <ReceiptDetails receipt={selectedReceipt} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function CreateReceiptForm({ onSuccess }: { onSuccess: () => void }) {
  const [customers, setCustomers] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<string>('')
  const [outstandingInvoices, setOutstandingInvoices] = useState<any[]>([])
  const [paymentAccounts, setPaymentAccounts] = useState<any[]>([])
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
    notes: ''
  })
  const [selectedInvoices, setSelectedInvoices] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadCustomers()
    loadPaymentAccounts()
  }, [])

  useEffect(() => {
    if (selectedCustomer) {
      loadOutstandingInvoices(selectedCustomer)
    }
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
        if (result.data.length === 0) {
          console.warn('No payment accounts found. Please create cash/bank accounts in GL.')
        }
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
      if (result.success && result.data) {
        setOutstandingInvoices(result.data || [])
      }
    } catch (error) {
      console.error('Error loading invoices:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Calculate total from selected invoices
      const lines = Object.entries(selectedInvoices)
        .filter(([_, amount]) => amount > 0)
        .map(([invoiceId, amount]) => ({
          invoice_id: invoiceId,
          allocated_amount: amount,
          discount_amount: 0
        }))

      const receiptData = {
        ...formData,
        customer_id: selectedCustomer,
        lines: lines.length > 0 ? lines : undefined
      }

      const result = await createCustomerReceipt(receiptData)
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
    setSelectedInvoices(prev => ({
      ...prev,
      [invoiceId]: amount
    }))
    
    // Update total amount
    const total = Object.values({ ...selectedInvoices, [invoiceId]: amount })
      .reduce((sum, amt) => sum + amt, 0)
    setFormData(prev => ({ ...prev, amount: total }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>العميل *</Label>
          <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
            <SelectTrigger>
              <SelectValue placeholder="اختر العميل" />
            </SelectTrigger>
            <SelectContent>
              {customers.map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>تاريخ السند *</Label>
          <Input
            type="date"
            value={formData.receipt_date}
            onChange={(e) => setFormData(prev => ({ ...prev, receipt_date: e.target.value }))}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>المبلغ *</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.amount}
            onChange={(e) => setFormData(prev => ({ ...prev, amount: Number.parseFloat(e.target.value) || 0 }))}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>طريقة السداد *</Label>
          <Select
            value={formData.payment_method}
            onValueChange={(value) => setFormData(prev => ({ ...prev, payment_method: value as PaymentMethod }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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
          <Label>حساب السداد</Label>
          <Select
            value={formData.payment_account_id}
            onValueChange={(value) => setFormData(prev => ({ ...prev, payment_account_id: value }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="اختر الحساب" />
            </SelectTrigger>
            <SelectContent>
              {paymentAccounts.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  لا توجد حسابات سداد متاحة
                </div>
              ) : (
                paymentAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.code} - {account.name_ar || account.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {formData.payment_method === 'check' && (
          <>
            <div className="space-y-2">
              <Label>رقم الشيك</Label>
              <Input
                value={formData.check_number}
                onChange={(e) => setFormData(prev => ({ ...prev, check_number: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>تاريخ الشيك</Label>
              <Input
                type="date"
                value={formData.check_date}
                onChange={(e) => setFormData(prev => ({ ...prev, check_date: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>بنك الشيك</Label>
              <Input
                value={formData.check_bank}
                onChange={(e) => setFormData(prev => ({ ...prev, check_bank: e.target.value }))}
              />
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label>رقم المرجع</Label>
          <Input
            value={formData.reference_number}
            onChange={(e) => setFormData(prev => ({ ...prev, reference_number: e.target.value }))}
          />
        </div>
      </div>

      {/* Outstanding Invoices */}
      {selectedCustomer && outstandingInvoices.length > 0 && (
        <div className="space-y-2">
          <Label>توزيع المبلغ على الفواتير</Label>
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الفاتورة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المبلغ المستحق</TableHead>
                    <TableHead>المدفوع</TableHead>
                    <TableHead>المتبقي</TableHead>
                    <TableHead>المخصص</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outstandingInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>{invoice.invoice_number}</TableCell>
                      <TableCell>
                        {new Date(invoice.invoice_date).toLocaleDateString('ar-SA')}
                      </TableCell>
                      <TableCell>{invoice.total_amount?.toFixed(2)} ريال</TableCell>
                      <TableCell>{invoice.paid_amount?.toFixed(2) || '0.00'} ريال</TableCell>
                      <TableCell>{invoice.outstanding_balance?.toFixed(2) || '0.00'} ريال</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={selectedInvoices[invoice.id] || 0}
                          onChange={(e) => updateInvoiceAllocation(invoice.id, Number.parseFloat(e.target.value) || 0)}
                          max={invoice.outstanding_balance}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-2">
        <Label>ملاحظات</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
          rows={3}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onSuccess}>
          إلغاء
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'جاري الحفظ...' : 'حفظ'}
        </Button>
      </div>
    </form>
  )
}

function ReceiptDetails({ receipt }: { receipt: CustomerReceipt }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-muted-foreground">رقم السند</Label>
          <p className="font-medium">{receipt.receipt_number}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">التاريخ</Label>
          <p className="font-medium">
            {receipt.receipt_date ? new Date(receipt.receipt_date).toLocaleDateString('ar-SA') : '-'}
          </p>
        </div>
        <div>
          <Label className="text-muted-foreground">المبلغ</Label>
          <p className="font-medium">{receipt.amount?.toFixed(2)} ريال</p>
        </div>
        <div>
          <Label className="text-muted-foreground">الحالة</Label>
          <p className="font-medium">{receipt.status}</p>
        </div>
      </div>

      {receipt.lines && receipt.lines.length > 0 && (
        <div>
          <Label className="text-muted-foreground mb-2 block">الفواتير المخصصة</Label>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الفاتورة</TableHead>
                <TableHead>المبلغ المخصص</TableHead>
                <TableHead>الخصم</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipt.lines.map((line, idx) => (
                <TableRow key={idx}>
                  <TableCell>{line.invoice_id}</TableCell>
                  <TableCell>{line.allocated_amount?.toFixed(2)} ريال</TableCell>
                  <TableCell>{line.discount_amount?.toFixed(2) || '0.00'} ريال</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

