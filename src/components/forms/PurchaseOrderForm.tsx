import { useUomEngineEnabled } from '@/hooks/use-uom-engine-enabled'
import { PurchaseOrderForm as PurchaseOrderLegacyForm } from './PurchaseOrderLegacyForm'
import { PurchaseOrderForm as PurchaseOrderUomForm } from './PurchaseOrderUomForm'

interface PurchaseOrderFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess?: () => void
}

/**
 * يحافظ على مسار أوامر الشراء القائم حتى تفعيل محرك الوحدات للمؤسسة.
 * العلم يضيف المسار الجديد ولا يلغي السلوك التشغيلي القديم أثناء الترحيل.
 */
export function PurchaseOrderForm(props: PurchaseOrderFormProps) {
  const { isEnabled } = useUomEngineEnabled()

  return isEnabled
    ? <PurchaseOrderUomForm {...props} />
    : <PurchaseOrderLegacyForm {...props} />
}
