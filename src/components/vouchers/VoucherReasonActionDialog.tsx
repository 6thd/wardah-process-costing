import { useState } from 'react'
import { toast } from 'sonner'
import { VoucherReasonDialog } from './VoucherReasonDialog'

export type VoucherReasonAction = Readonly<{ kind: 'reset' | 'cancel'; voucherId: string }>

type ActionResult = Readonly<{ success: boolean; duplicate?: boolean; error?: unknown }>

type Props = Readonly<{
  action: VoucherReasonAction | null
  resetDescription: string
  resetVoucher: (voucherId: string, reason: string) => Promise<ActionResult>
  cancelVoucher: (voucherId: string, reason: string) => Promise<ActionResult>
  onClose: () => void
  onChanged: () => void | Promise<void>
}>

export function VoucherReasonActionDialog({
  action,
  resetDescription,
  resetVoucher,
  cancelVoucher,
  onClose,
  onChanged,
}: Props) {
  const [pending, setPending] = useState(false)
  const isReset = action?.kind === 'reset'

  const runAction = async (reason: string) => {
    if (!action || pending) return
    setPending(true)
    try {
      const result = await (isReset ? resetVoucher : cancelVoucher)(action.voucherId, reason)
      if (!result.success) {
        toast.error(String(result.error || (isReset ? 'خطأ في إعادة السند إلى مسودة' : 'خطأ في إلغاء السند')))
        return
      }

      if (result.duplicate) {
        toast.info(isReset ? 'السند مسودة بالفعل' : 'السند ملغى بالفعل')
      } else {
        toast.success(isReset ? 'أُعيد السند إلى مسودة' : 'أُلغي السند')
      }
      onClose()
      await onChanged()
    } catch (error: unknown) {
      toast.error(`خطأ: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <VoucherReasonDialog
      open={Boolean(action)}
      pending={pending}
      title={isReset ? 'إعادة السند إلى مسودة' : 'إلغاء السند'}
      description={isReset ? resetDescription : 'يُنهي دورة السند دون حذف أي تاريخ. لا يمكن التراجع عن الإلغاء.'}
      confirmLabel={isReset ? 'إعادة إلى مسودة' : 'تأكيد الإلغاء'}
      confirmVariant={isReset ? 'default' : 'destructive'}
      onConfirm={runAction}
      onOpenChange={open => {
        if (!open && !pending) onClose()
      }}
    />
  )
}
