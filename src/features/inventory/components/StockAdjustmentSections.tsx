import { ClipboardList, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ADJUSTMENT_TYPES } from '../helpers'
import { UomStatusBadge } from './UomStatusBadge'

export type StockAdjustmentRecord = {
  id: string
  adjustment_number?: string | null
  adjustment_date: string
  adjustment_type: string
  status: string
  reason?: string | null
  reference_number?: string | null
  warehouse_id?: string | null
  increase_account_id?: string | null
  decrease_account_id?: string | null
  total_items?: number | null
  total_qty_difference?: number | null
  total_value_difference?: number | null
  requires_approval?: boolean | null
}

type StockAdjustmentCreateActionProps = {
  canCreateAdjustment: boolean
  canOpenAdjustmentForm: boolean
  onCreate: () => void
}

export function StockAdjustmentCreateAction({
  canCreateAdjustment,
  canOpenAdjustmentForm,
  onCreate,
}: Readonly<StockAdjustmentCreateActionProps>) {
  if (!canCreateAdjustment || !canOpenAdjustmentForm) return null

  return (
    <Button onClick={onCreate} className="gap-2">
      <Plus className="w-4 h-4" />
      تسوية جديدة
    </Button>
  )
}

type StockAdjustmentDetailsCardProps = {
  adjustment: StockAdjustmentRecord
  canUpdateAdjustment: boolean
  canApproveAdjustment: boolean
  canOpenAdjustmentForm: boolean
  onClose: () => void
  onEdit: () => void
  onSubmit: () => void
  onCancel: () => void
}

function adjustmentStatusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'SUBMITTED') return 'default'
  if (status === 'DRAFT') return 'secondary'
  return 'destructive'
}

function adjustmentStatusLabel(status: string): string {
  if (status === 'SUBMITTED') return 'مرحل'
  if (status === 'DRAFT') return 'مسودة'
  return 'ملغي'
}

function StockAdjustmentDraftActions({
  canUpdateAdjustment,
  canApproveAdjustment,
  canOpenAdjustmentForm,
  onEdit,
  onSubmit,
  onCancel,
}: Readonly<Omit<StockAdjustmentDetailsCardProps, 'adjustment' | 'onClose'>>) {
  return (
    <div className="flex justify-end gap-2">
      {canUpdateAdjustment && canOpenAdjustmentForm && (
        <Button variant="outline" onClick={onEdit}>
          ✏️ تعديل
        </Button>
      )}
      {canApproveAdjustment && (
        <Button onClick={onSubmit}>
          ✅ ترحيل
        </Button>
      )}
      {canUpdateAdjustment && (
        <Button variant="destructive" onClick={onCancel}>
          🗑️ إلغاء
        </Button>
      )}
    </div>
  )
}

