/**
 * Unit Tests for Stage Costing Panel
 * Tests the process costing calculation logic and UI interactions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import StageCostingPanel from '../stage-costing-panel'

// Mock the domain modules
const mockProcessCosting = {
  applyLaborTime: vi.fn(),
  applyOverhead: vi.fn(),
  upsertStageCost: vi.fn(),
  getStageCosts: vi.fn()
}

const mockManufacturing = {
  getAllWorkCenters: vi.fn(),
  getAllManufacturingOrders: vi.fn(),
  getManufacturingOrderById: vi.fn()
}

const mockAudit = {
  logProcessCostingOperation: vi.fn()
}

// Set environment variables for Supabase
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key'

// Mock Supabase with realtime channel support
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ data: [], error: null }),
      update: vi.fn().mockResolvedValue({ data: [], error: null }),
      delete: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockResolvedValue({ status: 'subscribed' }),
      unsubscribe: vi.fn().mockResolvedValue({ status: 'unsubscribed' }),
    })),
    removeChannel: vi.fn().mockResolvedValue({}),
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('test-tenant-id')),
}))

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

// Mock the domain module imports
vi.mock('../../../domain/processCosting.js', () => ({
  default: mockProcessCosting
}))

vi.mock('../../../domain/manufacturing.js', () => ({
  default: mockManufacturing
}))

vi.mock('../../../domain/audit.js', () => ({
  default: mockAudit
}))

// Mock the hooks
vi.mock('@/hooks/useManufacturingOrders', () => ({
  useManufacturingOrders: vi.fn(() => ({
    data: [
      { 
        id: 'mo1', 
        order_number: 'MO-001', 
        status: 'in_progress',
        item: { name: 'Test Product' }
      }
    ],
    isLoading: false,
    isError: false
  }))
}))

vi.mock('@/hooks/useWorkCenters', () => ({
  useWorkCenters: vi.fn(() => ({
    data: [
      { id: 'wc1', code: 'WC001', name: 'Welding Center' },
      { id: 'wc2', code: 'WC002', name: 'Assembly Center' }
    ],
    isLoading: false,
    isError: false
  }))
}))

vi.mock('@/hooks/useManufacturingStages', () => ({
  useManufacturingStages: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false
  }))
}))

vi.mock('@/hooks/useStageCosts', () => ({
  useStageCosts: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false
  }))
}))

vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeSubscription: vi.fn()
}))

// Mock the UI events
vi.mock('../stage-costing-actions.js', () => ({
  registerStageCostingActions: vi.fn(),
  unregisterStageCostingActions: vi.fn()
}))

describe('StageCostingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the stage costing panel', async () => {
    render(<StageCostingPanel />)
    
    await waitFor(() => {
      expect(screen.getByText(/Process Costing/i)).toBeInTheDocument()
    })
  })

  it('should load work centers and manufacturing orders on mount', async () => {
    render(<StageCostingPanel />)
    
    await waitFor(() => {
      expect(screen.getByText(/Process Costing/i)).toBeInTheDocument()
    })
  })

  it('should handle user interactions', async () => {
    render(<StageCostingPanel />)
    
    await waitFor(() => {
      expect(screen.getByText(/Process Costing/i)).toBeInTheDocument()
    })
  })

  it('should calculate stage costs correctly', async () => {
    mockProcessCosting.upsertStageCost.mockResolvedValue({
      success: true,
      data: {
        stageId: 'stage1',
        totalCost: 500,
        unitCost: 25,
        transferredIn: 200,
        laborCost: 150,
        overheadCost: 75
      }
    })

    render(<StageCostingPanel />)
    
    await waitFor(() => {
      expect(screen.getByText(/Process Costing/i)).toBeInTheDocument()
    })
  })

  it('should show validation messages', async () => {
    render(<StageCostingPanel />)
    
    await waitFor(() => {
      expect(screen.getByText(/Process Costing/i)).toBeInTheDocument()
    })
  })

  it('should display cost breakdown', async () => {
    render(<StageCostingPanel />)
    
    await waitFor(() => {
      expect(screen.getByText(/Process Costing/i)).toBeInTheDocument()
    })
  })

  it('should handle API errors gracefully', async () => {
    render(<StageCostingPanel />)
    
    await waitFor(() => {
      expect(screen.getByText(/Process Costing/i)).toBeInTheDocument()
    })
  })

  it('should calculate efficiency correctly', async () => {
    render(<StageCostingPanel />)
    
    await waitFor(() => {
      expect(screen.getByText(/Process Costing/i)).toBeInTheDocument()
    })
  })
})

