/**
 * Integration Tests for Accounting Service
 * Phase 6 of TEST_COVERAGE_PLAN.md
 * 
 * Tests the real code from src/services/accounting-service.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Supabase before importing the service
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

// Mock PerformanceMonitor
vi.mock('@/lib/performance-monitor', () => ({
  PerformanceMonitor: {
    measure: vi.fn((name: string, fn: () => Promise<any>) => fn()),
  },
}))

// Import after mocks are set up
import {
  createJournalEntry,
  getAccountEntries,
  calculateAccountBalance,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet,
  getGeneralJournal,
  getAccountStatement,
  type GLEntry,
  type JournalEntry,
} from '../accounting-service'
import { supabase } from '@/lib/supabase'

describe('Integration: Accounting Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================
  // GLEntry Interface Tests
  // ============================================
  describe('GLEntry Interface', () => {
    it('should have correct structure for debit entry', () => {
      const entry: GLEntry = {
        id: 'gl-001',
        account_code: '1101',
        account_name: 'Cash',
        debit: 1000,
        credit: 0,
        description: 'Cash receipt',
        reference_type: 'Receipt',
        reference_id: 'REC-001',
        transaction_date: '2025-01-01',
        fiscal_year: 2025,
        fiscal_period: 1,
      }

      expect(entry.account_code).toBe('1101')
      expect(entry.debit).toBe(1000)
      expect(entry.credit).toBe(0)
      expect(entry.fiscal_year).toBe(2025)
    })

    it('should have correct structure for credit entry', () => {
      const entry: GLEntry = {
        account_code: '4101',
        account_name: 'Sales Revenue',
        debit: 0,
        credit: 1000,
        description: 'Sales invoice',
        reference_type: 'Invoice',
        reference_id: 'INV-001',
        transaction_date: '2025-01-01',
      }

      expect(entry.credit).toBe(1000)
      expect(entry.debit).toBe(0)
    })

    it('should allow optional fields', () => {
      const entry: GLEntry = {
        account_code: '1101',
        account_name: 'Cash',
        debit: 500,
        credit: 0,
        description: 'Test',
        reference_type: 'Test',
        reference_id: 'T-001',
        transaction_date: '2025-01-01',
      }

      expect(entry.id).toBeUndefined()
      expect(entry.fiscal_year).toBeUndefined()
      expect(entry.created_at).toBeUndefined()
    })
  })

  // ============================================
  // JournalEntry Interface Tests
  // ============================================
  describe('JournalEntry Interface', () => {
    it('should have correct structure with entries array', () => {
      const journalEntry: JournalEntry = {
        entry_date: '2025-01-01',
        description: 'Sales Invoice INV-001',
        reference_type: 'Invoice',
        reference_id: 'INV-001',
        entries: [
          {
            account_code: '1201',
            account_name: 'Accounts Receivable',
            debit: 1150,
            credit: 0,
            description: 'Sales Invoice INV-001',
            reference_type: 'Invoice',
            reference_id: 'INV-001',
            transaction_date: '2025-01-01',
          },
          {
            account_code: '4101',
            account_name: 'Sales Revenue',
            debit: 0,
            credit: 1000,
            description: 'Sales Invoice INV-001',
            reference_type: 'Invoice',
            reference_id: 'INV-001',
            transaction_date: '2025-01-01',
          },
          {
            account_code: '2201',
            account_name: 'VAT Payable',
            debit: 0,
            credit: 150,
            description: 'VAT on Sales',
            reference_type: 'Invoice',
            reference_id: 'INV-001',
            transaction_date: '2025-01-01',
          },
        ],
      }

      expect(journalEntry.entries).toHaveLength(3)
      expect(journalEntry.reference_type).toBe('Invoice')
    })
  })

  // ============================================
  // createJournalEntry Tests
  // ============================================
  describe('createJournalEntry', () => {
    it('should reject unbalanced journal entries', async () => {
      const journalEntry: JournalEntry = {
        entry_date: '2025-01-01',
        description: 'Unbalanced entry',
        entries: [
          {
            account_code: '1101',
            account_name: 'Cash',
            debit: 1000,
            credit: 0,
            description: 'Cash',
            reference_type: 'Test',
            reference_id: 'T-001',
            transaction_date: '2025-01-01',
          },
          {
            account_code: '4101',
            account_name: 'Revenue',
            debit: 0,
            credit: 500, // Unbalanced!
            description: 'Revenue',
            reference_type: 'Test',
            reference_id: 'T-001',
            transaction_date: '2025-01-01',
          },
        ],
      }

      const result = await createJournalEntry(journalEntry)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should validate account existence', async () => {
      const journalEntry: JournalEntry = {
        entry_date: '2025-01-01',
        description: 'Test entry',
        entries: [
          {
            account_code: '9999', // Non-existent account
            account_name: 'Unknown',
            debit: 1000,
            credit: 0,
            description: 'Test',
            reference_type: 'Test',
            reference_id: 'T-001',
            transaction_date: '2025-01-01',
          },
          {
            account_code: '4101',
            account_name: 'Revenue',
            debit: 0,
            credit: 1000,
            description: 'Test',
            reference_type: 'Test',
            reference_id: 'T-001',
            transaction_date: '2025-01-01',
          },
        ],
      }

      // Mock account not found
      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } })
      
      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await createJournalEntry(journalEntry)

      expect(result.success).toBe(false)
    })

    it('should create balanced journal entry successfully', async () => {
      const journalEntry: JournalEntry = {
        entry_date: '2025-01-01',
        description: 'Cash Sale',
        reference_type: 'Invoice',
        reference_id: 'INV-001',
        entries: [
          {
            account_code: '1101',
            account_name: 'Cash',
            debit: 1000,
            credit: 0,
            description: 'Cash Sale',
            reference_type: 'Invoice',
            reference_id: 'INV-001',
            transaction_date: '2025-01-01',
          },
          {
            account_code: '4101',
            account_name: 'Sales Revenue',
            debit: 0,
            credit: 1000,
            description: 'Cash Sale',
            reference_type: 'Invoice',
            reference_id: 'INV-001',
            transaction_date: '2025-01-01',
          },
        ],
      }

      // Mock account exists
      const selectChainable: any = {}
      selectChainable.select = vi.fn().mockReturnValue(selectChainable)
      selectChainable.eq = vi.fn().mockReturnValue(selectChainable)
      selectChainable.single = vi.fn().mockResolvedValue({ 
        data: { account_code: '1101', account_name: 'Cash' }, 
        error: null 
      })

      // Mock insert
      const insertChainable: any = {}
      insertChainable.insert = vi.fn().mockReturnValue(insertChainable)
      insertChainable.select = vi.fn().mockResolvedValue({
        data: journalEntry.entries,
        error: null,
      })

      let callCount = 0
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'gl_accounts') {
          return selectChainable
        }
        if (table === 'gl_entries') {
          return insertChainable
        }
        return selectChainable
      })

      const result = await createJournalEntry(journalEntry)

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })

    it('should handle zero tolerance for balance check', async () => {
      const journalEntry: JournalEntry = {
        entry_date: '2025-01-01',
        description: 'Almost balanced',
        entries: [
          {
            account_code: '1101',
            account_name: 'Cash',
            debit: 1000.005,
            credit: 0,
            description: 'Test',
            reference_type: 'Test',
            reference_id: 'T-001',
            transaction_date: '2025-01-01',
          },
          {
            account_code: '4101',
            account_name: 'Revenue',
            debit: 0,
            credit: 1000, // Difference of 0.005
            description: 'Test',
            reference_type: 'Test',
            reference_id: 'T-001',
            transaction_date: '2025-01-01',
          },
        ],
      }

      // Should pass with 0.01 tolerance
      const selectChainable: any = {}
      selectChainable.select = vi.fn().mockReturnValue(selectChainable)
      selectChainable.eq = vi.fn().mockReturnValue(selectChainable)
      selectChainable.single = vi.fn().mockResolvedValue({ 
        data: { account_code: '1101', account_name: 'Cash' }, 
        error: null 
      })

      const insertChainable: any = {}
      insertChainable.insert = vi.fn().mockReturnValue(insertChainable)
      insertChainable.select = vi.fn().mockResolvedValue({
        data: journalEntry.entries,
        error: null,
      })

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'gl_accounts') return selectChainable
        return insertChainable
      })

      const result = await createJournalEntry(journalEntry)
      expect(result.success).toBe(true)
    })
  })

  // ============================================
  // getAccountEntries Tests
  // ============================================
  describe('getAccountEntries', () => {
    it('should fetch entries for a specific account', async () => {
      const mockEntries = [
        { id: '1', account_code: '1101', debit: 1000, credit: 0, transaction_date: '2025-01-01' },
        { id: '2', account_code: '1101', debit: 0, credit: 500, transaction_date: '2025-01-02' },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getAccountEntries('1101')

      expect(result.success).toBe(true)
      expect(result.data).toEqual(mockEntries)
    })

    it('should filter by date range', async () => {
      const mockEntries = [
        { id: '1', account_code: '1101', debit: 1000, credit: 0, transaction_date: '2025-01-15' },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getAccountEntries('1101', '2025-01-01', '2025-01-31')

      expect(result.success).toBe(true)
      expect(chainable.gte).toHaveBeenCalledWith('transaction_date', '2025-01-01')
      expect(chainable.lte).toHaveBeenCalledWith('transaction_date', '2025-01-31')
    })

    it('should handle database errors', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: null, error: { message: 'DB Error' } }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getAccountEntries('1101')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  // ============================================
  // calculateAccountBalance Tests
  // ============================================
  describe('calculateAccountBalance', () => {
    it('should calculate debit balance correctly', async () => {
      const mockEntries = [
        { debit: 1000, credit: 0 },
        { debit: 500, credit: 0 },
        { debit: 0, credit: 200 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await calculateAccountBalance('1101')

      expect(result.success).toBe(true)
      expect(result.totalDebit).toBe(1500)
      expect(result.totalCredit).toBe(200)
      expect(result.balance).toBe(1300) // 1500 - 200
    })

    it('should calculate credit balance correctly', async () => {
      const mockEntries = [
        { debit: 0, credit: 5000 },
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 2000 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await calculateAccountBalance('2101')

      expect(result.success).toBe(true)
      expect(result.balance).toBe(-6000) // 1000 - 7000
    })

    it('should filter by date when provided', async () => {
      const mockEntries = [{ debit: 500, credit: 0 }]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await calculateAccountBalance('1101', '2025-06-30')

      expect(result.success).toBe(true)
      expect(chainable.lte).toHaveBeenCalledWith('transaction_date', '2025-06-30')
    })

    it('should handle empty entries', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await calculateAccountBalance('1101')

      expect(result.success).toBe(true)
      expect(result.totalDebit).toBe(0)
      expect(result.totalCredit).toBe(0)
      expect(result.balance).toBe(0)
    })
  })

  // ============================================
  // getTrialBalance Tests
  // ============================================
  describe('getTrialBalance', () => {
    it('should generate balanced trial balance', async () => {
      const mockAccounts = [
        { account_code: '1101', account_name: 'Cash', account_type: 'Asset' },
        { account_code: '2101', account_name: 'Accounts Payable', account_type: 'Liability' },
      ]

      const mockEntries1101 = [
        { debit: 10000, credit: 0 },
        { debit: 0, credit: 3000 },
      ]

      const mockEntries2101 = [
        { debit: 0, credit: 7000 },
      ]

      // Create mock for gl_accounts
      const accountsChainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockAccounts, error: null }).then(resolve)
      }
      accountsChainable.select = vi.fn().mockReturnValue(accountsChainable)
      accountsChainable.order = vi.fn().mockReturnValue(accountsChainable)

      // Create mock for gl_entries
      const entriesChainable: any = {}
      entriesChainable.select = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.eq = vi.fn().mockImplementation((field: string, value: string) => {
        const result: any = {
          then: (resolve: any) => {
            if (value === '1101') {
              return Promise.resolve({ data: mockEntries1101, error: null }).then(resolve)
            } else if (value === '2101') {
              return Promise.resolve({ data: mockEntries2101, error: null }).then(resolve)
            }
            return Promise.resolve({ data: [], error: null }).then(resolve)
          }
        }
        return result
      })

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'gl_accounts') return accountsChainable
        return entriesChainable
      })

      const result = await getTrialBalance()

      expect(result.success).toBe(true)
      expect(result.balances).toBeDefined()
      expect(result.totals).toBeDefined()
      expect(result.isBalanced).toBeDefined()
    })

    it('should handle database error', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: null, error: { message: 'DB Error' } }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getTrialBalance()

      expect(result.success).toBe(false)
    })
  })

  // ============================================
  // getIncomeStatement Tests
  // ============================================
  describe('getIncomeStatement', () => {
    it('should calculate net income correctly', async () => {
      const mockEntries = [
        { account_code: '4101', account_name: 'Sales Revenue', debit: 0, credit: 50000 },
        { account_code: '4102', account_name: 'Service Revenue', debit: 0, credit: 10000 },
        { account_code: '5101', account_name: 'Cost of Goods Sold', debit: 30000, credit: 0 },
        { account_code: '5201', account_name: 'Salaries Expense', debit: 10000, credit: 0 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)
      chainable.or = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getIncomeStatement('2025-01-01', '2025-12-31')

      expect(result.success).toBe(true)
      expect(result.totalRevenue).toBe(60000) // 50000 + 10000
      expect(result.totalExpense).toBe(40000) // 30000 + 10000
      expect(result.netIncome).toBe(20000) // 60000 - 40000
    })

    it('should calculate profit margin', async () => {
      const mockEntries = [
        { account_code: '4101', account_name: 'Sales', debit: 0, credit: 100000 },
        { account_code: '5101', account_name: 'COGS', debit: 60000, credit: 0 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)
      chainable.or = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getIncomeStatement('2025-01-01', '2025-12-31')

      expect(result.success).toBe(true)
      expect(result.profitMargin).toBe(40) // (40000/100000)*100
    })

    it('should handle zero revenue', async () => {
      const mockEntries: any[] = []

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)
      chainable.or = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getIncomeStatement('2025-01-01', '2025-12-31')

      expect(result.success).toBe(true)
      expect(result.profitMargin).toBe(0) // Avoid division by zero
    })
  })

  // ============================================
  // getBalanceSheet Tests
  // ============================================
  describe('getBalanceSheet', () => {
    it('should separate assets, liabilities, and equity', async () => {
      const mockEntries = [
        { account_code: '1101', account_name: 'Cash', debit: 50000, credit: 10000 },
        { account_code: '1201', account_name: 'Inventory', debit: 30000, credit: 5000 },
        { account_code: '2101', account_name: 'Accounts Payable', debit: 5000, credit: 25000 },
        { account_code: '3101', account_name: 'Capital', debit: 0, credit: 40000 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)
      chainable.or = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getBalanceSheet('2025-12-31')

      expect(result.success).toBe(true)
      expect(result.assets).toBeDefined()
      expect(result.liabilities).toBeDefined()
      expect(result.equity).toBeDefined()
    })

    it('should check accounting equation balance', async () => {
      // Assets = Liabilities + Equity
      const mockEntries = [
        { account_code: '1101', account_name: 'Cash', debit: 100000, credit: 0 },
        { account_code: '2101', account_name: 'Loan', debit: 0, credit: 60000 },
        { account_code: '3101', account_name: 'Capital', debit: 0, credit: 40000 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)
      chainable.or = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getBalanceSheet('2025-12-31')

      expect(result.success).toBe(true)
      expect(result.totalAssets).toBe(100000)
      expect(result.totalLiabilities).toBe(60000)
      expect(result.totalEquity).toBe(40000)
      expect(result.isBalanced).toBe(true) // 100000 = 60000 + 40000
    })
  })

  // ============================================
  // getGeneralJournal Tests
  // ============================================
  describe('getGeneralJournal', () => {
    it('should group entries by reference', async () => {
      const mockEntries = [
        {
          id: '1',
          transaction_date: '2025-01-01',
          reference_type: 'Invoice',
          reference_id: 'INV-001',
          description: 'Sale',
          account_code: '1201',
          debit: 1000,
          credit: 0,
        },
        {
          id: '2',
          transaction_date: '2025-01-01',
          reference_type: 'Invoice',
          reference_id: 'INV-001',
          description: 'Sale',
          account_code: '4101',
          debit: 0,
          credit: 1000,
        },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await getGeneralJournal()

      expect(result.success).toBe(true)
      expect(result.journalEntries).toHaveLength(1) // Grouped into 1 entry
      expect(result.journalEntries![0].entries).toHaveLength(2)
      expect(result.journalEntries![0].totalDebit).toBe(1000)
      expect(result.journalEntries![0].totalCredit).toBe(1000)
    })

    it('should filter by reference type', async () => {
      const mockEntries: any[] = []

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      await getGeneralJournal(undefined, undefined, 'Invoice')

      expect(chainable.eq).toHaveBeenCalledWith('reference_type', 'Invoice')
    })

    it('should filter by date range', async () => {
      const mockEntries: any[] = []

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      await getGeneralJournal('2025-01-01', '2025-12-31')

      expect(chainable.gte).toHaveBeenCalledWith('transaction_date', '2025-01-01')
      expect(chainable.lte).toHaveBeenCalledWith('transaction_date', '2025-12-31')
    })
  })

  // ============================================
  // getAccountStatement Tests
  // ============================================
  describe('getAccountStatement', () => {
    it('should calculate opening balance', async () => {
      const mockAccount = { account_code: '1101', account_name: 'Cash', account_type: 'Asset' }
      const mockOpeningEntries = [
        { debit: 10000, credit: 0 },
        { debit: 0, credit: 2000 },
      ]
      const mockPeriodEntries = [
        { id: '1', debit: 5000, credit: 0, transaction_date: '2025-02-01' },
      ]

      // Mock for account info
      const accountChainable: any = {}
      accountChainable.select = vi.fn().mockReturnValue(accountChainable)
      accountChainable.eq = vi.fn().mockReturnValue(accountChainable)
      accountChainable.single = vi.fn().mockResolvedValue({ data: mockAccount, error: null })

      // Mock for opening balance
      const openingChainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockOpeningEntries, error: null }).then(resolve)
      }
      openingChainable.select = vi.fn().mockReturnValue(openingChainable)
      openingChainable.eq = vi.fn().mockReturnValue(openingChainable)
      openingChainable.lt = vi.fn().mockReturnValue(openingChainable)

      // Mock for period entries
      const entriesChainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockPeriodEntries, error: null }).then(resolve)
      }
      entriesChainable.select = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.eq = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.order = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.gte = vi.fn().mockReturnValue(entriesChainable)

      let callCount = 0
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'gl_accounts') return accountChainable
        callCount++
        if (callCount === 1) return openingChainable
        return entriesChainable
      })

      const result = await getAccountStatement('1101', '2025-02-01')

      expect(result.success).toBe(true)
      expect(result.openingBalance).toBe(8000) // 10000 - 2000
    })

    it('should calculate running balance', async () => {
      const mockAccount = { account_code: '1101', account_name: 'Cash', account_type: 'Asset' }
      const mockEntries = [
        { id: '1', debit: 1000, credit: 0, transaction_date: '2025-01-01' },
        { id: '2', debit: 500, credit: 0, transaction_date: '2025-01-02' },
        { id: '3', debit: 0, credit: 300, transaction_date: '2025-01-03' },
      ]

      const accountChainable: any = {}
      accountChainable.select = vi.fn().mockReturnValue(accountChainable)
      accountChainable.eq = vi.fn().mockReturnValue(accountChainable)
      accountChainable.single = vi.fn().mockResolvedValue({ data: mockAccount, error: null })

      const entriesChainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      entriesChainable.select = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.eq = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.order = vi.fn().mockReturnValue(entriesChainable)

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'gl_accounts') return accountChainable
        return entriesChainable
      })

      const result = await getAccountStatement('1101')

      expect(result.success).toBe(true)
      expect(result.movements).toHaveLength(3)
      expect(result.movements![0].balance).toBe(1000)
      expect(result.movements![1].balance).toBe(1500)
      expect(result.movements![2].balance).toBe(1200)
      expect(result.closingBalance).toBe(1200)
    })

    it('should calculate totals', async () => {
      const mockAccount = { account_code: '1101', account_name: 'Cash', account_type: 'Asset' }
      const mockEntries = [
        { id: '1', debit: 1000, credit: 0, transaction_date: '2025-01-01' },
        { id: '2', debit: 2000, credit: 0, transaction_date: '2025-01-02' },
        { id: '3', debit: 0, credit: 500, transaction_date: '2025-01-03' },
      ]

      const accountChainable: any = {}
      accountChainable.select = vi.fn().mockReturnValue(accountChainable)
      accountChainable.eq = vi.fn().mockReturnValue(accountChainable)
      accountChainable.single = vi.fn().mockResolvedValue({ data: mockAccount, error: null })

      const entriesChainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      entriesChainable.select = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.eq = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.order = vi.fn().mockReturnValue(entriesChainable)

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'gl_accounts') return accountChainable
        return entriesChainable
      })

      const result = await getAccountStatement('1101')

      expect(result.success).toBe(true)
      expect(result.totals).toEqual({ debit: 3000, credit: 500 })
    })

    it('should handle account not found', async () => {
      const accountChainable: any = {}
      accountChainable.select = vi.fn().mockReturnValue(accountChainable)
      accountChainable.eq = vi.fn().mockReturnValue(accountChainable)
      accountChainable.single = vi.fn().mockResolvedValue({ 
        data: null, 
        error: { message: 'Not found' } 
      })

      vi.mocked(supabase.from).mockReturnValue(accountChainable)

      const result = await getAccountStatement('9999')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  // ============================================
  // Edge Cases & Error Handling
  // ============================================
  describe('Edge Cases', () => {
    it('should handle null data gracefully', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await calculateAccountBalance('1101')

      expect(result.success).toBe(true)
      expect(result.totalDebit).toBe(0)
      expect(result.totalCredit).toBe(0)
    })

    it('should handle very large numbers', async () => {
      const mockEntries = [
        { debit: 999999999.99, credit: 0 },
        { debit: 0, credit: 999999999.98 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await calculateAccountBalance('1101')

      expect(result.success).toBe(true)
      expect(result.balance).toBeCloseTo(0.01, 2)
    })

    it('should handle floating point precision', async () => {
      const mockEntries = [
        { debit: 0.1, credit: 0 },
        { debit: 0.2, credit: 0 },
        { debit: 0, credit: 0.3 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await calculateAccountBalance('1101')

      expect(result.success).toBe(true)
      expect(result.balance).toBeCloseTo(0, 2)
    })
  })
})
