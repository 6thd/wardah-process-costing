/**
 * Equivalent Units Dashboard Tests
 */

import { describe, it, vi } from 'vitest'
import { render } from '@/test/test-utils'

import { EquivalentUnitsDashboard } from '../equivalent-units-dashboard'

// Set environment variables for Supabase
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key'

// Mock Supabase
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
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('test-tenant-id')),
}))

// Mock the toast hook
vi.mock('@/components/ui/use-toast', () => ({
  useToast: vi.fn().mockReturnValue({
    toast: vi.fn()
  })
}))

// Mock the useTranslation hook
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en'
    }
  })
}))

describe('EquivalentUnitsDashboard', () => {
  it('renders without crashing', async () => {
    render(<EquivalentUnitsDashboard />)
    // Test passes if component renders without throwing
  }, 10000)
})
