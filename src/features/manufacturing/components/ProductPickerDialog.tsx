/**
 * منتقي أصناف قابل لإعادة الاستخدام — بحث حي بالكود/الاسم في products (org-scoped)
 * ويعيد الصنف المختار للنموذج المستدعي (BOM، نماذج التصنيع...).
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Package } from 'lucide-react'
import { supabase, getEffectiveTenantId } from '@/lib/supabase'

export interface PickedProduct {
  id: string
  code: string
  name: string
  unit: string | null
  cost_price: number | null
  stock_quantity: number | null
}

/** بحث المنتجات بالكود/الاسم (org-scoped، أول 20 نتيجة). */
export async function searchProducts(term: string): Promise<PickedProduct[]> {
  const orgId = await getEffectiveTenantId()
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة')

  let query = supabase
    .from('products')
    .select('id, code, name, unit, cost_price, stock_quantity')
    .eq('org_id', orgId)
    .order('code')
    .limit(20)

  const t = term.trim()
  if (t) {
    query = query.or(`code.ilike.%${t}%,name.ilike.%${t}%`)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as PickedProduct[]
}

interface ProductPickerDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onPick: (product: PickedProduct) => void
}

export function ProductPickerDialog({ open, onOpenChange, onPick }: ProductPickerDialogProps) {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250)
    return () => clearTimeout(timer)
  }, [term])

  const { data: products, isLoading, isError, error } = useQuery({
    queryKey: ['product-picker', debounced],
    queryFn: () => searchProducts(debounced),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">البحث عن صنف</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="ابحث بالكود أو الاسم..."
            className="pr-9"
          />
        </div>

        <div className="max-h-80 overflow-y-auto divide-y rounded-md border">
          {isLoading && (
            <p className="p-4 text-sm text-muted-foreground text-center">جارٍ البحث…</p>
          )}
          {isError && (
            <p className="p-4 text-sm text-destructive text-center">
              {error instanceof Error ? error.message : 'خطأ في البحث'}
            </p>
          )}
          {!isLoading && !isError && (products ?? []).length === 0 && (
            <div className="p-6 text-center text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
              <p className="text-sm">لا توجد أصناف مطابقة</p>
            </div>
          )}
          {(products ?? []).map((p) => (
            <Button
              key={p.id}
              variant="ghost"
              className="w-full h-auto justify-between rounded-none py-3 px-4"
              onClick={() => {
                onPick(p)
                onOpenChange(false)
                setTerm('')
              }}
            >
              <Badge variant="outline" className="font-mono text-xs">{p.code}</Badge>
              <span className="flex-1 text-right mr-3 truncate">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p.stock_quantity ?? 0} {p.unit ?? ''}
              </span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
