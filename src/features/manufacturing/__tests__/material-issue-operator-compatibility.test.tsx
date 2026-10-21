import { Children, type ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ manage: vi.fn(), from: vi.fn(), rpc: vi.fn(), error: vi.fn() }))
const org = 'ed000000-0000-4000-8000-000000000001'
const mo = 'ed000000-0000-4000-8000-000000000010'
const stage = 'ed000000-0000-4000-8000-0000000000f1'
const product = 'ed000000-0000-4000-8000-0000000000c2'
vi.mock('@/lib/supabase', () => ({ getEffectiveTenantId: async () => org, getTenantId: async () => org,
  getSupabase: async () => ({ from: f.from, rpc: f.rpc }), supabase: { from: f.from, rpc: f.rpc } }))
vi.mock('@/services/manufacturing/materialIssueMaintenance', () => ({ manageMaterialIssueSetup: f.manage }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: f.error } }))
vi.mock('@/components/ui/select', () => {
  const Content = ({ children }: { children: ReactElement }) => children
  return {
    SelectContent: Content,
    Select: ({ children, value, onValueChange }: { children: ReactElement[]; value: string; onValueChange(value: string): void }) =>
      <select value={value} onChange={event => onValueChange(event.target.value)}><option value="" />
        {Children.toArray(children).filter(child => (child as ReactElement).type === Content)}</select>,
    SelectItem: ({ children, value }: { children: string; value: string }) => <option value={value}>{children}</option>,
    SelectTrigger: () => null, SelectValue: () => null,
  }
})
import { createManufacturingOrder } from '../services/manufacturingOrderService'
import { WipLogFormDialog } from '../components/WipLogFormDialog'
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
  f.manage.mockResolvedValue({ id: mo, org_id: org })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
it('routes the product-selector form through the real manufacturing service without inventing an item mapping', async () => {
  const ok = await createManufacturingOrder({ orderNumber: 'Operator', productId: product,
    quantity: '5', status: 'draft', startDate: '', dueDate: '', notes: '' }, key => key)
  expect(ok).toBe(true)
  expect(f.manage).toHaveBeenCalledWith({ operation: 'create_order', materials: [], order: {
    order_number: 'Operator', product_id: product, quantity: 5, start_date: null, due_date: null, notes: null,
  } })
  expect(f.rpc).not.toHaveBeenCalled()
})
function dialog(editing?: { id: string; mo_id: string; stage_id: string }) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <WipLogFormDialog open onOpenChange={vi.fn()} canSubmit editing={editing}
      manufacturingOrders={[{ id: mo, label: 'Operator MO' }]} stages={[{ id: stage, label: 'Operator stage' }]} />
  </QueryClientProvider>)
}
it('the mounted WIP form sends only pristine routing fields through the actual service', async () => {
  dialog()
  const selectors = screen.getAllByRole('combobox')
  fireEvent.change(selectors[0], { target: { value: mo } }); fireEvent.change(selectors[1], { target: { value: stage } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'حفظ' })))
  await waitFor(() => expect(f.manage).toHaveBeenCalled())
  expect(f.manage).toHaveBeenCalledWith({ operation: 'open_stage_wip', mo_id: mo, stage_id: stage,
    period_start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), period_end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  expect(screen.queryByLabelText('تكلفة العمل')).not.toBeInTheDocument()
  expect(f.from).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled()
})
it('isolated WIP editing is visibly held and does not invoke an unreviewed writer', () => {
  dialog({ id: 'wip', mo_id: mo, stage_id: stage })
  expect(screen.queryByRole('button', { name: 'تحديث' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(f.from).not.toHaveBeenCalled(); expect(f.manage).not.toHaveBeenCalled()
})
