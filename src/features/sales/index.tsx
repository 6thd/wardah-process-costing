import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { customersService, salesOrdersService } from '@/services/supabase-service'
import { toast } from 'sonner'
import type { Customer } from '@/lib/supabase'

export function SalesModule() {
  return (
    <Routes>
      <Route path="/" element={<SalesOverview />} />
      <Route path="/customers" element={<CustomersManagement />} />
      <Route path="/orders" element={<SalesOrdersManagement />} />
      <Route path="*" element={<Navigate to="/sales" replace />} />
    </Routes>
  )
}

function SalesOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [customers, setCustomers] = useState<Customer[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [customersData, ordersData] = await Promise.all([
          customersService.getAll(),
          salesOrdersService.getAll()
        ])
        setCustomers(customersData || [])
        setOrders(ordersData || [])
      } catch (error) {
        console.error('Error loading sales data:', error)
        toast.error('خطأ في تحميل بيانات المبيعات')
      } finally {
        setLoading(false)
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
    } catch (error) {
      console.error('Error loading customers:', error)
      toast.error('خطأ في تحميل العملاء')
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
    } catch (error) {
      console.error('Error adding customer:', error)
      toast.error('خطأ في إضافة العميل')
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
              <label className="block text-sm font-medium mb-2">اسم العميل</label>
              <Input
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({...newCustomer, name: e.target.value})}
                placeholder="اسم العميل"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">الاسم بالعربية</label>
              <Input
                value={newCustomer.name_ar}
                onChange={(e) => setNewCustomer({...newCustomer, name_ar: e.target.value})}
                placeholder="الاسم بالعربية"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">كود العميل</label>
              <Input
                value={newCustomer.code}
                onChange={(e) => setNewCustomer({...newCustomer, code: e.target.value})}
                placeholder="كود العميل"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">شخص الاتصال</label>
              <Input
                value={newCustomer.contact_person}
                onChange={(e) => setNewCustomer({...newCustomer, contact_person: e.target.value})}
                placeholder="شخص الاتصال"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">رقم الهاتف</label>
              <Input
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({...newCustomer, phone: e.target.value})}
                placeholder="رقم الهاتف"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
              <Input
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({...newCustomer, email: e.target.value})}
                placeholder="البريد الإلكتروني"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">العنوان</label>
              <Input
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

  useEffect(() => {
    const loadOrders = async () => {
      try {
        const data = await salesOrdersService.getAll()
        setOrders(data || [])
      } catch (error) {
        console.error('Error loading sales orders:', error)
        toast.error('خطأ في تحميل فواتير المبيعات')
      } finally {
        setLoading(false)
      }
    }
    loadOrders()
  }, [])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline">مسودة</Badge>
      case 'sent':
        return <Badge variant="default">مرسلة</Badge>
      case 'paid':
        return <Badge variant="secondary">مدفوعة</Badge>
      case 'overdue':
        return <Badge variant="destructive">متأخرة</Badge>
      case 'cancelled':
        return <Badge variant="destructive">ملغاة</Badge>
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
      <div>
        <h1 className="text-2xl font-bold">{t('sales.invoices')}</h1>
        <p className="text-muted-foreground">فواتير المبيعات</p>
      </div>

      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة فواتير المبيعات ({orders.length})</h3>
        </div>
        <div className="divide-y">
          {orders.map((order) => (
            <div key={order.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-medium">{order.invoice_number}</h4>
                  <p className="text-sm text-muted-foreground">{order.customer?.name}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    تاريخ الفاتورة: {new Date(order.invoice_date).toLocaleDateString('ar-SA')}
                  </p>
                </div>
                <div className="text-right">
                  {getStatusBadge(order.status)}
                  <div className="font-medium mt-1">{order.total_amount.toFixed(2)} ريال</div>
                  {order.due_date && (
                    <div className="text-sm text-muted-foreground">
                      تاريخ الاستحقاق: {new Date(order.due_date).toLocaleDateString('ar-SA')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}