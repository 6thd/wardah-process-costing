/**
 * IAccountingRepository - Domain Interface (Port)
 * 
 * واجهة المحاسبة للفصل بين طبقة المجال وطبقة البنية التحتية
 */

// ===== Types =====

export interface GLAccountData {
  id: string
  accountCode: string
  accountName: string
  accountNameAr?: string
  accountType: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense'
  parentCode?: string
  level: number
  isActive: boolean
  normalBalance: 'Debit' | 'Credit'
  currency?: string
}

export interface GLEntryData {
  id?: string
  accountCode: string
  accountName: string
  debit: number
  credit: number
  description: string
  referenceType: string
  referenceId: string
  transactionDate: string
  fiscalYear?: number
  fiscalPeriod?: number
  createdAt?: string
  createdBy?: string
}

export interface JournalEntryData {
  entryDate: string
  description: string
  referenceType?: string
  referenceId?: string
  entries: GLEntryData[]
}

export interface AccountBalanceData {
  accountCode: string
  accountName: string
  totalDebit: number
  totalCredit: number
  balance: number
}

export interface TrialBalanceData {
  balances: Array<{
    accountCode: string
    accountName: string
    accountType: string
    debit: number
    credit: number
    balance: number
  }>
  totals: {
    totalDebit: number
    totalCredit: number
  }
  isBalanced: boolean
}

export interface IncomeStatementData {
  period: { from: string; to: string }
  revenues: Array<{ accountCode: string; accountName: string; amount: number }>
  expenses: Array<{ accountCode: string; accountName: string; amount: number }>
  totalRevenue: number
  totalExpense: number
  netIncome: number
  profitMargin: number
}

export interface BalanceSheetData {
  asOfDate: string
  assets: Array<{ accountCode: string; accountName: string; balance: number }>
  liabilities: Array<{ accountCode: string; accountName: string; balance: number }>
  equity: Array<{ accountCode: string; accountName: string; balance: number }>
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  isBalanced: boolean
}

export interface AccountStatementData {
  account: GLAccountData
  openingBalance: number
  movements: Array<GLEntryData & { balance: number }>
  closingBalance: number
  totals: { debit: number; credit: number }
}

// ===== Interface =====

export interface IAccountingRepository {
  // Chart of Accounts
  getAccount(accountCode: string): Promise<GLAccountData | null>
  getAccounts(filters?: { type?: string; parentCode?: string; active?: boolean }): Promise<GLAccountData[]>
  createAccount(account: Omit<GLAccountData, 'id'>): Promise<GLAccountData>
  updateAccount(accountCode: string, data: Partial<GLAccountData>): Promise<void>

  // Journal Entries
  createJournalEntry(entry: JournalEntryData): Promise<{ success: boolean; data?: GLEntryData[]; error?: any }>
  getAccountEntries(
    accountCode: string,
    options?: { fromDate?: string; toDate?: string }
  ): Promise<GLEntryData[]>
  
  // Account Balances
  calculateAccountBalance(accountCode: string, upToDate?: string): Promise<AccountBalanceData>

  // Financial Reports
  getTrialBalance(fromDate?: string, toDate?: string): Promise<TrialBalanceData>
  getIncomeStatement(fromDate: string, toDate: string): Promise<IncomeStatementData>
  getBalanceSheet(asOfDate: string): Promise<BalanceSheetData>
  getAccountStatement(
    accountCode: string,
    options?: { fromDate?: string; toDate?: string }
  ): Promise<AccountStatementData>

  // General Journal
  getGeneralJournal(options?: {
    fromDate?: string
    toDate?: string
    referenceType?: string
  }): Promise<Array<{
    transactionDate: string
    referenceType: string
    referenceId: string
    description: string
    entries: GLEntryData[]
    totalDebit: number
    totalCredit: number
  }>>

  // Fiscal Period
  getCurrentFiscalPeriod(): Promise<{ year: number; period: number }>
  closeFiscalPeriod(year: number, period: number): Promise<void>
}
