import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { PackageSearch, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUomEngineEnabled } from '@/hooks/use-uom-engine-enabled'
import {
  ProductPickerDialog,
  type PickedProduct,
} from '@/features/manufacturing/components/ProductPickerDialog'
import { ProductUomSettings } from './ProductUomSettings'

const INVENTORY_ITEMS_PATH = '/inventory/items'

/**
 * Route-scoped launcher for the legal UoM master-data dialog.
 * It is fail-closed and renders only on the inventory items page when the
 * active organization has explicitly enabled the UoM engine.
 */
export function InventoryUomSettingsLauncher() {
  const { pathname } = useLocation()
  const { isEnabled, isLoading } = useUomEngineEnabled()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<PickedProduct | null>(null)

  if (pathname !== INVENTORY_ITEMS_PATH || isLoading || !isEnabled) return null

  return (
    <>
      <div
        className="fixed bottom-6 left-6 z-30 flex max-w-[calc(100vw-3rem)] items-center gap-2 rounded-lg border bg-card p-2 shadow-lg"
        dir="rtl"
        aria-label="إدارة وحدات قياس الأصناف"
      >
        {selectedProduct ? (
          <>
            <Badge variant="outline" className="max-w-44 truncate font-mono">
              {selectedProduct.code}
            </Badge>
            <span className="hidden max-w-52 truncate text-sm font-medium sm:inline">
              {selectedProduct.name}
            </span>
            <ProductUomSettings
              itemId={selectedProduct.id}
              productName={selectedProduct.name}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="إلغاء اختيار الصنف"
              onClick={() => setSelectedProduct(null)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => setPickerOpen(true)}>
            <PackageSearch className="ml-2 h-4 w-4" aria-hidden="true" />
            إعداد وحدات صنف
          </Button>
        )}
      </div>

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={setSelectedProduct}
      />
    </>
  )
}
