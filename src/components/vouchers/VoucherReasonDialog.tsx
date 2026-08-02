/**
 * Voucher Reason Dialog
 * حوار سبب الإجراء — للإعادة إلى مسودة والإلغاء
 *
 * Both `rpc_reset_*_to_draft` and `rpc_cancel_*` refuse a reason shorter than
 * five characters after trimming. The dialog enforces the same rule before the
 * call so the user is told what is wrong in place, instead of reading it back
 * from a server refusal — the server still re-enforces it.
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export const VOUCHER_REASON_MIN_LENGTH = 5

export type VoucherReasonDialogProps = Readonly<{
  open: boolean
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: 'default' | 'destructive'
  pending?: boolean
  onConfirm: (reason: string) => void | Promise<void>
  onOpenChange: (open: boolean) => void
}>

export function VoucherReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  pending = false,
  onConfirm,
  onOpenChange,
}: VoucherReasonDialogProps) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const trimmed = reason.trim()
  const tooShort = trimmed.length < VOUCHER_REASON_MIN_LENGTH

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="voucher-reason">السبب *</Label>
          <Textarea
            id="voucher-reason"
            rows={3}
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="اكتب سببًا واضحًا يُحفظ في سجل التدقيق"
            aria-invalid={tooShort}
          />
          <p className="text-sm text-muted-foreground">
            {tooShort
              ? `السبب يجب أن يكون ${VOUCHER_REASON_MIN_LENGTH} أحرف على الأقل`
              : 'يُحفظ هذا السبب في سجل التدقيق ولا يمكن تعديله لاحقًا'}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            تراجع
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={tooShort || pending}
            onClick={() => void onConfirm(trimmed)}
          >
            {pending ? 'جاري التنفيذ...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
