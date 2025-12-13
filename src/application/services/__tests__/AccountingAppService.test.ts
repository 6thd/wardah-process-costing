/**
 * @fileoverview AccountingAppService Tests
 * @description اختبارات خدمة تطبيق المحاسبة
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AccountingAppService } from '../AccountingAppService'
import type { 
  IAccountingRepository, 
  GLAccountData, 
  GLEntryData,
  JournalEntryData,
  TrialBalanceData,
  IncomeStatementData,
  BalanceSheetData 
} from '@/domain/interfaces'

describe('AccountingAppService', () => {
  let service: AccountingAppService
  let mockRepository: IAccountingRepository

  const mockAccounts: GLAccountData[] = [
    {
      id: 'acc-1',
      code: '1100',
      name: 'النقدية',
      accountType: 'asset',
      parentId: null,
      level: 1,
      isActive: true
    },
    {
      id: 'acc-2',
      code: '2100',
      name: 'الدائنون',
      accountType: 'liability',
      parentId: null,
      level: 1,
      isActive: true
    },
    {
      id: 'acc-3',
      code: '4100',
      name: 'إيرادات المبيعات',
      accountType: 'revenue',
      parentId: null,
      level: 1,
      isActive: true
    },
    {
      id: 'acc-4',
      code: '5100',
      name: 'تكلفة المبيعات',
      accountType: 'expense',
      parentId: null,
      level: 1,
      isActive: false
    }
  ]

  const mockEntries: GLEntryData[] = [
    {
      id: 'entry-1',
      accountId: 'acc-1',
      date: new Date('2025-01-15'),
      debit: 1000,
      credit: 0,
      description: 'إيداع نقدي',
      reference: 'JV-001'
    },
    {
      id: 'entry-2',
      accountId: 'acc-1',
      date: new Date('2025-01-20'),
      debit: 0,
      credit: 500,
      description: 'سحب نقدي',
      reference: 'JV-002'
    }
  ]

  beforeEach(() => {
    mockRepository = {
      getAccount: vi.fn(),
      getAccounts: vi.fn().mockResolvedValue(mockAccounts),
      createAccount: vi.fn(),
      getAccountEntries: vi.fn().mockResolvedValue(mockEntries),
      createJournalEntry: vi.fn(),
      calculateAccountBalance: vi.fn(),
      getTrialBalance: vi.fn(),
      getIncomeStatement: vi.fn(),
      getBalanceSheet: vi.fn(),
      getGeneralJournal: vi.fn()
    }

    service = new AccountingAppService(mockRepository)
  })

  describe('getChartOfAccounts', () => {
    it('should return all accounts', async () => {
      const result = await service.getChartOfAccounts()

      expect(result).toHaveLength(4)
    })

    it('should filter by search term', async () => {
      const result = await service.getChartOfAccounts({ search: 'نقدية' })

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('النقدية')
    })

    it('should filter by account type', async () => {
      const result = await service.getChartOfAccounts({ accountType: 'asset' })

      expect(result).toHaveLength(1)
      expect(result[0].accountType).toBe('asset')
    })

    it('should filter by active status', async () => {
      const result = await service.getChartOfAccounts({ isActive: true })

      expect(result).toHaveLength(3)
      expect(result.every(a => a.isActive)).toBe(true)
    })

    it('should filter by code search', async () => {
      const result = await service.getChartOfAccounts({ search: '1100' })

      expect(result).toHaveLength(1)
      expect(result[0].code).toBe('1100')
    })
  })

  describe('getAccount', () => {
    it('should return single account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(mockAccounts[0])

      const result = await service.getAccount('acc-1')

      expect(result).toEqual(mockAccounts[0])
    })

    it('should return null for non-existent account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(null)

      const result = await service.getAccount('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('getChildAccounts', () => {
    it('should return child accounts', async () => {
      const parentAccount: GLAccountData = {
        id: 'parent',
        code: '1000',
        name: 'الأصول',
        accountType: 'asset',
        parentId: null,
        level: 0,
        isActive: true
      }
      
      const childAccounts: GLAccountData[] = [
        { ...mockAccounts[0], parentId: 'parent' }
      ]

      vi.mocked(mockRepository.getAccounts).mockResolvedValue([
        parentAccount,
        ...childAccounts
      ])

      const result = await service.getChildAccounts('parent')

      expect(result).toHaveLength(1)
      expect(result[0].parentId).toBe('parent')
    })
  })

  describe('createAccount', () => {
    it('should create new account', async () => {
      const newAccount: Omit<GLAccountData, 'id'> = {
        code: '1200',
        name: 'البنك',
        accountType: 'asset',
        parentId: null,
        level: 1,
        isActive: true
      }

      vi.mocked(mockRepository.createAccount).mockResolvedValue({
        id: 'new-acc',
        ...newAccount
      })

      const result = await service.createAccount(newAccount)

      expect(result.id).toBe('new-acc')
      expect(mockRepository.createAccount).toHaveBeenCalledWith(newAccount)
    })

    it('should throw error for duplicate code', async () => {
      const duplicateAccount: Omit<GLAccountData, 'id'> = {
        code: '1100', // already exists
        name: 'حساب جديد',
        accountType: 'asset',
        parentId: null,
        level: 1,
        isActive: true
      }

      await expect(service.createAccount(duplicateAccount))
        .rejects.toThrow('كود الحساب مستخدم بالفعل')
    })
  })

  describe('createJournalEntry', () => {
    it('should create balanced journal entry', async () => {
      vi.mocked(mockRepository.getAccount)
        .mockResolvedValueOnce(mockAccounts[0]) // debit account
        .mockResolvedValueOnce(mockAccounts[1]) // credit account

      const mockEntry: JournalEntryData = {
        id: 'je-1',
        date: new Date(),
        reference: 'JV-001',
        description: 'قيد اختبار',
        lines: [
          { accountId: 'acc-1', debit: 1000, credit: 0 },
          { accountId: 'acc-2', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000
      }

      vi.mocked(mockRepository.createJournalEntry).mockResolvedValue(mockEntry)

      const result = await service.createJournalEntry({
        date: new Date(),
        description: 'قيد اختبار',
        lines: [
          { accountId: 'acc-1', debit: 1000 },
          { accountId: 'acc-2', credit: 1000 }
        ]
      })

      expect(result.id).toBe('je-1')
      expect(result.totalDebit).toBe(1000)
    })

    it('should throw error for unbalanced entry', async () => {
      await expect(service.createJournalEntry({
        date: new Date(),
        description: 'قيد غير متوازن',
        lines: [
          { accountId: 'acc-1', debit: 1000 },
          { accountId: 'acc-2', credit: 500 }
        ]
      })).rejects.toThrow('القيد غير متوازن')
    })

    it('should throw error for non-existent account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(null)

      await expect(service.createJournalEntry({
        date: new Date(),
        description: 'قيد',
        lines: [
          { accountId: 'non-existent', debit: 1000 },
          { accountId: 'acc-2', credit: 1000 }
        ]
      })).rejects.toThrow('الحساب غير موجود')
    })

    it('should throw error for inactive account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(mockAccounts[3]) // inactive

      await expect(service.createJournalEntry({
        date: new Date(),
        description: 'قيد',
        lines: [
          { accountId: 'acc-4', debit: 1000 },
          { accountId: 'acc-2', credit: 1000 }
        ]
      })).rejects.toThrow('الحساب غير نشط')
    })
  })

  describe('getAccountStatement', () => {
    it('should return account statement', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(mockAccounts[0])
      vi.mocked(mockRepository.calculateAccountBalance).mockResolvedValue(500)

      const result = await service.getAccountStatement({
        accountId: 'acc-1',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
        includeOpeningBalance: true
      })

      expect(result.account.id).toBe('acc-1')
      expect(result.entries).toHaveLength(2)
      expect(result.totalDebits).toBe(1000)
      expect(result.totalCredits).toBe(500)
    })

    it('should throw error for non-existent account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(null)

      await expect(service.getAccountStatement({
        accountId: 'non-existent',
        startDate: new Date(),
        endDate: new Date()
      })).rejects.toThrow('الحساب غير موجود')
    })
  })

  describe('getTrialBalance', () => {
    it('should return trial balance', async () => {
      const mockTrialBalance: TrialBalanceData = {
        accounts: [
          { accountId: 'acc-1', accountCode: '1100', accountName: 'النقدية', debit: 1000, credit: 0 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }

      vi.mocked(mockRepository.getTrialBalance).mockResolvedValue(mockTrialBalance)

      const result = await service.getTrialBalance({
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31')
      })

      expect(result.isBalanced).toBe(true)
      expect(mockRepository.getTrialBalance).toHaveBeenCalled()
    })
  })

  describe('getIncomeStatement', () => {
    it('should return income statement', async () => {
      const mockStatement: IncomeStatementData = {
        revenues: [
          { accountId: 'acc-3', accountName: 'إيرادات المبيعات', amount: 50000 }
        ],
        expenses: [
          { accountId: 'acc-4', accountName: 'تكلفة المبيعات', amount: 30000 }
        ],
        totalRevenue: 50000,
        totalExpenses: 30000,
        netIncome: 20000
      }

      vi.mocked(mockRepository.getIncomeStatement).mockResolvedValue(mockStatement)

      const result = await service.getIncomeStatement({
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31')
      })

      expect(result.netIncome).toBe(20000)
    })
  })

  describe('getBalanceSheet', () => {
    it('should return balance sheet', async () => {
      const mockBalanceSheet: BalanceSheetData = {
        assets: [{ accountId: 'acc-1', accountName: 'النقدية', balance: 10000 }],
        liabilities: [{ accountId: 'acc-2', accountName: 'الدائنون', balance: 5000 }],
        equity: [{ accountId: 'acc-5', accountName: 'رأس المال', balance: 5000 }],
        totalAssets: 10000,
        totalLiabilities: 5000,
        totalEquity: 5000
      }

      vi.mocked(mockRepository.getBalanceSheet).mockResolvedValue(mockBalanceSheet)

      const result = await service.getBalanceSheet(new Date())

      expect(result.totalAssets).toBe(10000)
      expect(result.totalAssets).toBe(result.totalLiabilities + result.totalEquity)
    })
  })

  describe('getDashboardMetrics', () => {
    it('should calculate financial metrics', async () => {
      vi.mocked(mockRepository.getBalanceSheet).mockResolvedValue({
        assets: [],
        liabilities: [],
        equity: [],
        totalAssets: 100000,
        totalLiabilities: 40000,
        totalEquity: 60000
      })

      vi.mocked(mockRepository.getIncomeStatement).mockResolvedValue({
        revenues: [],
        expenses: [],
        totalRevenue: 80000,
        totalExpenses: 50000,
        netIncome: 30000
      })

      const result = await service.getDashboardMetrics()

      expect(result.totalAssets).toBe(100000)
      expect(result.totalLiabilities).toBe(40000)
      expect(result.totalEquity).toBe(60000)
      expect(result.netIncome).toBe(30000)
      expect(result.debtToEquityRatio).toBeCloseTo(0.67, 1)
    })
  })

  describe('getGeneralJournal', () => {
    it('should return journal entries', async () => {
      const mockJournal: JournalEntryData[] = [
        {
          id: 'je-1',
          date: new Date(),
          description: 'قيد',
          lines: [],
          totalDebit: 1000,
          totalCredit: 1000
        }
      ]

      vi.mocked(mockRepository.getGeneralJournal).mockResolvedValue(mockJournal)

      const result = await service.getGeneralJournal(
        new Date('2025-01-01'),
        new Date('2025-12-31')
      )

      expect(result).toHaveLength(1)
    })
  })
})
