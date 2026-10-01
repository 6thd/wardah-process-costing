import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en/translation.json'
import '@/globals.css'
import { MaterialIssuePage } from '@/features/manufacturing/material-issue/MaterialIssuePage'
import { WipLogFormDialog } from '@/features/manufacturing/components/WipLogFormDialog'
import { createManufacturingOrder } from '@/features/manufacturing/services/manufacturingOrderService'
import { manufacturingService } from '@/services/supabase-service'
import { createMaterialIssueWorkOrder, updateWorkOrderStatus } from '@/services/manufacturing/mesService'
import { inventoryTransactionService } from '@/services/inventory-transaction-service'
import { changeIdentity, ids } from '../material-issue-browser/identity'
changeIdentity({ prepare: true, grant: true })
Object.assign(window, { __operator: {
  create: () => createManufacturingOrder({ orderNumber: 'MO-OPERATOR-COMBINED', productId: 'ed000000-0000-4000-8000-0000000000c2',
    quantity: '5', status: 'draft', startDate: '', dueDate: '', notes: '' }, key => key),
  async prepare(mo: string) {
    await manufacturingService.updateStatus(mo, 'confirmed')
    await manufacturingService.updateStatus(mo, 'in_progress')
    const wo = await createMaterialIssueWorkOrder(mo, 'ed000000-0000-4000-8000-0000000000f2', 'Manual issue preparation', 5)
    await updateWorkOrderStatus(wo.id, 'IN_PROGRESS')
    await inventoryTransactionService.reserveMaterials(mo, [{ item_id: ids.item, quantity: 25 }])
    return wo.id
  },
  release: (id: string) => inventoryTransactionService.releaseReservation(id),
} })
void i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
function App() {
  const [wip, setWip] = useState(false); const [mo, setMo] = useState('')
  return <>
    <label>Fixture order ID<input aria-label="Fixture order ID" value={mo} onChange={e => setMo(e.target.value)} /></label>
    <button onClick={() => setWip(true)}>Open stage form</button>
    <MaterialIssuePage />
    <WipLogFormDialog open={wip} onOpenChange={setWip} canSubmit
      manufacturingOrders={mo ? [{ id: mo, label: 'Combined MO' }] : []} stages={[{ id: ids.stage, label: 'Combined stage' }]} />
  </>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>)
