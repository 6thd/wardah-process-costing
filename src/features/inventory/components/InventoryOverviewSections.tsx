import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
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

interface InventoryQuickActionLinkProps {
  readonly to: string
  readonly title: ReactNode
  readonly description: string
  readonly isRTL: boolean
}

function InventoryQuickActionLink({ to, title, description, isRTL }: InventoryQuickActionLinkProps) {
  return (
    <Link to={to} className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
      <h3 className={cn('font-semibold mb-2', isRTL ? 'text-right' : 'text-left')}>
        {title}
      </h3>
      <p className={cn('text-muted-foreground text-sm', isRTL ? 'text-right' : 'text-left')}>
        {description}
      </p>
    </Link>
  )
}

function InventoryItemQuickActions({ t, isRTL }: Readonly<{ t: TFunction; isRTL: boolean }>) {
  return (
    <>
      <InventoryQuickActionLink
        to="/inventory/items"
        title={t('inventory.items')}
        description="إدارة الأصناف والمواد"
        isRTL={isRTL}
      />
      <InventoryQuickActionLink
        to="/inventory/categories"
        title="فئات المنتجات"
        description="تصنيف المخزون"
        isRTL={isRTL}
      />
    </>
  )
}

function InventoryWarehouseQuickActions({ isRTL }: Readonly<{ isRTL: boolean }>) {
  return (
    <>
      <InventoryQuickActionLink
        to="/inventory/warehouses"
        title="🏭 المخازن (1)"
        description="المخازن الرئيسية"
        isRTL={isRTL}
      />
      <InventoryQuickActionLink
        to="/inventory/locations"
        title="📍 مواقع التخزين (2)"
        description="المناطق والأرفف"
        isRTL={isRTL}
      />
      <InventoryQuickActionLink
        to="/inventory/bins"
        title="📦 صناديق التخزين (3)"
        description="المواقع الدقيقة + باركود"
        isRTL={isRTL}
      />
    </>
  )
}

function InventoryStockMoveQuickActions({ t, isRTL }: Readonly<{ t: TFunction; isRTL: boolean }>) {
  return (
    <>
      <InventoryQuickActionLink
        to="/inventory/movements"
        title={t('inventory.stockMoves')}
        description="متابعة حركات المخزون"
        isRTL={isRTL}
      />
      <InventoryQuickActionLink
        to="/inventory/transfers"
        title="🔄 تحويلات البضاعة"
        description="نقل المخزون بين المستودعات"
        isRTL={isRTL}
      />
    </>
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
      {canReadItems && <InventoryItemQuickActions t={t} isRTL={isRTL} />}
      {canReadStockMoves && <InventoryStockMoveQuickActions t={t} isRTL={isRTL} />}
      {canReadWarehouses && <InventoryWarehouseQuickActions isRTL={isRTL} />}
      {canReadAdjustments && (
        <InventoryQuickActionLink
          to="/inventory/adjustments"
          title={t('inventory.adjustments')}
          description="تسويات المخزون"
          isRTL={isRTL}
        />
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
