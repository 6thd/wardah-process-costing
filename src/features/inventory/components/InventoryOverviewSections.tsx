import type { TFunction } from 'i18next'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Item } from '@/lib/supabase'

interface InventoryKeyMetricsProps {
  readonly items: Item[]
  readonly totalValue: number
  readonly lowStockCount: number
}

export function InventoryKeyMetrics({ items, totalValue, lowStockCount }: InventoryKeyMetricsProps) {
  return (
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
        <div className="text-2xl font-bold text-amber-600">{lowStockCount}</div>
        <div className="text-sm text-muted-foreground">أصناف قليلة المخزون</div>
      </div>
      <div className="bg-card rounded-lg border p-4">
        <div className="text-2xl font-bold text-purple-600">
          {items.reduce((sum, item) => sum + item.stock_quantity, 0)}
        </div>
        <div className="text-sm text-muted-foreground">إجمالي الكمية</div>
      </div>
    </div>
  )
}

interface InventoryQuickActionsProps {
  readonly canReadItems: boolean
  readonly canReadStockMoves: boolean
  readonly canReadWarehouses: boolean
  readonly canReadAdjustments: boolean
  readonly t: TFunction
  readonly isRTL: boolean
}

export function InventoryQuickActions({
  canReadItems,
  canReadStockMoves,
  canReadWarehouses,
  canReadAdjustments,
  t,
  isRTL,
}: InventoryQuickActionsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {canReadItems && (
        <Link to="/inventory/items" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
            {t('inventory.items')}
          </h3>
          <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
            إدارة الأصناف والمواد
          </p>
        </Link>
      )}

      {canReadItems && (
        <Link to="/inventory/categories" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
            فئات المنتجات
          </h3>
          <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
            تصنيف المخزون
          </p>
        </Link>
      )}

      {canReadStockMoves && (
        <Link to="/inventory/movements" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
            {t('inventory.stockMoves')}
          </h3>
          <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
            متابعة حركات المخزون
          </p>
        </Link>
      )}

      {canReadWarehouses && (
        <Link to="/inventory/warehouses" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
            🏭 المخازن (1)
          </h3>
          <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
            المخازن الرئيسية
          </p>
        </Link>
      )}

      {canReadWarehouses && (
        <Link to="/inventory/locations" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
            📍 مواقع التخزين (2)
          </h3>
          <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
            المناطق والأرفف
          </p>
        </Link>
      )}

      {canReadWarehouses && (
        <Link to="/inventory/bins" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
            📦 صناديق التخزين (3)
          </h3>
          <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
            المواقع الدقيقة + باركود
          </p>
        </Link>
      )}

      {canReadStockMoves && (
        <Link to="/inventory/transfers" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
            🔄 تحويلات البضاعة
          </h3>
          <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
            نقل المخزون بين المستودعات
          </p>
        </Link>
      )}

      {canReadAdjustments && (
        <Link to="/inventory/adjustments" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
            {t('inventory.adjustments')}
          </h3>
          <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
            تسويات المخزون
          </p>
        </Link>
      )}
    </div>
  )
}

interface LowStockAlertProps {
  readonly lowStockItems: Item[]
}

export function LowStockAlert({ lowStockItems }: LowStockAlertProps) {
  return (
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
  )
}
