/**
 * Supplier Payments Component
 * مكون سندات الصرف للموردين
 * 
 * Similar to CustomerReceipts but for suppliers
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
  getAllSupplierPayments,
  createSupplierPayment,
  postSupplierPayment,
  getSupplierOutstandingInvoices,
  getPaymentAccounts,
  type SupplierPayment,
  type PaymentMethod
} from '@/services/payment-vouchers-service'
import { vendorsService } from '@/services/supabase-service'

export function SupplierPayments() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<SupplierPayment | null>(null)

  useEffect(() => {
    loadPayments()
  }, [])

  const loadPayments = async () => {
    setLoading(true)
    try {
      const result = await getAllSupplierPayments()
      if (result.success && result.data) {
        setPayments(result.data)
      } else {
        toast.error('خطأ في تحميل سندات الصرف')
      }
    } catch (error: any) {
      toast.error(`خطأ: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handlePost = async (paymentId: string) => {
    try {
      const result = await postSupplierPayment(paymentId)
      if (result.success) {
        toast.success('تم إقرار السند بنجاح')
        loadPayments()
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
          <h1 className="text-2xl font-bold">سندات الصرف</h1>
          <p className="text-muted-foreground">إدارة سندات الصرف للموردين</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>إضافة سند صرف</Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>سند صرف جديد</DialogTitle>
              <DialogDescription>إنشاء سند صرف جديد لمورد</DialogDescription>
            </DialogHeader>
            <CreatePaymentForm 
              onSuccess={() => {
                setShowCreateDialog(false)
                loadPayments()
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
            <div className="text-2xl font-bold">{payments.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">المسودات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {payments.filter(p => p.status === 'draft').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">المقررة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {payments.filter(p => p.status === 'posted').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">إجمالي المبلغ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {payments.reduce((sum, p) => sum + (p.amount || 0), 0).toFixed(2)} ريال
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payments Table */}
      <Card>
        <CardHeader>
          <CardTitle>قائمة سندات الصرف</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">جاري التحميل...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم السند</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>طريقة السداد</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      لا توجد سندات صرف
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">{payment.payment_number}</TableCell>
                      <TableCell>{payment.vendor?.name || 'غير محدد'}</TableCell>
                      <TableCell>
                        {payment.payment_date ? new Date(payment.payment_date).toLocaleDateString('ar-SA') : '-'}
                      </TableCell>
                      <TableCell>{payment.amount?.toFixed(2) || '0.00'} ريال</TableCell>
                      <TableCell>{getPaymentMethodLabel(payment.payment_method)}</TableCell>
                      <TableCell>{getStatusBadge(payment.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {payment.status === 'draft' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePost(payment.id!)}
                            >
                              إقرار
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedPayment(payment)}
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

      {/* Payment Details Dialog */}
      {selectedPayment && (
        <Dialog open={!!selectedPayment} onOpenChange={() => setSelectedPayment(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>تفاصيل سند الصرف</DialogTitle>
            </DialogHeader>
            <PaymentDetails payment={selectedPayment} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function CreatePaymentForm({ onSuccess }: { onSuccess: () => void }) {
  const [vendors, setVendors] = useState<any[]>([])
  const [selectedVendor, setSelectedVendor] = useState<string>('')
  const [outstandingInvoices, setOutstandingInvoices] = useState<any[]>([])
  const [paymentAccounts, setPaymentAccounts] = useState<any[]>([])
  const [formData, setFormData] = useState({
    vendor_id: '',
    payment_date: new Date().toISOString().split('T')[0],
    amount: 0,
    payment_method: 'bank_transfer' as PaymentMethod,
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
    loadVendors()
    loadPaymentAccounts()
  }, [])

  useEffect(() => {
    if (selectedVendor) {
      loadOutstandingInvoices(selectedVendor)
    }
  }, [selectedVendor])

  const loadVendors = async () => {
    try {
      const data = await vendorsService.getAll()
      setVendors(data || [])
    } catch (error) {
      console.error('Error loading vendors:', error)
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

  const loadOutstandingInvoices = async (vendorId: string) => {
    try {
      const result = await getSupplierOutstandingInvoices(vendorId)
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

      const paymentData = {
        ...formData,
        vendor_id: selectedVendor,
        lines: lines.length > 0 ? lines : undefined
      }

      const result = await createSupplierPayment(paymentData)
      if (result.success) {
        toast.success('تم إنشاء سند الصرف بنجاح')
        onSuccess()
      } else {
        toast.error(result.error || 'خطأ في إنشاء سند الصرف')
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
          <Label>المورد *</Label>
          <Select value={selectedVendor} onValueChange={setSelectedVendor}>
            <SelectTrigger>
              <SelectValue placeholder="اختر المورد" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((vendor) => (
                <SelectItem key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>تاريخ السند *</Label>
          <Input
            type="date"
            value={formData.payment_date}
            onChange={(e) => setFormData(prev => ({ ...prev, payment_date: e.target.value }))}
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
      {selectedVendor && outstandingInvoices.length > 0 && (
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

function PaymentDetails({ payment }: { payment: SupplierPayment }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-muted-foreground">رقم السند</Label>
          <p className="font-medium">{payment.payment_number}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">التاريخ</Label>
          <p className="font-medium">
            {payment.payment_date ? new Date(payment.payment_date).toLocaleDateString('ar-SA') : '-'}
          </p>
        </div>
        <div>
          <Label className="text-muted-foreground">المبلغ</Label>
          <p className="font-medium">{payment.amount?.toFixed(2)} ريال</p>
        </div>
        <div>
          <Label className="text-muted-foreground">الحالة</Label>
          <p className="font-medium">{payment.status}</p>
        </div>
      </div>

      {payment.lines && payment.lines.length > 0 && (
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
              {payment.lines.map((line, idx) => (
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

