import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Plus, X, Trash2, PackageOpen, ClipboardList } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { itemsService, categoriesService, stockMovementsService } from '@/services/supabase-service'
import { getSupabase, type Item, type Category } from '@/lib/supabase'
import { toast } from 'sonner'
import { 
  ADJUSTMENT_TYPES, 
  calculateAdjustmentTotals, 
  createAdjustmentItem, 
  updateAdjustmentItemQuantity,
  validateAdjustmentForm,
  type AdjustmentItem,
  type AdjustmentFormState
} from './helpers'

export function InventoryModule() {
  return (
    <Routes>
      <Route index element={<InventoryOverview />} />
      <Route path="overview" element={<InventoryOverview />} />
      <Route path="items" element={<ItemsManagement />} />
      <Route path="categories" element={<CategoriesManagement />} />
      <Route path="movements" element={<StockMovements />} />
      <Route path="adjustments" element={<StockAdjustments />} />
      <Route path="valuation" element={<InventoryValuation />} />
      <Route path="locations" element={<StorageLocationsPage />} />
      <Route path="warehouses" element={<WarehousesPage />} />
      <Route path="bins" element={<StorageBinsPage />} />
      <Route path="transfers" element={<StockTransfersPage />} />
      <Route path="*" element={<Navigate to="overview" replace />} />
    </Routes>
  )
}

function InventoryOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    const loadItems = async () => {
      try {
        const data = await itemsService.getAll()
        setItems(data || [])
      } catch (error) {
        console.error('Error loading items:', error)
        toast.error('خطأ في تحميل الأصناف')
      } finally {
      }
    }
    loadItems()
  }, [])

  const totalValue = items.reduce((sum, item) => sum + (item.stock_quantity * item.cost_price), 0)
  const lowStockItems = items.filter(item => item.stock_quantity <= item.minimum_stock)

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('inventory.title')}
        description="إدارة المخزون والأصناف"
        hideOnPrint={false}
      />

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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link to="/inventory/items" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('inventory.items')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إدارة الأصناف والمواد
          </p>
        </Link>

        <Link to="/inventory/categories" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            فئات المنتجات
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            تصنيف المخزون
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

        <Link to="/inventory/warehouses" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            🏭 المخازن (1)
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            المخازن الرئيسية
          </p>
        </Link>

        <Link to="/inventory/locations" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            📍 مواقع التخزين (2)
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            المناطق والأرفف
          </p>
        </Link>

        <Link to="/inventory/bins" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            📦 صناديق التخزين (3)
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            المواقع الدقيقة + باركود
          </p>
        </Link>

        <Link to="/inventory/transfers" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            🔄 تحويلات البضاعة
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            نقل المخزون بين المستودعات
          </p>
        </Link>

        <Link to="/inventory/adjustments" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn("font-semibold mb-2", isRTL ? "text-right" : "text-left")}>
            {t('inventory.adjustments')}
          </h3>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            تسويات المخزون
          </p>
        </Link>
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
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'code' | 'stock' | 'price'>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [newItem, setNewItem] = useState<Omit<Item, 'id' | 'category'> & { name_ar: string; selling_price: number; valuation_method?: string; default_warehouse_id?: string }>({
    name: '',
    name_ar: '',
    code: '',
    category_id: '',
    unit: '',
    cost_price: 0,
    selling_price: 0,
    stock_quantity: 0,
    minimum_stock: 0,
    description: '',
    price: 0,
    valuation_method: 'Weighted Average', // Default valuation method
    default_warehouse_id: '', // Default warehouse
  })

  // Warehouses for item form
  const [itemWarehouses, setItemWarehouses] = useState<any[]>([])
  const [loadingItemWarehouses, setLoadingItemWarehouses] = useState(true)

  useEffect(() => {
    loadData()
    loadItemWarehouses()
  }, [])

  const loadData = async () => {
    try {
      const [itemsData, categoriesData] = await Promise.all([
        itemsService.getAll(),
        categoriesService.getAll(),
      ]);
      setItems((itemsData || []) as Item[])
      setCategories((categoriesData || []) as unknown as Category[])
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('خطأ في تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  const loadItemWarehouses = async () => {
    try {
      setLoadingItemWarehouses(true)
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      
      setItemWarehouses(data || [])
      
      // Auto-select first warehouse for new items
      if (data && data.length > 0 && !newItem.default_warehouse_id) {
        setNewItem(prev => ({
          ...prev,
          default_warehouse_id: data[0].id
        }))
      }
    } catch (error) {
      console.error('Error loading warehouses:', error)
    } finally {
      setLoadingItemWarehouses(false)
    }
  }

  // Advanced filtering
  const filteredItems = items
    .filter(item => {
      // Search filter
      const matchesSearch = 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.code && item.code.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.description && item.description.toLowerCase().includes(searchTerm.toLowerCase()))
      
      // Category filter
      const matchesCategory = selectedCategory === 'all' || item.category_id === selectedCategory
      
      // Stock filter
      let matchesStock = true
      if (stockFilter === 'low') {
        matchesStock = item.stock_quantity <= item.minimum_stock && item.stock_quantity > 0
      } else if (stockFilter === 'out') {
        matchesStock = item.stock_quantity === 0
      }
      
      return matchesSearch && matchesCategory && matchesStock
    })
    .sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'code':
          comparison = (a.code || '').localeCompare(b.code || '')
          break
        case 'stock':
          comparison = a.stock_quantity - b.stock_quantity
          break
        case 'price':
          comparison = a.cost_price - b.cost_price
          break
      }
      
      return sortOrder === 'asc' ? comparison : -comparison
    })

  // Statistics
  const stats = {
    total: items.length,
    lowStock: items.filter(item => item.stock_quantity <= item.minimum_stock && item.stock_quantity > 0).length,
    outOfStock: items.filter(item => item.stock_quantity === 0).length,
    totalValue: items.reduce((sum, item) => sum + (item.stock_quantity * item.cost_price), 0)
  }

  const handleAddItem = async () => {
    try {
      // Validate warehouse selection
      if (!newItem.default_warehouse_id) {
        toast.error('الرجاء اختيار المخزن الافتراضي')
        return
      }

      // Clean up the data before sending
      const itemToAdd: any = {
        ...newItem,
        price: newItem.selling_price,
        category_id: newItem.category_id || null, // Convert empty string to null
      };
      await itemsService.create(itemToAdd)
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
        description: '',
        price: 0,
        valuation_method: 'Weighted Average',
        default_warehouse_id: itemWarehouses[0]?.id || '',
      })
      loadData()
    } catch (error) {
      console.error('Error adding item:', error)
      toast.error('خطأ في إضافة الصنف')
    }
  }

  if (loading) {
    return (
      <LoadingSpinner label={t('common.loading')} />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold">{t('inventory.items')}</h1>
          <p className="text-muted-foreground">إدارة أصناف المخزون ({items.length} صنف)</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? t('common.cancel') : '+ إضافة صنف جديد'}
        </Button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">إجمالي الأصناف</p>
              <h3 className="text-2xl font-bold mt-1">{stats.total}</h3>
            </div>
            <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">📦</span>
            </div>
          </div>
        </div>

        <div className="bg-card border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">مخزون منخفض</p>
              <h3 className="text-2xl font-bold mt-1 text-orange-600">{stats.lowStock}</h3>
            </div>
            <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">⚠️</span>
            </div>
          </div>
        </div>

        <div className="bg-card border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">نفذ من المخزون</p>
              <h3 className="text-2xl font-bold mt-1 text-red-600">{stats.outOfStock}</h3>
            </div>
            <div className="h-12 w-12 bg-red-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">❌</span>
            </div>
          </div>
        </div>

        <div className="bg-card border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">قيمة المخزون</p>
              <h3 className="text-2xl font-bold mt-1 text-green-600">
                {stats.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} ر.س
              </h3>
            </div>
            <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">💰</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="bg-card border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label htmlFor="search-term" className="block text-sm font-medium mb-2">🔍 البحث</label>
            <Input
              id="search-term"
              placeholder="ابحث بالاسم أو الكود..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Category Filter */}
          <div>
            <label htmlFor="category-filter" className="block text-sm font-medium mb-2">📁 الفئة</label>
            <select
              id="category-filter"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background"
            >
              <option value="all">جميع الفئات ({items.length})</option>
              {categories.map(cat => {
                const count = items.filter(item => item.category_id === cat.id).length
                return (
                  <option key={cat.id} value={cat.id}>
                    {cat.name_ar || cat.name} ({count})
                  </option>
                )
              })}
            </select>
          </div>

          {/* Stock Filter */}
          <div>
            <label htmlFor="stock-filter" className="block text-sm font-medium mb-2">📊 حالة المخزون</label>
            <select
              id="stock-filter"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background"
            >
              <option value="all">الكل ({items.length})</option>
              <option value="low">مخزون منخفض ({stats.lowStock})</option>
              <option value="out">نفذ من المخزون ({stats.outOfStock})</option>
            </select>
          </div>

          {/* Sort */}
          <div>
            <label htmlFor="sort-by" className="block text-sm font-medium mb-2">⬇️ الترتيب</label>
            <div className="flex gap-2">
              <select
                id="sort-by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="flex-1 h-10 px-3 rounded-md border border-input bg-background"
              >
                <option value="name">الاسم</option>
                <option value="code">الكود</option>
                <option value="stock">الكمية</option>
                <option value="price">السعر</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="px-3"
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Item Form */}
      {showAddForm && (
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">إضافة صنف جديد</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="item-name" className="block text-sm font-medium mb-2">اسم الصنف</label>
              <Input
                id="item-name"
                value={newItem.name}
                onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                placeholder="اسم الصنف"
              />
            </div>
            <div>
              <label htmlFor="item-name-ar" className="block text-sm font-medium mb-2">الاسم بالعربية</label>
              <Input
                id="item-name-ar"
                value={newItem.name_ar}
                onChange={(e) => setNewItem({...newItem, name_ar: e.target.value})}
                placeholder="الاسم بالعربية"
              />
            </div>
            <div>
              <label htmlFor="item-code" className="block text-sm font-medium mb-2">كود الصنف</label>
              <Input
                id="item-code"
                value={newItem.code}
                onChange={(e) => setNewItem({...newItem, code: e.target.value})}
                placeholder="كود الصنف"
              />
            </div>
            <div>
              <label htmlFor="item-category" className="block text-sm font-medium mb-2">الفئة</label>
              <select
                id="item-category"
                value={newItem.category_id}
                onChange={(e) => setNewItem({...newItem, category_id: e.target.value})}
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
              >
                <option value="">-- اختر الفئة --</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name_ar || cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="item-default-warehouse" className="block text-sm font-medium mb-2">المخزن الافتراضي *</label>
              <select
                id="item-default-warehouse"
                value={newItem.default_warehouse_id}
                onChange={(e) => setNewItem({...newItem, default_warehouse_id: e.target.value})}
                disabled={loadingItemWarehouses}
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
              >
                <option value="">-- اختر المخزن --</option>
                {itemWarehouses.map(wh => (
                  <option key={wh.id} value={wh.id}>
                    {wh.code} - {wh.name || wh.name_ar}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                💡 المخزن الذي سيتم تخزين المنتج فيه بشكل افتراضي
              </p>
            </div>
            <div>
              <label htmlFor="item-unit" className="block text-sm font-medium mb-2">وحدة القياس</label>
              <Input
                id="item-unit"
                value={newItem.unit}
                onChange={(e) => setNewItem({...newItem, unit: e.target.value})}
                placeholder="قطعة، كيلو، متر..."
              />
            </div>
            <div>
              <label htmlFor="item-cost-price" className="block text-sm font-medium mb-2">تكلفة الشراء</label>
              <Input
                id="item-cost-price"
                type="number"
                step="0.01"
                value={newItem.cost_price}
                onChange={(e) => setNewItem({...newItem, cost_price: Number.parseFloat(e.target.value) || 0})}
              />
            </div>
            <div>
              <label htmlFor="item-selling-price" className="block text-sm font-medium mb-2">سعر البيع</label>
              <Input
                id="item-selling-price"
                type="number"
                step="0.01"
                value={newItem.selling_price}
                onChange={(e) => setNewItem({...newItem, selling_price: Number.parseFloat(e.target.value) || 0})}
              />
            </div>
            <div>
              <label htmlFor="item-stock-quantity" className="block text-sm font-medium mb-2">الكمية الحالية</label>
              <Input
                id="item-stock-quantity"
                type="number"
                value={newItem.stock_quantity}
                onChange={(e) => setNewItem({...newItem, stock_quantity: Number.parseInt(e.target.value, 10) || 0})}
              />
            </div>
            <div>
              <label htmlFor="item-minimum-stock" className="block text-sm font-medium mb-2">الحد الأدنى</label>
              <Input
                id="item-minimum-stock"
                type="number"
                value={newItem.minimum_stock}
                onChange={(e) => setNewItem({...newItem, minimum_stock: Number.parseInt(e.target.value, 10) || 0})}
              />
            </div>
            <div>
              <label htmlFor="item-valuation-method" className="block text-sm font-medium mb-2">طريقة التقييم</label>
              <select
                id="item-valuation-method"
                value={newItem.valuation_method || 'Weighted Average'}
                onChange={(e) => setNewItem({...newItem, valuation_method: e.target.value})}
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
              >
                <option value="Weighted Average">المتوسط المرجح (Weighted Average)</option>
                <option value="FIFO">الوارد أولاً صادر أولاً (FIFO)</option>
                <option value="LIFO">الوارد أخيراً صادر أولاً (LIFO)</option>
                <option value="Moving Average">المتوسط المتحرك (Moving Average)</option>
              </select>
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
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">قائمة الأصناف ({filteredItems.length} من {items.length})</h3>
          <div className="flex gap-2">
            {filteredItems.length > 0 && (
              <>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const csv = [
                      ['الكود', 'الاسم', 'الفئة', 'الكمية', 'الوحدة', 'التكلفة', 'سعر البيع'],
                      ...filteredItems.map(item => [
                        item.code,
                        item.name,
                        categories.find(c => c.id === item.category_id)?.name || '',
                        item.stock_quantity,
                        item.unit,
                        item.cost_price,
                        item.price
                      ])
                    ].map(row => row.join(',')).join('\n')
                    
                    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
                    const link = document.createElement('a')
                    link.href = URL.createObjectURL(blob)
                    link.download = `items_${new Date().toISOString().split('T')[0]}.csv`
                    link.click()
                    toast.success('تم تصدير البيانات')
                  }}
                >
                  📥 تصدير Excel
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => globalThis.window.print()}
                >
                  🖨️ طباعة
                </Button>
              </>
            )}
          </div>
        </div>
        
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<PackageOpen aria-hidden="true" />}
            title="لا توجد أصناف"
            description={searchTerm || selectedCategory !== 'all' || stockFilter !== 'all'
              ? 'جرب تغيير الفلاتر للحصول على نتائج'
              : 'لم يتم إضافة أي أصناف بعد — ابدأ بزر «إضافة صنف»'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-right p-3 font-semibold">الكود</th>
                  <th className="text-right p-3 font-semibold">اسم الصنف</th>
                  <th className="text-right p-3 font-semibold">الفئة</th>
                  <th className="text-right p-3 font-semibold">طريقة التقييم</th>
                  <th className="text-center p-3 font-semibold">الكمية</th>
                  <th className="text-center p-3 font-semibold">الوحدة</th>
                  <th className="text-right p-3 font-semibold">التكلفة</th>
                  <th className="text-right p-3 font-semibold">سعر البيع</th>
                  <th className="text-center p-3 font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredItems.map((item) => {
                  const isLowStock = item.stock_quantity <= item.minimum_stock && item.stock_quantity > 0
                  const isOutOfStock = item.stock_quantity === 0
                  const category = categories.find(c => c.id === item.category_id)
                  
                  // Get Arabic name for valuation method
                  const valuationMethodMap: Record<string, string> = {
                    'Weighted Average': 'المتوسط المرجح',
                    'FIFO': 'الوارد أولاً صادر أولاً',
                    'LIFO': 'الوارد أخيراً صادر أولاً',
                    'Moving Average': 'المتوسط المتحرك'
                  }
                  const valuationMethodAr = valuationMethodMap[(item as any).valuation_method] || 'غير محدد'
                  
                  return (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
                          {item.code}
                        </span>
                      </td>
                      <td className="p-3">
                        <div>
                          <div className="font-medium">{item.name}</div>
                          {item.description && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {item.description}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        {category && (
                          <Badge variant="outline" className="text-xs">
                            {category.name_ar || category.name}
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge 
                          variant="secondary" 
                          className="text-xs whitespace-nowrap"
                        >
                          {valuationMethodAr}
                        </Badge>
                      </td>
                      <td className="p-3 text-center">
                        <span className={cn(
                          "font-semibold text-lg",
                          isOutOfStock ? "text-red-600" : isLowStock ? "text-orange-600" : "text-green-600"
                        )}>
                          {item.stock_quantity}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm text-muted-foreground">{item.unit}</span>
                      </td>
                      <td className="p-3">
                        <div className="text-sm">
                          {item.cost_price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ر.س
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="text-sm font-medium">
                          {item.price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ر.س
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex flex-col gap-1 items-center">
                          {isOutOfStock ? (
                            <Badge variant="destructive" className="text-xs">
                              ❌ نفذ
                            </Badge>
                          ) : isLowStock ? (
                            <Badge variant="outline" className="text-xs border-orange-500 text-orange-600">
                              ⚠️ منخفض
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs border-green-500 text-green-600">
                              ✅ متوفر
                            </Badge>
                          )}
                          {item.stock_quantity <= item.minimum_stock && (
                            <span className="text-xs text-muted-foreground">
                              الحد: {item.minimum_stock}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// Stock Adjustments Component
function StockAdjustments() {
  const { t } = useTranslation()
  const [adjustments, setAdjustments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [viewMode, setViewMode] = useState(false)
  const [selectedAdjustment, setSelectedAdjustment] = useState<any>(null)

  // New adjustment state
  const [newAdjustment, setNewAdjustment] = useState({
    adjustment_date: new Date().toISOString().split('T')[0],
    adjustment_type: 'PHYSICAL_COUNT',
    reason: '',
    reference_number: '',
    warehouse_id: '',
    increase_account_id: '',  // حساب الزيادة
    decrease_account_id: '',  // حساب النقص
    items: [] as any[]
  })

  // Warehouses state
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [loadingWarehouses, setLoadingWarehouses] = useState(true)
  
  // GL Accounts state
  const [glAccounts, setGLAccounts] = useState<any[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  // Item selection state
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [products, setProducts] = useState<any[]>([])
  const [showProductSearch, setShowProductSearch] = useState(false)
  const [showTypeDropdown, setShowTypeDropdown] = useState(false)

  useEffect(() => {
    loadAdjustments()
    loadProducts()
    loadWarehouses()
    loadGLAccounts()
  }, [])

  // Reload when filters change
  useEffect(() => {
    if (!loading) {
      loadAdjustments()
    }
  }, [filterStatus, filterType])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.product-search-container')) {
        setShowProductSearch(false)
      }
      if (!target.closest('.type-dropdown-container')) {
        setShowTypeDropdown(false)
      }
    }

    if (showProductSearch || showTypeDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showProductSearch, showTypeDropdown])

  const loadAdjustments = async () => {
    try {
      console.log('🔍 Loading adjustments...')
      const supabase = getSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        console.log('❌ No user found')
        setAdjustments([])
        setLoading(false)
        return
      }

      console.log('✅ User:', user.id)

      const { data: userOrgs, error: orgError } = await supabase
        .from('user_organizations')
        .select('org_id')
        .eq('user_id', user.id)
        .single()

      if (orgError || !userOrgs) {
        console.log('❌ No organization found:', orgError)
        setAdjustments([])
        setLoading(false)
        return
      }

      console.log('✅ Organization:', userOrgs.org_id)

      let query = supabase
        .from('stock_adjustments')
        .select('*')
        .eq('organization_id', userOrgs.org_id)
        .order('created_at', { ascending: false })

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus)
      }

      if (filterType !== 'all') {
        query = query.eq('adjustment_type', filterType)
      }

      const { data, error } = await query

      if (error) {
        console.error('❌ Error loading adjustments:', error)
        throw error
      }

      console.log('✅ Loaded adjustments:', data?.length || 0, data)
      setAdjustments(data || [])
    } catch (error) {
      console.error('❌ Error loading adjustments:', error)
      toast.error('خطأ في تحميل التسويات: ' + (error as any).message)
    } finally {
      setLoading(false)
    }
  }

  const loadProducts = async () => {
    try {
      const data = await itemsService.getAll()
      setProducts(data || [])
    } catch (error) {
      console.error('Error loading products:', error)
    }
  }

  const loadWarehouses = async () => {
    try {
      setLoadingWarehouses(true)
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      
      setWarehouses(data || [])
      
      // Auto-select first warehouse
      if (data && data.length > 0 && !newAdjustment.warehouse_id) {
        setNewAdjustment(prev => ({
          ...prev,
          warehouse_id: data[0].id
        }))
      }
    } catch (error) {
      console.error('Error loading warehouses:', error)
      toast.error('خطأ في تحميل المخازن')
    } finally {
      setLoadingWarehouses(false)
    }
  }

  const loadGLAccounts = async () => {
    try {
      setLoadingAccounts(true)
      const supabase = getSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setGLAccounts([])
        setLoadingAccounts(false)
        return
      }

      const { data: userOrgs } = await supabase
        .from('user_organizations')
        .select('org_id')
        .eq('user_id', user.id)
        .single()

      if (!userOrgs) {
        setGLAccounts([])
        setLoadingAccounts(false)
        return
      }

      // Load GL Accounts (expense and asset accounts)
      const { data, error } = await supabase
        .from('gl_accounts')
        .select('*')
        .eq('org_id', userOrgs.org_id)
        .in('category', ['ASSET', 'EXPENSE'])
        .eq('is_active', true)
        .order('code')

      if (error) throw error
      
      setGLAccounts(data || [])
    } catch (error) {
      console.error('Error loading GL accounts:', error)
      toast.error('خطأ في تحميل الحسابات')
    } finally {
      setLoadingAccounts(false)
    }
  }

  // Use imported ADJUSTMENT_TYPES from helpers

  const handleAddItem = () => {
    if (!newAdjustment.warehouse_id) {
      toast.error('الرجاء اختيار المخزن أولاً')
      return
    }

    if (!selectedProduct) {
      toast.error('الرجاء اختيار منتج')
      return
    }

    const existingItem = newAdjustment.items.find(
      (i: any) => i.product_id === selectedProduct.id
    )

    if (existingItem) {
      toast.error('المنتج موجود بالفعل في القائمة')
      return
    }

    // Use helper function to create adjustment item
    const newItem = createAdjustmentItem(selectedProduct, newAdjustment.warehouse_id)

    setNewAdjustment({
      ...newAdjustment,
      items: [...newAdjustment.items, newItem]
    })

    setSelectedProduct(null)
    setSearchTerm('')
    setShowProductSearch(false)
  }

  const handleItemChange = (itemId: string, field: string, value: any) => {
    const updatedItems = newAdjustment.items.map((item: any) => {
      if (item.id === itemId) {
        // Use helper function for quantity updates
        if (field === 'new_qty') {
          return updateAdjustmentItemQuantity(item, value)
        }
        // For other fields, just update directly
        return { ...item, [field]: value }
      }
      return item
    })

    setNewAdjustment({
      ...newAdjustment,
      items: updatedItems
    })
  }

  const handleRemoveItem = (itemId: string) => {
    setNewAdjustment({
      ...newAdjustment,
      items: newAdjustment.items.filter((i: any) => i.id !== itemId)
    })
  }

  // Use imported calculateAdjustmentTotals from helpers
  const calculateTotals = () => {
    return calculateAdjustmentTotals(newAdjustment.items as AdjustmentItem[])
  }

  const handleSaveAdjustment = async () => {
    // Use imported validation from helpers
    const validation = validateAdjustmentForm(newAdjustment as AdjustmentFormState)
    if (!validation.valid) {
      toast.error(validation.message)
      return
    }
    
    try {
      const supabase = getSupabase()
      
      // Get user and organization
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error('الرجاء تسجيل الدخول')
        return
      }

      const { data: userOrg } = await supabase
        .from('user_organizations')
        .select('org_id')
        .eq('user_id', user.id)
        .single()

      if (!userOrg) {
        toast.error('لم يتم العثور على المؤسسة')
        return
      }

      // Calculate totals using helper
      const totals = calculateAdjustmentTotals(newAdjustment.items as AdjustmentItem[])
      const { totalItems, totalQtyDiff, totalValueDiff } = totals

      // Check if editing existing adjustment
      const isEditing = selectedAdjustment?.isEditing

      let adjustment: any

      if (isEditing) {
        // Update existing adjustment
        const { data: updatedAdj, error: updateError } = await supabase
          .from('stock_adjustments')
          .update({
            adjustment_date: newAdjustment.adjustment_date,
            posting_date: newAdjustment.adjustment_date,
            adjustment_type: newAdjustment.adjustment_type,
            reason: newAdjustment.reason,
            reference_number: newAdjustment.reference_number || null,
            warehouse_id: newAdjustment.warehouse_id,
            increase_account_id: newAdjustment.increase_account_id,
            decrease_account_id: newAdjustment.decrease_account_id,
            total_items: totalItems,
            total_qty_difference: totalQtyDiff,
            total_value_difference: totalValueDiff,
            updated_at: new Date().toISOString()
          })
          .eq('id', selectedAdjustment.id)
          .select()
          .single()

        if (updateError) throw updateError
        adjustment = updatedAdj

        // Delete old items
        const { error: deleteError } = await supabase
          .from('stock_adjustment_items')
          .delete()
          .eq('adjustment_id', selectedAdjustment.id)

        if (deleteError) throw deleteError
      } else {
        // Save new adjustment header
        const { data: newAdj, error: adjError } = await supabase
          .from('stock_adjustments')
          .insert({
            organization_id: userOrg.org_id,
            adjustment_date: newAdjustment.adjustment_date,
            adjustment_number: `ADJ-${Date.now()}`,
            posting_date: newAdjustment.adjustment_date,
            adjustment_type: newAdjustment.adjustment_type,
            reason: newAdjustment.reason,
            reference_number: newAdjustment.reference_number || null,
            warehouse_id: newAdjustment.warehouse_id,
            increase_account_id: newAdjustment.increase_account_id,
            decrease_account_id: newAdjustment.decrease_account_id,
            status: 'DRAFT',
            total_items: totalItems,
            total_qty_difference: totalQtyDiff,
            total_value_difference: totalValueDiff,
            created_by: user.id
          })
          .select()
          .single()

        if (adjError) throw adjError
        adjustment = newAdj
      }

      // Save adjustment items
      const itemsToInsert = newAdjustment.items.map((item: any) => ({
        adjustment_id: adjustment.id,
        organization_id: userOrg.org_id,
        product_id: item.product_id,
        warehouse_id: item.warehouse_id || newAdjustment.warehouse_id, // Use item warehouse or adjustment warehouse
        current_qty: item.current_qty,
        new_qty: item.new_qty,
        difference_qty: item.difference_qty,
        current_rate: item.current_rate,
        value_difference: item.value_difference,
        reason: item.reason || null
      }))

      const { error: itemsError } = await supabase
        .from('stock_adjustment_items')
        .insert(itemsToInsert)

      if (itemsError) throw itemsError

      toast.success(isEditing ? 'تم تحديث التسوية بنجاح' : 'تم حفظ التسوية كمسودة بنجاح')
      setShowNewForm(false)
      setSelectedAdjustment(null)
      setNewAdjustment({
        adjustment_date: new Date().toISOString().split('T')[0],
        adjustment_type: 'PHYSICAL_COUNT',
        reason: '',
        reference_number: '',
        warehouse_id: warehouses[0]?.id || '',
        increase_account_id: '',
        decrease_account_id: '',
        items: []
      })
      
      // Reload adjustments
      loadAdjustments()
    } catch (error: any) {
      console.error('Error saving adjustment:', error)
      toast.error(error.message || 'خطأ في حفظ التسوية')
    }
  }

  const handleSubmitAdjustment = async (adjustmentId: string) => {
    try {
      const supabase = getSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        toast.error('الرجاء تسجيل الدخول')
        return
      }

      // Get user's organization
      const { data: userOrg } = await supabase
        .from('user_organizations')
        .select('org_id')
        .eq('user_id', user.id)
        .single()

      if (!userOrg) {
        toast.error('لم يتم العثور على المؤسسة')
        return
      }

      // Get adjustment with items
      const { data: adjustment, error: adjError } = await supabase
        .from('stock_adjustments')
        .select('*')
        .eq('id', adjustmentId)
        .single()

      if (adjError || !adjustment) {
        toast.error('لم يتم العثور على التسوية')
        return
      }

      if (adjustment.status !== 'DRAFT') {
        toast.error('يمكن فقط ترحيل التسويات بحالة مسودة')
        return
      }

      // Get adjustment items
      const { data: items, error: itemsError } = await supabase
        .from('stock_adjustment_items')
        .select('*')
        .eq('adjustment_id', adjustmentId)

      if (itemsError || !items || items.length === 0) {
        toast.error('لم يتم العثور على بنود التسوية')
        return
      }

      // Use the warehouse from the adjustment
      const warehouseId = adjustment.warehouse_id

      if (!warehouseId) {
        toast.error('لم يتم تحديد المخزن في التسوية')
        return
      }

      // Create stock ledger entries for each item
      const stockLedgerEntries = items.map((item: any) => ({
        org_id: userOrg.org_id,
        posting_date: adjustment.posting_date,
        posting_time: new Date().toTimeString().split(' ')[0],
        voucher_type: 'Stock Adjustment',
        voucher_id: adjustmentId,
        voucher_number: adjustment.adjustment_number || adjustment.reference_number || `ADJ-${adjustmentId.substring(0, 8)}`,
        product_id: item.product_id,
        warehouse_id: item.warehouse_id || warehouseId, // Use item's warehouse or adjustment's warehouse
        actual_qty: item.difference_qty,
        qty_after_transaction: item.new_qty,
        incoming_rate: item.difference_qty > 0 ? item.current_rate : 0,
        outgoing_rate: item.difference_qty < 0 ? item.current_rate : 0,
        valuation_rate: item.current_rate,
        stock_value: item.new_qty * item.current_rate,
        stock_value_difference: item.value_difference,
        is_cancelled: false,
        created_by: user.id
      }))

      const { error: ledgerError } = await supabase
        .from('stock_ledger_entries')
        .insert(stockLedgerEntries)

      if (ledgerError) {
        console.error('Error creating stock ledger entries:', ledgerError)
        throw new Error('فشل في إنشاء قيود المخزون: ' + ledgerError.message)
      }

      // Create Journal Entries for accounting integration
      try {
        // Calculate totals for increases and decreases
        const totalIncrease = items
          .filter((item: any) => item.difference_qty > 0)
          .reduce((sum: number, item: any) => sum + item.value_difference, 0)
        
        const totalDecrease = items
          .filter((item: any) => item.difference_qty < 0)
          .reduce((sum: number, item: any) => sum + Math.abs(item.value_difference), 0)

        const journalEntries = []

        // Entry for increases (Dr: Inventory Asset, Cr: Adjustment Account)
        if (totalIncrease > 0 && adjustment.increase_account_id) {
          const { data: warehouseData } = await supabase
            .from('warehouses')
            .select('inventory_account_id')
            .eq('id', adjustment.warehouse_id)
            .single()

          if (warehouseData?.inventory_account_id) {
            journalEntries.push({
              account_id: warehouseData.inventory_account_id,
              debit: totalIncrease,
              credit: 0,
              description: `زيادة مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}`
            })
            journalEntries.push({
              account_id: adjustment.increase_account_id,
              debit: 0,
              credit: totalIncrease,
              description: `زيادة مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}`
            })
          }
        }

        // Entry for decreases (Dr: Expense Account, Cr: Inventory Asset)
        if (totalDecrease > 0 && adjustment.decrease_account_id) {
          const { data: warehouseData } = await supabase
            .from('warehouses')
            .select('inventory_account_id')
            .eq('id', adjustment.warehouse_id)
            .single()

          if (warehouseData?.inventory_account_id) {
            journalEntries.push({
              account_id: adjustment.decrease_account_id,
              debit: totalDecrease,
              credit: 0,
              description: `نقص مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}`
            })
            journalEntries.push({
              account_id: warehouseData.inventory_account_id,
              debit: 0,
              credit: totalDecrease,
              description: `نقص مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}`
            })
          }
        }

        // Insert journal entries if any
        if (journalEntries.length > 0) {
          // Create GL Entry header (using gl_entries table)
          const { data: glEntry, error: glError } = await supabase
            .from('gl_entries')
            .insert({
              org_id: userOrg.org_id,
              entry_date: adjustment.posting_date,
              entry_type: 'STOCK_ADJUSTMENT',
              entry_number: adjustment.adjustment_number || `ADJ-${adjustmentId.substring(0, 8)}`,
              reference_number: adjustment.reference_number || null,
              reference_type: 'stock_adjustments',
              reference_id: adjustmentId,
              description: `تسوية مخزون - ${adjustment.reason}`,
              status: 'posted',
              created_by: user.id
            })
            .select('id')
            .single()

          if (glError) {
            console.error('Error creating GL entry:', glError)
            throw new Error('فشل في إنشاء القيد المحاسبي: ' + glError.message)
          }

          if (glEntry) {
            // Add entry_id to all line items
            const lineItems = journalEntries.map((entry: any, idx: number) => ({
              org_id: userOrg.org_id,
              entry_id: glEntry.id,
              line_number: idx + 1,
              account_id: entry.account_id,
              debit: entry.debit || 0,
              credit: entry.credit || 0,
              description: entry.description || ''
            }))

            const { error: linesError } = await supabase
              .from('journal_lines')
              .insert(lineItems)

            if (linesError) {
              console.error('Error creating journal lines:', linesError)
              throw new Error('فشل في إنشاء بنود القيد: ' + linesError.message)
            } else {
              console.log('✅ Journal entries created successfully:', {
                entry_id: glEntry.id,
                lines_count: lineItems.length,
                total_debit: lineItems.reduce((sum: number, l: any) => sum + l.debit, 0),
                total_credit: lineItems.reduce((sum: number, l: any) => sum + l.credit, 0)
              })
            }
          }
        } else {
          console.warn('⚠️ No journal entries to create')
        }
      } catch (jeError: any) {
        console.error('Error creating journal entries:', jeError)
        // Don't fail the whole operation if journal entry creation fails
        toast.warning('تم ترحيل التسوية لكن فشل إنشاء القيود المحاسبية: ' + jeError.message)
      }
      
      // Update adjustment status to SUBMITTED
      const { error: updateError } = await supabase
        .from('stock_adjustments')
        .update({
          status: 'SUBMITTED',
          submitted_at: new Date().toISOString(),
          submitted_by: user.id
        })
        .eq('id', adjustmentId)

      if (updateError) throw updateError

      toast.success('✅ تم ترحيل التسوية بنجاح وتحديث قيود المخزون')
      
      // Close view mode and reload
      setViewMode(false)
      setSelectedAdjustment(null)
      loadAdjustments()

    } catch (error: any) {
      console.error('Error submitting adjustment:', error)
      toast.error(error.message || 'خطأ في ترحيل التسوية')
    }
  }

  const filteredProducts = products.filter(
    (p: any) =>
      p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.code?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const { totalValueDiff, increaseCount, decreaseCount } = calculateTotals()

  if (loading) {
    return (
      <LoadingSpinner label="جاري التحميل..." />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="تسويات المخزون"
        description="تعديل وتصحيح أرصدة المخزون حسب المعايير المحاسبية"
        hideOnPrint={false}
        actions={
          <Button onClick={() => setShowNewForm(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            تسوية جديدة
          </Button>
        }
      />

      {/* New Adjustment Form */}
      {showNewForm && (
        <Card className="p-6" style={{ overflow: 'visible' }}>
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">تسوية مخزون جديدة</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNewForm(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Header Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
              <div>
                <label htmlFor="adjustment-date" className="block text-sm font-medium mb-1">
                  التاريخ *
                </label>
                <input
                  id="adjustment-date"
                  type="date"
                  value={newAdjustment.adjustment_date}
                  onChange={(e) =>
                    setNewAdjustment({
                      ...newAdjustment,
                      adjustment_date: e.target.value
                    })
                  }
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              <div>
                <label htmlFor="adjustment-warehouse" className="block text-sm font-medium mb-1">
                  المخزن *
                </label>
                <select
                  id="adjustment-warehouse"
                  value={newAdjustment.warehouse_id}
                  onChange={(e) => {
                    const newWarehouseId = e.target.value
                    setNewAdjustment({
                      ...newAdjustment,
                      warehouse_id: newWarehouseId,
                      // Update all existing items with new warehouse
                      items: newAdjustment.items.map((item: any) => ({
                        ...item,
                        warehouse_id: newWarehouseId
                      }))
                    })
                  }}
                  disabled={loadingWarehouses}
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-800"
                >
                  <option value="">اختر المخزن</option>
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.code} - {wh.name || wh.name_ar}
                    </option>
                  ))}
                </select>
                {!newAdjustment.warehouse_id && (
                  <p className="text-xs text-red-600 mt-1">
                    ⚠️ يجب اختيار المخزن
                  </p>
                )}
              </div>

              <div className="relative">
                <label htmlFor="adjustment-type" className="block text-sm font-medium mb-1">
                  نوع التسوية *
                </label>
                <div className="type-dropdown-container">
                  <button
                    type="button"
                    onClick={() => setShowTypeDropdown(!showTypeDropdown)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-right bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-between relative z-10"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-xl">{ADJUSTMENT_TYPES[newAdjustment.adjustment_type as keyof typeof ADJUSTMENT_TYPES]?.icon}</span>
                      <span>{ADJUSTMENT_TYPES[newAdjustment.adjustment_type as keyof typeof ADJUSTMENT_TYPES]?.label}</span>
                    </span>
                    <svg 
                      className={cn("w-4 h-4 transition-transform", showTypeDropdown && "rotate-180")} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showTypeDropdown && (
                    <div 
                      className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-950 border-2 border-gray-400 dark:border-gray-400 rounded-lg shadow-2xl max-h-80 overflow-y-auto z-[9999]"
                      style={{ 
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                      }}
                    >
                      {Object.entries(ADJUSTMENT_TYPES).map(([key, value]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setNewAdjustment({
                              ...newAdjustment,
                              adjustment_type: key
                            })
                            setShowTypeDropdown(false)
                          }}
                          className={cn(
                            "w-full px-4 py-3 text-right hover:bg-gray-100 dark:hover:bg-gray-800 border-b border-gray-200 dark:border-gray-700 last:border-b-0 transition-colors flex items-center gap-3 bg-white dark:bg-gray-950",
                            newAdjustment.adjustment_type === key && "bg-blue-50 dark:bg-blue-950 border-l-4 border-l-blue-500"
                          )}
                        >
                          <span className="text-2xl">{value.icon}</span>
                          <span className="font-medium text-gray-900 dark:text-white">{value.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="adjustment-reference" className="block text-sm font-medium mb-1">
                  رقم المرجع
                </label>
                <input
                  id="adjustment-reference"
                  type="text"
                  value={newAdjustment.reference_number}
                  onChange={(e) =>
                    setNewAdjustment({
                      ...newAdjustment,
                      reference_number: e.target.value
                    })
                  }
                  placeholder="اختياري"
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            {/* GL Accounts Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-5 border-t pt-4">
              <div>
                <label htmlFor="adjustment-increase-account" className="block text-sm font-medium mb-1">
                  حساب الزيادة في المخزون *
                </label>
                <select
                  id="adjustment-increase-account"
                  value={newAdjustment.increase_account_id}
                  onChange={(e) =>
                    setNewAdjustment({
                      ...newAdjustment,
                      increase_account_id: e.target.value
                    })
                  }
                  disabled={loadingAccounts}
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-800"
                >
                  <option value="">اختر الحساب</option>
                  {glAccounts
                    .filter(acc => acc.category === 'ASSET')
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} - {account.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  💡 الحساب الذي سيُضاف إليه عند زيادة المخزون (حساب أصول)
                </p>
              </div>

              <div>
                <label htmlFor="adjustment-decrease-account" className="block text-sm font-medium mb-1">
                  حساب النقص في المخزون *
                </label>
                <select
                  id="adjustment-decrease-account"
                  value={newAdjustment.decrease_account_id}
                  onChange={(e) =>
                    setNewAdjustment({
                      ...newAdjustment,
                      decrease_account_id: e.target.value
                    })
                  }
                  disabled={loadingAccounts}
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-800"
                >
                  <option value="">اختر الحساب</option>
                  {glAccounts
                    .filter(acc => acc.category === 'EXPENSE')
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} - {account.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  💡 الحساب الذي سيُخصم منه عند نقص المخزون (حساب مصروف)
                </p>
              </div>
            </div>

            <div className="relative z-5">
              <label htmlFor="adjustment-reason" className="block text-sm font-medium mb-1">
                السبب *
              </label>
              <textarea
                id="adjustment-reason"
                value={newAdjustment.reason}
                onChange={(e) =>
                  setNewAdjustment({
                    ...newAdjustment,
                    reason: e.target.value
                  })
                }
                placeholder="اذكر سبب التسوية بالتفصيل..."
                rows={2}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            {/* Product Selection */}
            <div className="relative z-20">
              <label htmlFor="adjustment-add-item" className="block text-sm font-medium mb-2">
                إضافة منتج
              </label>
              
              {!newAdjustment.warehouse_id && (
                <div className="mb-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
                  <p className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <span>⚠️</span>
                    <span>يجب اختيار المخزن أولاً قبل إضافة المنتجات</span>
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <div className="flex-1 relative product-search-container">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value)
                      setShowProductSearch(true)
                    }}
                    onFocus={() => setShowProductSearch(true)}
                    placeholder="ابحث عن منتج..."
                    disabled={!newAdjustment.warehouse_id}
                    className="w-full px-3 py-2 border rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  
                  {showProductSearch && searchTerm && (
                    <div 
                      className="absolute z-[9999] w-full mt-1 bg-white dark:bg-gray-950 border-2 border-gray-400 dark:border-gray-400 rounded-lg shadow-2xl max-h-60 overflow-y-auto"
                      style={{ 
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                      }}
                    >
                      {filteredProducts.length > 0 ? (
                        filteredProducts.map((product) => (
                          <button
                            key={product.id}
                            onClick={() => {
                              setSelectedProduct(product)
                              setSearchTerm(product.name)
                              setShowProductSearch(false)
                            }}
                            className="w-full px-4 py-3 text-right hover:bg-gray-100 dark:hover:bg-gray-800 border-b border-gray-200 dark:border-gray-700 last:border-b-0 transition-colors bg-white dark:bg-gray-950"
                          >
                            <div className="font-medium text-gray-900 dark:text-white">{product.name}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {product.code} - الرصيد: {product.stock_quantity}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-4 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-950">
                          لا توجد نتائج
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <Button 
                  onClick={handleAddItem}
                  disabled={!newAdjustment.warehouse_id || !selectedProduct}
                >
                  إضافة
                </Button>
              </div>
            </div>

            {/* Items Table */}
            {newAdjustment.items.length > 0 && (
              <div className="border rounded-lg overflow-hidden relative z-0">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-right text-xs font-medium">
                        المنتج
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium">
                        الرصيد الحالي
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium">
                        الكمية الجديدة
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium">
                        الفرق
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium">
                        السعر
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium">
                        فرق القيمة
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium">
                        ملاحظات
                      </th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {newAdjustment.items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium">{item.product?.name}</div>
                          <div className="text-xs text-gray-500">
                            {item.product?.code}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-mono">
                          {item.current_qty}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={item.new_qty}
                            onChange={(e) =>
                              handleItemChange(
                                item.id,
                                'new_qty',
                                Number.parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-20 px-2 py-1 border rounded text-center"
                            step="0.01"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'font-bold',
                              item.difference_qty > 0
                                ? 'text-green-600'
                                : item.difference_qty < 0
                                ? 'text-red-600'
                                : 'text-gray-600'
                            )}
                          >
                            {item.difference_qty > 0 ? '+' : ''}
                            {(item.difference_qty || 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {(item.current_rate || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'font-bold',
                              item.value_difference > 0
                                ? 'text-green-600'
                                : item.value_difference < 0
                                ? 'text-red-600'
                                : 'text-gray-600'
                            )}
                          >
                            {(item.value_difference || 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={item.reason || ''}
                            onChange={(e) =>
                              handleItemChange(item.id, 'reason', e.target.value)
                            }
                            placeholder="اختياري"
                            className="w-full px-2 py-1 border rounded text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveItem(item.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Summary */}
                <div className="bg-gray-50 p-4 border-t">
                  <div className="flex justify-between items-center">
                    <div className="flex gap-4 text-sm">
                      <span>
                        عدد المنتجات: <strong>{newAdjustment.items.length}</strong>
                      </span>
                      <span className="text-green-600">
                        زيادة: <strong>{increaseCount}</strong>
                      </span>
                      <span className="text-red-600">
                        نقص: <strong>{decreaseCount}</strong>
                      </span>
                    </div>
                    <div className="text-lg font-bold">
                      إجمالي فرق القيمة:{' '}
                      <span
                        className={cn(
                          totalValueDiff > 0
                            ? 'text-green-600'
                            : totalValueDiff < 0
                            ? 'text-red-600'
                            : 'text-gray-600'
                        )}
                      >
                        {totalValueDiff.toFixed(2)} ر.س
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowNewForm(false)
                  setSelectedAdjustment(null)
                  setNewAdjustment({
                    adjustment_date: new Date().toISOString().split('T')[0],
                    adjustment_type: 'PHYSICAL_COUNT',
                    reason: '',
                    reference_number: '',
                    warehouse_id: warehouses[0]?.id || '',
                    increase_account_id: '',
                    decrease_account_id: '',
                    items: []
                  })
                }}
              >
                إلغاء
              </Button>
              <Button
                onClick={handleSaveAdjustment}
                disabled={newAdjustment.items.length === 0}
              >
                {selectedAdjustment?.isEditing ? '💾 تحديث التسوية' : 'حفظ كمسودة'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* View Mode - Display Adjustment Details */}
      {viewMode && selectedAdjustment && (
        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-bold flex items-center gap-2">
                <span>
                  {ADJUSTMENT_TYPES[selectedAdjustment.adjustment_type as keyof typeof ADJUSTMENT_TYPES]?.icon}
                </span>
                {' '}
                تفاصيل التسوية
              </h3>
              <Button variant="outline" onClick={() => {
                setViewMode(false)
                setSelectedAdjustment(null)
              }}>
                ✕ إغلاق
              </Button>
            </div>

            {/* Adjustment Header Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div>
                <span className="text-sm text-muted-foreground">رقم التسوية:</span>
                <p className="font-medium">{selectedAdjustment.adjustment_number}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">التاريخ:</span>
                <p className="font-medium">
                  {new Date(selectedAdjustment.adjustment_date).toLocaleDateString('en-US')}
                </p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">النوع:</span>
                <p className="font-medium">
                  {ADJUSTMENT_TYPES[selectedAdjustment.adjustment_type as keyof typeof ADJUSTMENT_TYPES]?.label}
                </p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">الحالة:</span>
                <Badge
                  variant={
                    selectedAdjustment.status === 'SUBMITTED'
                      ? 'default'
                      : selectedAdjustment.status === 'DRAFT'
                      ? 'secondary'
                      : 'destructive'
                  }
                >
                  {selectedAdjustment.status === 'SUBMITTED'
                    ? 'مرحل'
                    : selectedAdjustment.status === 'DRAFT'
                    ? 'مسودة'
                    : 'ملغي'}
                </Badge>
              </div>
              <div className="col-span-2">
                <span className="text-sm text-muted-foreground">السبب:</span>
                <p className="font-medium">{selectedAdjustment.reason}</p>
              </div>
              {selectedAdjustment.reference_number && (
                <div className="col-span-2">
                  <span className="text-sm text-muted-foreground">رقم المرجع:</span>
                  <p className="font-medium">{selectedAdjustment.reference_number}</p>
                </div>
              )}
            </div>

            {/* Summary Statistics */}
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <p className="text-sm text-muted-foreground">إجمالي المنتجات</p>
                <p className="text-2xl font-bold">{selectedAdjustment.total_items || 0}</p>
              </div>
              <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
                <p className="text-sm text-muted-foreground">فرق الكمية</p>
                <p className="text-2xl font-bold">{selectedAdjustment.total_qty_difference || 0}</p>
              </div>
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                <p className="text-sm text-muted-foreground">فرق القيمة</p>
                <p className="text-2xl font-bold">
                  {(selectedAdjustment.total_value_difference || 0).toFixed(2)} ر.س
                </p>
              </div>
              <div className="p-4 bg-amber-50 dark:bg-amber-950 rounded-lg">
                <p className="text-sm text-muted-foreground">يتطلب موافقة</p>
                <p className="text-2xl font-bold">{selectedAdjustment.requires_approval ? 'نعم' : 'لا'}</p>
              </div>
            </div>

            {/* Action Buttons */}
            {selectedAdjustment.status === 'DRAFT' && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={async () => {
                  try {
                    // Load adjustment items
                    const supabase = getSupabase()
                    const { data: items, error } = await supabase
                      .from('stock_adjustment_items')
                      .select('*, products(*)')
                      .eq('adjustment_id', selectedAdjustment.id)
                    
                    if (error) throw error

                    // Set form data for editing
                    setNewAdjustment({
                      adjustment_date: selectedAdjustment.adjustment_date,
                      adjustment_type: selectedAdjustment.adjustment_type,
                      reason: selectedAdjustment.reason || '',
                      reference_number: selectedAdjustment.reference_number,
                      warehouse_id: selectedAdjustment.warehouse_id,
                      increase_account_id: selectedAdjustment.increase_account_id || '',
                      decrease_account_id: selectedAdjustment.decrease_account_id || '',
                      items: items?.map(item => ({
                        id: item.id,
                        product_id: item.product_id,
                        product: item.products,
                        warehouse_id: item.warehouse_id,
                        current_qty: item.current_qty || 0,
                        new_qty: item.new_qty || 0,
                        difference_qty: item.difference_qty || 0,
                        current_rate: item.current_rate || 0,
                        value_difference: item.value_difference || 0,
                        reason: item.reason || ''
                      })) || []
                    })

                    // Switch to edit mode
                    setViewMode(false)
                    setSelectedAdjustment({ ...selectedAdjustment, isEditing: true })
                    setShowNewForm(true)
                  } catch (error: any) {
                    toast.error('فشل تحميل بيانات التسوية: ' + error.message)
                  }
                }}>
                  ✏️ تعديل
                </Button>
                <Button onClick={async () => {
                  if (confirm('هل أنت متأكد من ترحيل هذه التسوية؟ سيتم تحديث أرصدة المخزون وإنشاء القيود المحاسبية.')) {
                    await handleSubmitAdjustment(selectedAdjustment.id)
                  }
                }}>
                  ✅ ترحيل
                </Button>
                <Button variant="destructive" onClick={async () => {
                  if (confirm('هل أنت متأكد من إلغاء هذه التسوية؟')) {
                    try {
                      const supabase = getSupabase()
                      const { error } = await supabase
                        .from('stock_adjustments')
                        .update({ status: 'CANCELLED' })
                        .eq('id', selectedAdjustment.id)
                      
                      if (error) throw error
                      
                      toast.success('تم إلغاء التسوية بنجاح')
                      setViewMode(false)
                      setSelectedAdjustment(null)
                      loadAdjustments()
                    } catch (error: any) {
                      toast.error('فشل إلغاء التسوية: ' + error.message)
                    }
                  }
                }}>
                  🗑️ إلغاء
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="filter-status" className="block text-sm font-medium mb-1">الحالة</label>
            <select
              id="filter-status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">الكل</option>
              <option value="DRAFT">مسودة</option>
              <option value="SUBMITTED">مرحل</option>
              <option value="CANCELLED">ملغي</option>
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="filter-type" className="block text-sm font-medium mb-1">النوع</label>
            <select
              id="filter-type"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">الكل</option>
              {Object.entries(ADJUSTMENT_TYPES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.icon} {value.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Adjustments List */}
      <div className="bg-card rounded-lg border">
        {adjustments.length === 0 ? (
          <EmptyState
            icon={<ClipboardList aria-hidden="true" />}
            title="لا توجد تسويات مخزون بعد"
            description="ابدأ بإنشاء تسوية جديدة بالزر أعلاه"
          />
        ) : (
          <div className="divide-y">
            {adjustments.map((adj) => (
              <button
                key={adj.id}
                type="button"
                aria-label={`عرض تفاصيل تسوية المخزون ${adj.id}`}
                className="w-full text-start p-4 hover:bg-muted/50 cursor-pointer transition-colors border-0 bg-transparent"
                onClick={() => {
                  setSelectedAdjustment(adj)
                  setViewMode(true)
                }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">
                        {ADJUSTMENT_TYPES[adj.adjustment_type as keyof typeof ADJUSTMENT_TYPES]?.icon}
                      </span>
                      <div>
                        <h3 className="font-medium">
                          {ADJUSTMENT_TYPES[adj.adjustment_type as keyof typeof ADJUSTMENT_TYPES]?.label}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {adj.reference_number || adj.id}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm mt-2">{adj.reason}</p>
                  </div>
                  <div className="text-start">
                    <Badge
                      variant={
                        adj.status === 'SUBMITTED'
                          ? 'default'
                          : adj.status === 'DRAFT'
                          ? 'secondary'
                          : 'destructive'
                      }
                    >
                      {adj.status === 'SUBMITTED'
                        ? 'مرحل'
                        : adj.status === 'DRAFT'
                        ? 'مسودة'
                        : 'ملغي'}
                    </Badge>
                    <div className="text-sm text-muted-foreground mt-2">
                      {new Date(adj.adjustment_date).toLocaleDateString('en-US')}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Inventory Valuation Component
function InventoryValuation() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <PageHeader
        title="تقييم المخزون"
        description="تقارير قيمة وتقييم المخزون"
        hideOnPrint={false}
      />
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - تقارير تقييم وقيمة المخزون
        </p>
      </div>
    </div>
  )
}

// Storage Locations Component
function StorageLocations() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <PageHeader
        title="مواقع التخزين"
        description="إدارة مواقع ومستودعات التخزين"
        hideOnPrint={false}
      />
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - إدارة مواقع ومستودعات التخزين
        </p>
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
      <LoadingSpinner label={t('common.loading')} />
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
          {movements.length === 0 ? (
            <EmptyState
              title="لا توجد حركات مخزون بعد"
              description="تظهر الحركات هنا تلقائياً مع أول استلام أو صرف أو تسوية"
            />
          ) : (
            movements.map((movement) => {
              // Determine movement direction from actual_qty
              const isIncoming = movement.actual_qty > 0
              const isOutgoing = movement.actual_qty < 0
              
              // Get voucher type in Arabic
              const getVoucherTypeAr = (type: string) => {
                const types: Record<string, string> = {
                  'Goods Receipt': 'استلام بضاعة',
                  'Delivery Note': 'إذن تسليم',
                  'Stock Entry': 'قيد مخزون',
                  'Material Issue': 'صرف مواد',
                  'Material Receipt': 'استلام مواد',
                  'Purchase Receipt': 'استلام مشتريات',
                  'Sales Return': 'مرتجع مبيعات',
                  'Purchase Return': 'مرتجع مشتريات',
                  'Stock Adjustment': 'تسوية مخزون'
                }
                return types[type] || type
              }

              return (
                <div key={movement.id} className="p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-base truncate">
                            {movement.item?.name || 'منتج غير معروف'}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {movement.item?.code || 'N/A'}
                          </p>
                        </div>
                      </div>
                      
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge 
                          variant={isIncoming ? 'default' : isOutgoing ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          {getVoucherTypeAr(movement.voucher_type || 'N/A')}
                        </Badge>
                        
                        {movement.voucher_number && (
                          <span className="text-xs text-muted-foreground">
                            #{movement.voucher_number}
                          </span>
                        )}
                        
                        {movement.batch_no && (
                          <Badge variant="outline" className="text-xs">
                            دفعة: {movement.batch_no}
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    <div className="text-start shrink-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn(
                          "font-bold text-lg tabular-nums",
                          isIncoming ? 'text-green-600' : 
                          isOutgoing ? 'text-red-600' : 'text-blue-600'
                        )}>
                          {isIncoming ? '+' : ''}{movement.actual_qty?.toFixed(2)}
                        </span>
                      </div>
                      
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>الرصيد: {movement.qty_after_transaction?.toFixed(2)}</div>
                        <div>التقييم: {movement.valuation_rate?.toFixed(2)} ر.س</div>
                        <div>القيمة: {movement.stock_value?.toFixed(2)} ر.س</div>
                      </div>
                      
                      <div className="text-xs text-muted-foreground mt-2">
                        {new Date(movement.posting_date).toLocaleDateString('en-US')}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// Categories Management Component
function CategoriesManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCategory, setNewCategory] = useState({
    name: '',
    name_ar: ''
  })

  useEffect(() => {
    loadCategories()
  }, [])

  const loadCategories = async () => {
    try {
      const data = await categoriesService.getAll()
      setCategories((data || []) as unknown as Category[])
    } catch (error) {
      console.error('Error loading categories:', error)
      toast.error('خطأ في تحميل الفئات')
    } finally {
      setLoading(false)
    }
  }

  const handleAddCategory = async () => {
    try {
      if (!newCategory.name) {
        toast.error('الرجاء إدخال اسم الفئة')
        return
      }

      await categoriesService.create({
        name: newCategory.name,
        name_ar: newCategory.name_ar || newCategory.name
      } as any)
      
      toast.success('تم إضافة الفئة بنجاح')
      setShowAddForm(false)
      setNewCategory({ name: '', name_ar: '' })
      loadCategories()
    } catch (error) {
      console.error('Error adding category:', error)
      toast.error('خطأ في إضافة الفئة')
    }
  }

  if (loading) {
    return (
      <LoadingSpinner label={t('common.loading')} />
    )
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold">فئات المنتجات</h1>
          <p className="text-muted-foreground">إدارة تصنيفات المخزون</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? t('common.cancel') : '+ إضافة فئة'}
        </Button>
      </div>

      {/* Add Category Form */}
      {showAddForm && (
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">إضافة فئة جديدة</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="category-name" className="block text-sm font-medium mb-2">اسم الفئة (English)</label>
              <Input
                id="category-name"
                value={newCategory.name}
                onChange={(e) => setNewCategory({...newCategory, name: e.target.value})}
                placeholder="Raw Materials, Finished Goods..."
              />
            </div>
            <div>
              <label htmlFor="category-name-ar" className="block text-sm font-medium mb-2">الاسم بالعربية</label>
              <Input
                id="category-name-ar"
                value={newCategory.name_ar}
                onChange={(e) => setNewCategory({...newCategory, name_ar: e.target.value})}
                placeholder="مواد خام، منتجات تامة..."
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleAddCategory} disabled={!newCategory.name}>
              إضافة
            </Button>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {/* Categories List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة الفئات ({categories.length})</h3>
        </div>
        <div className="divide-y">
          {categories.length === 0 ? (
            <EmptyState
              title="لا توجد فئات"
              description="ابدأ بإضافة فئة جديدة لتنظيم الأصناف"
            />
          ) : (
            categories.map((category) => (
              <div key={category.id} className="p-4 flex justify-between items-center hover:bg-accent/50 transition-colors">
                <div>
                  <h4 className="font-medium">{category.name_ar || category.name}</h4>
                  <p className="text-sm text-muted-foreground">{category.name}</p>
                </div>
                <Badge variant="secondary">فئة</Badge>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Suggested Categories */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">💡 فئات مقترحة:</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div>• مواد خام (Raw Materials)</div>
          <div>• منتجات تامة (Finished Goods)</div>
          <div>• نصف مصنعة (Semi-Finished)</div>
          <div>• مشتريات خارجية (External Purchases)</div>
          <div>• مواد تعبئة (Packaging)</div>
          <div>• قطع غيار (Spare Parts)</div>
          <div>• مستلزمات (Supplies)</div>
          <div>• أدوات (Tools)</div>
        </div>
      </div>
    </div>
  )
}

// Warehouses Page Component
import WarehouseManagement from './components/WarehouseManagement'
import StorageLocationsManagement from './components/StorageLocationsManagement'
// import StorageBinsManagement from './components/StorageBinsManagement' // Temporarily disabled - missing types
import StockTransferManagement from './components/StockTransfer'

function WarehousesPage() {
  return <WarehouseManagement />
}

function StorageLocationsPage() {
  return <StorageLocationsManagement />
}

function StorageBinsPage() {
  // Temporarily disabled - return placeholder
  return (
    <div className="p-8 text-center">
      <h2 className="text-xl font-semibold mb-2">إدارة صناديق التخزين</h2>
      <p className="text-gray-500">هذه الميزة قيد التطوير</p>
    </div>
  )
}

function StockTransfersPage() {
  return <StockTransferManagement />
}




