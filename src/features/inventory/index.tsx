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
      <Route index element={<InventoryOverview />} />
      <Route path="overview" element={<InventoryOverview />} />
      <Route path="items" element={<ItemsManagement />} />
      <Route path="categories" element={<CategoriesManagement />} />
      <Route path="movements" element={<StockMovements />} />
      <Route path="adjustments" element={<StockAdjustments />} />
      <Route path="valuation" element={<InventoryValuation />} />
      <Route path="locations" element={<StorageLocations />} />
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
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'code' | 'stock' | 'price'>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [newItem, setNewItem] = useState<Omit<Item, 'id' | 'category'> & { name_ar: string; selling_price: number }>({
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
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [itemsData, categoriesData] = await Promise.all([
        itemsService.getAll(),
        categoriesService.getAll(),
      ]);
      setItems(itemsData || [])
      setCategories(categoriesData || [])
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('خطأ في تحميل البيانات')
    } finally {
      setLoading(false)
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
                {stats.totalValue.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر.س
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
            <label className="block text-sm font-medium mb-2">🔍 البحث</label>
            <Input
              placeholder="ابحث بالاسم أو الكود..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-sm font-medium mb-2">📁 الفئة</label>
            <select
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
            <label className="block text-sm font-medium mb-2">📊 حالة المخزون</label>
            <select
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
            <label className="block text-sm font-medium mb-2">⬇️ الترتيب</label>
            <div className="flex gap-2">
              <select
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
              <label className="block text-sm font-medium mb-2">الفئة</label>
              <select
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
                  onClick={() => window.print()}
                >
                  🖨️ طباعة
                </Button>
              </>
            )}
          </div>
        </div>
        
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-6xl mb-4">📭</div>
            <h3 className="text-lg font-semibold mb-2">لا توجد أصناف</h3>
            <p className="text-muted-foreground">
              {searchTerm || selectedCategory !== 'all' || stockFilter !== 'all'
                ? 'جرب تغيير الفلاتر للحصول على نتائج'
                : 'لم يتم إضافة أي أصناف بعد'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-right p-3 font-semibold">الكود</th>
                  <th className="text-right p-3 font-semibold">اسم الصنف</th>
                  <th className="text-right p-3 font-semibold">الفئة</th>
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
                          {item.cost_price.toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="text-sm font-medium">
                          {item.price.toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س
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
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تسويات المخزون</h1>
        <p className="text-muted-foreground mt-2">
          تعديل وتصحيح أرصدة المخزون
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - تسويات وتعديلات أرصدة المخزون
        </p>
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
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تقييم المخزون</h1>
        <p className="text-muted-foreground mt-2">
          تقارير قيمة وتقييم المخزون
        </p>
      </div>
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
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">مواقع التخزين</h1>
        <p className="text-muted-foreground mt-2">
          إدارة مواقع ومستودعات التخزين
        </p>
      </div>
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
      setCategories(data || [])
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
              <label className="block text-sm font-medium mb-2">اسم الفئة (English)</label>
              <Input
                value={newCategory.name}
                onChange={(e) => setNewCategory({...newCategory, name: e.target.value})}
                placeholder="Raw Materials, Finished Goods..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">الاسم بالعربية</label>
              <Input
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
            <div className="p-8 text-center text-muted-foreground">
              <p>لا توجد فئات. ابدأ بإضافة فئة جديدة!</p>
            </div>
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
