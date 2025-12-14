/**
 * @fileoverview Accounting App Service Tests
 * @description اختبارات خدمة تطبيق المحاسبة
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AccountingAppService } from '../AccountingAppService'
import type { 
  IAccountingRepository, 
  GLAccountData, 
  GLEntryData,
  AccountBalanceData,
  TrialBalanceData,
  IncomeStatementData,
  BalanceSheetData,
  AccountStatementData
} from '@/domain/interfaces'

// Mock accounts matching GLAccountData interface
const mockAccounts: GLAccountData[] = [
  {
    id: 'acc-1',
    accountCode: '1100',
    accountName: 'Cash',
    accountNameAr: 'النقدية',
    accountType: 'Asset',
    level: 2,
    isActive: true,
    normalBalance: 'Debit'
  },
  {
    id: 'acc-2',
    accountCode: '2100',
    accountName: 'Accounts Payable',
    accountNameAr: 'الذمم الدائنة',
    accountType: 'Liability',
    level: 2,
    isActive: true,
    normalBalance: 'Credit'
  },
  {
    id: 'acc-3',
    accountCode: '4100',
    accountName: 'Sales Revenue',
    accountNameAr: 'إيرادات المبيعات',
    accountType: 'Revenue',
    level: 2,
    isActive: true,
    normalBalance: 'Credit'
  },
  {
    id: 'acc-4',
    accountCode: '5100',
    accountName: 'Cost of Goods Sold',
    accountNameAr: 'تكلفة البضاعة المباعة',
    accountType: 'Expense',
    level: 2,
    isActive: true,
    normalBalance: 'Debit'
  }
]

const mockBalanceSheet: BalanceSheetData = {
  asOfDate: '2025-01-15',
  assets: [{ accountCode: '1100', accountName: 'Cash', balance: 100000 }],
  liabilities: [{ accountCode: '2100', accountName: 'Accounts Payable', balance: 30000 }],
  equity: [{ accountCode: '3100', accountName: 'Capital', balance: 70000 }],
  totalAssets: 100000,
  totalLiabilities: 30000,
  totalEquity: 70000,
  isBalanced: true
}

const mockIncomeStatement: IncomeStatementData = {
  period: { from: '2025-01-01', to: '2025-01-15' },
  revenues: [{ accountCode: '4100', accountName: 'Sales', amount: 50000 }],
  expenses: [{ accountCode: '5100', accountName: 'COGS', amount: 30000 }],
  totalRevenue: 50000,
  totalExpense: 30000,
  netIncome: 20000,
  profitMargin: 40
}

describe('AccountingAppService', () => {
  let service: AccountingAppService
  let mockRepository: IAccountingRepository

  beforeEach(() => {
    mockRepository = {
      getAccount: vi.fn(),
      getAccounts: vi.fn().mockResolvedValue(mockAccounts),
      createAccount: vi.fn(),
      updateAccount: vi.fn().mockResolvedValue(undefined),
      createJournalEntry: vi.fn(),
      getAccountEntries: vi.fn().mockResolvedValue([]),
      calculateAccountBalance: vi.fn(),
      getTrialBalance: vi.fn(),
      getIncomeStatement: vi.fn().mockResolvedValue(mockIncomeStatement),
      getBalanceSheet: vi.fn().mockResolvedValue(mockBalanceSheet),
      getAccountStatement: vi.fn(),
      getGeneralJournal: vi.fn().mockResolvedValue([]),
      getCurrentFiscalPeriod: vi.fn().mockResolvedValue({ year: 2025, period: 1 }),
      closeFiscalPeriod: vi.fn().mockResolvedValue(undefined)
    }
    
    service = new AccountingAppService(mockRepository)
  })

  describe('getAccounts', () => {
    it('should return paginated accounts', async () => {
      const result = await service.getAccounts({ page: 1, pageSize: 10 })
      
      expect(result.accounts).toHaveLength(4)
      expect(result.total).toBe(4)
      expect(result.hasMore).toBe(false)
    })

    it('should filter by search', async () => {
      const result = await service.getAccounts({ search: 'Cash' })
      
      expect(result.accounts).toHaveLength(1)
      expect(result.accounts[0].accountCode).toBe('1100')
    })

    it('should filter by Arabic name', async () => {
      const result = await service.getAccounts({ search: 'النقدية' })
      
      expect(result.accounts).toHaveLength(1)
      expect(result.accounts[0].accountCode).toBe('1100')
    })

    it('should filter by type', async () => {
      const result = await service.getAccounts({ type: 'Asset' })
      
      expect(mockRepository.getAccounts).toHaveBeenCalledWith({ 
        type: 'Asset', 
        parentCode: undefined, 
        active: undefined 
      })
    })

    it('should filter by level', async () => {
      const result = await service.getAccounts({ level: 2 })
      
      expect(result.accounts.every(a => a.level === 2)).toBe(true)
    })
  })

  describe('getAccount', () => {
    it('should return single account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(mockAccounts[0])
      
      const result = await service.getAccount('1100')
      
      expect(result).toEqual(mockAccounts[0])
      expect(mockRepository.getAccount).toHaveBeenCalledWith('1100')
    })

    it('should return null for non-existent account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(null)
      
      const result = await service.getAccount('9999')
      
      expect(result).toBeNull()
    })
  })

  describe('getAccountsByType', () => {
    it('should return accounts by type', async () => {
      await service.getAccountsByType('Asset')
      
      expect(mockRepository.getAccounts).toHaveBeenCalledWith({ type: 'Asset' })
    })
  })

  describe('searchAccounts', () => {
    it('should search by name', async () => {
      const result = await service.searchAccounts('Cash')
      
      expect(result).toHaveLength(1)
      expect(result[0].accountName).toBe('Cash')
    })

    it('should search by code', async () => {
      const result = await service.searchAccounts('1100')
      
      expect(result).toHaveLength(1)
      expect(result[0].accountCode).toBe('1100')
    })
  })

  describe('createAccount', () => {
    it('should create new account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(null)
      vi.mocked(mockRepository.createAccount).mockResolvedValue({
        id: 'new-acc',
        accountCode: '1200',
        accountName: 'Bank',
        accountType: 'Asset',
        level: 2,
        isActive: true,
        normalBalance: 'Debit'
      })
      
      const result = await service.createAccount({
        accountCode: '1200',
        accountName: 'Bank',
        accountType: 'Asset',
        level: 2,
        isActive: true,
        normalBalance: 'Debit'
      })
      
      expect(result.accountCode).toBe('1200')
    })

    it('should throw error if account exists', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(mockAccounts[0])
      
      await expect(service.createAccount({
        accountCode: '1100',
        accountName: 'Duplicate',
        accountType: 'Asset',
        level: 2,
        isActive: true,
        normalBalance: 'Debit'
      })).rejects.toThrow('الحساب موجود مسبقاً')
    })

    it('should throw error if parent not found', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(null)
      
      await expect(service.createAccount({
        accountCode: '1150',
        accountName: 'Sub Account',
        accountType: 'Asset',
        level: 3,
        isActive: true,
        normalBalance: 'Debit',
        parentCode: '9999'
      })).rejects.toThrow('الحساب الأب غير موجود')
    })
  })

  describe('updateAccount', () => {
    it('should update existing account', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(mockAccounts[0])
      
      await service.updateAccount('1100', { accountName: 'Cash Updated' })
      
      expect(mockRepository.updateAccount).toHaveBeenCalledWith('1100', { accountName: 'Cash Updated' })
    })

    it('should throw error if account not found', async () => {
      vi.mocked(mockRepository.getAccount).mockResolvedValue(null)
      
      await expect(service.updateAccount('9999', { accountName: 'Test' }))
        .rejects.toThrow('الحساب غير موجود')
    })
  })

  describe('createJournalEntry', () => {
    beforeEach(() => {
      vi.mocked(mockRepository.getAccount).mockImplementation(async (code) => {
        const account = mockAccounts.find(a => a.accountCode === code)
        return account || null
      })
    })

    it('should create balanced journal entry', async () => {
      vi.mocked(mockRepository.createJournalEntry).mockResolvedValue({
        success: true,
        data: []
      })
      
      const result = await service.createJournalEntry({
        entryDate: '2025-01-15',
        referenceType: 'manual',
        referenceId: 'JV-001',
        description: 'Test entry',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 1000, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 1000 }
        ]
      })
      
      expect(result.success).toBe(true)
    })

    it('should reject unbalanced entry', async () => {
      const result = await service.createJournalEntry({
        entryDate: '2025-01-15',
        referenceType: 'manual',
        referenceId: 'JV-001',
        description: 'Test entry',
        lines: [
          { accountCode: '1100', accountName: 'Cash', debit: 1000, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 500 }
        ]
      })
      
      expect(result.success).toBe(false)
      expect(result.error).toContain('القيد غير متوازن')
    })

    it('should reject entry with invalid account', async () => {
      const result = await service.createJournalEntry({
        entryDate: '2025-01-15',
        referenceType: 'manual',
        referenceId: 'JV-001',
        description: 'Test entry',
        lines: [
          { accountCode: '9999', accountName: 'Invalid', debit: 1000, credit: 0 },
          { accountCode: '4100', accountName: 'Sales', debit: 0, credit: 1000 }
        ]
      })
      
      expect(result.success).toBe(false)
      expect(result.error).toContain('الحساب غير موجود')
    })
  })

  describe('getAccountBalance', () => {
    it('should return account balance', async () => {
      const balance: AccountBalanceData = {
        accountCode: '1100',
        accountName: 'Cash',
        totalDebit: 10000,
        totalCredit: 3000,
        balance: 7000
      }
      
      vi.mocked(mockRepository.calculateAccountBalance).mockResolvedValue(balance)
      
      const result = await service.getAccountBalance('1100')
      
      expect(result.balance).toBe(7000)
    })

    it('should accept asOfDate parameter', async () => {
      const balance: AccountBalanceData = {
        accountCode: '1100',
        accountName: 'Cash',
        totalDebit: 5000,
        totalCredit: 2000,
        balance: 3000
      }
      
      vi.mocked(mockRepository.calculateAccountBalance).mockResolvedValue(balance)
      
      await service.getAccountBalance('1100', '2025-01-01')
      
      expect(mockRepository.calculateAccountBalance).toHaveBeenCalledWith('1100', '2025-01-01')
    })
  })

  describe('getTrialBalance', () => {
    it('should return trial balance', async () => {
      const trialBalance: TrialBalanceData = {
        balances: [
          { accountCode: '1100', accountName: 'Cash', accountType: 'Asset', debit: 10000, credit: 0, balance: 10000 },
          { accountCode: '2100', accountName: 'Payables', accountType: 'Liability', debit: 0, credit: 5000, balance: -5000 }
        ],
        totals: { totalDebit: 10000, totalCredit: 5000 },
        isBalanced: false
      }
      
      vi.mocked(mockRepository.getTrialBalance).mockResolvedValue(trialBalance)
      
      const result = await service.getTrialBalance()
      
      expect(result.balances).toHaveLength(2)
      expect(result.totals.totalDebit).toBe(10000)
    })
  })

  describe('getIncomeStatement', () => {
    it('should return income statement', async () => {
      const result = await service.getIncomeStatement('2025-01-01', '2025-01-31')
      
      expect(result.totalRevenue).toBe(50000)
      expect(result.totalExpense).toBe(30000)
      expect(result.netIncome).toBe(20000)
    })
  })

  describe('getBalanceSheet', () => {
    it('should return balance sheet', async () => {
      const result = await service.getBalanceSheet('2025-01-15')
      
      expect(result.totalAssets).toBe(100000)
      expect(result.totalLiabilities).toBe(30000)
      expect(result.isBalanced).toBe(true)
    })
  })

  describe('getCurrentFiscalPeriod', () => {
    it('should return current fiscal period', async () => {
      const result = await service.getCurrentFiscalPeriod()
      
      expect(result.year).toBe(2025)
      expect(result.period).toBe(1)
    })
  })

  describe('closeFiscalPeriod', () => {
    it('should close fiscal period', async () => {
      await service.closeFiscalPeriod(2025, 1)
      
      expect(mockRepository.closeFiscalPeriod).toHaveBeenCalledWith(2025, 1)
    })
  })

  describe('getDashboardMetrics', () => {
    it('should return dashboard metrics', async () => {
      const result = await service.getDashboardMetrics()
      
      expect(result.totalAccounts).toBe(4)
      expect(result.activeAccounts).toBe(4)
      expect(result.totalAssets).toBe(100000)
      expect(result.totalLiabilities).toBe(30000)
      expect(result.totalRevenue).toBe(50000)
      expect(result.totalExpenses).toBe(30000)
    })
  })

  describe('getProfitAndLoss', () => {
    it('should return profit and loss summary', async () => {
      const result = await service.getProfitAndLoss('2025-01-01', '2025-01-31')
      
      expect(result.revenue).toBe(50000)
      expect(result.expenses).toBe(30000)
      expect(result.netProfit).toBe(20000)
    })
  })
})
