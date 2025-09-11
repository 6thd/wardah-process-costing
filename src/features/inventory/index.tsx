import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { itemsService, categoriesService, stockMovementsService } from '@/services/supabase-service'
import { toast } from 'sonner'
import type { Item, Category } from '@/lib/supabase'

export function InventoryModule() {
  return (
    <Routes>
      <Route path="/" element={<InventoryOverview />} />
      <Route path="/items" element={<ItemsManagement />} />
      <Route path="/movements" element={<StockMovements />} />
      <Route path="*" element={<Navigate to="/inventory/items" replace />} />
    </Routes>
  )
}

function InventoryOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [items, setItems] = useState<Item[]>([])
  const [setLoading] = useState(true)

  useEffect(() => {
    const loadItems = async () => {
      try {
        const data = await itemsService.getAll()
        setItems(data || [])
      } catch (error) {
        console.error('Error loading items:', error)
        toast.error('خطأ في تحميل الأصناف')
      } finally {
        setLoading(false)
      }
    }
    loadItems()
  }, [])

  const totalValue = items.reduce((sum, item) => sum + (item.stock_quantity * item.cost_price), 0)
  const lowStockItems = items.filter(item => item.stock_quantity <= item.minimum_stock)

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('inventory.title')}</h1>
        <p className="text-muted-foreground mt-2">
          إدارة المخزون والأصناف
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{items.length}</div>
          <div className="text-sm text-muted-foreground">إجمالي الأصناف</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{totalValue.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">قيمة المخزون (ريال)</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-amber-600">{lowStockItems.length}</div>
          <div className="text-sm text-muted-foreground">أصناف قليلة المخزون</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-purple-600">
            {items.reduce((sum, item) => sum + item.stock_quantity, 0)}
          </div>
          <div className="text-sm text-muted-foreground">إجمالي الكمية</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/inventory/items" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('inventory.items')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إدارة الأصناف والمواد
          </p>
        </Link>

        <Link to="/inventory/movements" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('inventory.stockMoves')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            متابعة حركات المخزون
          </p>
        </Link>

        <div className="bg-card rounded-lg border p-6">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('inventory.adjustments')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            تسويات المخزون
          </p>
        </div>
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-2">
            تنبيه: أصناف قليلة المخزون ({lowStockItems.length})
          </h3>
          <div className="space-y-2">
            {lowStockItems.slice(0, 5).map((item) => (
              <div key={item.id} className="flex justify-between items-center">
                <span className="text-sm">{item.name}</span>
                <Badge variant="destructive">
                  {item.stock_quantity} / {item.minimum_stock}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ItemsManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [items, setItems] = useState<Item[]>([])
  const [categories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newItem, setNewItem] = useState({
    name: '',
    name_ar: '',
    code: '',
    category_id: '',
    unit: '',
    cost_price: 0,
    selling_price: 0,
    stock_quantity: 0,
    minimum_stock: 0,
    description: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const itemsData = await itemsService.getAll()
      setItems(itemsData || [])
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('خطأ في تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.code.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleAddItem = async () => {
    try {
      await itemsService.create(newItem)
      toast.success('تم إضافة الصنف بنجاح')
      setShowAddForm(false)
      setNewItem({
        name: '',
        name_ar: '',
        code: '',
        category_id: '',
        unit: '',
        cost_price: 0,
        selling_price: 0,
        stock_quantity: 0,
        minimum_stock: 0,
        description: ''
      })
      loadData()
    } catch (error) {
      console.error('Error adding item:', error)
      toast.error('خطأ في إضافة الصنف')
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
          <h1 className="text-2xl font-bold">{t('inventory.items')}</h1>
          <p className="text-muted-foreground">إدارة أصناف المخزون</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? t('common.cancel') : t('common.add')}
        </Button>
      </div>

      {/* Search */}
      <div className="max-w-md">
        <Input
          placeholder="البحث في الأصناف..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Add Item Form */}
      {showAddForm && (
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">إضافة صنف جديد</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">اسم الصنف</label>
              <Input
                value={newItem.name}
                onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                placeholder="اسم الصنف"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">الاسم بالعربية</label>
              <Input
                value={newItem.name_ar}
                onChange={(e) => setNewItem({...newItem, name_ar: e.target.value})}
                placeholder="الاسم بالعربية"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">كود الصنف</label>
              <Input
                value={newItem.code}
                onChange={(e) => setNewItem({...newItem, code: e.target.value})}
                placeholder="كود الصنف"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">وحدة القياس</label>
              <Input
                value={newItem.unit}
                onChange={(e) => setNewItem({...newItem, unit: e.target.value})}
                placeholder="قطعة، كيلو، متر..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">تكلفة الشراء</label>
              <Input
                type="number"
                step="0.01"
                value={newItem.cost_price}
                onChange={(e) => setNewItem({...newItem, cost_price: parseFloat(e.target.value) || 0})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">سعر البيع</label>
              <Input
                type="number"
                step="0.01"
                value={newItem.selling_price}
                onChange={(e) => setNewItem({...newItem, selling_price: parseFloat(e.target.value) || 0})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">الكمية الحالية</label>
              <Input
                type="number"
                value={newItem.stock_quantity}
                onChange={(e) => setNewItem({...newItem, stock_quantity: parseInt(e.target.value) || 0})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">الحد الأدنى</label>
              <Input
                type="number"
                value={newItem.minimum_stock}
                onChange={(e) => setNewItem({...newItem, minimum_stock: parseInt(e.target.value) || 0})}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleAddItem} disabled={!newItem.name || !newItem.code}>
              {t('common.add')}
            </Button>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Items List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة الأصناف ({filteredItems.length})</h3>
        </div>
        <div className="divide-y">
          {filteredItems.map((item) => (
            <div key={item.id} className="p-4 flex justify-between items-center">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <div>
                    <h4 className="font-medium">{item.name}</h4>
                    <p className="text-sm text-muted-foreground">{item.code}</p>
                  </div>
                  <div className="flex gap-1">
                    {item.category && <Badge variant="secondary">{item.category.name}</Badge>}
                    {item.stock_quantity <= item.minimum_stock && <Badge variant="destructive">مخزون قليل</Badge>}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{item.stock_quantity} {item.unit}</div>
                <div className="text-sm text-muted-foreground">{item.cost_price.toFixed(2)} ريال</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StockMovements() {
  const { t } = useTranslation()
  const [movements, setMovements] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadMovements = async () => {
      try {
        const data = await stockMovementsService.getAll()
        setMovements(data || [])
      } catch (error) {
        console.error('Error loading stock movements:', error)
        toast.error('خطأ في تحميل حركات المخزون')
      } finally {
        setLoading(false)
      }
    }
    loadMovements()
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
      <div>
        <h1 className="text-2xl font-bold">{t('inventory.stockMoves')}</h1>
        <p className="text-muted-foreground">متابعة حركات المخزون</p>
      </div>

      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">حركات المخزون ({movements.length})</h3>
        </div>
        <div className="divide-y">
          {movements.map((movement) => (
            <div key={movement.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-medium">{movement.item?.name}</h4>
                  <p className="text-sm text-muted-foreground">{movement.item?.code}</p>
                  {movement.notes && (
                    <p className="text-sm text-muted-foreground mt-1">{movement.notes}</p>
                  )}
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={movement.movement_type === 'in' ? 'default' : 
                              movement.movement_type === 'out' ? 'destructive' : 'secondary'}
                    >
                      {movement.movement_type === 'in' ? 'وارد' : 
                       movement.movement_type === 'out' ? 'صادر' : 'تسوية'}
                    </Badge>
                    <span className={cn(
                      "font-medium",
                      movement.movement_type === 'in' ? 'text-green-600' : 
                      movement.movement_type === 'out' ? 'text-red-600' : 'text-blue-600'
                    )}>
                      {movement.movement_type === 'out' ? '-' : '+'}{movement.quantity}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(movement.created_at).toLocaleDateString('ar-SA')}
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