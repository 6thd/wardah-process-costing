import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
  suppliersService, 
  purchaseOrdersService,
  newPurchaseOrdersService
} from '@/services/supabase-service'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Supplier, PurchaseOrder } from '@/lib/supabase'
import { PurchaseOrderForm } from '@/components/forms/PurchaseOrderForm'
import { GoodsReceiptForm } from '@/components/forms/GoodsReceiptForm'
import { SupplierInvoiceForm } from '@/components/forms/SupplierInvoiceForm'
import { SupplierPayments } from './components/SupplierPayments'

export function PurchasingModule() {
  return (
    <Routes>
      <Route index element={<PurchasingOverview />} />
      <Route path="overview" element={<PurchasingOverview />} />
      <Route path="suppliers" element={<SuppliersManagement />} />
      <Route path="orders" element={<PurchaseOrdersManagement />} />
      <Route path="receipts" element={<GoodsReceiptManagement />} />
      <Route path="invoices" element={<SupplierInvoicesManagement />} />
      <Route path="payments" element={<SupplierPayments />} />
      <Route path="*" element={<Navigate to="overview" replace />} />
    </Routes>
  )
}

function PurchasingOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])

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
        <Link to="suppliers" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('purchasing.suppliers')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إدارة الموردين
          </p>
        </Link>

        <Link to="orders" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('purchasing.purchaseOrders')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            أوامر الشراء
          </p>
        </Link>

        <Link to="receipts" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('purchasing.receipts')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            استلام البضائع
          </p>
        </Link>
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
  const [newSupplier, setNewSupplier] = useState<Omit<Supplier, 'id'>>({
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
              <label htmlFor="supplier-name" className="block text-sm font-medium mb-2">اسم المورد</label>
              <Input
                id="supplier-name"
                value={newSupplier.name}
                onChange={(e) => setNewSupplier({...newSupplier, name: e.target.value})}
                placeholder="اسم المورد"
              />
            </div>
            <div>
              <label htmlFor="supplier-name-ar" className="block text-sm font-medium mb-2">الاسم بالعربية</label>
              <Input
                id="supplier-name-ar"
                value={newSupplier.name_ar}
                onChange={(e) => setNewSupplier({...newSupplier, name_ar: e.target.value})}
                placeholder="الاسم بالعربية"
              />
            </div>
            <div>
              <label htmlFor="supplier-code" className="block text-sm font-medium mb-2">كود المورد</label>
              <Input
                id="supplier-code"
                value={newSupplier.code}
                onChange={(e) => setNewSupplier({...newSupplier, code: e.target.value})}
                placeholder="كود المورد"
              />
            </div>
            <div>
              <label htmlFor="supplier-contact-person" className="block text-sm font-medium mb-2">شخص الاتصال</label>
              <Input
                id="supplier-contact-person"
                value={newSupplier.contact_person}
                onChange={(e) => setNewSupplier({...newSupplier, contact_person: e.target.value})}
                placeholder="شخص الاتصال"
              />
            </div>
            <div>
              <label htmlFor="supplier-phone" className="block text-sm font-medium mb-2">رقم الهاتف</label>
              <Input
                id="supplier-phone"
                value={newSupplier.phone}
                onChange={(e) => setNewSupplier({...newSupplier, phone: e.target.value})}
                placeholder="رقم الهاتف"
              />
            </div>
            <div>
              <label htmlFor="supplier-email" className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
              <Input
                id="supplier-email"
                type="email"
                value={newSupplier.email}
                onChange={(e) => setNewSupplier({...newSupplier, email: e.target.value})}
                placeholder="البريد الإلكتروني"
              />
            </div>
            <div>
              <label htmlFor="supplier-address" className="block text-sm font-medium mb-2">العنوان</label>
              <Input
                id="supplier-address"
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
  const [showAddForm, setShowAddForm] = useState(false)
  const [showGRForm, setShowGRForm] = useState(false)

  const loadOrders = async () => {
    setLoading(true)
    try {
      // Try new system first
      try {
        const newData = await newPurchaseOrdersService.getAll()
        console.log('✅ Loaded from NEW system:', newData)
        setOrders(newData || [])
      } catch (newError) {
        console.warn('New system unavailable, fallback to old:', newError)
        const oldData = await purchaseOrdersService.getAll()
        setOrders(oldData || [])
      }
    } catch (error) {
      console.error('Error loading purchase orders:', error)
      toast.error('خطأ في تحميل أوامر الشراء')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [])

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      'DRAFT': { label: 'مسودة', variant: 'outline' },
      'CONFIRMED': { label: 'مؤكد', variant: 'default' },
      'APPROVED': { label: 'معتمد', variant: 'default' },
      'RECEIVED': { label: 'مستلم', variant: 'secondary' },
      'CANCELLED': { label: 'ملغى', variant: 'destructive' },
      'draft': { label: 'مسودة', variant: 'outline' },
      'confirmed': { label: 'مؤكد', variant: 'default' },
      'received': { label: 'مستلم', variant: 'secondary' },
      'cancelled': { label: 'ملغى', variant: 'destructive' }
    }
    const config = statusMap[status] || { label: status, variant: 'outline' as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
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
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('purchasing.purchaseOrders')}</h1>
          <p className="text-muted-foreground">أوامر الشراء</p>
        </div>
        <Button onClick={() => setShowAddForm(true)}>
          + إضافة أمر شراء
        </Button>
      </div>

      <PurchaseOrderForm
        open={showAddForm}
        onOpenChange={setShowAddForm}
        onSuccess={() => {
          loadOrders()
        }}
      />

      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">قائمة أوامر الشراء ({orders.length})</h3>
          {orders.length === 0 && <Badge variant="outline">لا توجد بيانات</Badge>}
        </div>
        <div className="divide-y">
          {orders.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>لا توجد أوامر شراء مسجلة</p>
              <p className="text-sm mt-2">البيانات موجودة في قاعدة البيانات</p>
            </div>
          ) : (
            orders.map((order) => (
              <div key={order.id} className="p-4 hover:bg-accent/50 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-medium text-lg">{order.order_number}</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {order.vendor?.name || order.supplier?.name || 'مورد غير محدد'}
                    </p>
                    <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                      <span>📅 {new Date(order.order_date).toLocaleDateString('ar-SA')}</span>
                      {(order.expected_delivery || order.delivery_date) && (
                        <span>🚚 التسليم: {new Date(order.expected_delivery || order.delivery_date).toLocaleDateString('ar-SA')}</span>
                      )}
                    </div>
                    {order.purchase_order_lines && order.purchase_order_lines.length > 0 && (
                      <div className="mt-3 text-sm">
                        <p className="font-medium text-muted-foreground mb-1">المنتجات ({order.purchase_order_lines.length}):</p>
                        <div className="flex flex-wrap gap-2">
                          {order.purchase_order_lines.slice(0, 3).map((line: any) => (
                            <Badge key={line.id} variant="outline" className="text-xs">
                              {line.product?.product_name || line.product?.name} ({line.quantity} {line.unit})
                            </Badge>
                          ))}
                          {order.purchase_order_lines.length > 3 && (
                            <Badge variant="outline" className="text-xs">+{order.purchase_order_lines.length - 3} المزيد</Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-4">
                    {getStatusBadge(order.status)}
                    <div className="font-bold text-lg mt-2 text-primary">
                      {(order.total_amount || 0).toFixed(2)} ريال
                    </div>
                    {order.vat_amount > 0 && (
                      <div className="text-xs text-muted-foreground">
                        شامل ضريبة: {order.vat_amount.toFixed(2)} ريال
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

// Goods Receipt Management Component
function GoodsReceiptManagement() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [showGRForm, setShowGRForm] = useState(false)

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div className={cn(isRTL ? "text-right" : "text-left")}>
          <h1 className="text-3xl font-bold">استلام البضائع</h1>
          <p className="text-muted-foreground mt-2">
            إدارة عمليات استلام البضائع من الموردين
          </p>
        </div>
        <Button onClick={() => setShowGRForm(true)}>
          + إضافة استلام
        </Button>
      </div>
      
      <GoodsReceiptForm 
        open={showGRForm}
        onOpenChange={setShowGRForm}
        onSuccess={async () => {
          toast.success('تم إنشاء إشعار الاستلام بنجاح')
          // Reload goods receipts if needed
        }}
      />
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
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [showInvoiceForm, setShowInvoiceForm] = useState(false)
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadInvoices()
  }, [])

  const loadInvoices = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('supplier_invoices')
        .select(`
          *,
          vendor:vendors(code, name),
          purchase_order:purchase_orders(order_number)
        `)
        .order('invoice_date', { ascending: false })

      if (error) throw error
      setInvoices(data || [])
    } catch (error) {
      console.error('Error loading supplier invoices:', error)
      toast.error('خطأ في تحميل فواتير المشتريات')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      'pending': { label: 'قيد الانتظار', variant: 'outline' },
      'paid': { label: 'مدفوعة', variant: 'secondary' },
      'partial': { label: 'دفعة جزئية', variant: 'default' },
      'overdue': { label: 'متأخرة', variant: 'destructive' }
    }
    const config = statusMap[status] || { label: status, variant: 'outline' }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div className={cn(isRTL ? "text-right" : "text-left")}>
          <h1 className="text-3xl font-bold">فواتير المشتريات</h1>
          <p className="text-muted-foreground mt-2">
            إدارة فواتير الموردين وقيود اليومية
          </p>
        </div>
        <Button onClick={() => setShowInvoiceForm(true)}>
          + إضافة فاتورة مشتريات
        </Button>
      </div>

      <SupplierInvoiceForm
        open={showInvoiceForm}
        onOpenChange={setShowInvoiceForm}
        onSuccess={loadInvoices}
      />

      {/* Invoices List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">فواتير المشتريات ({invoices.length})</h3>
        </div>
        <div className="divide-y">
          {invoices.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              لا توجد فواتير مشتريات. اضغط على "+ إضافة فاتورة مشتريات" لإضافة فاتورة جديدة.
            </div>
          ) : (
            invoices.map((invoice) => (
              <div key={invoice.id} className="p-4 hover:bg-accent/50 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-medium text-lg">{invoice.invoice_number}</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {invoice.vendor?.name || 'مورد غير محدد'}
                    </p>
                    <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                      <span>📅 {new Date(invoice.invoice_date).toLocaleDateString('ar-SA')}</span>
                      {invoice.due_date && (
                        <span>⏰ الاستحقاق: {new Date(invoice.due_date).toLocaleDateString('ar-SA')}</span>
                      )}
                      {invoice.purchase_order && (
                        <span>📦 أمر الشراء: {invoice.purchase_order.order_number}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    {getStatusBadge(invoice.status)}
                    <div className="font-bold text-lg mt-2 text-primary">
                      {invoice.total_amount.toFixed(2)} ريال
                    </div>
                    {invoice.tax_amount > 0 && (
                      <div className="text-xs text-muted-foreground">
                        شامل ضريبة: {invoice.tax_amount.toFixed(2)} ريال
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

// Payments Management Component
function PaymentsManagement() {
  const { i18n } = useTranslation()
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
