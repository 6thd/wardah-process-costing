import { usePermissions } from '@/hooks/usePermissions'
import { SupplierInvoiceForm as AtomicSupplierInvoiceForm } from './AtomicSupplierInvoiceForm'

interface SupplierInvoiceFormProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSuccess: () => void | Promise<void>
}

export function SupplierInvoiceForm(props: SupplierInvoiceFormProps) {
  const { hasPermissionKey } = usePermissions()
  const canApprove = hasPermissionKey('purchasing.purchase_invoices.approve')

  return <AtomicSupplierInvoiceForm {...props} canApprove={canApprove} />
}
