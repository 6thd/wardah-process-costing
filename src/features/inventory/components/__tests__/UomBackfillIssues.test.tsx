import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UomBackfillIssues } from '../UomBackfillIssues'

const useUomEngineEnabled = vi.fn()
const useAuth = vi.fn()
const listUnmappedProducts = vi.fn()
const listOpenUomBackfillIssues = vi.fn()
const listUomCatalog = vi.fn()
const assignProductBaseUom = vi.fn()
const resolveUomBackfillIssue = vi.fn()
const ignoreUomBackfillIssue = vi.fn()

// jsdom lacks scrollIntoView, which Radix Select calls when opening.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => useUomEngineEnabled(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuth(),
}))

vi.mock('@/services/uom-master-data-service', () => ({
  listUnmappedProducts: (...args: unknown[]) => listUnmappedProducts(...args),
  listOpenUomBackfillIssues: (...args: unknown[]) => listOpenUomBackfillIssues(...args),
  listUomCatalog: (...args: unknown[]) => listUomCatalog(...args),
  assignProductBaseUom: (...args: unknown[]) => assignProductBaseUom(...args),
  resolveUomBackfillIssue: (...args: unknown[]) => resolveUomBackfillIssue(...args),
  ignoreUomBackfillIssue: (...args: unknown[]) => ignoreUomBackfillIssue(...args),
  // Consumed by the nested ProductUomSettings dialog trigger.
  resolveProductIdForItem: vi.fn(),
  getProductUomMasterProfile: vi.fn(),
  getProductBaseUomChangeGuard: vi.fn(),
  listProductUomConversionHistory: vi.fn(),
}))

vi.mock('@/services/uom-service', () => ({
  convertProductQuantity: vi.fn(),
  saveProductUomConversion: vi.fn(),
  setProductPhysicalWeight: vi.fn(),
}))

vi.mock('@/services/uom-error-mapper', () => ({
  mapUomError: () => ({ code: 'TEST', title: 'خطأ', description: 'وصف', context: {} }),
}))

function renderComponent() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <UomBackfillIssues />
    </QueryClientProvider>,
  )
}

describe('UomBackfillIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ currentOrgId: 'org-1' })
    listUnmappedProducts.mockResolvedValue([
      { id: 'p-1', code: 'A1', name: 'Widget', name_ar: 'ودجة', unit: 'box', uom_migration_status: 'AMBIGUOUS' },
    ])
    listOpenUomBackfillIssues.mockResolvedValue([
      {
        id: 'issue-1', org_id: 'org-1', source_table: 'items', source_id: 'i-1',
        source_value: 'حبة', issue_code: 'UNIT_AMBIGUOUS_OR_UNKNOWN', details: {}, status: 'OPEN',
        resolved_uom_id: null, created_at: '2026-07-22T00:00:00.000Z',
      },
    ])
    listUomCatalog.mockResolvedValue({
      categories: [{ id: 'count', code: 'COUNT', name: 'Count', name_ar: 'عدد', dimension: 'count', is_system: true }],
      uoms: [{
        id: 'piece', code: 'PCS', name: 'Piece', name_ar: 'قطعة', symbol: 'pcs',
        category_id: 'count', is_category_base: true, is_product_specific: false, decimal_places: 6,
      }],
    })
  })

  it('fails closed with a notice while the organization flag is disabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: false })

    renderComponent()

    expect(screen.getByText('محرك الوحدات غير مُفعّل')).toBeInTheDocument()
    expect(listUnmappedProducts).not.toHaveBeenCalled()
  })

  it('lists unmapped products and open issues when enabled', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })

    renderComponent()

    expect(await screen.findByText('ودجة')).toBeInTheDocument()
    expect(screen.getByText('وحدة غير محسومة')).toBeInTheDocument()
    expect(screen.getByText('وحدة غير معروفة أو ملتبسة')).toBeInTheDocument()
    expect(listUnmappedProducts).toHaveBeenCalledWith('org-1')
    expect(listOpenUomBackfillIssues).toHaveBeenCalledWith('org-1')
  })

  it('resolves an issue through the guarded RPC (note optional)', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    resolveUomBackfillIssue.mockResolvedValue(undefined)

    renderComponent()

    fireEvent.click(await screen.findByRole('button', { name: 'حل' }))

    const confirm = await screen.findByRole('button', { name: 'تأكيد الحل' })
    expect(confirm).not.toBeDisabled() // resolve does not require a note
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(resolveUomBackfillIssue).toHaveBeenCalledWith({
        orgId: 'org-1',
        issueId: 'issue-1',
        resolvedUomId: null,
        note: null,
      }),
    )
  })

  it('records an ignore with a mandatory note through the guarded RPC', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    ignoreUomBackfillIssue.mockResolvedValue(undefined)

    renderComponent()

    fireEvent.click(await screen.findByRole('button', { name: 'تجاهل' }))

    const confirm = await screen.findByRole('button', { name: 'تأكيد التجاهل' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/ملاحظة/), { target: { value: 'مقصود' } })
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد التجاهل' }))

    await waitFor(() =>
      expect(ignoreUomBackfillIssue).toHaveBeenCalledWith({
        orgId: 'org-1',
        issueId: 'issue-1',
        note: 'مقصود',
      }),
    )
  })
})
