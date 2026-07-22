import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductUomSettings } from '../ProductUomSettings'

const useUomEngineEnabled = vi.fn()
const useAuth = vi.fn()
const resolveProductIdForItem = vi.fn()
const getProductUomMasterProfile = vi.fn()
const getProductBaseUomChangeGuard = vi.fn()
const listUomCatalog = vi.fn()
const listProductUomConversionHistory = vi.fn()
const assignProductBaseUom = vi.fn()

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => useUomEngineEnabled(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuth(),
}))

vi.mock('@/services/uom-master-data-service', () => ({
  resolveProductIdForItem: (...args: unknown[]) => resolveProductIdForItem(...args),
  getProductUomMasterProfile: (...args: unknown[]) => getProductUomMasterProfile(...args),
  getProductBaseUomChangeGuard: (...args: unknown[]) => getProductBaseUomChangeGuard(...args),
  listUomCatalog: (...args: unknown[]) => listUomCatalog(...args),
  listProductUomConversionHistory: (...args: unknown[]) => listProductUomConversionHistory(...args),
  assignProductBaseUom: (...args: unknown[]) => assignProductBaseUom(...args),
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
    resolveProductIdForItem.mockResolvedValue('product-1')
    getProductUomMasterProfile.mockResolvedValue({
      product_id: 'product-1',
      org_id: 'org-1',
      base_uom_id: 'piece',
      base_uom: {
        id: 'piece',
        code: 'PCS',
        name: 'Piece',
        name_ar: 'قطعة',
        symbol: 'pcs',
        category_id: 'count',
        is_category_base: true,
        is_product_specific: false,
        decimal_places: 6,
      },
      uom_migration_status: 'MAPPED',
      net_weight: 0.015,
      gross_weight: 0.017,
      weight_uom_id: 'kg',
      weight_uom: {
        id: 'kg',
        code: 'KG',
        name: 'Kilogram',
        name_ar: 'كيلوجرام',
        symbol: 'kg',
        category_id: 'mass',
        is_category_base: true,
        is_product_specific: false,
        decimal_places: 6,
      },
      conversions: [],
    })
    getProductBaseUomChangeGuard.mockResolvedValue({
      has_movements: true,
      base_uom_locked: true,
    })
    listProductUomConversionHistory.mockResolvedValue([])
    assignProductBaseUom.mockResolvedValue(undefined)
    listUomCatalog.mockResolvedValue({
      categories: [
        { id: 'count', code: 'COUNT', name: 'Count', name_ar: 'عدد', dimension: 'count', is_system: true },
        { id: 'mass', code: 'MASS', name: 'Mass', name_ar: 'كتلة', dimension: 'mass', is_system: true },
      ],
      uoms: [
        {
          id: 'piece', code: 'PCS', name: 'Piece', name_ar: 'قطعة', symbol: 'pcs',
          category_id: 'count', is_category_base: true, is_product_specific: false, decimal_places: 6,
        },
        {
          id: 'kg', code: 'KG', name: 'Kilogram', name_ar: 'كيلوجرام', symbol: 'kg',
          category_id: 'mass', is_category_base: true, is_product_specific: false, decimal_places: 6,
        },
      ],
    })
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

  it('offers the base-unit assignment path when unset and no movement exists', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    getProductUomMasterProfile.mockResolvedValue({
      product_id: 'product-1',
      org_id: 'org-1',
      base_uom_id: null,
      base_uom: null,
      uom_migration_status: 'NO_UNIT',
      net_weight: null,
      gross_weight: null,
      weight_uom_id: null,
      weight_uom: null,
      conversions: [],
    })
    getProductBaseUomChangeGuard.mockResolvedValue({ has_movements: false, base_uom_locked: false })

    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByRole('button', { name: 'تعيين وحدة الأساس' })).toBeInTheDocument()
    expect(screen.getByText('غير محددة')).toBeInTheDocument()
    expect(screen.queryByText('الوحدة الأساسية مقفلة')).not.toBeInTheDocument()
  })

  it('loads the legal product profile only after the user opens the dialog', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    renderComponent()

    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByText('الوحدة الأساسية القانونية')).toBeInTheDocument()
    expect(screen.getAllByText('قطعة (pcs)').length).toBeGreaterThan(0)
    expect(screen.getByText('الوحدة الأساسية مقفلة')).toBeInTheDocument()
    expect(screen.getByText('لا توجد تحويلات مخصصة للصنف.')).toBeInTheDocument()
    expect(resolveProductIdForItem).toHaveBeenCalledWith('org-1', 'item-1')
    expect(getProductUomMasterProfile).toHaveBeenCalledWith('org-1', 'product-1')
    expect(getProductBaseUomChangeGuard).toHaveBeenCalledWith('org-1', 'product-1')
    expect(listUomCatalog).toHaveBeenCalledTimes(1)
  })
})
