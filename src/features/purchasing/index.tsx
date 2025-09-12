import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { suppliersService, purchaseOrdersService } from '@/services/supabase-service'
import { toast } from 'sonner'
import type { Supplier } from '@/lib/supabase'

export function PurchasingModule() {
  return (
    <Routes>
      <Route path="/" element={<PurchasingOverview />} />
      <Route path="/overview" element={<PurchasingOverview />} />
      <Route path="/suppliers" element={<SuppliersManagement />} />
      <Route path="/orders" element={<PurchaseOrdersManagement />} />
      <Route path="/receipts" element={<GoodsReceiptManagement />} />
      <Route path="/invoices" element={<SupplierInvoicesManagement />} />
      <Route path="/payments" element={<PaymentsManagement />} />
      <Route path="*" element={<Navigate to="/purchasing/overview" replace />} />
    </Routes>
  )
}

function PurchasingOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [suppliersData, ordersData] = await Promise.all([
          suppliersService.getAll(),
          purchaseOrdersService.getAll()
        ])
        setSuppliers(suppliersData || [])
        setOrders(ordersData || [])
      } catch (error) {
        console.error('Error loading purchasing data:', error)
        toast.error('خطأ في تحميل بيانات المشتريات')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const totalOrderValue = orders.reduce((sum, order) => sum + order.total_amount, 0)
  const pendingOrders = orders.filter(order => order.status === 'draft' || order.status === 'confirmed')

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('purchasing.title')}</h1>
        <p className="text-muted-foreground mt-2">
          إدارة المشتريات والموردين
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{suppliers.length}</div>
          <div className="text-sm text-muted-foreground">إجمالي الموردين</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{totalOrderValue.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">قيمة الطلبات (ريال)</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-amber-600">{pendingOrders.length}</div>
          <div className="text-sm text-muted-foreground">طلبات معلقة</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-purple-600">{orders.length}</div>
          <div className="text-sm text-muted-foreground">إجمالي الطلبات</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/purchasing/suppliers" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('purchasing.suppliers')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إدارة الموردين
          </p>
        </Link>

        <Link to="/purchasing/orders" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('purchasing.purchaseOrders')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            أوامر الشراء
          </p>
        </Link>

        <div className="bg-card rounded-lg border p-6">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('purchasing.receipts')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            استلام البضائع
          </p>
        </div>
      </div>
    </div>
  )
}

function SuppliersManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSupplier, setNewSupplier] = useState({
    name: '',
    name_ar: '',
    code: '',
    contact_person: '',
    phone: '',
    email: '',
    address: ''
  })

  useEffect(() => {
    loadSuppliers()
  }, [])

  const loadSuppliers = async () => {
    try {
      const data = await suppliersService.getAll()
      setSuppliers(data || [])
    } catch (error) {
      console.error('Error loading suppliers:', error)
      toast.error('خطأ في تحميل الموردين')
    } finally {
      setLoading(false)
    }
  }

  const filteredSuppliers = suppliers.filter(supplier => 
    supplier.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleAddSupplier = async () => {
    try {
      await suppliersService.create(newSupplier)
      toast.success('تم إضافة المورد بنجاح')
      setShowAddForm(false)
      setNewSupplier({
        name: '',
        name_ar: '',
        code: '',
        contact_person: '',
        phone: '',
        email: '',
        address: ''
      })
      loadSuppliers()
    } catch (error) {
      console.error('Error adding supplier:', error)
      toast.error('خطأ في إضافة المورد')
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
          <h1 className="text-2xl font-bold">{t('purchasing.suppliers')}</h1>
          <p className="text-muted-foreground">إدارة الموردين</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? t('common.cancel') : t('common.add')}
        </Button>
      </div>

      {/* Search */}
      <div className="max-w-md">
        <Input
          placeholder="البحث في الموردين..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Add Supplier Form */}
      {showAddForm && (
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">إضافة مورد جديد</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">اسم المورد</label>
              <Input
                value={newSupplier.name}
                onChange={(e) => setNewSupplier({...newSupplier, name: e.target.value})}
                placeholder="اسم المورد"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">الاسم بالعربية</label>
              <Input
                value={newSupplier.name_ar}
                onChange={(e) => setNewSupplier({...newSupplier, name_ar: e.target.value})}
                placeholder="الاسم بالعربية"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">كود المورد</label>
              <Input
                value={newSupplier.code}
                onChange={(e) => setNewSupplier({...newSupplier, code: e.target.value})}
                placeholder="كود المورد"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">شخص الاتصال</label>
              <Input
                value={newSupplier.contact_person}
                onChange={(e) => setNewSupplier({...newSupplier, contact_person: e.target.value})}
                placeholder="شخص الاتصال"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">رقم الهاتف</label>
              <Input
                value={newSupplier.phone}
                onChange={(e) => setNewSupplier({...newSupplier, phone: e.target.value})}
                placeholder="رقم الهاتف"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
              <Input
                type="email"
                value={newSupplier.email}
                onChange={(e) => setNewSupplier({...newSupplier, email: e.target.value})}
                placeholder="البريد الإلكتروني"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">العنوان</label>
              <Input
                value={newSupplier.address}
                onChange={(e) => setNewSupplier({...newSupplier, address: e.target.value})}
                placeholder="العنوان"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleAddSupplier} disabled={!newSupplier.name}>
              {t('common.add')}
            </Button>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Suppliers List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة الموردين ({filteredSuppliers.length})</h3>
        </div>
        <div className="divide-y">
          {filteredSuppliers.map((supplier) => (
            <div key={supplier.id} className="p-4 flex justify-between items-center">
              <div className="flex-1">
                <h4 className="font-medium">{supplier.name}</h4>
                <p className="text-sm text-muted-foreground">{supplier.contact_person}</p>
                <p className="text-sm text-muted-foreground">{supplier.phone} | {supplier.email}</p>
              </div>
              <div className="text-right">
                <div className="font-medium">{supplier.code}</div>
                <div className="text-sm text-muted-foreground">{supplier.address}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PurchaseOrdersManagement() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadOrders = async () => {
      try {
        const data = await purchaseOrdersService.getAll()
        setOrders(data || [])
      } catch (error) {
        console.error('Error loading purchase orders:', error)
        toast.error('خطأ في تحميل أوامر الشراء')
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
      case 'confirmed':
        return <Badge variant="default">مؤكد</Badge>
      case 'received':
        return <Badge variant="secondary">مستلم</Badge>
      case 'cancelled':
        return <Badge variant="destructive">ملغى</Badge>
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
        <h1 className="text-2xl font-bold">{t('purchasing.purchaseOrders')}</h1>
        <p className="text-muted-foreground">أوامر الشراء</p>
      </div>

      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة أوامر الشراء ({orders.length})</h3>
        </div>
        <div className="divide-y">
          {orders.map((order) => (
            <div key={order.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-medium">{order.order_number}</h4>
                  <p className="text-sm text-muted-foreground">{order.supplier?.name}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    تاريخ الطلب: {new Date(order.order_date).toLocaleDateString('ar-SA')}
                  </p>
                </div>
                <div className="text-right">
                  {getStatusBadge(order.status)}
                  <div className="font-medium mt-1">{order.total_amount.toFixed(2)} ريال</div>
                  {order.delivery_date && (
                    <div className="text-sm text-muted-foreground">
                      تاريخ التسليم: {new Date(order.delivery_date).toLocaleDateString('ar-SA')}
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

// Goods Receipt Management Component
function GoodsReceiptManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">استلام البضائع</h1>
        <p className="text-muted-foreground mt-2">
          إدارة عمليات استلام البضائع من الموردين
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - عمليات استلام وفحص البضائع
        </p>
      </div>
    </div>
  )
}

// Supplier Invoices Management Component
function SupplierInvoicesManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">فواتير الموردين</h1>
        <p className="text-muted-foreground mt-2">
          إدارة فواتير ومطالبات الموردين
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - فواتير ومطالبات الموردين
        </p>
      </div>
    </div>
  )
}

// Payments Management Component
function PaymentsManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">إدارة المدفوعات</h1>
        <p className="text-muted-foreground mt-2">
          متابعة وإدارة مدفوعات الموردين
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - متابعة وإدارة المدفوعات
        </p>
      </div>
    </div>
  )
}