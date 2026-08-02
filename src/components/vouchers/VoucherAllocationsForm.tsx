import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type VoucherAllocationLine = {
  invoice_id: string
  allocated_amount: number
  discount_amount?: number
}

type Invoice = {
  id: string
  invoice_number?: string
  total_amount?: number | null
  outstanding_balance?: number | null
}

type Result<T> = { success: boolean; data?: T; error?: string }

const NO_ALLOCATION_LINES: VoucherAllocationLine[] = []

type Props = Readonly<{
  voucherId?: string
  scopeId: string
  voucherAmount: number
  currentLines?: VoucherAllocationLine[]
  emptyMessage: string
  loadInvoices: (scopeId: string) => Promise<Result<Invoice[]>>
  updateDraft: (voucherId: string, input: { amount: number; lines: VoucherAllocationLine[] }) => Promise<Result<unknown>>
  onSuccess: () => void
  onCancel: () => void
}>

export function VoucherAllocationsForm({
  voucherId,
  scopeId,
  voucherAmount,
  currentLines = NO_ALLOCATION_LINES,
  emptyMessage,
  loadInvoices,
  updateDraft,
  onSuccess,
  onCancel,
}: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [allocations, setAllocations] = useState<Record<string, number>>(() =>
    Object.fromEntries(currentLines.map(line => [line.invoice_id, Number(line.allocated_amount) || 0])),
  )
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const load = async () => {
      const result = await loadInvoices(scopeId)
      const open = result.success && result.data ? result.data : []
      const known = new Set(open.map(invoice => invoice.id))
      const allocatedButClosed = currentLines
        .filter(line => !known.has(line.invoice_id))
        .map(line => ({ id: line.invoice_id, invoice_number: line.invoice_id }))
      setInvoices([...open, ...allocatedButClosed])
    }
    void load()
  }, [currentLines, loadInvoices, scopeId])

  const total = useMemo(
    () => Object.values(allocations).reduce((sum, value) => sum + (value || 0), 0),
    [allocations],
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!voucherId || pending) return
    const lines = Object.entries(allocations)
      .filter(([, amount]) => amount > 0)
      .map(([invoice_id, allocated_amount]) => ({ invoice_id, allocated_amount, discount_amount: 0 }))

    setPending(true)
    try {
      const result = await updateDraft(voucherId, {
        amount: lines.length > 0 ? total : voucherAmount,
        lines,
      })
      if (!result.success) {
        toast.error(result.error || 'خطأ في تعديل المسودة')
        return
      }
      toast.success(lines.length === 0 ? 'حُذفت كل سطور التخصيص' : `حُفظت ${lines.length} سطر تخصيص`)
      onSuccess()
    } catch (error: unknown) {
      toast.error(`خطأ: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Table>
        <TableHeader><TableRow><TableHead>رقم الفاتورة</TableHead><TableHead>الإجمالي</TableHead><TableHead>المتبقي</TableHead><TableHead>المخصص</TableHead></TableRow></TableHeader>
        <TableBody>
          {invoices.length === 0 ? (
            <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">{emptyMessage}</TableCell></TableRow>
          ) : invoices.map(invoice => (
            <TableRow key={invoice.id}>
              <TableCell>{invoice.invoice_number || invoice.id}</TableCell>
              <TableCell>{invoice.total_amount != null ? `${Number(invoice.total_amount).toFixed(2)} ريال` : '-'}</TableCell>
              <TableCell>{invoice.outstanding_balance != null ? `${Number(invoice.outstanding_balance).toFixed(2)} ريال` : '-'}</TableCell>
              <TableCell><Input type="number" step="0.01" min={0} value={allocations[invoice.id] || 0} onChange={event => setAllocations(previous => ({ ...previous, [invoice.id]: Number.parseFloat(event.target.value) || 0 }))} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between rounded-md border p-3"><span className="text-sm text-muted-foreground">إجمالي التخصيصات</span><span className="font-medium">{total.toFixed(2)} ريال</span></div>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel} disabled={pending}>تراجع</Button><Button type="submit" disabled={pending}>{pending ? 'جاري الحفظ...' : 'حفظ التعديل'}</Button></div>
    </form>
  )
}
