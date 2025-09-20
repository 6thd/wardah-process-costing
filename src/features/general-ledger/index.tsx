import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { getSupabase, JournalEntry, Account, GLAccount, getAllGLAccounts, getEffectiveTenantId } from '@/lib/supabase'
import { toast } from 'sonner'
import { 
  BookOpen, 
  FileText, 
  TrendingUp, 
  Calculator, 
  CheckCircle, 
  Clock, 
  AlertTriangle,
  Search,
  Filter,
  Eye,
  RotateCcw,
  Plus
} from 'lucide-react'

export function GeneralLedgerModule() {
  return (
    <Routes>
      <Route path="/" element={<GLOverview />} />
      <Route path="/overview" element={<GLOverview />} />
      <Route path="/accounts" element={<ChartOfAccounts />} />
      <Route path="/entries" element={<JournalEntries />} />
      <Route path="/entries/:id" element={<JournalEntryDetails />} />
      <Route path="/trial-balance" element={<TrialBalance />} />
      <Route path="/posting" element={<PostingManagement />} />
      <Route path="*" element={<Navigate to="/general-ledger/overview" replace />} />
    </Routes>
  )
}

function GLOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [summary, setSummary] = useState({
    totalEntries: 0,
    postedEntries: 0,
    unpostedEntries: 0,
    totalDebit: 0,
    totalCredit: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSummary()
  }, [])

  const loadSummary = async () => {
    try {
      const client = await getSupabase();
      if (!client) throw new Error('Supabase client not initialized');
      
      const { data: entries, error } = await client
        .from('journal_entries')
        .select('status, total_debit, total_credit')

      if (error) throw error

      const posted = entries?.filter((e: Pick<JournalEntry, 'status'>) => e.status === 'posted') || []
      const unposted = entries?.filter((e: Pick<JournalEntry, 'status'>) => e.status === 'draft') || []
      const totalDebit = posted.reduce((sum: number, e: Pick<JournalEntry, 'total_debit'>) => sum + (e.total_debit || 0), 0)
      const totalCredit = posted.reduce((sum: number, e: Pick<JournalEntry, 'total_credit'>) => sum + (e.total_credit || 0), 0)

      setSummary({
        totalEntries: entries?.length || 0,
        postedEntries: posted.length,
        unpostedEntries: unposted.length,
        totalDebit,
        totalCredit
      })
    } catch (error) {
      console.error('Error loading GL summary:', error)
      toast.error('خطأ في تحميل ملخص دفتر الأستاذ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">دفتر الأستاذ العام</h1>
        <p className="text-muted-foreground mt-2">
          إدارة القيود المحاسبية ودفتر الأستاذ العام
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{summary.totalEntries}</div>
          <div className="text-sm text-muted-foreground">إجمالي القيود</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{summary.postedEntries}</div>
          <div className="text-sm text-muted-foreground">قيود منشورة</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-amber-600">{summary.unpostedEntries}</div>
          <div className="text-sm text-muted-foreground">قيود مسودة</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-purple-600">{summary.totalDebit.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">إجمالي المدين</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-indigo-600">{summary.totalCredit.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">إجمالي الدائن</div>
        </div>
      </div>

      {/* GL Functions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link to="/general-ledger/accounts" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <BookOpen className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold", isRTL ? "text-right" : "text-left")}>
              شجرة الحسابات
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إدارة وتحرير شجرة الحسابات المحاسبية
          </p>
        </Link>

        <Link to="/general-ledger/entries" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <FileText className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold", isRTL ? "text-right" : "text-left")}>
              القيود اليومية
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            عرض وإدارة جميع القيود المحاسبية
          </p>
        </Link>

        <Link to="/general-ledger/trial-balance" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <Calculator className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold", isRTL ? "text-right" : "text-left")}>
              ميزان المراجعة
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            ميزان المراجعة وأرصدة الحسابات
          </p>
        </Link>

        <Link to="/general-ledger/posting" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <CheckCircle className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold", isRTL ? "text-right" : "text-left")}>
              إدارة النشر
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            نشر وعكس القيود المحاسبية
          </p>
        </Link>

        <div className="bg-card rounded-lg border p-6">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <TrendingUp className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold", isRTL ? "text-right" : "text-left")}>
              التقارير المالية
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            قائمة الدخل والميزانية العمومية
          </p>
        </div>

        <div className="bg-card rounded-lg border p-6">
          <div className={cn("flex items-center gap-3 mb-3", isRTL ? "flex-row-reverse" : "")}>
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h3 className={cn("font-semibold", isRTL ? "text-right" : "text-left")}>
              إقفال الفترة
            </h3>
          </div>
          <p className={cn("text-muted-foreground text-sm", isRTL ? "text-right" : "text-left")}>
            إقفال الفترات المحاسبية وإعداد الميزانية
          </p>
        </div>
      </div>

      {/* Recent Entries */}
      <RecentEntries />
    </div>
  )
}

function RecentEntries() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRecentEntries()
  }, [])

  const loadRecentEntries = async () => {
    try {
      const client = await getSupabase();
      if (!client) throw new Error('Supabase client not initialized');
      
      const { data, error } = await client
        .from('journal_entries')
        .select(`
          *,
          journals(name, name_ar)
        `)
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) throw error
      setEntries(data || [])
    } catch (error) {
      console.error('Error loading recent entries:', error)
      toast.error('خطأ في تحميل القيود الأخيرة')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline">مسودة</Badge>
      case 'posted':
        return <Badge variant="default">منشور</Badge>
      case 'reversed':
        return <Badge variant="destructive">معكوس</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (loading) {
    return (
      <div className="bg-card rounded-lg border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-1/4"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg border">
      <div className="p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold">القيود الأخيرة</h3>
        <Link to="/general-ledger/entries">
          <Button variant="outline" size="sm">عرض الكل</Button>
        </Link>
      </div>
      <div className="divide-y">
        {entries.map((entry) => (
          <Link
            key={entry.id}
            to={`/general-ledger/entries/${entry.id}`}
            className="block p-4 hover:bg-accent transition-colors"
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">{entry.entry_number}</h4>
                  {getStatusBadge(entry.status)}
                </div>
                <p className="text-sm text-muted-foreground">{entry.description}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {entry.journals?.name_ar || entry.journals?.name} • {new Date(entry.entry_date).toLocaleDateString('ar-SA')}
                </p>
              </div>
              <div className="text-right">
                <div className="font-medium">{entry.total_debit?.toFixed(2)} ريال</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(entry.created_at).toLocaleDateString('ar-SA')}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function ChartOfAccounts() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [accounts, setAccounts] = useState<GLAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<any>(null) // Add debug info state

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      setLoading(true)
      setError(null)
      setDebugInfo(null)
      
      console.log('=== ChartOfAccounts Debug Info ===')
      console.log('Loading GL accounts...')
      
      // Use the specialized query function for gl_accounts
      const result = await getAllGLAccounts() // Use the new function to get all accounts
      
      // Type guard to ensure we have a valid array of GLAccount objects
      if (!Array.isArray(result)) {
        throw new Error('Invalid response format from getAllGLAccounts')
      }
      
      // Filter out any objects that don't match the GLAccount interface
      const validAccounts = result.filter(account => 
        account && 
        typeof account === 'object' && 
        'id' in account && 
        'code' in account && 
        'name' in account
      ) as GLAccount[]
      
      // Get org ID for debugging
      const client = await getSupabase();
      if (!client) throw new Error('Supabase client not initialized');
      
      const { data: { session } } = await client.auth.getSession()
      
      // Try to get org ID using the enhanced function
      const orgId = await getEffectiveTenantId();
      
      console.log('GL accounts query result:', result)
      setDebugInfo({
        timestamp: new Date().toISOString(),
        result: validAccounts,
        dataLength: validAccounts.length || 0,
        orgId: orgId,
        session: session ? {
          userId: session.user?.id,
          userEmail: session.user?.email,
          userMetadata: session.user?.user_metadata,
          appMetadata: session.user?.app_metadata
        } : null
      })

      console.log('Setting accounts data:', validAccounts.length, 'records')
      setAccounts(validAccounts)
      
      // If no accounts found, show a message
      if (validAccounts.length === 0) {
        console.log('No accounts found - showing empty state')
        setError('لا توجد حسابات متاحة. قد يكون هذا بسبب عدم تسجيل الدخول أو عدم وجود بيانات.')
      } else {
        console.log('Successfully loaded', validAccounts.length, 'accounts')
      }
    } catch (err: any) {
      console.error('Error loading accounts:', err)
      setDebugInfo({
        timestamp: new Date().toISOString(),
        error: err.message,
        stack: err.stack
      })
      // Check if it's a stack depth error
      if (err.message && err.message.includes('stack depth limit exceeded')) {
        setError('Database configuration issue: stack depth limit exceeded. This is a known issue with recursive queries.')
      }
      // Check if the error is related to table not found
      else if (err.message && (err.message.includes('not found') || err.message.includes('relation') || err.message.includes('table'))) {
        setError('جدول الحسابات غير موجود في قاعدة البيانات. قد تحتاج إلى إعداد قاعدة البيانات أولاً.')
      } else {
        setError('خطأ غير متوقع أثناء تحميل شجرة الحسابات')
      }
    } finally {
      setLoading(false)
    }
  }

  // Build hierarchical tree structure using path if available, otherwise fallback to parent_code
  const buildTree = (accounts: GLAccount[]): any[] => {
    const accountMap = new Map<string, any>()
    const roots: any[] = []

    // Initialize all accounts
    accounts.forEach(account => {
      accountMap.set(account.code, {
        ...account,
        children: [],
        level: 0
      })
    })

    // Build parent-child relationships using path-based approach
    accounts.forEach(account => {
      const node = accountMap.get(account.code)
      
      // Find parent using path-based approach
      // If path is '100000.110000.110100', parent path would be '100000.110000'
      if (account.path && account.path.includes('.')) {
        const pathParts = account.path.split('.')
        const parentPath = pathParts.slice(0, -1).join('.')
        
        // Find parent account by path
        const parentAccount = accounts.find(acc => acc.path === parentPath)
        if (parentAccount) {
          const parent = accountMap.get(parentAccount.code)
          if (parent) {
            parent.children.push(node)
            node.level = parent.level + 1
            return
          }
        }
      }
      
      // Fallback: use parent_code relationship when path is missing
      if ((!account.path || !account.path.includes('.')) && account.parent_code) {
        const parent = accountMap.get(account.parent_code)
        if (parent) {
          parent.children.push(node)
          node.level = parent.level + 1
          return
        }
      }

      // If no parent found or root account, add to roots
      roots.push(node)
    })

    return roots
  }

  // Toggle expanded state for an account
  const toggleExpand = (code: string) => {
    setExpandedAccounts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(code)) {
        newSet.delete(code)
      } else {
        newSet.add(code)
      }
      return newSet
    })
  }

  // Render account tree recursively
  const renderAccountTree = (account: any, level = 0) => {
    const isExpanded = expandedAccounts.has(account.code)
    const hasChildren = account.children && account.children.length > 0
    
    // Calculate padding based on level
    const paddingLeft = level > 0 ? `${Math.min(level * 16 + 16, 64)}px` : '16px'
    
    return (
      <div key={account.id}>
        <div 
          style={{ paddingLeft }}
          className="p-4 flex justify-between items-center hover:bg-accent transition-colors cursor-pointer"
          onClick={() => hasChildren && toggleExpand(account.code)}
        >
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {hasChildren && (
                <button className="text-muted-foreground">
                  {isExpanded ? '▼' : '►'}
                </button>
              )}
              <h4 className="font-medium">{account.code}</h4>
              {getAccountTypeBadge(account.category)}
              {getBalanceTypeBadge(account.normal_balance)}
              {account.allow_posting ? (
                <Badge variant="outline">يمكن النشر</Badge>
              ) : (
                <Badge variant="secondary">حساب رئيسي</Badge>
              )}
            </div>
            <p className="text-sm font-medium">{account.name_ar || account.name}</p>
            <p className="text-xs text-muted-foreground">{account.name}</p>
          </div>
          <div className="text-right">
            {account.is_active ? (
              <Badge variant="default">نشط</Badge>
            ) : (
              <Badge variant="destructive">غير نشط</Badge>
            )}
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="border-r-2 border-muted ml-4">
            {account.children.map((child: any) => renderAccountTree(child, level + 1))}
          </div>
        )}
      </div>
    )
  }

  const filteredAccounts = accounts.filter(account => 
    account.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    account.code.includes(searchTerm) ||
    (account.name_ar && account.name_ar.includes(searchTerm))
  )

  // Build tree only with filtered accounts
  const accountTree = buildTree(filteredAccounts)

  // Helper function to get account type badge
  const getAccountTypeBadge = (category: string) => {
    switch (category) {
      case 'ASSET':
        return <Badge variant="default">الأصول</Badge>
      case 'LIABILITY':
        return <Badge variant="destructive">الخصوم</Badge>
      case 'EQUITY':
        return <Badge variant="secondary">حقوق الملكية</Badge>
      case 'REVENUE':
        return <Badge variant="success">الإيرادات</Badge>
      case 'EXPENSE':
        return <Badge variant="outline">المصروفات</Badge>
      default:
        return <Badge variant="outline">{category}</Badge>
    }
  }

  // Helper function to get balance type badge
  const getBalanceTypeBadge = (balance: string) => {
    if (balance === 'DEBIT') {
      return <Badge variant="default">مدين</Badge>
    } else {
      return <Badge variant="secondary">دائن</Badge>
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
          <div>
            <h1 className="text-2xl font-bold">شجرة الحسابات</h1>
            <p className="text-muted-foreground">دليل الحسابات المحاسبية</p>
          </div>
        </div>
        
        {/* Debug Info Display */}
        {debugInfo && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="font-medium text-yellow-800 mb-2">Debug Information:</h3>
            <pre className="text-xs bg-white p-2 rounded overflow-auto max-h-40">
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
          </div>
        )}
        
        <div className="bg-card rounded-lg border p-6">
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">لا يمكن عرض شجرة الحسابات</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={loadAccounts} variant="outline">
              <RotateCcw className="h-4 w-4 ml-2" />
              إعادة المحاولة
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold">شجرة الحسابات</h1>
          <p className="text-muted-foreground">دليل الحسابات المحاسبية</p>
        </div>
        {/* Add refresh button for debugging */}
        <Button onClick={loadAccounts} variant="outline" size="sm">
          <RotateCcw className="h-4 w-4 ml-2" />
          تحديث
        </Button>
      </div>

      {/* Debug Info Display */}
      {debugInfo && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800 mb-2">Debug Information:</h3>
          <div className="text-sm">
            <p>Loaded at: {new Date(debugInfo.timestamp).toLocaleTimeString()}</p>
            <p>Records found: {debugInfo.dataLength}</p>
            {debugInfo.error && <p className="text-red-600">Error: {debugInfo.error}</p>}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="max-w-md">
        <Input
          placeholder="البحث في الحسابات..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Accounts Tree */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة الحسابات ({filteredAccounts.length})</h3>
        </div>
        <div className="divide-y">
          {accountTree.length > 0 ? (
            accountTree.map(account => renderAccountTree(account))
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>لا توجد حسابات لعرضها</p>
              <p className="text-sm mt-2">قد تحتاج إلى تسجيل الدخول أو إضافة حسابات</p>
              <Button onClick={loadAccounts} variant="outline" className="mt-4">
                <RotateCcw className="h-4 w-4 ml-2" />
                إعادة المحاولة
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function JournalEntries() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    loadEntries()
  }, [])

  const loadEntries = async () => {
    try {
      const client = await getSupabase();
      if (!client) throw new Error('Supabase client not initialized');
      
      const { data, error } = await client
        .from('journal_entries')
        .select(`
          *,
          journals(name, name_ar, code)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      setEntries(data || [])
    } catch (error) {
      console.error('Error loading journal entries:', error)
      toast.error('خطأ في تحميل القيود اليومية')
    } finally {
      setLoading(false)
    }
  }

  const filteredEntries = entries.filter(entry => {
    const matchesSearch = entry.entry_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (entry.description && entry.description.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesStatus = statusFilter === 'all' || entry.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline">مسودة</Badge>
      case 'posted':
        return <Badge variant="default">منشور</Badge>
      case 'reversed':
        return <Badge variant="destructive">معكوس</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-2xl font-bold">القيود اليومية</h1>
          <p className="text-muted-foreground">عرض وإدارة جميع القيود المحاسبية</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1 max-w-md">
          <Input
            placeholder="البحث في القيود..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-md"
        >
          <option value="all">جميع الحالات</option>
          <option value="draft">مسودة</option>
          <option value="posted">منشور</option>
          <option value="reversed">معكوس</option>
        </select>
      </div>

      {/* Entries List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-semibold">قائمة القيود ({filteredEntries.length})</h3>
        </div>
        <div className="divide-y">
          {filteredEntries.map((entry) => (
            <Link
              key={entry.id}
              to={`/general-ledger/entries/${entry.id}`}
              className="block p-4 hover:bg-accent transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium">{entry.entry_number}</h4>
                    {getStatusBadge(entry.status)}
                  </div>
                  <p className="text-sm text-muted-foreground">{entry.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>{entry.journals?.name_ar || entry.journals?.name}</span>
                    <span>تاريخ القيد: {new Date(entry.entry_date).toLocaleDateString('ar-SA')}</span>
                    {entry.posted_at && (
                      <span>تاريخ النشر: {new Date(entry.posted_at).toLocaleDateString('ar-SA')}</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{entry.total_debit?.toFixed(2)} ريال</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleDateString('ar-SA')}
                  </div>
                  {entry.reference_number && (
                    <div className="text-xs text-blue-600">
                      مرجع: {entry.reference_number}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function JournalEntryDetails() {
  // This component will be implemented to show detailed view of a journal entry
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">تفاصيل القيد المحاسبي</h1>
      <p className="text-muted-foreground">سيتم تطوير هذه الصفحة لاحقاً</p>
    </div>
  )
}

function TrialBalance() {
  // This component will show trial balance report
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">ميزان المراجعة</h1>
      <p className="text-muted-foreground">سيتم تطوير هذا التقرير لاحقاً</p>
    </div>
  )
}

function PostingManagement() {
  // This component will handle posting and reversing entries
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">إدارة النشر</h1>
      <p className="text-muted-foreground">سيتم تطوير هذه الوظيفة لاحقاً</p>
    </div>
  )
}