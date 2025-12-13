/**
 * Integration Tests for SupabaseAccountingRepository
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

import { SupabaseAccountingRepository } from '../SupabaseAccountingRepository'
import { supabase } from '@/lib/supabase'

describe('SupabaseAccountingRepository', () => {
  let repository: SupabaseAccountingRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repository = new SupabaseAccountingRepository()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===== Chart of Accounts =====
  describe('getAccount', () => {
    it('should fetch account by code', async () => {
      const mockAccount = {
        id: 'acc-001',
        account_code: '1101',
        account_name: 'Cash',
        account_name_ar: 'النقدية',
        account_type: 'Asset',
        level: 3,
        is_active: true,
        normal_balance: 'Debit',
      }

      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ data: mockAccount, error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getAccount('1101')

      expect(result).not.toBeNull()
      expect(result?.accountCode).toBe('1101')
      expect(result?.accountType).toBe('Asset')
    })

    it('should return null for non-existent account', async () => {
      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ 
        data: null, 
        error: { code: 'PGRST116', message: 'Not found' } 
      })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getAccount('9999')

      expect(result).toBeNull()
    })
  })

  describe('getAccounts', () => {
    it('should fetch all accounts', async () => {
      const mockAccounts = [
        { id: '1', account_code: '1101', account_name: 'Cash', account_type: 'Asset' },
        { id: '2', account_code: '2101', account_name: 'Accounts Payable', account_type: 'Liability' },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockAccounts, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getAccounts()

      expect(result).toHaveLength(2)
    })

    it('should filter by type', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      await repository.getAccounts({ type: 'Asset' })

      expect(chainable.eq).toHaveBeenCalledWith('account_type', 'Asset')
    })
  })

  describe('createAccount', () => {
    it('should create new account', async () => {
      const newAccount = {
        accountCode: '1102',
        accountName: 'Bank',
        accountType: 'Asset' as const,
        level: 3,
        isActive: true,
        normalBalance: 'Debit' as const,
      }

      const mockResult = {
        id: 'acc-new',
        account_code: '1102',
        account_name: 'Bank',
        account_type: 'Asset',
        level: 3,
        is_active: true,
        normal_balance: 'Debit',
      }

      const chainable: any = {}
      chainable.insert = vi.fn().mockReturnValue(chainable)
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ data: mockResult, error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.createAccount(newAccount)

      expect(result.accountCode).toBe('1102')
    })
  })

  // ===== Journal Entries =====
  describe('createJournalEntry', () => {
    it('should reject unbalanced entries', async () => {
      const entry = {
        entryDate: '2025-01-01',
        description: 'Test',
        entries: [
          { accountCode: '1101', accountName: 'Cash', debit: 1000, credit: 0, description: '', referenceType: '', referenceId: '', transactionDate: '' },
          { accountCode: '4101', accountName: 'Revenue', debit: 0, credit: 500, description: '', referenceType: '', referenceId: '', transactionDate: '' },
        ],
      }

      const result = await repository.createJournalEntry(entry)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should create balanced entry', async () => {
      const entry = {
        entryDate: '2025-01-01',
        description: 'Cash Sale',
        referenceType: 'Invoice',
        referenceId: 'INV-001',
        entries: [
          { accountCode: '1101', accountName: 'Cash', debit: 1000, credit: 0, description: 'Cash', referenceType: '', referenceId: '', transactionDate: '' },
          { accountCode: '4101', accountName: 'Revenue', debit: 0, credit: 1000, description: 'Revenue', referenceType: '', referenceId: '', transactionDate: '' },
        ],
      }

      // Mock getAccount
      const accountChainable: any = {}
      accountChainable.select = vi.fn().mockReturnValue(accountChainable)
      accountChainable.eq = vi.fn().mockReturnValue(accountChainable)
      accountChainable.single = vi.fn().mockResolvedValue({ 
        data: { account_code: '1101', account_name: 'Cash' }, 
        error: null 
      })

      // Mock insert
      const insertChainable: any = {}
      insertChainable.insert = vi.fn().mockReturnValue(insertChainable)
      insertChainable.select = vi.fn().mockResolvedValue({
        data: entry.entries.map((e, i) => ({ id: `e-${i}`, ...e })),
        error: null,
      })

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'gl_accounts') return accountChainable
        return insertChainable
      })

      const result = await repository.createJournalEntry(entry)

      expect(result.success).toBe(true)
    })
  })

  describe('getAccountEntries', () => {
    it('should fetch entries for account', async () => {
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

      const result = await repository.getAccountEntries('1101')

      expect(result).toHaveLength(2)
    })

    it('should filter by date range', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      await repository.getAccountEntries('1101', { fromDate: '2025-01-01', toDate: '2025-12-31' })

      expect(chainable.gte).toHaveBeenCalledWith('transaction_date', '2025-01-01')
      expect(chainable.lte).toHaveBeenCalledWith('transaction_date', '2025-12-31')
    })
  })

  // ===== Account Balances =====
  describe('calculateAccountBalance', () => {
    it('should calculate balance correctly', async () => {
      const mockEntries = [
        { debit: 1000, credit: 0 },
        { debit: 500, credit: 0 },
        { debit: 0, credit: 200 },
      ]

      // Mock for entries
      const entriesChainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      entriesChainable.select = vi.fn().mockReturnValue(entriesChainable)
      entriesChainable.eq = vi.fn().mockReturnValue(entriesChainable)

      // Mock for account
      const accountChainable: any = {}
      accountChainable.select = vi.fn().mockReturnValue(accountChainable)
      accountChainable.eq = vi.fn().mockReturnValue(accountChainable)
      accountChainable.single = vi.fn().mockResolvedValue({ 
        data: { account_code: '1101', account_name: 'Cash' }, 
        error: null 
      })

      let callCount = 0
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'gl_entries') return entriesChainable
        return accountChainable
      })

      const result = await repository.calculateAccountBalance('1101')

      expect(result.totalDebit).toBe(1500)
      expect(result.totalCredit).toBe(200)
      expect(result.balance).toBe(1300)
    })
  })

  // ===== Financial Reports =====
  describe('getIncomeStatement', () => {
    it('should calculate income statement', async () => {
      const mockEntries = [
        { account_code: '4101', account_name: 'Sales', debit: 0, credit: 50000 },
        { account_code: '5101', account_name: 'COGS', debit: 30000, credit: 0 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)
      chainable.or = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getIncomeStatement('2025-01-01', '2025-12-31')

      expect(result.totalRevenue).toBe(50000)
      expect(result.totalExpense).toBe(30000)
      expect(result.netIncome).toBe(20000)
      expect(result.profitMargin).toBe(40)
    })
  })

  describe('getBalanceSheet', () => {
    it('should calculate balance sheet', async () => {
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

      const result = await repository.getBalanceSheet('2025-12-31')

      expect(result.totalAssets).toBe(100000)
      expect(result.totalLiabilities).toBe(60000)
      expect(result.totalEquity).toBe(40000)
      expect(result.isBalanced).toBe(true)
    })
  })

  describe('getGeneralJournal', () => {
    it('should group entries by reference', async () => {
      const mockEntries = [
        { id: '1', transaction_date: '2025-01-01', reference_type: 'INV', reference_id: 'INV-001', description: 'Sale', account_code: '1101', debit: 1000, credit: 0 },
        { id: '2', transaction_date: '2025-01-01', reference_type: 'INV', reference_id: 'INV-001', description: 'Sale', account_code: '4101', debit: 0, credit: 1000 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockEntries, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getGeneralJournal()

      expect(result).toHaveLength(1)
      expect(result[0].entries).toHaveLength(2)
      expect(result[0].totalDebit).toBe(1000)
      expect(result[0].totalCredit).toBe(1000)
    })
  })

  // ===== Fiscal Period =====
  describe('getCurrentFiscalPeriod', () => {
    it('should return current fiscal period', async () => {
      const result = await repository.getCurrentFiscalPeriod()

      expect(result.year).toBe(new Date().getFullYear())
      expect(result.period).toBeGreaterThanOrEqual(1)
      expect(result.period).toBeLessThanOrEqual(12)
    })
  })
})
