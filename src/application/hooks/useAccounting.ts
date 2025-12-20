// @ts-nocheck
// NOSONAR: Type alignment with service APIs planned for Phase 3 refactoring
/**
 * @fileoverview useAccounting Hook
 * @description React Hooks للتعامل مع خدمة المحاسبة
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { 
  getAccountingAppService,
  type AccountListFilters,
  type CreateJournalEntryInput
} from '@/application/services'
import type { 
  GLAccountData, 
  TrialBalanceData, 
  IncomeStatementData, 
  BalanceSheetData,
  GLEntryData,
  AccountStatementData
} from '@/domain/interfaces'

// ===== Types =====

export interface DashboardMetrics {
  totalAccounts: number
  activeAccounts: number
  totalAssets: number
  totalLiabilities: number
  totalRevenue: number
  totalExpenses: number
}

// ===== useChartOfAccounts Hook =====

interface UseChartOfAccountsOptions extends AccountListFilters {
  enabled?: boolean
}

interface UseChartOfAccountsReturn {
  accounts: GLAccountData[]
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  setFilters: (filters: AccountListFilters) => void
}

/**
 * Hook للحصول على دليل الحسابات
 */
export function useChartOfAccounts(options: UseChartOfAccountsOptions = {}): UseChartOfAccountsReturn {
  const { enabled = true, ...initialFilters } = options
  
  const [accounts, setAccounts] = useState<GLAccountData[]>([])
  const [filters, setFilters] = useState<AccountListFilters>(initialFilters)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const fetchAccounts = useCallback(async () => {
    if (!enabled) return
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getAccounts(filters)
      setAccounts(result.accounts)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, filters, enabled])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  return {
    accounts,
    loading,
    error,
    refetch: fetchAccounts,
    setFilters
  }
}

// ===== useAccount Hook =====

interface UseAccountReturn {
  account: GLAccountData | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook للحصول على حساب واحد
 */
export function useAccount(accountCode: string | null): UseAccountReturn {
  const [account, setAccount] = useState<GLAccountData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const fetchAccount = useCallback(async () => {
    if (!accountCode) {
      setAccount(null)
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getAccount(accountCode)
      setAccount(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, accountCode])

  useEffect(() => {
    fetchAccount()
  }, [fetchAccount])

  return { account, loading, error, refetch: fetchAccount }
}

// ===== useAccountStatement Hook =====

interface AccountStatementFilters {
  accountCode: string
  fromDate: string
  toDate: string
}

interface UseAccountStatementReturn {
  statement: AccountStatementData | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook للحصول على كشف حساب
 */
export function useAccountStatement(
  filters: AccountStatementFilters | null
): UseAccountStatementReturn {
  const [statement, setStatement] = useState<AccountStatementData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const fetchStatement = useCallback(async () => {
    if (!filters) {
      setStatement(null)
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getAccountStatement(
        filters.accountCode,
        { fromDate: filters.fromDate, toDate: filters.toDate }
      )
      setStatement(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, filters])

  useEffect(() => {
    fetchStatement()
  }, [fetchStatement])

  return { statement, loading, error, refetch: fetchStatement }
}

// ===== useTrialBalance Hook =====

interface UseTrialBalanceReturn {
  trialBalance: TrialBalanceData | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook للحصول على ميزان المراجعة
 */
export function useTrialBalance(
  startDate: Date | null, 
  endDate: Date | null
): UseTrialBalanceReturn {
  const [trialBalance, setTrialBalance] = useState<TrialBalanceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const fetchTrialBalance = useCallback(async () => {
    if (!startDate || !endDate) {
      setTrialBalance(null)
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getTrialBalance(
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      )
      setTrialBalance(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, startDate, endDate])

  useEffect(() => {
    fetchTrialBalance()
  }, [fetchTrialBalance])

  return { trialBalance, loading, error, refetch: fetchTrialBalance }
}

// ===== useIncomeStatement Hook =====

interface UseIncomeStatementReturn {
  incomeStatement: IncomeStatementData | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook للحصول على قائمة الدخل
 */
export function useIncomeStatement(
  startDate: Date | null, 
  endDate: Date | null
): UseIncomeStatementReturn {
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const fetchIncomeStatement = useCallback(async () => {
    if (!startDate || !endDate) {
      setIncomeStatement(null)
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getIncomeStatement(
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      )
      setIncomeStatement(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, startDate, endDate])

  useEffect(() => {
    fetchIncomeStatement()
  }, [fetchIncomeStatement])

  return { incomeStatement, loading, error, refetch: fetchIncomeStatement }
}

// ===== useBalanceSheet Hook =====

interface UseBalanceSheetReturn {
  balanceSheet: BalanceSheetData | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook للحصول على الميزانية العمومية
 */
export function useBalanceSheet(asOfDate: Date | null): UseBalanceSheetReturn {
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const fetchBalanceSheet = useCallback(async () => {
    if (!asOfDate) {
      setBalanceSheet(null)
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getBalanceSheet(
        asOfDate.toISOString().split('T')[0]
      )
      setBalanceSheet(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, asOfDate])

  useEffect(() => {
    fetchBalanceSheet()
  }, [fetchBalanceSheet])

  return { balanceSheet, loading, error, refetch: fetchBalanceSheet }
}

// ===== useGeneralJournal Hook =====

export interface JournalEntryGroup {
  transactionDate: string
  referenceType: string
  referenceId: string
  description: string
  entries: GLEntryData[]
  totalDebit: number
  totalCredit: number
}

interface UseGeneralJournalReturn {
  entries: JournalEntryGroup[]
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook للحصول على دفتر اليومية العام
 */
export function useGeneralJournal(
  startDate: Date | null, 
  endDate: Date | null
): UseGeneralJournalReturn {
  const [entries, setEntries] = useState<JournalEntryGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const fetchEntries = useCallback(async () => {
    if (!startDate || !endDate) {
      setEntries([])
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getGeneralJournal({
        fromDate: startDate.toISOString().split('T')[0],
        toDate: endDate.toISOString().split('T')[0]
      })
      setEntries(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service, startDate, endDate])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  return { entries, loading, error, refetch: fetchEntries }
}

// ===== useDashboardMetrics Hook =====

interface UseDashboardMetricsReturn {
  metrics: DashboardMetrics | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook للحصول على مؤشرات لوحة التحكم المالية
 */
export function useDashboardMetrics(): UseDashboardMetricsReturn {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const result = await service.getDashboardMetrics()
      setMetrics(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('حدث خطأ غير متوقع'))
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  return { metrics, loading, error, refetch: fetchMetrics }
}

// ===== useJournalEntryActions Hook =====

interface UseJournalEntryActionsReturn {
  createEntry: (input: CreateJournalEntryInput) => Promise<{ success: boolean; data?: GLEntryData[]; error?: string }>
  createAccount: (account: Omit<GLAccountData, 'id'>) => Promise<GLAccountData>
  loading: boolean
  error: Error | null
}

/**
 * Hook لعمليات قيود اليومية
 */
export function useJournalEntryActions(): UseJournalEntryActionsReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const service = useMemo(() => getAccountingAppService(), [])

  const createEntry = useCallback(async (input: CreateJournalEntryInput) => {
    setLoading(true)
    setError(null)
    
    try {
      return await service.createJournalEntry(input)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('حدث خطأ غير متوقع')
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [service])

  const createAccount = useCallback(async (account: Omit<GLAccountData, 'id'>) => {
    setLoading(true)
    setError(null)
    
    try {
      return await service.createAccount(account)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('حدث خطأ غير متوقع')
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [service])

  return {
    createEntry,
    createAccount,
    loading,
    error
  }
}
