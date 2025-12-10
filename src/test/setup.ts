/**
 * Test Setup Configuration
 * Global test setup and mocks for the Wardah ERP system
 */

import { beforeAll, afterEach, afterAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  root: Element | Document | null = null
  rootMargin: string = '0px'
  thresholds: ReadonlyArray<number> = [0]
  
  constructor(
    _callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.root = options?.root || null
    this.rootMargin = options?.rootMargin || '0px'
    this.thresholds = options?.threshold 
      ? Array.isArray(options.threshold) 
        ? options.threshold 
        : [options.threshold]
      : [0]
  }
  
  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
}

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
global.localStorage = localStorageMock as Storage

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
global.sessionStorage = sessionStorageMock as Storage

// Mock fetch
global.fetch = vi.fn()

// Mock Supabase (can be overridden in individual tests)
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual('@/lib/supabase')
  return {
    ...actual,
    getSupabase: vi.fn(),
    getEffectiveTenantId: vi.fn(() => Promise.resolve('test-tenant-id'))
  }
})

// Mock Audit Logger (can be overridden in individual tests)
vi.mock('@/lib/audit-logger', () => ({
  logAuditEvent: vi.fn(),
  getAuditLog: vi.fn(() => Promise.resolve([])),
  getAuditRecord: vi.fn(() => Promise.resolve(null))
}))

// Global test helpers
declare global {
  var createTestUser: (overrides?: any) => any
  var createTestGLEntry: (overrides?: any) => any
}

global.createTestUser = (overrides = {}) => ({
  id: 'test-user-id',
  email: 'test@example.com',
  role: 'accountant',
  tenantId: 'test-tenant-id',
  ...overrides
})

global.createTestGLEntry = (overrides = {}) => ({
  id: 'test-entry-id',
  date: '2024-12-01',
  reference: 'TEST-REF-001',
  description: 'Test Entry',
  lines: [
    { account: '1000', debit: 100, credit: 0 },
    { account: '4000', debit: 0, credit: 100 }
  ],
  status: 'DRAFT',
  created_by: 'test-user-id',
  ...overrides
})

// Mock console methods to reduce noise in tests
const originalConsole = { ...console }
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

// Setup and teardown
beforeAll(() => {
  // Any global setup
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

afterAll(() => {
  // Restore console
  global.console = originalConsole
  vi.restoreAllMocks()
})