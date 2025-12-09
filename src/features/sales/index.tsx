import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
  customersService, 
  salesOrdersService,
  newSalesInvoicesService
} from '@/services/supabase-service'
import {
  getAllSalesOrders,
  getAllSalesInvoices
} from '@/services/enhanced-sales-service'
import { toast } from 'sonner'
import type { Customer } from '@/lib/supabase'
import { SalesInvoiceForm } from '@/components/forms/SalesInvoiceForm'
import { DeliveryNoteForm } from '@/components/forms/DeliveryNoteForm'
import { CustomerReceipts } from './components/CustomerReceipts'

// Shared status badge function
function getStatusBadge(status: string) {
  const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    'DRAFT': { label: 'مسودة', variant: 'outline' },
    'CONFIRMED': { label: 'مؤكدة', variant: 'default' },
    'DELIVERED': { label: 'مسلمة', variant: 'secondary' },
    'PAID': { label: 'مدفوعة', variant: 'secondary' },
    'CANCELLED': { label: 'ملغاة', variant: 'destructive' },
    'draft': { label: 'مسودة', variant: 'outline' },
    'sent': { label: 'مرسلة', variant: 'default' },
    'paid': { label: 'مدفوعة', variant: 'secondary' },
    'overdue': { label: 'متأخرة', variant: 'destructive' },
    'cancelled': { label: 'ملغاة', variant: 'destructive' }
  }
  const config = statusMap[status] || { label: status, variant: 'outline' as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}

// Helper function to get delivery status text
function getDeliveryStatusText(status: string): string {
  if (status === 'fully_delivered') return 'مسلمة';
  if (status === 'partially_delivered') return 'جزئية';
  return 'معلقة';
}

// Helper function to get payment status text
function getPaymentStatusText(status: string): string {
  if (status === 'paid') return 'مدفوعة';
  if (status === 'partially_paid') return 'جزئية';
  return 'غير مدفوعة';
}

function SalesOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [customers, setCustomers] = useState<Customer[]>([])
  const [orders, setOrders] = useState<any[]>([])

  // Helper function to load customers
  const loadCustomers = async () => {
    try {
      const customersData = await customersService.getAll().catch(() => [])
      setCustomers(customersData || [])
    } catch (error) {
      console.warn('Error loading customers:', error)
    }
  }

  // Helper function to load orders with fallback
  const loadOrdersWithFallback = async () => {
    try {
      const { getAllSalesInvoices } = await import('@/services/enhanced-sales-service')
      const invoicesResult = await getAllSalesInvoices()
      if (invoicesResult.success && invoicesResult.data) {
        setOrders(invoicesResult.data || [])
        return
      }
    } catch (invoiceError: any) {
      console.warn('Error loading sales invoices, trying fallback:', invoiceError)
    }
    
    // Fallback: try old service
    try {
      const ordersData = await salesOrdersService.getAll()
      setOrders(ordersData || [])
    } catch (ordersError: any) {
      if (ordersError.code === 'PGRST205') {
        console.warn('sales_orders table not found, using empty array')
        setOrders([])
      } else {
        console.error('Error loading sales data:', ordersError)
        toast.error(`خطأ في تحميل بيانات المبيعات: ${ordersError.message}`)
      }
    }
  }

  useEffect(() => {
    const loadData = async () => {
      try {
        await Promise.all([
          loadCustomers(),
          loadOrdersWithFallback()
        ])
      } catch (error: any) {
        console.error('Error loading sales data:', error)
        toast.error(`خطأ في تحميل بيانات المبيعات: ${error.message}`)
      }
    }
    loadData()
  }, [])

  const totalSalesValue = orders.reduce((sum, order) => sum + order.total_amount, 0)
  const pendingOrders = orders.filter(order => order.status === 'draft' || order.status === 'sent')

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('sales.title')}</h1>
        <p className="text-muted-foreground mt-2">
          إدارة المبيعات والعملاء
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{customers.length}</div>
          <div className="text-sm text-muted-foreground">إجمالي العملاء</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{totalSalesValue.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">قيمة المبيعات (ريال)</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-amber-600">{pendingOrders.length}</div>
          <div className="text-sm text-muted-foreground">فواتير معلقة</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-purple-600">{orders.length}</div>
          <div className="text-sm text-muted-foreground">إجمالي الفواتير</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/sales/customers" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('sales.customers')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إدارة العملاء
          </p>
        </Link>

        <Link to="/sales/orders" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('sales.invoices')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            فواتير المبيعات
          </p>
        </Link>

        <div className="bg-card rounded-lg border p-6">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('sales.delivery')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إدارة التسليم
          </p>
        </div>
      </div>
    </div>
  )
}

function CustomersManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    name_ar: '',
    code: '',
    contact_person: '',
    phone: '',
    email: '',
    address: ''
  })

  useEffect(() => {
    loadCustomers()
  }, [])

  const loadCustomers = async () => {
    try {
      const data = await customersService.getAll()
      setCustomers(data || [])
    } catch (error: any) {
      console.error('Error loading customers:', error)
      toast.error(`خطأ في تحميل العملاء: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const filteredCustomers = customers.filter(customer => 
    customer.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleAddCustomer = async () => {
    try {
      await customersService.create(newCustomer)
      toast.success('تم إضافة العميل بنجاح')
      setShowAddForm(false)
      setNewCustomer({
        name: '',
        name_ar: '',
        code: '',
        contact_person: '',
        phone: '',
        email: '',
        address: ''
      })
      loadCustomers()
    } catch (error: any) {
      console.error('Error adding customer:', error)
      toast.error(`خطأ في إضافة العميل: ${error.message}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold">{t('sales.customers')}</h1>
          <p className="text-muted-foreground">إدارة العملاء</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? t('common.cancel') : t('common.add')}
        </Button>
      </div>

      {/* Search */}
      <div className="max-w-md">
        <Input
          placeholder="البحث في العملاء..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Add Customer Form */}
      {showAddForm && (
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">إضافة عميل جديد</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="customer-name" className="block text-sm font-medium mb-2">اسم العميل</label>
              <Input
                id="customer-name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({...newCustomer, name: e.target.value})}
                placeholder="اسم العميل"
              />
            </div>
            <div>
              <label htmlFor="customer-name-ar" className="block text-sm font-medium mb-2">الاسم بالعربية</label>
              <Input
                id="customer-name-ar"
                value={newCustomer.name_ar}
                onChange={(e) => setNewCustomer({...newCustomer, name_ar: e.target.value})}
                placeholder="الاسم بالعربية"
              />
            </div>
            <div>
              <label htmlFor="customer-code" className="block text-sm font-medium mb-2">كود العميل</label>
              <Input
                id="customer-code"
                value={newCustomer.code}
                onChange={(e) => setNewCustomer({...newCustomer, code: e.target.value})}
                placeholder="كود العميل"
              />
            </div>
            <div>
              <label htmlFor="customer-contact" className="block text-sm font-medium mb-2">شخص الاتصال</label>
              <Input
                id="customer-contact"
                value={newCustomer.contact_person}
                onChange={(e) => setNewCustomer({...newCustomer, contact_person: e.target.value})}
                placeholder="شخص الاتصال"
              />
            </div>
            <div>
              <label htmlFor="customer-phone" className="block text-sm font-medium mb-2">رقم الهاتف</label>
              <Input
                id="customer-phone"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({...newCustomer, phone: e.target.value})}
                placeholder="رقم الهاتف"
              />
            </div>
            <div>
              <label htmlFor="customer-email" className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
              <Input
                id="customer-email"
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({...newCustomer, email: e.target.value})}
                placeholder="البريد الإلكتروني"
              />
            </div>
            <div>
              <label htmlFor="customer-address" className="block text-sm font-medium mb-2">العنوان</label>
              <Input
                id="customer-address"
                value={newCustomer.address}
                onChange={(e) => setNewCustomer({...newCustomer, address: e.target.value})}
                placeholder="العنوان"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleAddCustomer} disabled={!newCustomer.name}>
              {t('common.add')}
            </Button>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Customers List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة العملاء ({filteredCustomers.length})</h3>
        </div>
        <div className="divide-y">
          {filteredCustomers.map((customer) => (
            <div key={customer.id} className="p-4 flex justify-between items-center">
              <div className="flex-1">
                <h4 className="font-medium">{customer.name}</h4>
                <p className="text-sm text-muted-foreground">{customer.contact_person}</p>
                <p className="text-sm text-muted-foreground">{customer.phone} | {customer.email}</p>
              </div>
              <div className="text-right">
                <div className="font-medium">{customer.code}</div>
                <div className="text-sm text-muted-foreground">{customer.address}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SalesOrdersManagement() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const loadOrders = async () => {
    setLoading(true)
    try {
      // Try enhanced service first for sales orders
      const result = await getAllSalesOrders()
      if (result.success && result.data) {
        setOrders(result.data)
      } else {
        // Fallback to old service
        try {
          const oldData = await salesOrdersService.getAll()
          setOrders(oldData || [])
        } catch (oldError: any) {
          if (oldError.code === 'PGRST205') {
            // Table doesn't exist, use empty array
            console.warn('sales_orders table not found, using empty array')
            setOrders([])
          } else {
            console.error('Error loading sales orders:', oldError)
            toast.error(`خطأ في تحميل طلبات المبيعات: ${oldError.message}`)
          }
        }
      }
    } catch (error: any) {
      console.error('Error loading sales orders:', error)
      toast.error(`خطأ في تحميل طلبات المبيعات: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">طلبات المبيعات</h1>
          <p className="text-muted-foreground">إدارة طلبات المبيعات</p>
        </div>
        <Button disabled>
          + إضافة طلب مبيعات (قريباً)
        </Button>
      </div>

      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">قائمة طلبات المبيعات ({orders.length})</h3>
          {orders.length === 0 && <Badge variant="outline">لا توجد بيانات</Badge>}
        </div>
        <div className="divide-y">
          {orders.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>لا توجد طلبات مبيعات مسجلة</p>
              <p className="text-sm mt-2">البيانات موجودة في قاعدة البيانات</p>
            </div>
          ) : (
            orders.map((order) => (
              <div key={order.id} className="p-4 hover:bg-accent/50 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-medium text-lg">{order.so_number || order.order_number || `SO-${order.id?.slice(0, 8)}`}</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {order.customer?.name || 'عميل غير محدد'}
                    </p>
                    <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                      <span>📅 {new Date(order.order_date || order.so_date || order.created_at).toLocaleDateString('ar-SA')}</span>
                      {order.delivery_date && (
                        <span>🚚 التسليم: {new Date(order.delivery_date).toLocaleDateString('ar-SA')}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <div className="flex gap-2 mb-2">
                      {getStatusBadge(order.status)}
                    </div>
                    <div className="font-bold text-lg mt-2 text-primary">
                      {(order.total_amount || 0).toFixed(2)} ريال
                    </div>
                    {order.tax_amount > 0 && (
                      <div className="text-xs text-muted-foreground">
                        شامل ضريبة: {order.tax_amount.toFixed(2)} ريال
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function SalesInvoicesManagement() {
  const { t } = useTranslation()
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)

  const loadInvoices = async () => {
    setLoading(true)
    try {
      // Try enhanced service first
      const result = await getAllSalesInvoices()
      if (result.success && result.data) {
        setInvoices(result.data)
      } else {
        // Fallback to old service
        try {
          const newData = await newSalesInvoicesService.getAll()
          setInvoices(newData || [])
        } catch (newError) {
          console.warn('New system unavailable, fallback to old:', newError)
          try {
            const oldData = await salesOrdersService.getAll()
            setInvoices(oldData || [])
          } catch (oldError: any) {
            if (oldError.code === 'PGRST205') {
              // Table doesn't exist, use empty array
              console.warn('sales_invoices table not found, using empty array')
              setInvoices([])
            } else {
              console.error('Error loading sales invoices:', oldError)
              toast.error(`خطأ في تحميل فواتير المبيعات: ${oldError.message}`)
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error loading sales invoices:', error)
      toast.error(`خطأ في تحميل فواتير المبيعات: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInvoices()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('sales.invoices')}</h1>
          <p className="text-muted-foreground">فواتير المبيعات</p>
        </div>
        <Button onClick={() => setShowAddForm(true)}>
          + إضافة فاتورة مبيعات
        </Button>
      </div>

      <SalesInvoiceForm
        open={showAddForm}
        onOpenChange={setShowAddForm}
        onSuccess={() => {
          loadInvoices()
        }}
      />

      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">قائمة فواتير المبيعات ({invoices.length})</h3>
          {invoices.length === 0 && <Badge variant="outline">لا توجد بيانات</Badge>}
        </div>
        <div className="divide-y">
          {invoices.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>لا توجد فواتير مبيعات مسجلة</p>
              <p className="text-sm mt-2">البيانات موجودة في قاعدة البيانات</p>
            </div>
          ) : (
            invoices.map((invoice) => (
              <div key={invoice.id} className="p-4 hover:bg-accent/50 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-medium text-lg">{invoice.invoice_number}</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {invoice.customer?.name || 'عميل غير محدد'}
                    </p>
                    <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                      <span>📅 {new Date(invoice.invoice_date).toLocaleDateString('ar-SA')}</span>
                      {invoice.due_date && (
                        <span>⏰ الاستحقاق: {new Date(invoice.due_date).toLocaleDateString('ar-SA')}</span>
                      )}
                    </div>
                    {invoice.sales_invoice_lines && invoice.sales_invoice_lines.length > 0 && (
                      <div className="mt-3 text-sm">
                        <p className="font-medium text-muted-foreground mb-1">المنتجات ({invoice.sales_invoice_lines.length}):</p>
                        <div className="flex flex-wrap gap-2">
                          {invoice.sales_invoice_lines.slice(0, 3).map((line: any) => (
                            <Badge key={line.id} variant="outline" className="text-xs">
                              {line.product?.product_name || line.product?.name} ({line.quantity} {line.unit})
                            </Badge>
                          ))}
                          {invoice.sales_invoice_lines.length > 3 && (
                            <Badge variant="outline" className="text-xs">+{invoice.sales_invoice_lines.length - 3} المزيد</Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-4">
                    <div className="flex gap-2 mb-2">
                      {getStatusBadge(invoice.status)}
                      {invoice.delivery_status && (
                        <Badge variant={invoice.delivery_status === 'fully_delivered' ? 'secondary' : 'outline'}>
                          {getDeliveryStatusText(invoice.delivery_status)}
                        </Badge>
                      )}
                      {invoice.payment_status && (
                        <Badge variant={invoice.payment_status === 'paid' ? 'secondary' : 'outline'}>
                          {getPaymentStatusText(invoice.payment_status)}
                        </Badge>
                      )}
                    </div>
                    <div className="font-bold text-lg mt-2 text-primary">
                      {(invoice.total_amount || 0).toFixed(2)} ريال
                    </div>
                    {invoice.tax_amount > 0 && (
                      <div className="text-xs text-muted-foreground">
                        شامل ضريبة: {invoice.tax_amount.toFixed(2)} ريال
                      </div>
                    )}
                    {invoice.paid_amount > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        مدفوع: {invoice.paid_amount.toFixed(2)} ريال
                        {invoice.total_amount > invoice.paid_amount && (
                          <span className="text-red-600">
                            {' '}(متبقي: {((invoice.total_amount || 0) - (invoice.paid_amount || 0)).toFixed(2)})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export function SalesModule() {
  return (
    <Routes>
      <Route path="/" element={<SalesOverview />} />
      <Route path="/overview" element={<SalesOverview />} />
      <Route path="/customers" element={<CustomersManagement />} />
      <Route path="/orders" element={<SalesOrdersManagement />} />
      <Route path="/invoices" element={<SalesInvoicesManagement />} />
      <Route path="/delivery" element={<DeliveryManagement />} />
      <Route path="/collections" element={<CustomerReceipts />} />
      <Route path="/receipts" element={<CustomerReceipts />} />
      <Route path="*" element={<Navigate to="/sales/overview" replace />} />
    </Routes>
  )
}

function DeliveryManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [deliveries, setDeliveries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showDeliveryForm, setShowDeliveryForm] = useState(false)

  useEffect(() => {
    // Simulate loading delivery data
    const loadDeliveries = async () => {
      try {
        // This would be replaced with actual delivery service call
        const mockDeliveries = [
          {
            id: 1,
            delivery_number: 'DEL-001',
            customer_name: 'شركة الوردة',
            status: 'pending',
            delivery_date: new Date().toISOString(),
            items_count: 5,
            driver: 'أحمد محمد',
            vehicle: 'تويوتا هايلوكس - أ ب ج 1234'
          },
          {
            id: 2,
            delivery_number: 'DEL-002',
            customer_name: 'مؤسسة التقنية',
            status: 'delivered',
            delivery_date: new Date().toISOString(),
            items_count: 3,
            driver: 'سالم العتيبي',
            vehicle: 'نيسان نافارا - د هـ و 5678'
          }
        ]
        setDeliveries(mockDeliveries)
      } catch (error: any) {
        console.error('Error loading deliveries:', error)
        toast.error(`خطأ في تحميل بيانات التسليم: ${error.message}`)
      } finally {
        setLoading(false)
      }
    }
    loadDeliveries()
  }, [])

  const filteredDeliveries = deliveries.filter(delivery => 
    delivery.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    delivery.delivery_number.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline">في الانتظار</Badge>
      case 'in_transit':
        return <Badge variant="default">في الطريق</Badge>
      case 'delivered':
        return <Badge variant="secondary">تم التسليم</Badge>
      case 'failed':
        return <Badge variant="destructive">فشل التسليم</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold">{t('sales.delivery')}</h1>
          <p className="text-muted-foreground">مذكرات التسليم</p>
        </div>
        <Button onClick={() => setShowDeliveryForm(true)}>
          + إضافة مذكرة تسليم
        </Button>
      </div>
      
      <DeliveryNoteForm 
        open={showDeliveryForm}
        onOpenChange={setShowDeliveryForm}
        onSuccess={async () => {
          toast.success('تم إنشاء مذكرة التسليم بنجاح')
          // Reload deliveries if needed
        }}
      />
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold hidden">{t('sales.delivery')}</h1>
          <p className="text-muted-foreground">إدارة التسليم والتوزيع</p>
        </div>
        <Button>
          {t('common.add')}
        </Button>
      </div>

      {/* Search */}
      <div className="max-w-md">
        <Input
          placeholder="البحث في عمليات التسليم..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Delivery Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-amber-600">
            {deliveries.filter(d => d.status === 'pending').length}
          </div>
          <div className="text-sm text-muted-foreground">في الانتظار</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">
            {deliveries.filter(d => d.status === 'in_transit').length}
          </div>
          <div className="text-sm text-muted-foreground">في الطريق</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">
            {deliveries.filter(d => d.status === 'delivered').length}
          </div>
          <div className="text-sm text-muted-foreground">تم التسليم</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-red-600">
            {deliveries.filter(d => d.status === 'failed').length}
          </div>
          <div className="text-sm text-muted-foreground">فشل التسليم</div>
        </div>
      </div>

      {/* Deliveries List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة عمليات التسليم ({filteredDeliveries.length})</h3>
        </div>
        <div className="divide-y">
          {filteredDeliveries.map((delivery) => (
            <div key={delivery.id} className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-medium">{delivery.delivery_number}</h4>
                    {getStatusBadge(delivery.status)}
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">
                    العميل: {delivery.customer_name}
                  </p>
                  <p className="text-sm text-muted-foreground mb-1">
                    السائق: {delivery.driver}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    المركبة: {delivery.vehicle}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-medium mb-1">{delivery.items_count} عنصر</div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(delivery.delivery_date).toLocaleDateString('ar-SA')}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CollectionsManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [collections, setCollections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    // Simulate loading collections data
    const loadCollections = async () => {
      try {
        // This would be replaced with actual collections service call
        const mockCollections = [
          {
            id: 1,
            collection_number: 'COL-001',
            customer_name: 'شركة الوردة',
            invoice_number: 'INV-001',
            amount_due: 15000,
            amount_paid: 10000,
            balance: 5000,
            due_date: new Date().toISOString(),
            status: 'partial',
            payment_method: 'bank_transfer'
          },
          {
            id: 2,
            collection_number: 'COL-002',
            customer_name: 'مؤسسة التقنية',
            invoice_number: 'INV-002',
            amount_due: 8500,
            amount_paid: 8500,
            balance: 0,
            due_date: new Date().toISOString(),
            status: 'paid',
            payment_method: 'cash'
          }
        ]
        setCollections(mockCollections)
      } catch (error: any) {
        console.error('Error loading collections:', error)
        toast.error(`خطأ في تحميل بيانات التحصيل: ${error.message}`)
      } finally {
        setLoading(false)
      }
    }
    loadCollections()
  }, [])

  const filteredCollections = collections.filter(collection => 
    collection.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    collection.collection_number.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline">معلق</Badge>
      case 'partial':
        return <Badge variant="default">دفع جزئي</Badge>
      case 'paid':
        return <Badge variant="secondary">مدفوع</Badge>
      case 'overdue':
        return <Badge variant="destructive">متأخر</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const totalAmountDue = collections.reduce((sum, col) => sum + col.amount_due, 0)
  const totalBalance = collections.reduce((sum, col) => sum + col.balance, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold">{t('sales.collections')}</h1>
          <p className="text-muted-foreground">إدارة التحصيل والمدفوعات</p>
        </div>
        <Button>
          {t('common.add')}
        </Button>
      </div>

      {/* Collection Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{totalAmountDue.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">إجمالي المستحق (ريال)</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-red-600">{totalBalance.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">الرصيد المعلق (ريال)</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">
            {collections.filter(c => c.status === 'paid').length}
          </div>
          <div className="text-sm text-muted-foreground">فواتير مدفوعة</div>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-md">
        <Input
          placeholder="البحث في عمليات التحصيل..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Collections List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة عمليات التحصيل ({filteredCollections.length})</h3>
        </div>
        <div className="divide-y">
          {filteredCollections.map((collection) => (
            <div key={collection.id} className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-medium">{collection.collection_number}</h4>
                    {getStatusBadge(collection.status)}
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">
                    العميل: {collection.customer_name}
                  </p>
                  <p className="text-sm text-muted-foreground mb-1">
                    رقم الفاتورة: {collection.invoice_number}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    تاريخ الاستحقاق: {new Date(collection.due_date).toLocaleDateString('ar-SA')}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-medium mb-1">{collection.amount_due.toFixed(2)} ريال</div>
                  <div className="text-sm text-muted-foreground mb-1">
                    مدفوع: {collection.amount_paid.toFixed(2)} ريال
                  </div>
                  <div className={cn(
                    "text-sm font-medium",
                    collection.balance > 0 ? "text-red-600" : "text-green-600"
                  )}>
                    الرصيد: {collection.balance.toFixed(2)} ريال
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}