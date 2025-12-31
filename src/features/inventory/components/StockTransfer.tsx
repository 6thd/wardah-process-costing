/**
 * Stock Transfer Component
 * نظام تحويلات البضاعة بين المستودعات
 */

import { useState, useEffect } from 'react'
import { Plus, X, Trash2, Package, ArrowRight, Save, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { getSupabase } from '@/lib/supabase'
import { itemsService } from '@/services/supabase-service'

interface StockTransferItem {
  id: string
  product_id: string
  product: any
  quantity: number
  available_qty: number
}

interface StockTransfer {
  id?: string
  transfer_date: string
  reference_number: string
  from_warehouse_id: string
  to_warehouse_id: string
  status: 'DRAFT' | 'SUBMITTED'
  notes: string
  items: StockTransferItem[]
}

export default function StockTransferManagement() {
  const [transfers, setTransfers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)

  // Warehouses
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [loadingWarehouses, setLoadingWarehouses] = useState(true)

  // Products
  const [products, setProducts] = useState<any[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)

  // New Transfer State
  const [newTransfer, setNewTransfer] = useState<StockTransfer>({
    transfer_date: new Date().toISOString().split('T')[0],
    reference_number: '',
    from_warehouse_id: '',
    to_warehouse_id: '',
    status: 'DRAFT',
    notes: '',
    items: []
  })

  // Product search
  const [searchTerm, setSearchTerm] = useState('')
  const [showProductSearch, setShowProductSearch] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<any>(null)

  useEffect(() => {
    loadTransfers()
    loadWarehouses()
    loadProducts()
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.product-search-container')) {
        setShowProductSearch(false)
      }
    }

    if (showProductSearch) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showProductSearch])

  const loadTransfers = async () => {
    try {
      setLoading(true)
      const supabase = getSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setTransfers([])
        setLoading(false)
        return
      }

      const { data: userOrgs } = await supabase
        .from('user_organizations')
        .select('org_id')
        .eq('user_id', user.id)
        .single()

      if (!userOrgs) {
        setTransfers([])
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('stock_transfers')
        .select('*')
        .eq('organization_id', userOrgs.org_id)
        .order('created_at', { ascending: false })

      if (error) throw error

      setTransfers(data || [])
    } catch (error) {
      console.error('Error loading transfers:', error)
      toast.error('خطأ في تحميل التحويلات')
    } finally {
      setLoading(false)
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
    } catch (error) {
      console.error('Error loading warehouses:', error)
      toast.error('خطأ في تحميل المخازن')
    } finally {
      setLoadingWarehouses(false)
    }
  }

  const loadProducts = async () => {
    try {
      setLoadingProducts(true)
      const data = await itemsService.getAll()
      setProducts(data || [])
    } catch (error) {
      console.error('Error loading products:', error)
    } finally {
      setLoadingProducts(false)
    }
  }

  const getAvailableQty = async (productId: string, warehouseId: string): Promise<number> => {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('bins')
        .select('actual_qty')
        .eq('product_id', productId)
        .eq('warehouse_id', warehouseId)
        .single()

      if (error) {
        console.log('No bin found, returning 0')
        return 0
      }

      return data?.actual_qty || 0
    } catch (error) {
      console.error('Error getting available qty:', error)
      return 0
    }
  }

  const handleAddItem = async () => {
    if (!newTransfer.from_warehouse_id) {
      toast.error('الرجاء اختيار المستودع المصدر أولاً')
      return
    }

    if (!selectedProduct) {
      toast.error('الرجاء اختيار منتج')
      return
    }

    const existingItem = newTransfer.items.find(
      (i: StockTransferItem) => i.product_id === selectedProduct.id
    )

    if (existingItem) {
      toast.error('المنتج موجود بالفعل في القائمة')
      return
    }

    // Get available quantity from source warehouse
    const availableQty = await getAvailableQty(selectedProduct.id, newTransfer.from_warehouse_id)

    const newItem: StockTransferItem = {
      id: Date.now().toString(),
      product_id: selectedProduct.id,
      product: selectedProduct,
      quantity: 0,
      available_qty: availableQty
    }

    setNewTransfer({
      ...newTransfer,
      items: [...newTransfer.items, newItem]
    })

    setSelectedProduct(null)
    setSearchTerm('')
    setShowProductSearch(false)
  }

  const handleItemChange = (itemId: string, field: string, value: any) => {
    const updatedItems = newTransfer.items.map((item: StockTransferItem) => {
      if (item.id === itemId) {
        return { ...item, [field]: value }
      }
      return item
    })

    setNewTransfer({
      ...newTransfer,
      items: updatedItems
    })
  }

  const handleRemoveItem = (itemId: string) => {
    setNewTransfer({
      ...newTransfer,
      items: newTransfer.items.filter((i: StockTransferItem) => i.id !== itemId)
    })
  }

  const validateTransfer = (): boolean => {
    if (!newTransfer.from_warehouse_id) {
      toast.error('الرجاء اختيار المستودع المصدر')
      return false
    }

    if (!newTransfer.to_warehouse_id) {
      toast.error('الرجاء اختيار المستودع الوجهة')
      return false
    }

    if (newTransfer.from_warehouse_id === newTransfer.to_warehouse_id) {
      toast.error('لا يمكن التحويل إلى نفس المستودع')
      return false
    }

    if (newTransfer.items.length === 0) {
      toast.error('الرجاء إضافة منتج واحد على الأقل')
      return false
    }

    const invalidItems = newTransfer.items.filter(
      (i: StockTransferItem) => i.quantity <= 0 || i.quantity > i.available_qty
    )

    if (invalidItems.length > 0) {
      toast.error('يوجد منتجات بكميات غير صحيحة أو تتجاوز الرصيد المتاح')
      return false
    }

    return true
  }

  const handleSaveDraft = async () => {
    if (!validateTransfer()) return

    try {
      const supabase = getSupabase()
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

      // Generate reference number if empty
      const referenceNumber = newTransfer.reference_number || `STR-${Date.now().toString().slice(-8)}`

      // Save transfer header
      const { data: transfer, error: transferError } = await supabase
        .from('stock_transfers')
        .insert({
          organization_id: userOrg.org_id,
          transfer_date: newTransfer.transfer_date,
          reference_number: referenceNumber,
          from_warehouse_id: newTransfer.from_warehouse_id,
          to_warehouse_id: newTransfer.to_warehouse_id,
          status: 'DRAFT',
          notes: newTransfer.notes || null,
          total_items: newTransfer.items.length,
          created_by: user.id
        })
        .select()
        .single()

      if (transferError) throw transferError

      // Save transfer items
      const itemsToInsert = newTransfer.items.map((item: StockTransferItem) => ({
        transfer_id: transfer.id,
        organization_id: userOrg.org_id,
        product_id: item.product_id,
        quantity: item.quantity,
        available_qty_at_transfer: item.available_qty
      }))

      const { error: itemsError } = await supabase
        .from('stock_transfer_items')
        .insert(itemsToInsert)

      if (itemsError) throw itemsError

      toast.success('✅ تم حفظ التحويل كمسودة بنجاح')
      setShowNewForm(false)
      resetForm()
      loadTransfers()
    } catch (error: any) {
      console.error('Error saving transfer:', error)
      toast.error(error.message || 'خطأ في حفظ التحويل')
    }
  }

  const handleSubmitTransfer = async (transferId: string) => {
    try {
      const supabase = getSupabase()
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

      // Get transfer with items
      const { data: transfer, error: transferError } = await supabase
        .from('stock_transfers')
        .select('*')
        .eq('id', transferId)
        .single()

      if (transferError || !transfer) {
        toast.error('لم يتم العثور على التحويل')
        return
      }

      if (transfer.status !== 'DRAFT') {
        toast.error('يمكن فقط تأكيد التحويلات بحالة مسودة')
        return
      }

      // Get transfer items
      const { data: items, error: itemsError } = await supabase
        .from('stock_transfer_items')
        .select('*')
        .eq('transfer_id', transferId)

      if (itemsError || !items || items.length === 0) {
        toast.error('لم يتم العثور على بنود التحويل')
        return
      }

      // Create stock ledger entries (OUT from source, IN to destination)
      const stockLedgerEntries = []

      for (const item of items) {
        // Get current rate from bins
        const { data: bin } = await supabase
          .from('bins')
          .select('valuation_rate')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', transfer.from_warehouse_id)
          .single()

        const valuationRate = bin?.valuation_rate || 0

        const postingTime = new Date().toTimeString().split(' ')[0];
        const commonFields = {
          org_id: userOrg.org_id,
          posting_date: transfer.transfer_date,
          posting_time: postingTime,
          voucher_type: 'Stock Transfer',
          voucher_id: transferId,
          voucher_number: transfer.reference_number,
          product_id: item.product_id,
          is_cancelled: false,
          created_by: user.id
        };

        // OUT from source warehouse and IN to destination warehouse
        const outEntry = {
          ...commonFields,
          warehouse_id: transfer.from_warehouse_id,
          actual_qty: -item.quantity, // Negative for OUT
          incoming_rate: 0,
          outgoing_rate: valuationRate,
          valuation_rate: valuationRate,
          stock_value_difference: -item.quantity * valuationRate
        };
        const inEntry = {
          ...commonFields,
          warehouse_id: transfer.to_warehouse_id,
          actual_qty: item.quantity, // Positive for IN
          incoming_rate: valuationRate,
          outgoing_rate: 0,
          valuation_rate: valuationRate,
          stock_value_difference: item.quantity * valuationRate
        };
        // Push both entries at once (intentional - both entries are created together)
        // eslint-disable-next-line sonarjs/prefer-array-methods
        stockLedgerEntries.push(outEntry, inEntry)
      }

      const { error: ledgerError } = await supabase
        .from('stock_ledger_entries')
        .insert(stockLedgerEntries)

      if (ledgerError) {
        console.error('Error creating stock ledger entries:', ledgerError)
        throw new Error('فشل في إنشاء قيود المخزون: ' + ledgerError.message)
      }

      // Update transfer status
      const { error: updateError } = await supabase
        .from('stock_transfers')
        .update({
          status: 'SUBMITTED',
          submitted_at: new Date().toISOString(),
          submitted_by: user.id
        })
        .eq('id', transferId)

      if (updateError) throw updateError

      toast.success('✅ تم تأكيد التحويل وتحديث المخزون بنجاح')
      
      loadTransfers()

    } catch (error: any) {
      console.error('Error submitting transfer:', error)
      toast.error(error.message || 'خطأ في تأكيد التحويل')
    }
  }

  const resetForm = () => {
    setNewTransfer({
      transfer_date: new Date().toISOString().split('T')[0],
      reference_number: '',
      from_warehouse_id: '',
      to_warehouse_id: '',
      status: 'DRAFT',
      notes: '',
      items: []
    })
    setSelectedProduct(null)
    setSearchTerm('')
  }

  const filteredProducts = products.filter(
    (p: any) =>
      p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.code?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getWarehouseName = (warehouseId: string) => {
    const wh = warehouses.find(w => w.id === warehouseId)
    return wh ? `${wh.code} - ${wh.name || wh.name_ar}` : warehouseId
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
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">تحويلات البضاعة</h1>
          <p className="text-muted-foreground mt-2">
            نقل البضاعة بين المستودعات المختلفة
          </p>
        </div>
        <Button
          onClick={() => setShowNewForm(true)}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          تحويل جديد
        </Button>
      </div>

      {/* New Transfer Form */}
      {showNewForm && (
        <Card className="p-6">
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">تحويل بضاعة جديد</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowNewForm(false)
                  resetForm()
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Header Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>التاريخ *</Label>
                <Input
                  type="date"
                  value={newTransfer.transfer_date}
                  onChange={(e) =>
                    setNewTransfer({
                      ...newTransfer,
                      transfer_date: e.target.value
                    })
                  }
                />
              </div>

              <div>
                <Label>رقم المرجع</Label>
                <Input
                  value={newTransfer.reference_number}
                  onChange={(e) =>
                    setNewTransfer({
                      ...newTransfer,
                      reference_number: e.target.value
                    })
                  }
                  placeholder="سيتم إنشاؤه تلقائياً"
                />
              </div>
            </div>

            {/* Warehouses Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/30 p-4 rounded-lg">
              <div>
                <Label>المستودع المصدر *</Label>
                <select
                  value={newTransfer.from_warehouse_id}
                  onChange={(e) => {
                    setNewTransfer({
                      ...newTransfer,
                      from_warehouse_id: e.target.value,
                      items: [] // Reset items when source changes
                    })
                  }}
                  disabled={loadingWarehouses}
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-800"
                >
                  <option value="">اختر المستودع</option>
                  {warehouses
                    .filter(wh => wh.id !== newTransfer.to_warehouse_id)
                    .map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.code} - {wh.name || wh.name_ar}
                      </option>
                    ))}
                </select>
                {!newTransfer.from_warehouse_id && (
                  <p className="text-xs text-red-600 mt-1">
                    ⚠️ يجب اختيار المستودع المصدر
                  </p>
                )}
              </div>

              <div>
                <Label>المستودع الوجهة *</Label>
                <select
                  value={newTransfer.to_warehouse_id}
                  onChange={(e) =>
                    setNewTransfer({
                      ...newTransfer,
                      to_warehouse_id: e.target.value
                    })
                  }
                  disabled={loadingWarehouses}
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-800"
                >
                  <option value="">اختر المستودع</option>
                  {warehouses
                    .filter(wh => wh.id !== newTransfer.from_warehouse_id)
                    .map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.code} - {wh.name || wh.name_ar}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Visual Transfer Indicator */}
            {newTransfer.from_warehouse_id && newTransfer.to_warehouse_id && (
              <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex-1 text-center">
                  <Package className="w-6 h-6 mx-auto mb-2 text-blue-600" />
                  <p className="font-medium text-sm">
                    {getWarehouseName(newTransfer.from_warehouse_id)}
                  </p>
                </div>
                <ArrowRight className="w-8 h-8 text-blue-600" />
                <div className="flex-1 text-center">
                  <Package className="w-6 h-6 mx-auto mb-2 text-green-600" />
                  <p className="font-medium text-sm">
                    {getWarehouseName(newTransfer.to_warehouse_id)}
                  </p>
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <Label>ملاحظات</Label>
              <textarea
                value={newTransfer.notes}
                onChange={(e) =>
                  setNewTransfer({
                    ...newTransfer,
                    notes: e.target.value
                  })
                }
                placeholder="أضف ملاحظات إضافية..."
                rows={2}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            {/* Product Selection */}
            {!newTransfer.from_warehouse_id && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
                <p className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>يجب اختيار المستودع المصدر أولاً قبل إضافة المنتجات</span>
                </p>
              </div>
            )}

            <div className="relative">
              <Label>إضافة منتج</Label>
              <div className="flex gap-2 mt-1">
                <div className="flex-1 relative product-search-container">
                  <Input
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value)
                      setShowProductSearch(true)
                    }}
                    onFocus={() => setShowProductSearch(true)}
                    placeholder="ابحث عن منتج..."
                    disabled={!newTransfer.from_warehouse_id || loadingProducts}
                  />
                  
                  {showProductSearch && searchTerm && (
                    <div 
                      className="absolute z-[9999] w-full mt-1 bg-white dark:bg-gray-950 border-2 border-gray-400 rounded-lg shadow-2xl max-h-60 overflow-y-auto"
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
                            <div className="font-medium">{product.name}</div>
                            <div className="text-sm text-gray-500">
                              {product.code} - الرصيد: {product.stock_quantity}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-4 text-center text-gray-500">
                          لا توجد نتائج
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <Button 
                  onClick={handleAddItem}
                  disabled={!newTransfer.from_warehouse_id || !selectedProduct}
                >
                  إضافة
                </Button>
              </div>
            </div>

            {/* Items Table */}
            {newTransfer.items.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-right text-xs font-medium">المنتج</th>
                      <th className="px-4 py-3 text-right text-xs font-medium">الرصيد المتاح</th>
                      <th className="px-4 py-3 text-right text-xs font-medium">الكمية المحولة *</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newTransfer.items.map((item: StockTransferItem) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-4 py-3">
                          <div>
                            <div className="font-medium">{item.product.name}</div>
                            <div className="text-sm text-muted-foreground">{item.product.code}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={item.available_qty > 0 ? "outline" : "destructive"}>
                            {item.available_qty}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min="0"
                            max={item.available_qty}
                            value={item.quantity}
                            onChange={(e) =>
                              handleItemChange(item.id, 'quantity', Number.parseFloat(e.target.value) || 0)
                            }
                            className="w-32"
                          />
                          {item.quantity > item.available_qty && (
                            <p className="text-xs text-red-600 mt-1">
                              تتجاوز الرصيد المتاح
                            </p>
                          )}
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
              </div>
            )}

            {/* Summary */}
            {newTransfer.items.length > 0 && (
              <div className="bg-muted/30 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium">إجمالي المنتجات:</span>
                  <Badge variant="outline">{newTransfer.items.length}</Badge>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="font-medium">إجمالي الكميات:</span>
                  <Badge variant="outline">
                    {newTransfer.items.reduce((sum: number, item: StockTransferItem) => sum + item.quantity, 0)}
                  </Badge>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end border-t pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowNewForm(false)
                  resetForm()
                }}
              >
                إلغاء
              </Button>
              <Button
                onClick={handleSaveDraft}
                className="gap-2"
              >
                <Save className="w-4 h-4" />
                حفظ كمسودة
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Transfers List */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">التحويلات السابقة</h3>
        
        {transfers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            لا توجد تحويلات بعد
          </div>
        ) : (
          <div className="space-y-4">
            {transfers.map((transfer) => (
              <button
                key={transfer.id}
                type="button"
                aria-label={`عرض تفاصيل نقل المخزون ${transfer.id}`}
                className="w-full text-left border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                onClick={() => {
                  // View transfer details
                }}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h4 className="font-semibold">{transfer.reference_number}</h4>
                      <Badge variant={transfer.status === 'SUBMITTED' ? 'default' : 'secondary'}>
                        {transfer.status === 'DRAFT' ? 'مسودة' : 'مؤكد'}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {new Date(transfer.transfer_date).toLocaleDateString('ar-SA')}
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <span>{getWarehouseName(transfer.from_warehouse_id)}</span>
                      <ArrowRight className="w-4 h-4" />
                      <span>{getWarehouseName(transfer.to_warehouse_id)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">
                      {transfer.total_items} منتج
                    </div>
                    {transfer.status === 'DRAFT' && (
                      <Button
                        size="sm"
                        className="mt-2 gap-2"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSubmitTransfer(transfer.id)
                        }}
                      >
                        <Send className="w-4 h-4" />
                        تأكيد التحويل
                      </Button>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
