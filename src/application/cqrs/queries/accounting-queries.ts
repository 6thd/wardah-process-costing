/**
 * @fileoverview Accounting Queries
 * @description استعلامات المحاسبة (CQRS Queries)
 */

import type { IQuery, PaginationParams, SortParams, QueryMetadata } from '../types'

// ===== Query Types =====

export const AccountingQueryTypes = {
  GET_ACCOUNT: 'accounting.getAccount',
  GET_ACCOUNTS: 'accounting.getAccounts',
  GET_JOURNAL_ENTRY: 'accounting.getJournalEntry',
  GET_JOURNAL_ENTRIES: 'accounting.getJournalEntries',
  GET_TRIAL_BALANCE: 'accounting.getTrialBalance',
  GET_ACCOUNT_STATEMENT: 'accounting.getAccountStatement',
  GET_INCOME_STATEMENT: 'accounting.getIncomeStatement',
  GET_BALANCE_SHEET: 'accounting.getBalanceSheet',
  GET_DASHBOARD_METRICS: 'accounting.getDashboardMetrics'
} as const

// ===== Get Account Query =====

export interface GetAccountQuery extends IQuery<GetAccountResult> {
  queryType: typeof AccountingQueryTypes.GET_ACCOUNT
  accountId: string
  includeBalance?: boolean
  asOfDate?: Date
}

export interface GetAccountResult {
  id: string
  code: string
  name: string
  nameEn?: string
  accountType: string
  parentId?: string
  parentName?: string
  description?: string
  level: number
  isActive: boolean
  balance?: number
  debitTotal?: number
  creditTotal?: number
  childAccounts?: AccountSummary[]
}

export interface AccountSummary {
  id: string
  code: string
  name: string
  accountType: string
  balance: number
  isActive: boolean
}

