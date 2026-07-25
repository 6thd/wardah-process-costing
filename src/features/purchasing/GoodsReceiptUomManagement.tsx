import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { PageHeader } from '@/components/ui/page-header'
import { UomGoodsReceiptForm } from '@/components/forms/UomGoodsReceiptForm'
import { getAllGoodsReceipts } from '@/services/purchasing-service'

interface ReceiptListItem {
  id: string
  receipt_number?: string | null
  receipt_date: string
  status?: string | null
  notes?: string | null
  receiver_name?: string | null
  warehouse_location?: string | null
  vendor?: { name?: string | null } | null
  purchase_order?: { order_number?: string | null } | null
}

function ReceiptStatusBadge({ status }: { status?: string | null }) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    draft: { label: 'مسودة', variant: 'outline' },
    confirmed: { label: 'مؤكد', variant: 'secondary' },
    completed: { label: 'مكتمل', variant: 'default' },
    cancelled: { label: 'ملغى', variant: 'destructive' },
  }
  const config = map[status || ''] ?? { label: status || '—', variant: 'outline' as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}

export function GoodsReceiptUomManagement() {
  const [formOpen, setFormOpen] = useState(false)
  const [receipts, setReceipts] = useState<ReceiptListItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadReceipts = async () => {
    setLoading(true)
    try {
      const result = await getAllGoodsReceipts()
      if (!result.success) throw result.error
      setReceipts((result.data || []) as ReceiptListItem[])
    } catch (error) {
      console.error('Failed to load goods receipts:', error)
      toast.error('تعذر تحميل سندات الاستلام')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReceipts()
  }, [])

  if (loading) return <LoadingSpinner label="جاري تحميل سندات الاستلام…" />

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="استلام البضائع"
          description="استلام جزئي بوحدة أمر الشراء مع تحويل ذري إلى وحدة الأساس"
          hideOnPrint={false}
        />
        <Button onClick={() => setFormOpen(true)}>+ إضافة استلام</Button>
      </div>

      <UomGoodsReceiptForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSuccess={() => {
          void loadReceipts()
        }}
      />

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="font-semibold">سندات الاستلام ({receipts.length})</h3>
          <Badge variant="outline">UoM Atomic GRN</Badge>
        </div>

        <div className="divide-y">
          {receipts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              لا توجد سندات استلام بعد.
            </div>
          ) : (
            receipts.map((receipt) => (
              <div key={receipt.id} className="p-4 transition-colors hover:bg-accent/50">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium">{receipt.receipt_number || 'سند استلام'}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {receipt.vendor?.name || 'مورد غير محدد'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span>📅 {new Date(receipt.receipt_date).toLocaleDateString('en-US')}</span>
                      {receipt.purchase_order?.order_number && (
                        <span>📦 أمر الشراء: {receipt.purchase_order.order_number}</span>
                      )}
                      {receipt.receiver_name && <span>👤 {receipt.receiver_name}</span>}
                      {receipt.warehouse_location && <span>🏭 {receipt.warehouse_location}</span>}
                    </div>
                    {receipt.notes && (
                      <p className="mt-2 text-xs text-muted-foreground">{receipt.notes}</p>
                    )}
                  </div>
                  <ReceiptStatusBadge status={receipt.status} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