export function StockAdjustmentDetailsCard({
  adjustment,
  canUpdateAdjustment,
  canApproveAdjustment,
  canOpenAdjustmentForm,
  onClose,
  onEdit,
  onSubmit,
  onCancel,
}: Readonly<StockAdjustmentDetailsCardProps>) {
  const adjustmentType = ADJUSTMENT_TYPES[
    adjustment.adjustment_type as keyof typeof ADJUSTMENT_TYPES
  ]

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-2xl font-bold flex items-center gap-2">
            <span>{adjustmentType?.icon}</span>{' '}
            تفاصيل التسوية
          </h3>
          <Button variant="outline" onClick={onClose}>
            ✕ إغلاق
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 dark:bg-gray-900 rounded-lg">
          <div>
            <span className="text-sm text-muted-foreground">رقم التسوية:</span>
            <p className="font-medium">{adjustment.adjustment_number}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">التاريخ:</span>
            <p className="font-medium">
              {new Date(adjustment.adjustment_date).toLocaleDateString('en-US')}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">النوع:</span>
            <p className="font-medium">{adjustmentType?.label}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">الحالة:</span>
            <Badge variant={adjustmentStatusVariant(adjustment.status)}>
              {adjustmentStatusLabel(adjustment.status)}
            </Badge>
          </div>
          <div className="col-span-2">
            <span className="text-sm text-muted-foreground">السبب:</span>
            <p className="font-medium">{adjustment.reason}</p>
          </div>
          {adjustment.reference_number && (
            <div className="col-span-2">
              <span className="text-sm text-muted-foreground">رقم المرجع:</span>
              <p className="font-medium">{adjustment.reference_number}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <p className="text-sm text-muted-foreground">إجمالي المنتجات</p>
            <p className="text-2xl font-bold">{adjustment.total_items || 0}</p>
          </div>
          <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
            <p className="text-sm text-muted-foreground">فرق الكمية</p>
            <p className="text-2xl font-bold">{adjustment.total_qty_difference || 0}</p>
          </div>
          <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
            <p className="text-sm text-muted-foreground">فرق القيمة</p>
            <p className="text-2xl font-bold">
              {(adjustment.total_value_difference || 0).toFixed(2)} ر.س
            </p>
          </div>
          <div className="p-4 bg-amber-50 dark:bg-amber-950 rounded-lg">
            <p className="text-sm text-muted-foreground">يتطلب موافقة</p>
            <p className="text-2xl font-bold">{adjustment.requires_approval ? 'نعم' : 'لا'}</p>
          </div>
        </div>

        {adjustment.status === 'DRAFT' && (
          <StockAdjustmentDraftActions
            canUpdateAdjustment={canUpdateAdjustment}
            canApproveAdjustment={canApproveAdjustment}
            canOpenAdjustmentForm={canOpenAdjustmentForm}
            onEdit={onEdit}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
      </div>
    </Card>
  )
}

type StockAdjustmentFiltersProps = {
  filterStatus: string
  filterType: string
  onStatusChange: (value: string) => void
  onTypeChange: (value: string) => void
}

export function StockAdjustmentFilters({
  filterStatus,
  filterType,
  onStatusChange,
  onTypeChange,
}: Readonly<StockAdjustmentFiltersProps>) {
  return (
    <Card className="p-4">
      <div className="flex gap-4">
        <div className="flex-1">
          <label htmlFor="filter-status" className="block text-sm font-medium mb-1">الحالة</label>
          <select
            id="filter-status"
            value={filterStatus}
            onChange={(event) => onStatusChange(event.target.value)}
            className="w-full px-3 py-2 border border-border dark:border-gray-700 rounded-md bg-card dark:bg-gray-800 text-foreground dark:text-gray-100 hover:bg-muted/50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
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
            onChange={(event) => onTypeChange(event.target.value)}
            className="w-full px-3 py-2 border border-border dark:border-gray-700 rounded-md bg-card dark:bg-gray-800 text-foreground dark:text-gray-100 hover:bg-muted/50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
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
  )
}

export type StockAdjustmentProduct = {
  id: string
  name: string
  code?: string | null
  stock_quantity?: number | null
}

type StockAdjustmentProductPickerProps = {
  warehouseId: string
  searchTerm: string
  showProductSearch: boolean
  filteredProducts: StockAdjustmentProduct[]
  selectedProduct: StockAdjustmentProduct | null
  productUomStatus: {
    isEnabled: boolean
    isLoading: boolean
    isError: boolean
  }
  productNeedsUomSetup: (productId: string) => boolean
  onSearchTermChange: (value: string) => void
  onSearchFocus: () => void
  onProductSelect: (product: StockAdjustmentProduct) => void
  onAddItem: () => void
}

type StockAdjustmentProductSearchResultsProps = Pick<
  StockAdjustmentProductPickerProps,
  'filteredProducts' | 'productUomStatus' | 'productNeedsUomSetup' | 'onProductSelect'
>

function StockAdjustmentProductSearchResults({
  filteredProducts,
  productUomStatus,
  productNeedsUomSetup,
  onProductSelect,
}: Readonly<StockAdjustmentProductSearchResultsProps>) {
  if (productUomStatus.isEnabled && productUomStatus.isLoading) {
    return (
      <div className="px-4 py-4 text-center text-muted-foreground bg-card dark:bg-gray-950">
        جارٍ التحقق من إعداد وحدات الأصناف…
      </div>
    )
  }

  if (productUomStatus.isEnabled && productUomStatus.isError) {
    return (
      <div className="px-4 py-4 text-center text-red-600 bg-card dark:bg-gray-950">
        تعذّر التحقق من حالة وحدات الأصناف — لا يمكن اختيار صنف الآن
      </div>
    )
  }

  if (filteredProducts.length === 0) {
    return (
      <div className="px-4 py-4 text-center text-muted-foreground dark:text-muted-foreground bg-card dark:bg-gray-950">
        لا توجد نتائج
      </div>
    )
  }

  return filteredProducts.map((product) => {
    if (productNeedsUomSetup(product.id)) {
      return (
        <div
          key={product.id}
          className="w-full px-4 py-3 text-right border-b border-border dark:border-gray-700 last:border-b-0 bg-muted/40 dark:bg-gray-900 opacity-80"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium text-foreground dark:text-white">{product.name}</div>
            <UomStatusBadge />
          </div>
          <div className="text-sm text-muted-foreground dark:text-muted-foreground">
            {product.code} - الرصيد: {product.stock_quantity}
          </div>
        </div>
      )
    }

    return (
      <button
        key={product.id}
        type="button"
        onClick={() => onProductSelect(product)}
        className="w-full px-4 py-3 text-right hover:bg-muted dark:hover:bg-gray-800 border-b border-border dark:border-gray-700 last:border-b-0 transition-colors bg-card dark:bg-gray-950"
      >
        <div className="font-medium text-foreground dark:text-white">{product.name}</div>
        <div className="text-sm text-muted-foreground dark:text-muted-foreground">
          {product.code} - الرصيد: {product.stock_quantity}
        </div>
      </button>
    )
  })
}

export function StockAdjustmentProductPicker({
  warehouseId,
  searchTerm,
  showProductSearch,
  filteredProducts,
  selectedProduct,
  productUomStatus,
  productNeedsUomSetup,
  onSearchTermChange,
  onSearchFocus,
  onProductSelect,
  onAddItem,
}: Readonly<StockAdjustmentProductPickerProps>) {
  return (
    <div className="relative z-20">
      <label htmlFor="adjustment-add-item" className="block text-sm font-medium mb-2">
        إضافة منتج
      </label>

      {!warehouseId && (
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
            id="adjustment-add-item"
            type="text"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            onFocus={onSearchFocus}
            placeholder="ابحث عن منتج..."
            disabled={!warehouseId}
            className="w-full px-3 py-2 border rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          />

          {showProductSearch && searchTerm && (
            <div
              className="absolute z-[9999] w-full mt-1 bg-card dark:bg-gray-950 border-2 border-gray-400 dark:border-gray-400 rounded-lg shadow-2xl max-h-60 overflow-y-auto"
              style={{
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.1)',
              }}
            >
              <StockAdjustmentProductSearchResults
                filteredProducts={filteredProducts}
                productUomStatus={productUomStatus}
                productNeedsUomSetup={productNeedsUomSetup}
                onProductSelect={onProductSelect}
              />
            </div>
          )}
        </div>
        <Button onClick={onAddItem} disabled={!warehouseId || !selectedProduct}>
          إضافة
        </Button>
      </div>
    </div>
  )
}

type StockAdjustmentsListProps = {
  adjustments: StockAdjustmentRecord[]
  onSelect: (adjustment: StockAdjustmentRecord) => void
}

export function StockAdjustmentsList({
  adjustments,
  onSelect,
}: Readonly<StockAdjustmentsListProps>) {
  if (adjustments.length === 0) {
    return (
      <div className="bg-card rounded-lg border">
        <EmptyState
          icon={<ClipboardList aria-hidden="true" />}
          title="لا توجد تسويات مخزون بعد"
          description="ابدأ بإنشاء تسوية جديدة بالزر أعلاه"
        />
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg border">
      <div className="divide-y">
        {adjustments.map((adjustment) => {
          const adjustmentType = ADJUSTMENT_TYPES[
            adjustment.adjustment_type as keyof typeof ADJUSTMENT_TYPES
          ]

          return (
            <button
              key={adjustment.id}
              type="button"
              aria-label={`عرض تفاصيل تسوية المخزون ${adjustment.id}`}
              className="w-full text-start p-4 hover:bg-muted/50 cursor-pointer transition-colors border-0 bg-transparent"
              onClick={() => onSelect(adjustment)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{adjustmentType?.icon}</span>
                    <div>
                      <h3 className="font-medium">{adjustmentType?.label}</h3>
                      <p className="text-sm text-muted-foreground">
                        {adjustment.reference_number || adjustment.id}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm mt-2">{adjustment.reason}</p>
                </div>
                <div className="text-start">
                  <Badge variant={adjustmentStatusVariant(adjustment.status)}>
                    {adjustmentStatusLabel(adjustment.status)}
                  </Badge>
                  <div className="text-sm text-muted-foreground mt-2">
                    {new Date(adjustment.adjustment_date).toLocaleDateString('en-US')}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