export function createGetAccountQuery(
  params: Omit<GetAccountQuery, 'queryType' | 'timestamp'>
): GetAccountQuery {
  return {
    queryType: AccountingQueryTypes.GET_ACCOUNT,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Accounts Query =====

export interface GetAccountsQuery extends IQuery<GetAccountsResult> {
  queryType: typeof AccountingQueryTypes.GET_ACCOUNTS
  accountType?: string
  parentId?: string
  isActive?: boolean
  searchTerm?: string
  includeBalances?: boolean
  asOfDate?: Date
  pagination?: PaginationParams
}

export interface GetAccountsResult {
  accounts: AccountWithBalance[]
  metadata: QueryMetadata
}

export interface AccountWithBalance {
  id: string
  code: string
  name: string
  nameEn?: string
  accountType: string
  parentId?: string
  level: number
  isActive: boolean
  balance: number
  hasChildren: boolean
}

export function createGetAccountsQuery(
  params: Omit<GetAccountsQuery, 'queryType' | 'timestamp'>
): GetAccountsQuery {
  return {
    queryType: AccountingQueryTypes.GET_ACCOUNTS,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Journal Entry Query =====

export interface GetJournalEntryQuery extends IQuery<GetJournalEntryResult> {
  queryType: typeof AccountingQueryTypes.GET_JOURNAL_ENTRY
  entryId: string
}

export interface GetJournalEntryResult {
  id: string
  entryNumber: string
  date: Date
  reference?: string
  description: string
  status: 'draft' | 'posted' | 'reversed'
  lines: JournalEntryLine[]
  totalDebit: number
  totalCredit: number
  postedAt?: Date
  postedBy?: string
  createdAt: Date
  createdBy?: string
  attachments?: string[]
  reversalOf?: string
  reversedBy?: string
}

export interface JournalEntryLine {
  id: string
  accountId: string
  accountCode: string
  accountName: string
  debit: number
  credit: number
  description?: string
  costCenterId?: string
  costCenterName?: string
}

export function createGetJournalEntryQuery(
  params: Omit<GetJournalEntryQuery, 'queryType' | 'timestamp'>
): GetJournalEntryQuery {
  return {
    queryType: AccountingQueryTypes.GET_JOURNAL_ENTRY,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Journal Entries Query =====

export interface GetJournalEntriesQuery extends IQuery<GetJournalEntriesResult> {
  queryType: typeof AccountingQueryTypes.GET_JOURNAL_ENTRIES
  fromDate?: Date
  toDate?: Date
  status?: 'draft' | 'posted' | 'reversed'
  accountId?: string
  searchTerm?: string
  pagination?: PaginationParams
  sort?: SortParams
}

export interface GetJournalEntriesResult {
  entries: JournalEntrySummary[]
  metadata: QueryMetadata
}

export interface JournalEntrySummary {
  id: string
  entryNumber: string
  date: Date
  reference?: string
  description: string
  status: string
  totalDebit: number
  totalCredit: number
  lineCount: number
  createdAt: Date
}

export function createGetJournalEntriesQuery(
  params: Omit<GetJournalEntriesQuery, 'queryType' | 'timestamp'>
): GetJournalEntriesQuery {
  return {
    queryType: AccountingQueryTypes.GET_JOURNAL_ENTRIES,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Trial Balance Query =====

export interface GetTrialBalanceQuery extends IQuery<GetTrialBalanceResult> {
  queryType: typeof AccountingQueryTypes.GET_TRIAL_BALANCE
  asOfDate: Date
  accountType?: string
  level?: number
  includeZeroBalances?: boolean
}

export interface GetTrialBalanceResult {
  asOfDate: Date
  accounts: TrialBalanceAccount[]
  totals: {
    totalDebit: number
    totalCredit: number
    isBalanced: boolean
  }
}

export interface TrialBalanceAccount {
  accountId: string
  accountCode: string
  accountName: string
  accountType: string
  level: number
  debitBalance: number
  creditBalance: number
  netBalance: number
}

export function createGetTrialBalanceQuery(
  params: Omit<GetTrialBalanceQuery, 'queryType' | 'timestamp'>
): GetTrialBalanceQuery {
  return {
    queryType: AccountingQueryTypes.GET_TRIAL_BALANCE,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Account Statement Query =====

export interface GetAccountStatementQuery extends IQuery<GetAccountStatementResult> {
  queryType: typeof AccountingQueryTypes.GET_ACCOUNT_STATEMENT
  accountId: string
  fromDate: Date
  toDate: Date
  pagination?: PaginationParams
}

export interface GetAccountStatementResult {
  accountId: string
  accountCode: string
  accountName: string
  fromDate: Date
  toDate: Date
  openingBalance: number
  transactions: AccountTransaction[]
  closingBalance: number
  totalDebit: number
  totalCredit: number
  metadata: QueryMetadata
}

export interface AccountTransaction {
  date: Date
  entryId: string
  entryNumber: string
  reference?: string
  description: string
  debit: number
  credit: number
  balance: number
}

export function createGetAccountStatementQuery(
  params: Omit<GetAccountStatementQuery, 'queryType' | 'timestamp'>
): GetAccountStatementQuery {
  return {
    queryType: AccountingQueryTypes.GET_ACCOUNT_STATEMENT,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Income Statement Query =====

export interface GetIncomeStatementQuery extends IQuery<GetIncomeStatementResult> {
  queryType: typeof AccountingQueryTypes.GET_INCOME_STATEMENT
  fromDate: Date
  toDate: Date
  compareWithPreviousPeriod?: boolean
}

export interface GetIncomeStatementResult {
  fromDate: Date
  toDate: Date
  revenue: IncomeStatementSection
  costOfGoodsSold: IncomeStatementSection
  grossProfit: number
  operatingExpenses: IncomeStatementSection
  operatingIncome: number
  otherIncome: IncomeStatementSection
  otherExpenses: IncomeStatementSection
  netIncome: number
  previousPeriod?: {
    grossProfit: number
    operatingIncome: number
    netIncome: number
  }
}

export interface IncomeStatementSection {
  accounts: IncomeStatementAccount[]
  total: number
}

export interface IncomeStatementAccount {
  accountId: string
  accountCode: string
  accountName: string
  amount: number
  percentage?: number
}

export function createGetIncomeStatementQuery(
  params: Omit<GetIncomeStatementQuery, 'queryType' | 'timestamp'>
): GetIncomeStatementQuery {
  return {
    queryType: AccountingQueryTypes.GET_INCOME_STATEMENT,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Dashboard Metrics Query =====

export interface GetDashboardMetricsQuery extends IQuery<GetDashboardMetricsResult> {
  queryType: typeof AccountingQueryTypes.GET_DASHBOARD_METRICS
  period?: 'today' | 'week' | 'month' | 'quarter' | 'year'
}

export interface GetDashboardMetricsResult {
  cashBalance: number
  receivables: number
  payables: number
  revenue: number
  expenses: number
  netIncome: number
  pendingEntries: number
  recentTransactions: RecentTransaction[]
  periodComparison?: {
    revenueChange: number
    expensesChange: number
    netIncomeChange: number
  }
}

export interface RecentTransaction {
  id: string
  date: Date
  description: string
  amount: number
  type: 'debit' | 'credit'
}

export function createGetDashboardMetricsQuery(
  params: Omit<GetDashboardMetricsQuery, 'queryType' | 'timestamp'>
): GetDashboardMetricsQuery {
  return {
    queryType: AccountingQueryTypes.GET_DASHBOARD_METRICS,
    timestamp: new Date(),
    ...params
  }
}

// ===== Union Type =====

export type AccountingQuery =
  | GetAccountQuery
  | GetAccountsQuery
  | GetJournalEntryQuery
  | GetJournalEntriesQuery
  | GetTrialBalanceQuery
  | GetAccountStatementQuery
  | GetIncomeStatementQuery
  | GetDashboardMetricsQuery
