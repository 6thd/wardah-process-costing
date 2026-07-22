import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductUomSettings } from '../ProductUomSettings'

const useUomEngineEnabled = vi.fn()
const useAuth = vi.fn()
const resolveProductIdForItem = vi.fn()

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => useUomEngineEnabled(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuth(),
}))

vi.mock('@/services/uom-master-data-service', () => ({
  resolveProductIdForItem: (...args: unknown[]) => resolveProductIdForItem(...args),
  getProductUomMasterProfile: vi.fn(),
  getProductBaseUomChangeGuard: vi.fn(),
  listUomCatalog: vi.fn(),
}))

vi.mock('@/services/uom-service', () => ({
  convertProductQuantity: vi.fn(),
  saveProductUomConversion: vi.fn(),
  setProductPhysicalWeight: vi.fn(),
}))

vi.mock('@/services/uom-error-mapper', () => ({
  mapUomError: () => ({
    code: 'TEST',
    title: 'خطأ',
    description: 'وصف',
    context: {},
  }),
}))

function renderComponent() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={client}>
      <ProductUomSettings itemId="item-1" productName="صنف تجريبي" />
    </QueryClientProvider>,
  )
}

describe('ProductUomSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ currentOrgId: 'org-1' })
  })

  it('fails closed and renders nothing while the organization flag is disabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: false })

    const { container } = renderComponent()

    expect(container).toBeEmptyDOMElement()
    expect(resolveProductIdForItem).not.toHaveBeenCalled()
  })

  it('exposes the settings action when the organization flag is enabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })

    renderComponent()

    expect(screen.getByRole('button', { name: /إعدادات الوحدات/ })).toBeInTheDocument()
    expect(resolveProductIdForItem).not.toHaveBeenCalled()
  })

  it('fails closed while the flag value is loading', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: true })

    const { container } = renderComponent()

    expect(container).toBeEmptyDOMElement()
  })
})
