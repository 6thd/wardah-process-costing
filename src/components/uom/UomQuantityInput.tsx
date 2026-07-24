import { useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePurchaseProductUoms } from '@/hooks/use-purchase-product-uoms'
import type { ProductUomOption } from '@/services/uom-service'

export interface UomQuantityValue {
  quantityEntered: number
  uomId: string
  factorToBase: number
  baseQuantity: number
}

interface UomQuantityInputProps {
  readonly productId: string | null
  readonly value: UomQuantityValue
  readonly onChange: (value: UomQuantityValue) => void
  readonly disabled?: boolean
  readonly purchaseOnly?: boolean
}

function displayName(option: ProductUomOption) {
  return option.name_ar?.trim() || option.name || option.code
}

function roundBaseQuantity(quantity: number, factor: number) {
  return Math.round(quantity * factor * 1_000_000) / 1_000_000
}

export function UomQuantityInput({
  productId,
  value,
  onChange,
  disabled = false,
  purchaseOnly = false,
}: UomQuantityInputProps) {
  const query = usePurchaseProductUoms(productId)
  const options = useMemo(
    () => (query.data ?? []).filter((option) => !purchaseOnly || option.use_for_purchase),
    [purchaseOnly, query.data],
  )

  useEffect(() => {
    if (!productId || options.length === 0) return
    const current = options.find((option) => option.id === value.uomId)
    if (current) return
    const preferred = options.find((option) => option.use_for_purchase && !option.is_base)
      ?? options.find((option) => option.is_base)
      ?? options[0]
    onChange({
      quantityEntered: value.quantityEntered > 0 ? value.quantityEntered : 1,
      uomId: preferred.id,
      factorToBase: preferred.factor_to_base,
      baseQuantity: roundBaseQuantity(
        value.quantityEntered > 0 ? value.quantityEntered : 1,
        preferred.factor_to_base,
      ),
    })
  }, [onChange, options, productId, value.quantityEntered, value.uomId])

  const selected = options.find((option) => option.id === value.uomId)
  const base = options.find((option) => option.is_base)

  const updateQuantity = (quantityEntered: number) => {
    const factor = selected?.factor_to_base ?? value.factorToBase ?? 1
    onChange({
      quantityEntered,
      uomId: selected?.id ?? value.uomId,
      factorToBase: factor,
      baseQuantity: roundBaseQuantity(quantityEntered, factor),
    })
  }

  const updateUom = (uomId: string) => {
    const next = options.find((option) => option.id === uomId)
    if (!next) return
    onChange({
      quantityEntered: value.quantityEntered,
      uomId: next.id,
      factorToBase: next.factor_to_base,
      baseQuantity: roundBaseQuantity(value.quantityEntered, next.factor_to_base),
    })
  }

  if (!productId) {
    return <div className="text-xs text-muted-foreground">اختر الصنف أولاً</div>
  }

  if (query.isLoading) {
    return <div className="text-xs text-muted-foreground">جاري تحميل الوحدات...</div>
  }

  if (query.isError || options.length === 0) {
    return <div className="text-xs text-destructive">لا توجد وحدة شراء قانونية للصنف</div>
  }

  return (
    <div className="space-y-1.5 min-w-[220px]">
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <Input
          aria-label="الكمية المدخلة"
          type="number"
          min="0.000001"
          step="any"
          value={value.quantityEntered}
          disabled={disabled}
          onChange={(event) => updateQuantity(Number.parseFloat(event.target.value) || 0)}
          className="h-9"
        />
        <Select value={value.uomId || undefined} onValueChange={updateUom} disabled={disabled}>
          <SelectTrigger aria-label="وحدة الشراء" className="h-9">
            <SelectValue placeholder="الوحدة" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {displayName(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {selected && base && (
        <div className="text-xs text-muted-foreground">
          = {value.baseQuantity.toLocaleString(undefined, { maximumFractionDigits: base.decimal_places })}{' '}
          {base.symbol || displayName(base)}
          {selected.factor_to_base !== 1 && (
            <span> · المعامل {selected.factor_to_base.toLocaleString()}</span>
          )}
        </div>
      )}
    </div>
  )
}
